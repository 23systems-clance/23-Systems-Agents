/**
 * CRM import orchestrator service.
 *
 * Orchestrates the end-to-end CRM import flow in a CRM-agnostic way:
 * 1. Load CrmConnection + field mappings from DB
 * 2. Convert enrichment results to canonical records (via canonicalMapper)
 * 3. Upsert canonical records to the database (via canonicalService)
 * 4. Look up the appropriate adapter from the registry by crmType
 * 5. Filter records needing push via CrmPushRecord timestamps
 * 6. Call adapter.upsertContacts() with mapped fields
 * 7. Update CrmPushRecord with results
 *
 * This service MUST NOT import any CRM-specific modules directly.
 */

import type { CrmConnection, CrmFieldMapping, CrmPushStatus } from '@prisma/client';
import { prisma } from '../../models/index.js';
import { getAdapter } from './crmAdapterRegistry.js';
import type { CrmImportOptions, CrmUpsertResult } from './types.js';
import {
  mapJobCompaniesToCanonicalAccounts,
  mapJobContactsToCanonicalContacts,
} from '../canonical/canonicalMapper.js';
import {
  upsertAccounts,
  upsertContacts,
} from '../canonical/canonicalService.js';
import logger from '../../lib/logger.js';

/** Result returned from executeImport. */
export interface CrmImportResult {
  /** Total canonical contacts processed. */
  totalContacts: number;
  /** Total canonical accounts processed. */
  totalAccounts: number;
  /** CRM adapter upsert result. */
  upsertResult: CrmUpsertResult;
  /** Whether a CRM list was created/populated. */
  listCreated: boolean;
  /** CRM-side list ID (if created). */
  listId?: string;
}

/**
 * Execute a full CRM import for a given connection and enrichment job.
 *
 * @param connectionId - CrmConnection UUID.
 * @param enrichmentJobId - The Job UUID whose results should be imported.
 * @param options - Import options (incremental, list name).
 * @returns Import result summary.
 */
