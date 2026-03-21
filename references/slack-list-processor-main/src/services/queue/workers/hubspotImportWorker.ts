/**
 * BullMQ worker for HubSpot contact import jobs.
 *
 * Processes jobs from the 'hubspot-import' queue. Downloads the source
 * file from S3, applies column mapping, batch-upserts contacts to HubSpot
 * (100 per batch), creates a static list, adds contacts to the list,
 * and posts progress/completion messages to Slack.
 */

import { Worker, Job } from 'bullmq';
import { Client as HubSpotClient } from '@hubspot/api-client';
import { config } from '../../../config/index.js';
import { prisma } from '../../../models/index.js';
import { downloadFile } from '../../../lib/storage.js';
import { getAccessToken } from '../../hubspot/hubspotOAuth.js';
import { ensureEnrichmentProperties } from '../../hubspot/hubspotPropertyMapping.js';
import { executeImport } from '../../crm/crmImportService.js';
import { logAudit } from '../../../lib/auditLogger.js';
import logger from '../../../lib/logger.js';
import type { HubSpotImportJobData } from '../queues.js';
import { promptContextCache } from '../../cache/promptCache.js';
// T087: Import systemEventEmitter for chain event publishing
import { emitEvent } from '../../autonomous/systemEventEmitter.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum contacts per batch upsert API call. */
const BATCH_SIZE = 100;

/** Post progress to Slack every N contacts. */
const PROGRESS_INTERVAL = 500;

/** Delay (ms) between batches to respect rate limits. */
const BATCH_DELAY_MS = 200;

// ---------------------------------------------------------------------------
// Worker processor
// ---------------------------------------------------------------------------

/**
 * Processes a single HubSpot import job.
 *
 * Steps:
 *   1. Load import job + connection from DB
 *   2. Set status to PROCESSING
 *   3. Get valid access token (auto-refresh if needed)
 *   4. Ensure custom enrichment properties exist
 *   5. Download + parse source file from S3
 *   6. Apply column mapping to transform rows
 *   7. Batch upsert contacts (100/batch)
 *   8. Create static list
 *   9. Add contact IDs to list
 *  10. Update DB with results + post completion to Slack
 */
