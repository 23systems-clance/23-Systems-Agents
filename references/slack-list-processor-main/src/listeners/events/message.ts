/**
 * Bolt message event handler.
 *
 * After the migration to /enrich slash commands, this listener only
 * handles metadata replies (list owner / additional context) in threads
 * where the conversation state indicates metadata collection is pending.
 *
 * The exported handleTechnographicFlow and handleCombinedFlow functions
 * are still called by action handlers (enrichmentType, cosellCheck, etc.).
 */

import type { App } from '@slack/bolt';
import type { GenericMessageEvent } from '@slack/types';
import { v4 as uuidv4 } from 'uuid';
import { trackUsage } from '../../services/metering/usageTracker.js';
import type { ApolloContactFilters } from '../../types/enrichmentFilters.js';
import { getConversation, updateConversation } from '../../services/state/conversationStore.js';
import { handleContactEnrichment } from '../../listeners/actions/purposeSelection.js';
import { handleFilterMessage } from '../../listeners/actions/filterFlow.js';
import { prisma } from '../../models/index.js';
import { resolveClientId } from '../../lib/clientLookup.js';
import { enrichmentQueue } from '../../services/queue/queues.js';
import { downloadSlackFile } from '../../services/file/slackFile.js';
import { parseFile } from '../../services/file/parser.js';
import { autoDetectAndNormalizeColumns } from '../../services/file/columnAutoDetector.js';
import { validateFile, buildValidationErrorBlocks, uploadTemplateCsv } from '../../services/file/validator.js';
import { config } from '../../config/index.js';
import logger from '../../lib/logger.js';
import { extractSlugsFromMessage, resolveDocumentReferences } from '../../services/document/referenceResolver.js';
import { logAudit } from '../../lib/auditLogger.js';
import { loadQualityGateConfig, snapshotConfig } from '../../services/qualityGate/config.js';
import { runQualityGate, buildFilteringSummaryBlocks } from '../../services/qualityGate/qualityGate.js';
import { generateFilteredCsv } from '../../services/qualityGate/filteredCsv.js';
import { formatDocumentList } from '../../services/document/listFormatter.js';
import { archiveDocument } from '../../services/document/archiver.js';
import { generateTableOfContents } from '../../services/document/tocGenerator.js';
import { isDocsChannel } from '../../services/document/channelDetector.js';

/**
 * Resolves a Slack channel name from its ID, returning null on failure.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveChannelName(client: any, channelId: string): Promise<string | null> {
  try {
    const info = await client.conversations.info({ channel: channelId });
    return info.channel?.name ?? null;
  } catch {
    return null;
  }
}

/** MIME type mapping for file type strings. */
const MIME_TYPE_MAP: Record<string, string> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/**
 * Resolves document references from a message text.
 *
 * Extracts slugs from the message (e.g. "using icp-acme" or "with settings-defaults"),
 * resolves them against the document store, and returns context string + settings overrides
 * for use in AI classification and enrichment.
 *
 * @param teamId - Slack team ID.
 * @param message - The message text to scan for slug references.
 * @param userId - Actor user ID for audit logging.
 * @param channelId - Channel where the message was sent.
 * @returns Object with documentContext string and optional settingsOverrides.
 */