export async function executeImport(
  connectionId: string,
  enrichmentJobId: string,
  options: CrmImportOptions = {},
): Promise<CrmImportResult> {
  const startTime = Date.now();

  // 1. Load CRM connection and field mappings
  const connection = await prisma.crmConnection.findUniqueOrThrow({
    where: { id: connectionId },
    include: { fieldMappings: true },
  });

  if (connection.status !== 'ACTIVE') {
    throw new Error(`CRM connection ${connectionId} is not active (status: ${connection.status})`);
  }

  // 2. Load enrichment job with companies and contacts
  const job = await prisma.job.findUniqueOrThrow({
    where: { id: enrichmentJobId },
    include: {
      companies: {
        include: { technologies: true },
      },
      contacts: true,
    },
  });

  // 3. Convert to canonical records
  const canonicalAccounts = mapJobCompaniesToCanonicalAccounts(job.companies, job);
  const companyMap = new Map(job.companies.map((c) => [c.id, c]));
  const canonicalContacts = mapJobContactsToCanonicalContacts(job.contacts, companyMap, job);

  logger.info('CRM import: canonical conversion complete', {
    connectionId,
    enrichmentJobId,
    accounts: canonicalAccounts.length,
    contacts: canonicalContacts.length,
  });

  // 4. Upsert canonical records to database
  const dbAccounts = await upsertAccounts(canonicalAccounts);
  const dbContacts = await upsertContacts(canonicalContacts);

  // 5. Filter for records needing push (incremental mode)
  let contactsToPush = canonicalContacts;
  if (options.incrementalOnly) {
    const existingPushRecords = await prisma.crmPushRecord.findMany({
      where: {
        crmConnectionId: connectionId,
        canonicalContactId: { in: dbContacts.map((c) => c.id) },
        pushStatus: 'SUCCESS',
      },
      select: { canonicalContactId: true, lastPushedAt: true },
    });

    const pushedContactIds = new Set(
      existingPushRecords
        .filter((pr) => pr.canonicalContactId)
        .map((pr) => pr.canonicalContactId!),
    );

    // Build email set for contacts that were already successfully pushed
    const alreadyPushedEmails = new Set<string>();
    for (const dbContact of dbContacts) {
      if (pushedContactIds.has(dbContact.id)) {
        alreadyPushedEmails.add(dbContact.email);
      }
    }

    contactsToPush = canonicalContacts.filter(
      (c) => !alreadyPushedEmails.has(c.email),
    );

    logger.info('CRM import: incremental filter applied', {
      total: canonicalContacts.length,
      skipped: canonicalContacts.length - contactsToPush.length,
      toPush: contactsToPush.length,
    });
  }

  // 6. Look up adapter and push contacts
  const adapter = getAdapter(connection.crmType);
  const upsertResult = await adapter.upsertContacts(
    connectionId,
    contactsToPush,
    connection.fieldMappings,
  );

  // 7. Update push records
  await updatePushRecords(
    connectionId,
    dbContacts,
    upsertResult,
  );

  // 8. Optionally create a CRM list and add contacts
  let listCreated = false;
  let listId: string | undefined;
  if (options.listName) {
    try {
      listId = await adapter.createList(connectionId, options.listName);
      const crmContactIds = Array.from(upsertResult.crmRecordIds.values());
      if (crmContactIds.length > 0) {
        await adapter.addContactsToList(connectionId, listId, crmContactIds);
      }
      listCreated = true;
    } catch (err) {
      logger.error('CRM import: failed to create/populate list', {
        connectionId,
        listName: options.listName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const duration = Date.now() - startTime;
  logger.info('CRM import complete', {
    connectionId,
    enrichmentJobId,
    totalContacts: canonicalContacts.length,
    totalAccounts: canonicalAccounts.length,
    succeeded: upsertResult.succeeded,
    failed: upsertResult.failed,
    listCreated,
    durationMs: duration,
  });

  // 9. Write audit log entry (SOC 2 compliance)
  await writeSyncAuditLog(connection, enrichmentJobId, upsertResult, duration);

  return {
    totalContacts: canonicalContacts.length,
    totalAccounts: canonicalAccounts.length,
    upsertResult,
    listCreated,
    listId,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Update CrmPushRecord entries based on upsert results.
 *
 * Creates or updates push records for each canonical contact, tracking
 * success/failure status and CRM-side record IDs.
 */
async function updatePushRecords(
  connectionId: string,
  dbContacts: Array<{ id: string; email: string }>,
  upsertResult: CrmUpsertResult,
): Promise<void> {
  const contactByEmail = new Map(
    dbContacts.map((c) => [c.email.toLowerCase(), c.id]),
  );

  const errorByEmail = new Map(
    upsertResult.errors.map((e) => [e.email.toLowerCase(), e.error]),
  );

  for (const [email, crmRecordId] of upsertResult.crmRecordIds) {
    const canonicalContactId = contactByEmail.get(email.toLowerCase());
    if (!canonicalContactId) continue;

    await prisma.crmPushRecord.upsert({
      where: {
        crmConnectionId_canonicalContactId: {
          crmConnectionId: connectionId,
          canonicalContactId,
        },
      },
      create: {
        crmConnectionId: connectionId,
        canonicalContactId,
        crmRecordId,
        pushStatus: 'SUCCESS',
        lastPushedAt: new Date(),
      },
      update: {
        crmRecordId,
        pushStatus: 'SUCCESS',
        lastPushedAt: new Date(),
        errorMessage: null,
      },
    });
  }

  // Record failures
  for (const { email, error } of upsertResult.errors) {
    const canonicalContactId = contactByEmail.get(email.toLowerCase());
    if (!canonicalContactId) continue;

    await prisma.crmPushRecord.upsert({
      where: {
        crmConnectionId_canonicalContactId: {
          crmConnectionId: connectionId,
          canonicalContactId,
        },
      },
      create: {
        crmConnectionId: connectionId,
        canonicalContactId,
        pushStatus: 'FAILED',
        errorMessage: error,
      },
      update: {
        pushStatus: 'FAILED',
        errorMessage: error,
      },
    });
  }
}

/**
 * Write an audit log entry for a CRM import operation.
 *
 * Uses the existing HubSpotSyncLog table for SOC 2 compliance.
 * For non-HubSpot CRM types, logs a warning and skips (future: dedicated CrmSyncLog table).
 */
async function writeSyncAuditLog(
  connection: CrmConnection & { fieldMappings: CrmFieldMapping[] },
  enrichmentJobId: string,
  upsertResult: CrmUpsertResult,
  durationMs: number,
): Promise<void> {
  try {
    if (connection.crmType !== 'HUBSPOT' || !connection.hubspotConnectionId) {
      logger.warn('CRM import audit: skipping — no HubSpotConnection link', {
        connectionId: connection.id,
        crmType: connection.crmType,
      });
      return;
    }

    await prisma.hubSpotSyncLog.create({
      data: {
        connectionId: connection.hubspotConnectionId,
        syncType: 'CONTACT_IMPORT',
        direction: 'push',
        recordsProcessed: upsertResult.succeeded + upsertResult.failed,
        recordsCreated: upsertResult.succeeded,
        recordsUpdated: 0,
        recordsFailed: upsertResult.failed,
        durationMs,
        metadata: {
          source: 'crmImportService',
          crmConnectionId: connection.id,
          enrichmentJobId,
          fieldMappingCount: connection.fieldMappings.length,
        },
      },
    });
  } catch (err) {
    logger.error('CRM import audit: failed to write sync log', {
      connectionId: connection.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