async function processImportJob(
  job: Job<HubSpotImportJobData>,
  slackClient: { chat: { postMessage: (args: Record<string, unknown>) => Promise<unknown> } },
): Promise<void> {
  const { importJobId, clientId, channelId, threadTs } = job.data;

  // 1. Load import job
  const importJob = await prisma.hubSpotImportJob.findUnique({
    where: { id: importJobId },
    include: { connection: true },
  });

  if (!importJob || importJob.status === 'CANCELLED') {
    logger.info('Import job not found or cancelled', { importJobId });
    return;
  }

  // 2. Set status to PROCESSING
  await prisma.hubSpotImportJob.update({
    where: { id: importJobId },
    data: { status: 'PROCESSING', startedAt: new Date() },
  });

  // --- CRM-agnostic path: delegate to crmImportService when enrichmentJobId is present ---
  if (importJob.enrichmentJobId) {
    try {
      // Look up CrmConnection for this client
      const crmConnection = await prisma.crmConnection.findUnique({
        where: { clientId_crmType: { clientId, crmType: 'HUBSPOT' } },
      });

      if (!crmConnection) {
        throw new Error(`No CRM connection found for client ${clientId} (type: HUBSPOT)`);
      }

      const result = await executeImport(crmConnection.id, importJob.enrichmentJobId, {
        listName: importJob.listName,
        incrementalOnly: false,
      });

      // Update HubSpotImportJob with results from CRM import service
      await prisma.hubSpotImportJob.update({
        where: { id: importJobId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          contactsCreated: result.upsertResult.succeeded,
          contactsUpdated: 0,
          contactsFailed: result.upsertResult.failed,
          contactsTotal: result.totalContacts,
          hubspotListId: result.listId || null,
          hubspotListUrl: result.listId
            ? `https://app.hubspot.com/contacts/${importJob.connection.hubspotPortalId}/objects/0-1/views/${result.listId}/list`
            : null,
        },
      });

      // T027: Invalidate prompt context cache on HubSpot import completion
      if (importJob.enrichmentJobId) {
        const enrichmentJob = await prisma.job.findUnique({
          where: { id: importJob.enrichmentJobId },
          select: { slackTeamId: true, slackUserId: true },
        });
        if (enrichmentJob) {
          await promptContextCache.invalidate(enrichmentJob.slackTeamId, enrichmentJob.slackUserId);
        }
      }

      // Update connection stats
      await prisma.hubSpotConnection.update({
        where: { id: importJob.connectionId },
        data: {
          totalContactsSynced: { increment: result.upsertResult.succeeded },
          lastSyncAt: new Date(),
        },
      });

      const listLink = result.listId
        ? `\n<https://app.hubspot.com/contacts/${importJob.connection.hubspotPortalId}/objects/0-1/views/${result.listId}/list|View list in HubSpot>`
        : '';

      await postToSlack(slackClient, channelId, threadTs,
        `*HubSpot Import Complete* (via CRM adapter)\n\n` +
        `*List:* \`${importJob.listName}\`\n` +
        `*Pushed:* ${result.upsertResult.succeeded.toLocaleString()} contacts\n` +
        `*Failed:* ${result.upsertResult.failed.toLocaleString()} contacts\n` +
        `*Total:* ${result.totalContacts.toLocaleString()} contacts` +
        listLink,
      );

      logger.info('HubSpot import completed via CRM adapter', {
        importJobId,
        enrichmentJobId: importJob.enrichmentJobId,
        succeeded: result.upsertResult.succeeded,
        failed: result.upsertResult.failed,
      });

      return;
    } catch (err) {
      logger.error('CRM adapter import failed, falling through to legacy path', {
        error: err instanceof Error ? err.message : String(err),
        importJobId,
      });

      await prisma.hubSpotImportJob.update({
        where: { id: importJobId },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      });

      // T027: Invalidate prompt context cache on HubSpot import failure
      if (importJob.enrichmentJobId) {
        const enrichmentJob = await prisma.job.findUnique({
          where: { id: importJob.enrichmentJobId },
          select: { slackTeamId: true, slackUserId: true },
        });
        if (enrichmentJob) {
          await promptContextCache.invalidate(enrichmentJob.slackTeamId, enrichmentJob.slackUserId);
        }
      }

      await postToSlack(slackClient, channelId, threadTs,
        `HubSpot import failed: ${err instanceof Error ? err.message : 'Unknown error'}. Please try again.`);

      return;
    }
  }

  // --- Legacy CSV-based import path (no enrichmentJobId) ---
  try {
    // 3. Get access token
    const accessToken = await getAccessToken(clientId);
    const hubspotClient = new HubSpotClient({ accessToken });

    // 4. Ensure enrichment properties
    await ensureEnrichmentProperties(clientId);

    // 5. Download and parse source file
    const key = importJob.sourceFileUrl?.includes('://')
      ? new URL(importJob.sourceFileUrl).pathname.slice(1)
      : importJob.sourceFileUrl || '';

    let buffer: Buffer;
    try {
      buffer = await downloadFile(key);
    } catch (dlErr) {
      const msg = `Failed to download source file: ${dlErr instanceof Error ? dlErr.message : String(dlErr)}`;
      logger.error(msg, { importJobId, key });
      await prisma.hubSpotImportJob.update({
        where: { id: importJobId },
        data: { status: 'FAILED', completedAt: new Date(), errorMessage: msg },
      });
      await postToSlack(slackClient, channelId, threadTs,
        'HubSpot import failed: Could not download source file. Please try again.');
      return;
    }

    const rows = parseCsv(buffer.toString('utf-8'));

    if (rows.length === 0) {
      throw new Error('No data rows found in source file');
    }

    const columnMapping = importJob.columnMapping as Record<string, string>;
    const totalRows = rows.length;

    // Warn for large imports
    if (totalRows > 5000) {
      await postToSlack(slackClient, channelId, threadTs,
        `Large import: ${totalRows.toLocaleString()} rows. This may take several minutes.`);
    }

    // 6-7. Transform and batch upsert contacts
    let contactsCreated = 0;
    let contactsUpdated = 0;
    let contactsFailed = 0;
    const allContactIds: string[] = [];
    let processedCount = 0;

    for (let i = 0; i < totalRows; i += BATCH_SIZE) {
      // Check for cancellation mid-import
      const currentJob = await prisma.hubSpotImportJob.findUnique({
        where: { id: importJobId },
        select: { status: true },
      });
      if (currentJob?.status === 'CANCELLED') {
        logger.info('Import cancelled mid-processing', { importJobId });
        return;
      }

      const batch = rows.slice(i, i + BATCH_SIZE);
      const inputs = batch.map((row) => {
        const properties: Record<string, string> = {};
        for (const [csvCol, hsProp] of Object.entries(columnMapping)) {
          if (row[csvCol] !== undefined && row[csvCol] !== '') {
            properties[hsProp] = row[csvCol];
          }
        }
        // Add enrichment metadata
        properties['enrichment_source'] = 'Slack List Processor';
        properties['enrichment_date'] = new Date().toISOString().split('T')[0];
        if (importJob.enrichmentJobId) {
          properties['enrichment_job_id'] = importJob.enrichmentJobId;
        }

        return {
          idProperty: 'email',
          id: properties['email'] || '',
          properties,
        };
      }).filter((input) => input.id); // Skip rows without email

      if (inputs.length === 0) continue;

      try {
        // Refresh token if needed mid-import
        const currentToken = await getAccessToken(clientId);
        if (currentToken !== accessToken) {
          hubspotClient.setAccessToken(currentToken);
        }

        const result = await hubspotClient.crm.contacts.batchApi.upsert({
          inputs,
        });

        for (const contact of result.results) {
          allContactIds.push(contact.id);
          if (contact.createdAt && contact.updatedAt &&
              contact.createdAt.getTime() === contact.updatedAt.getTime()) {
            contactsCreated++;
          } else {
            contactsUpdated++;

            // T087: Chain event integration point for CRM Conflict Resolver (T082).
            // When a contact is being UPDATED (not created), this is where a sync
            // conflict may exist — the incoming data differs from the existing
            // HubSpot record. To enable the CRM Conflict Resolver agent, publish
            // a 'hubspot.sync.conflict' chain event here with the existing and
            // incoming record fields:
            //
            // await emitEvent({
            //   type: 'hubspot.sync.conflict',
            //   severity: 'INFO',
            //   message: `Sync conflict detected for contact ${contact.id}`,
            //   metadata: {
            //     conflictId: `${importJobId}-${contact.id}`,
            //     existingRecord: contact.properties,
            //     incomingRecord: inputs.find(i => i.id === contact.properties?.email)?.properties ?? {},
            //     importJobId,
            //   },
            //   agentName: 'CRM Conflict Resolver',
            // });
          }

          // Create HubSpotContactMapping for activity lookups
          const contactEmail = contact.properties?.email;
          if (contactEmail) {
            await prisma.hubSpotContactMapping.upsert({
              where: {
                connectionId_email: {
                  connectionId: importJob.connectionId,
                  email: contactEmail,
                },
              },
              create: {
                connectionId: importJob.connectionId,
                email: contactEmail,
                hubspotContactId: contact.id,
              },
              update: {
                hubspotContactId: contact.id,
              },
            });
          }
        }
      } catch (err: unknown) {
        const statusCode = (err as { code?: number })?.code;
        if (statusCode === 429) {
          // Rate limited — wait and retry
          logger.warn('HubSpot rate limit hit, waiting 10s', { importJobId, batch: i });
          await delay(10000);
          i -= BATCH_SIZE; // Retry this batch
          continue;
        }

        logger.error('HubSpot batch upsert failed', { error: err, importJobId, batchStart: i });
        contactsFailed += inputs.length;
      }

      processedCount += batch.length;

      // Post progress every PROGRESS_INTERVAL
      if (processedCount % PROGRESS_INTERVAL < BATCH_SIZE && processedCount > 0) {
        await postToSlack(slackClient, channelId, threadTs,
          `Importing to HubSpot... ${processedCount.toLocaleString()}/${totalRows.toLocaleString()} contacts processed.`);
      }

      // Brief delay between batches
      if (i + BATCH_SIZE < totalRows) {
        await delay(BATCH_DELAY_MS);
      }
    }

    // 8. Create static list
    let hubspotListId: string | null = null;
    let hubspotListUrl: string | null = null;

    if (allContactIds.length > 0) {
      try {
        const currentToken = await getAccessToken(clientId);
        hubspotClient.setAccessToken(currentToken);

        const listResult = await hubspotClient.crm.lists.listsApi.create({
          name: importJob.listName,
          processingType: 'MANUAL',
          objectTypeId: '0-1',
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const listData = (listResult as any).list || listResult;
        hubspotListId = listData.listId ? String(listData.listId) : null;

        if (hubspotListId) {
          // 9. Add contacts to list in batches
          for (let i = 0; i < allContactIds.length; i += BATCH_SIZE) {
            const contactBatch = allContactIds.slice(i, i + BATCH_SIZE);
            await hubspotClient.crm.lists.membershipsApi.add(
              hubspotListId,
              contactBatch,
            );
            if (i + BATCH_SIZE < allContactIds.length) {
              await delay(BATCH_DELAY_MS);
            }
          }

          hubspotListUrl = `https://app.hubspot.com/contacts/${importJob.connection.hubspotPortalId}/objects/0-1/views/${hubspotListId}/list`;
        }
      } catch (err) {
        logger.error('HubSpot list creation/membership failed', { error: err, importJobId });
        // Non-fatal — contacts are already upserted. Warn user.
        await postToSlack(slackClient, channelId, threadTs,
          `Warning: ${allContactIds.length.toLocaleString()} contacts were upserted in HubSpot, but list creation failed. Contacts are available in CRM but no list was created.`);
      }
    }

    // 10. Update DB
    await prisma.hubSpotImportJob.update({
      where: { id: importJobId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        contactsCreated,
        contactsUpdated,
        contactsFailed,
        contactsTotal: contactsCreated + contactsUpdated + contactsFailed,
        hubspotListId,
        hubspotListUrl,
      },
    });

    // Update connection stats
    await prisma.hubSpotConnection.update({
      where: { id: importJob.connectionId },
      data: {
        totalContactsSynced: { increment: contactsCreated + contactsUpdated },
        lastSyncAt: new Date(),
      },
    });

    // Create sync log
    await prisma.hubSpotSyncLog.create({
      data: {
        connectionId: importJob.connectionId,
        syncType: 'CONTACT_IMPORT',
        direction: 'push',
        recordsProcessed: totalRows,
        recordsCreated: contactsCreated,
        recordsUpdated: contactsUpdated,
        recordsFailed: contactsFailed,
        metadata: { importJobId, listName: importJob.listName },
      },
    });

    // Post completion summary
    const listLink = hubspotListUrl
      ? `\n<${hubspotListUrl}|View list in HubSpot>`
      : '';

    await postToSlack(slackClient, channelId, threadTs,
      `*HubSpot Import Complete*\n\n` +
      `*List:* \`${importJob.listName}\`\n` +
      `*Created:* ${contactsCreated.toLocaleString()} contacts\n` +
      `*Updated:* ${contactsUpdated.toLocaleString()} contacts\n` +
      `*Failed:* ${contactsFailed.toLocaleString()} contacts\n` +
      `*Total:* ${(contactsCreated + contactsUpdated + contactsFailed).toLocaleString()} contacts` +
      listLink,
    );

    logger.info('HubSpot import completed', {
      importJobId,
      contactsCreated,
      contactsUpdated,
      contactsFailed,
      hubspotListId,
    });

    logAudit({
      action: 'hubspot_import_completed',
      actorUserId: 'system',
      targetType: 'HubSpotImportJob',
      targetId: importJobId,
      metadata: { clientId, contactsCreated, contactsUpdated, contactsFailed, listName: importJob.listName },
    }).catch(() => {});
  } catch (err) {
    logger.error('HubSpot import job failed', { error: err, importJobId });

    await prisma.hubSpotImportJob.update({
      where: { id: importJobId },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        errorMessage: err instanceof Error ? err.message : String(err),
      },
    });

    await prisma.hubSpotConnection.update({
      where: { id: importJob!.connectionId },
      data: { totalSyncFailures: { increment: 1 } },
    });

    logAudit({
      action: 'hubspot_import_failed',
      actorUserId: 'system',
      targetType: 'HubSpotImportJob',
      targetId: importJobId,
      metadata: { clientId, error: err instanceof Error ? err.message : String(err) },
    }).catch(() => {});

    await postToSlack(slackClient, channelId, threadTs,
      `HubSpot import failed: ${err instanceof Error ? err.message : 'Unknown error'}. Please try again.`);
  }
}

// ---------------------------------------------------------------------------
// Worker factory
// ---------------------------------------------------------------------------

/**
 * Creates and returns the HubSpot import BullMQ worker.
 *
 * @param slackClient - Slack WebClient for posting progress messages
 */
export function createHubSpotImportWorker(slackClient: unknown): Worker {
  const worker = new Worker<HubSpotImportJobData>(
    'hubspot-import',
    async (job: Job<HubSpotImportJobData>) => {
      await processImportJob(
        job,
        slackClient as { chat: { postMessage: (args: Record<string, unknown>) => Promise<unknown> } },
      );
    },
    {
      connection: { url: config.redis.url },
      concurrency: 1,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error('HubSpot import worker job failed', {
      jobId: job?.id,
      error: err.message,
    });
  });

  return worker;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Posts a message to Slack, optionally in a thread.
 */
async function postToSlack(
  slackClient: { chat: { postMessage: (args: Record<string, unknown>) => Promise<unknown> } },
  channelId: string,
  threadTs: string | undefined | null,
  text: string,
): Promise<void> {
  try {
    await slackClient.chat.postMessage({
      channel: channelId,
      text,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    });
  } catch (err) {
    logger.warn('Failed to post HubSpot import update to Slack', { error: err });
  }
}

/**
 * Parses CSV content into an array of row objects using the first row as headers.
 */
function parseCsv(content: string): Array<Record<string, string>> {
  const lines = content.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const rows: Array<Record<string, string>> = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || '';
    }
    rows.push(row);
  }

  return rows;
}

/**
 * Parses a single CSV line, handling quoted fields.
 */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current.trim().replace(/\r$/, ''));

  return fields;
}

/**
 * Simple delay utility.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