export async function resolveMessageDocumentRefs(
  teamId: string,
  message: string,
  userId: string,
  channelId: string,
): Promise<{ documentContext: string; settingsOverrides: Record<string, unknown> | null }> {
  const slugs = extractSlugsFromMessage(message);

  if (slugs.length === 0) {
    return { documentContext: '', settingsOverrides: null };
  }

  const result = await resolveDocumentReferences(teamId, slugs);

  // Log audit events for each resolved reference.
  for (const doc of result.documents) {
    logAudit({
      action: 'doc_reference',
      actorUserId: userId,
      actorTeamId: teamId,
      targetType: 'document',
      targetId: doc.slug,
      channelId,
      metadata: { slug: doc.slug, referencedFrom: 'message' },
    });
  }

  // Build context string from resolved documents.
  let documentContext = '';
  let settingsOverrides: Record<string, unknown> | null = null;

  for (const doc of result.documents) {
    documentContext += `\n--- Document: ${doc.slug} (${doc.documentType}) ---\n`;
    documentContext += doc.content;
    documentContext += '\n';

    // Merge settings overrides from SETTINGS documents.
    if (doc.parsedSettings && Object.keys(doc.parsedSettings).length > 0) {
      settingsOverrides = { ...(settingsOverrides ?? {}), ...doc.parsedSettings };
    }
  }

  // Log warnings for unresolved references.
  if (result.notFound.length > 0) {
    logger.warn('Unresolved document references', { slugs: result.notFound, teamId });
  }
  if (result.ambiguous.length > 0) {
    logger.warn('Ambiguous document references', {
      slugs: result.ambiguous.map((a) => a.slug),
      teamId,
    });
  }

  return { documentContext: documentContext.trim(), settingsOverrides };
}

/**
 * Handles the full technographic enrichment flow (T032):
 * 1. Download and parse the uploaded file
 * 2. Validate row count
 * 3. Create Job + JobCompany records in DB
 * 4. Enqueue BullMQ technographic enrichment job
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleTechnographicFlow(
  client: any,
  channelId: string,
  threadTs: string,
  conversation: {
    fileId: string;
    fileName: string;
    fileType: string;
    userId: string;
    isCosell?: boolean;
    cosellProvider?: string;
    listOwner?: string;
    additionalContext?: string;
    intentUsage?: { inputTokens: number; outputTokens: number; estimatedCostUsd: number; durationMs: number };
    creditRateSnapshot?: Record<string, unknown>;
    forceRefresh?: boolean;
  },
  enrichInstruction: string,
  userId: string,
  teamId: string,
): Promise<void> {
  // 1. Download the file from Slack.
  logger.info('handleTechnographicFlow: step 1 - downloading file', {
    fileId: conversation.fileId,
    channelId,
    threadTs,
  });
  const fileInfo = await client.files.info({ file: conversation.fileId });
  const file = fileInfo.file;
  const downloadUrl = file?.url_private;

  if (!downloadUrl) {
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: 'Unable to access the uploaded file. Please re-upload and try again.',
    });
    return;
  }

  const fileBuffer = await downloadSlackFile(downloadUrl, config.slack.botToken);
  logger.info('handleTechnographicFlow: step 1 complete - file downloaded', {
    bufferSize: fileBuffer.length,
  });

  // 2. Parse the file.
  logger.info('handleTechnographicFlow: step 2 - parsing file', {
    fileType: conversation.fileType,
  });
  const mimeType = MIME_TYPE_MAP[conversation.fileType] ?? 'text/csv';
  const parsed = parseFile(fileBuffer, mimeType);
  logger.info('handleTechnographicFlow: step 2 complete - file parsed', {
    rowCount: parsed.rows.length,
    domainColumn: parsed.domainColumn,
    companyNameColumn: parsed.companyNameColumn,
  });

  // 2.5. Auto-detect and normalize columns (before validation).
  logger.info('handleTechnographicFlow: step 2.5 - auto-detecting and normalizing columns');
  const normalized = autoDetectAndNormalizeColumns(parsed);
  logger.info('handleTechnographicFlow: step 2.5 complete - columns normalized', {
    domainColumn: normalized.domainColumn,
    companyNameColumn: normalized.companyNameColumn,
  });

  // 3. Validate file structure, data quality, and row count.
  logger.info('handleTechnographicFlow: step 3 - validating file');
  const fileValidation = validateFile(normalized);
  if (!fileValidation.valid) {
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      blocks: buildValidationErrorBlocks(fileValidation),
      text: 'File validation failed. Please check the format.',
    });
    await uploadTemplateCsv(client, channelId, threadTs);
    return;
  }
  logger.info('handleTechnographicFlow: step 3 complete - validation passed', {
    normalizedRowCount: fileValidation.normalizedRows.length,
    warningCount: fileValidation.warnings.length,
  });

  // Post any warnings (HTML cleaned, domains normalized, etc.).
  if (fileValidation.warnings.length > 0) {
    const warningText = fileValidation.warnings
      .map((w) => `- ${w.message}`)
      .join('\n');
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `Data quality notes:\n${warningText}`,
    });
  }

  // 4. Create Job record (including contextual metadata from T055).
  logger.info('handleTechnographicFlow: step 4 - creating Job record', {
    userId,
    teamId,
  });
  const channelName = await resolveChannelName(client, channelId);
  const techClientId = await resolveClientId(teamId, channelId);
  const jobId = uuidv4();
  const job = await prisma.job.create({
    data: {
      id: jobId,
      jobType: 'TECHNOGRAPHIC',
      status: 'PENDING',
      isCosell: conversation.isCosell ?? false,
      cosellProvider: conversation.cosellProvider ?? null,
      listOwner: conversation.listOwner ?? null,
      additionalContext: conversation.additionalContext ?? null,
      slackChannelId: channelId,
      slackChannelName: channelName,
      slackThreadTs: threadTs,
      slackUserId: userId,
      slackTeamId: teamId,
      clientId: techClientId,
      sourceFileName: conversation.fileName,
      sourceFileType: conversation.fileType === 'csv' ? 'CSV' : 'XLSX',
      sourceRowCount: parsed.rows.length,
      enrichInstruction,
      forceRefresh: conversation.forceRefresh ?? false,
      creditRateSnapshot: conversation.creditRateSnapshot
        ? JSON.parse(JSON.stringify(conversation.creditRateSnapshot))
        : undefined,
    },
  });
  logger.info('handleTechnographicFlow: step 4 complete - Job created', {
    jobId: job.id,
  });

  // 5. Log AI intent classification usage now that we have a jobId.
  if (conversation.intentUsage) {
    await trackUsage({
      jobId: job.id,
      slackTeamId: teamId,
      service: 'ANTHROPIC',
      endpoint: 'classifyIntent',
      tokensInput: conversation.intentUsage.inputTokens,
      tokensOutput: conversation.intentUsage.outputTokens,
      estimatedCostUsd: conversation.intentUsage.estimatedCostUsd,
      durationMs: conversation.intentUsage.durationMs,
    });
  }

  // 6. Run quality gate on parsed rows.
  logger.info('handleTechnographicFlow: step 6 - running quality gate');
  const gateConfig = await loadQualityGateConfig(techClientId);
  const { result: gateResult, passedRows, filteredRowDetails, uniqueDomainsList } = runQualityGate(
    fileValidation.normalizedRows,
    gateConfig,
    {
      emailColumn: parsed.emailColumn,
      domainColumn: parsed.domainColumn,
      companyNameColumn: parsed.companyNameColumn,
    },
  );

  // Generate filtered CSV and post Slack summary if rows were filtered.
  if (gateResult.filteredRows > 0) {
    const { key, url } = await generateFilteredCsv(
      filteredRowDetails,
      parsed.headers,
      job.id,
    );
    gateResult.filteredFileUrl = url;
    gateResult.filteredFileKey = key;

    const summaryBlocks = buildFilteringSummaryBlocks(gateResult, url);
    if (summaryBlocks) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        blocks: summaryBlocks,
        text: `Quality check: ${gateResult.passedRows} of ${gateResult.totalRows} rows passed. ${gateResult.filteredRows} filtered.`,
      });
    }
  }

  // Store quality gate result and config snapshot on the Job record.
  const configSnapshot = snapshotConfig(gateConfig);
  await prisma.job.update({
    where: { id: job.id },
    data: {
      qualityGateResult: JSON.parse(JSON.stringify(gateResult)),
      qualityGateConfigSnapshot: JSON.parse(JSON.stringify(configSnapshot)),
    },
  });

  // Log quality gate stats to ApiUsageLog (T031)
  await trackUsage({
    jobId: job.id,
    slackTeamId: teamId,
    service: 'QUALITY_GATE',
    endpoint: 'PreEnrichmentFilter',
    requestCount: gateResult.filteredRows,
    creditsConsumed: 0,
    estimatedCostUsd: 0,
    durationMs: gateResult.processingTimeMs,
  });

  logger.info('handleTechnographicFlow: step 6 complete - quality gate done', {
    totalRows: gateResult.totalRows,
    passedRows: gateResult.passedRows,
    filteredRows: gateResult.filteredRows,
  });

  // If all rows were filtered, mark job COMPLETED and stop.
  if (gateResult.passedRows === 0) {
    await prisma.job.update({
      where: { id: job.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    logger.info('handleTechnographicFlow: all rows filtered, job completed without enrichment', {
      jobId: job.id,
    });
    return;
  }

  // 7. Create JobCompany records using PASSED rows only.
  logger.info('handleTechnographicFlow: step 7 - creating JobCompany records', {
    companyCount: passedRows.length,
  });
  const companyData = passedRows.map((row, index) => ({
    id: uuidv4(),
    jobId: job.id,
    rowIndex: index,
    domain: parsed.domainColumn ? (row[parsed.domainColumn] as string) ?? null : null,
    companyName: parsed.companyNameColumn ? (row[parsed.companyNameColumn] as string) ?? null : null,
    enrichmentStatus: 'PENDING' as const,
  }));

  await prisma.jobCompany.createMany({ data: companyData });
  logger.info('handleTechnographicFlow: step 7 complete - JobCompany records created');

  // 8. Enqueue the technographic enrichment job and store BullMQ job ID.
  logger.info('handleTechnographicFlow: step 8 - enqueuing BullMQ job');
  const companies = companyData.map((c) => ({
    rowIndex: c.rowIndex,
    domain: c.domain ?? undefined,
    companyName: c.companyName ?? undefined,
  }));

  const bullmqJob = await enrichmentQueue.add('technographic-enrichment', {
    jobId: job.id,
    companies,
    uniqueDomains: uniqueDomainsList.length > 0 ? uniqueDomainsList : undefined,
    forceRefresh: conversation.forceRefresh ?? false,
  });

  await prisma.job.update({
    where: { id: job.id },
    data: { bullmqJobId: bullmqJob.id },
  });

  logger.info('Technographic enrichment job enqueued', {
    jobId: job.id,
    companyCount: companies.length,
    channelId,
    threadTs,
  });
}

/**
 * Handles the combined enrichment flow (T059):
 * Downloads the file, creates Job + JobCompany records, enqueues a
 * 'combined-enrichment' BullMQ job that runs both technographic and
 * contact enrichment.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleCombinedFlow(
  client: any,
  channelId: string,
  threadTs: string,
  userId: string,
  teamId: string,
  purpose: 'COLD_CALLING' | 'EMAILING' | 'JUST_A_LIST' | 'LINKEDIN',
  conversation: {
    fileId: string;
    fileName: string;
    fileType: string;
    isCosell?: boolean;
    cosellProvider?: string;
    listOwner?: string;
    additionalContext?: string;
    enrichInstruction?: string;
    intentUsage?: { inputTokens: number; outputTokens: number; estimatedCostUsd: number; durationMs: number };
    contactFilters?: ApolloContactFilters;
    creditRateSnapshot?: Record<string, unknown>;
    forceRefresh?: boolean;
  },
): Promise<void> {
  // 1. Download the file from Slack.
  const fileInfo = await client.files.info({ file: conversation.fileId });
  const file = fileInfo.file;
  const downloadUrl = file?.url_private;

  if (!downloadUrl) {
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: 'Unable to access the uploaded file. Please re-upload and try again.',
    });
    return;
  }

  const fileBuffer = await downloadSlackFile(downloadUrl, config.slack.botToken);

  // 2. Parse the file.
  const mimeType = MIME_TYPE_MAP[conversation.fileType] ?? 'text/csv';
  const parsed = parseFile(fileBuffer, mimeType);

  // 2.5. Auto-detect and normalize columns (before validation).
  const normalized = autoDetectAndNormalizeColumns(parsed);

  // 3. Validate file structure, data quality, and row count.
  const fileValidation = validateFile(normalized);
  if (!fileValidation.valid) {
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      blocks: buildValidationErrorBlocks(fileValidation),
      text: 'File validation failed. Please check the format.',
    });
    await uploadTemplateCsv(client, channelId, threadTs);
    return;
  }

  // Post any warnings (HTML cleaned, domains normalized, etc.).
  if (fileValidation.warnings.length > 0) {
    const warningText = fileValidation.warnings
      .map((w) => `- ${w.message}`)
      .join('\n');
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `Data quality notes:\n${warningText}`,
    });
  }

  // 4. Create Job record with metadata.
  const channelName = await resolveChannelName(client, channelId);
  const combinedClientId = await resolveClientId(teamId, channelId);
  const jobId = uuidv4();
  const job = await prisma.job.create({
    data: {
      id: jobId,
      jobType: 'COMBINED',
      status: 'PENDING',
      purpose,
      isCosell: conversation.isCosell ?? false,
      cosellProvider: conversation.cosellProvider ?? null,
      listOwner: conversation.listOwner ?? null,
      additionalContext: conversation.additionalContext ?? null,
      slackChannelId: channelId,
      slackChannelName: channelName,
      slackThreadTs: threadTs,
      slackUserId: userId,
      slackTeamId: teamId,
      clientId: combinedClientId,
      sourceFileName: conversation.fileName,
      sourceFileType: conversation.fileType === 'csv' ? 'CSV' : 'XLSX',
      sourceRowCount: parsed.rows.length,
      enrichInstruction: conversation.enrichInstruction ?? null,
      forceRefresh: conversation.forceRefresh ?? false,
      creditRateSnapshot: conversation.creditRateSnapshot
        ? JSON.parse(JSON.stringify(conversation.creditRateSnapshot))
        : undefined,
    },
  });

  // 5. Log AI intent classification usage now that we have a jobId.
  if (conversation.intentUsage) {
    await trackUsage({
      jobId: job.id,
      slackTeamId: teamId,
      service: 'ANTHROPIC',
      endpoint: 'classifyIntent',
      tokensInput: conversation.intentUsage.inputTokens,
      tokensOutput: conversation.intentUsage.outputTokens,
      estimatedCostUsd: conversation.intentUsage.estimatedCostUsd,
      durationMs: conversation.intentUsage.durationMs,
    });
  }

  // 6. Run quality gate on parsed rows.
  const combinedGateConfig = await loadQualityGateConfig(combinedClientId);
  const { result: combinedGateResult, passedRows: combinedPassedRows, filteredRowDetails: combinedFilteredDetails, uniqueDomainsList: combinedUniqueDomains } = runQualityGate(
    fileValidation.normalizedRows,
    combinedGateConfig,
    {
      emailColumn: parsed.emailColumn,
      domainColumn: parsed.domainColumn,
      companyNameColumn: parsed.companyNameColumn,
    },
  );

  if (combinedGateResult.filteredRows > 0) {
    const { key, url } = await generateFilteredCsv(
      combinedFilteredDetails,
      parsed.headers,
      job.id,
    );
    combinedGateResult.filteredFileUrl = url;
    combinedGateResult.filteredFileKey = key;

    const summaryBlocks = buildFilteringSummaryBlocks(combinedGateResult, url);
    if (summaryBlocks) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        blocks: summaryBlocks,
        text: `Quality check: ${combinedGateResult.passedRows} of ${combinedGateResult.totalRows} rows passed. ${combinedGateResult.filteredRows} filtered.`,
      });
    }
  }

  const combinedConfigSnapshot = snapshotConfig(combinedGateConfig);
  await prisma.job.update({
    where: { id: job.id },
    data: {
      qualityGateResult: JSON.parse(JSON.stringify(combinedGateResult)),
      qualityGateConfigSnapshot: JSON.parse(JSON.stringify(combinedConfigSnapshot)),
    },
  });

  // Log quality gate stats to ApiUsageLog (T031)
  await trackUsage({
    jobId: job.id,
    slackTeamId: teamId,
    service: 'QUALITY_GATE',
    endpoint: 'PreEnrichmentFilter',
    requestCount: combinedGateResult.filteredRows,
    creditsConsumed: 0,
    estimatedCostUsd: 0,
    durationMs: combinedGateResult.processingTimeMs,
  });

  if (combinedGateResult.passedRows === 0) {
    await prisma.job.update({
      where: { id: job.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    logger.info('handleCombinedFlow: all rows filtered, job completed without enrichment', {
      jobId: job.id,
    });
    return;
  }

  // 7. Create JobCompany records using PASSED rows only.
  const companyData = combinedPassedRows.map((row, index) => ({
    id: uuidv4(),
    jobId: job.id,
    rowIndex: index,
    domain: parsed.domainColumn ? (row[parsed.domainColumn] as string) ?? null : null,
    companyName: parsed.companyNameColumn ? (row[parsed.companyNameColumn] as string) ?? null : null,
    enrichmentStatus: 'PENDING' as const,
  }));

  await prisma.jobCompany.createMany({ data: companyData });

  // 8. Enqueue the combined enrichment job and store BullMQ job ID.
  const companies = companyData.map((c) => ({
    rowIndex: c.rowIndex,
    domain: c.domain ?? undefined,
    companyName: c.companyName ?? undefined,
  }));

  const bullmqJob = await enrichmentQueue.add('combined-enrichment', {
    jobId: job.id,
    companies,
    purpose,
    contactFilters: conversation.contactFilters,
    uniqueDomains: combinedUniqueDomains.length > 0 ? combinedUniqueDomains : undefined,
    forceRefresh: conversation.forceRefresh ?? false,
  });

  await prisma.job.update({
    where: { id: job.id },
    data: { bullmqJobId: bullmqJob.id },
  });

  logger.info('Combined enrichment job enqueued', {
    jobId: job.id,
    companyCount: companies.length,
    purpose,
    channelId,
    threadTs,
  });
}

/**
 * Registers the message event listener on the given Bolt app.
 *
 * After the slash command migration, this listener only handles
 * metadata replies (list owner / additional context) in threads
 * where the conversation state is awaiting that information.
 *
 * @param app - The Slack Bolt application instance.
 */
export function registerMessageListener(app: App): void {
  app.message(async ({ message, client }) => {
    // Only handle standard user messages (not bot messages, changed messages, etc.).
    if (message.subtype !== undefined) {
      return;
    }

    const msg = message as GenericMessageEvent;
    const text = msg.text ?? '';
    const threadTs = msg.thread_ts ?? msg.ts;
    const channelId = msg.channel;
    const userId = msg.user ?? 'unknown';
    const teamId = msg.team ?? 'unknown';

    // --- Document management commands (checked before thread/enrichment flow) ---

    // ENRICH docs - list all documents.
    if (/^ENRICH\s+docs\s*$/i.test(text.trim())) {
      try {
        const blocks = await formatDocumentList(teamId);
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          blocks,
          text: 'Document list',
        });
      } catch (err) {
        logger.error('Error listing documents', {
          channelId,
          error: err instanceof Error ? err.message : String(err),
        });
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: 'Failed to list documents. Please try again.',
        });
      }
      return;
    }

    // ENRICH delete doc {slug} - archive a document.
    const deleteMatch = text.trim().match(/^ENRICH\s+delete\s+doc\s+([\w-]+)\s*$/i);
    if (deleteMatch) {
      const slug = deleteMatch[1].toLowerCase();
      try {
        // Check if the user is an admin.
        let userIsAdmin = false;
        try {
          const userInfo = await client.users.info({ user: userId });
          userIsAdmin = !!(userInfo.user as Record<string, unknown>)?.is_admin;
        } catch {
          // If we can't check, assume non-admin.
        }

        const result = await archiveDocument(teamId, slug, userId, userIsAdmin);
        if (result.success) {
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: `Document \`${slug}\` has been archived.`,
          });
        } else {
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: result.error ?? 'Failed to archive document.',
          });
        }
      } catch (err) {
        logger.error('Error archiving document', {
          slug,
          channelId,
          error: err instanceof Error ? err.message : String(err),
        });
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: 'Failed to archive document. Please try again.',
        });
      }
      return;
    }

    // ENRICH refresh toc - regenerate table of contents.
    if (/^ENRICH\s+refresh\s+toc\s*$/i.test(text.trim())) {
      try {
        // Find all docs channels for this team and regenerate TOC for each.
        const docsChannels = await prisma.clientDocument.groupBy({
          by: ['slackChannelId'],
          where: { slackTeamId: teamId, status: 'ACTIVE' },
        });

        let totalDocs = 0;
        for (const ch of docsChannels) {
          const toc = await generateTableOfContents(teamId, ch.slackChannelId);
          // Count documents from the TOC (rough parse).
          const docLines = toc.match(/^- `/gm);
          totalDocs += docLines?.length ?? 0;
        }

        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: `Table of contents regenerated. ${totalDocs} active document${totalDocs === 1 ? '' : 's'} indexed across ${docsChannels.length} channel${docsChannels.length === 1 ? '' : 's'}.`,
        });
      } catch (err) {
        logger.error('Error refreshing TOC', {
          channelId,
          error: err instanceof Error ? err.message : String(err),
        });
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: 'Failed to refresh table of contents. Please try again.',
        });
      }
      return;
    }

    // --- End document management commands ---

    // Only handle thread replies (must have thread_ts).
    if (!msg.thread_ts) {
      return;
    }

    // Route filter flow NL messages to the filter handler.
    const conv = await getConversation(channelId, threadTs);

    // Split flow is fully interactive (no NL input) — ignore thread messages.
    if (conv?.flowType === 'split') {
      return;
    }

    if (conv?.flowType === 'filter' && text.trim()) {
      try {
        await handleFilterMessage(client, channelId, threadTs, text.trim());
      } catch (err) {
        logger.error('Error handling filter message', {
          channelId,
          threadTs,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    // T055: Handle metadata reply (list owner / additional context).
    // If the conversation state has purpose set, isCosell answered, but
    // no listOwner yet, treat this thread reply as the metadata.
    if (!conv || !conv.purpose || conv.isCosell === undefined || conv.listOwner || !conv.fileId) {
      return;
    }

    logger.info('Metadata reply received', {
      channelId,
      threadTs,
      textPreview: text.substring(0, 100),
    });

    // Store the reply as list owner and additional context.
    const updatedConv = {
      ...conv,
      listOwner: text.trim(),
      additionalContext: text.trim(),
    };
    await updateConversation(channelId, threadTs, {
      listOwner: text.trim(),
      additionalContext: text.trim(),
    });

    // Post acknowledgment.
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: 'Thanks! Starting enrichment now...',
    });

    // Route to the correct enrichment flow based on enrichIntent.
    try {
      if (updatedConv.enrichIntent === 'combined') {
        await handleCombinedFlow(
          client,
          channelId,
          threadTs,
          msg.user ?? 'unknown',
          msg.team ?? 'unknown',
          updatedConv.purpose as 'COLD_CALLING' | 'EMAILING' | 'JUST_A_LIST' | 'LINKEDIN',
          updatedConv,
        );
      } else {
        await handleContactEnrichment(
          client,
          channelId,
          threadTs,
          msg.user ?? 'unknown',
          msg.team ?? 'unknown',
          updatedConv.purpose as 'COLD_CALLING' | 'EMAILING' | 'JUST_A_LIST' | 'LINKEDIN',
          updatedConv,
        );
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Enrichment failed after metadata collection', {
        channelId,
        threadTs,
        enrichIntent: updatedConv.enrichIntent,
        error: errorMsg,
      });
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: 'Sorry, something went wrong starting the enrichment. Please try again.',
      });
    }
  });
}
