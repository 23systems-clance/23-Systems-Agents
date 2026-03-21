/**
 * Bolt action handler for purpose selection buttons (T043 / T044).
 *
 * When the AI orchestrator classifies intent as 'contact' or 'combined',
 * the bot posts purpose selection buttons. This handler responds to those
 * button clicks by acknowledging, updating the message, storing the
 * selected purpose in the conversation state, and then kicking off the
 * contact enrichment flow (download file, create Job + JobCompany records,
 * enqueue BullMQ job).
 */

import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import { v4 as uuidv4 } from 'uuid';
import { resolveClientId } from '../../lib/clientLookup.js';
import {
  getConversation,
  updateConversation,
} from '../../services/state/conversationStore.js';
import { buildCosellCheckBlocks } from './cosellCheck.js';
import { buildContactFilterSelectionBlocks } from './enrichmentPresetBlocks.js';
import { DEFAULT_APOLLO_FILTERS } from '../../types/enrichmentFilters.js';
import type { ApolloContactFilters } from '../../types/enrichmentFilters.js';
import { downloadSlackFile } from '../../services/file/slackFile.js';
import { parseFile } from '../../services/file/parser.js';
import { autoDetectAndNormalizeColumns } from '../../services/file/columnAutoDetector.js';
import { validateFile, buildValidationErrorBlocks, uploadTemplateCsv } from '../../services/file/validator.js';
import { prisma } from '../../models/index.js';
import { enrichmentQueue } from '../../services/queue/queues.js';
import { config } from '../../config/index.js';
import logger from '../../lib/logger.js';
import { trackUsage } from '../../services/metering/usageTracker.js';
import { loadQualityGateConfig, snapshotConfig } from '../../services/qualityGate/config.js';
import { runQualityGate, buildFilteringSummaryBlocks } from '../../services/qualityGate/qualityGate.js';
import { generateFilteredCsv } from '../../services/qualityGate/filteredCsv.js';

/** Valid purpose values mapped from action_id suffixes. */
const PURPOSE_MAP: Record<string, string> = {
  select_purpose_just_a_list: 'JUST_A_LIST',
  select_purpose_emailing: 'EMAILING',
  select_purpose_cold_calling: 'COLD_CALLING',
  select_purpose_linkedin: 'LINKEDIN',
  select_purpose_all: 'ALL',
};

/** Human-readable labels for purposes. */
const PURPOSE_LABELS: Record<string, string> = {
  JUST_A_LIST: 'Just a List',
  EMAILING: 'Email',
  COLD_CALLING: 'Cold Call',
  LINKEDIN: 'LinkedIn',
  ALL: 'All',
};

/** MIME type mapping for file type strings. */
const MIME_TYPE_MAP: Record<string, string> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/**
 * Downloads the uploaded file, validates it, creates a Job + JobCompany
 * records, and enqueues a contact-enrichment BullMQ job.
 *
 * Called after the user selects a purpose for the contact enrichment flow.
 *
 * @param client    - Slack WebClient for API calls
 * @param channelId - Slack channel ID
 * @param threadTs  - Thread timestamp
 * @param userId    - Slack user ID that initiated the request
 * @param teamId    - Slack team/workspace ID
 * @param purpose   - Selected list purpose
 * @param conversation - Conversation state containing file context
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleContactEnrichment(
  client: any,
  channelId: string,
  threadTs: string,
  userId: string,
  teamId: string,
  purpose: 'COLD_CALLING' | 'EMAILING' | 'JUST_A_LIST' | 'LINKEDIN' | 'ALL',
  conversation: {
    fileId: string;
    fileName: string;
    fileType: string;
    isCosell?: boolean;
    cosellProvider?: string;
    listOwner?: string;
    additionalContext?: string;
    intentUsage?: { inputTokens: number; outputTokens: number; estimatedCostUsd: number; durationMs: number };
    contactFilters?: ApolloContactFilters;
    creditRateSnapshot?: Record<string, unknown>;
    enrichDataType?: 'contact_data' | 'email' | 'mobile' | 'all';
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

  // Post any warnings.
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
  let channelName: string | null = null;
  try {
    const chInfo = await client.conversations.info({ channel: channelId });
    channelName = chInfo.channel?.name ?? null;
  } catch { /* ignore */ }
  const clientId = await resolveClientId(teamId, channelId);
  const jobId = uuidv4();

  // Feature 27: Map enrichDataType to EnrichmentMode
  const enrichDataType = conversation.enrichDataType;
  let enrichmentMode: 'EMAIL_ONLY' | 'PHONE_ONLY' | 'ALL' | null = null;

  if (enrichDataType === 'email') {
    enrichmentMode = 'EMAIL_ONLY';
  } else if (enrichDataType === 'mobile') {
    enrichmentMode = 'PHONE_ONLY';
  } else if (enrichDataType === 'all') {
    enrichmentMode = 'ALL';
  } else if (!enrichDataType || enrichDataType === 'contact_data') {
    // Fallback: derive enrichmentMode from purpose when enrichDataType is not set
    // (covers main UI button flows that skip the enrichmentDataType selection step)
    if (purpose === 'EMAILING') enrichmentMode = 'EMAIL_ONLY';
    else if (purpose === 'COLD_CALLING') enrichmentMode = 'ALL';
    else if (purpose === 'ALL') enrichmentMode = 'ALL';
    else if (purpose === 'LINKEDIN') enrichmentMode = 'EMAIL_ONLY';
    // JUST_A_LIST remains null — uses legacy Apollo bulk enrich for full contact data
  }

  const job = await prisma.job.create({
    data: {
      id: jobId,
      jobType: 'CONTACT',
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
      clientId,
      sourceFileName: conversation.fileName,
      sourceFileType: conversation.fileType === 'csv' ? 'CSV' : 'XLSX',
      sourceRowCount: parsed.rows.length,
      enrichmentMode,
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
  const contactGateConfig = await loadQualityGateConfig(clientId);
  const { result: contactGateResult, passedRows: contactPassedRows, filteredRowDetails: contactFilteredDetails } = runQualityGate(
    fileValidation.normalizedRows,
    contactGateConfig,
    {
      emailColumn: parsed.emailColumn,
      domainColumn: parsed.domainColumn,
      companyNameColumn: parsed.companyNameColumn,
    },
  );

  if (contactGateResult.filteredRows > 0) {
    const { key, url } = await generateFilteredCsv(
      contactFilteredDetails,
      parsed.headers,
      job.id,
    );
    contactGateResult.filteredFileUrl = url;
    contactGateResult.filteredFileKey = key;

    const summaryBlocks = buildFilteringSummaryBlocks(contactGateResult, url);
    if (summaryBlocks) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        blocks: summaryBlocks,
        text: `Quality check: ${contactGateResult.passedRows} of ${contactGateResult.totalRows} rows passed. ${contactGateResult.filteredRows} filtered.`,
      });
    }
  }

  const contactConfigSnapshot = snapshotConfig(contactGateConfig);
  await prisma.job.update({
    where: { id: job.id },
    data: {
      qualityGateResult: JSON.parse(JSON.stringify(contactGateResult)),
      qualityGateConfigSnapshot: JSON.parse(JSON.stringify(contactConfigSnapshot)),
    },
  });

  // Log quality gate stats to ApiUsageLog (T031)
  await trackUsage({
    jobId: job.id,
    slackTeamId: teamId,
    service: 'QUALITY_GATE',
    endpoint: 'PreEnrichmentFilter',
    requestCount: contactGateResult.filteredRows,
    creditsConsumed: 0,
    estimatedCostUsd: 0,
    durationMs: contactGateResult.processingTimeMs,
  });

  if (contactGateResult.passedRows === 0) {
    await prisma.job.update({
      where: { id: job.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    logger.info('handleContactEnrichment: all rows filtered, job completed without enrichment', {
      jobId: job.id,
    });
    return;
  }

  // 7. Create JobCompany records using PASSED rows only.
  const companyData = contactPassedRows.map((row, index) => ({
    id: uuidv4(),
    jobId: job.id,
    rowIndex: index,
    domain: parsed.domainColumn ? (row[parsed.domainColumn] as string) ?? null : null,
    companyName: parsed.companyNameColumn
      ? (row[parsed.companyNameColumn] as string) ?? null
      : null,
    enrichmentStatus: 'PENDING' as const,
  }));

  await prisma.jobCompany.createMany({ data: companyData });

  // 8. Enqueue the contact enrichment job and store BullMQ job ID.
  const bullmqJob = await enrichmentQueue.add('contact-enrichment', {
    jobId: job.id,
    companies: companyData.map((c) => ({
      jobCompanyId: c.id,
      domain: c.domain ?? '',
      companyName: c.companyName ?? undefined,
    })),
    purpose,
    contactFilters: conversation.contactFilters,
  });

  await prisma.job.update({
    where: { id: job.id },
    data: { bullmqJobId: bullmqJob.id },
  });

  logger.info('Contact enrichment job enqueued', {
    jobId: job.id,
    companyCount: companyData.length,
    purpose,
    channelId,
    threadTs,
  });
}

/**
 * Creates a CONTACT enrichment job by chaining from an existing
 * TECHNOGRAPHIC job's companies. Skips file download/parse since
 * the companies are already in the database with resolved domains.
 *
 * @param client      - Slack WebClient for API calls
 * @param channelId   - Slack channel ID
 * @param threadTs    - Thread timestamp
 * @param userId      - Slack user ID
 * @param teamId      - Slack team ID
 * @param purpose     - Selected list purpose
 * @param sourceJobId - Completed technographic job ID
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleChainContactEnrichment(
  client: any,
  channelId: string,
  threadTs: string,
  userId: string,
  teamId: string,
  purpose: 'COLD_CALLING' | 'EMAILING' | 'JUST_A_LIST' | 'LINKEDIN' | 'ALL',
  sourceJobId: string,
  contactFilters?: ApolloContactFilters,
): Promise<void> {
  // 1. Load the source technographic job and its companies.
  const sourceJob = await prisma.job.findUniqueOrThrow({
    where: { id: sourceJobId },
    include: {
      companies: {
        where: { enrichmentStatus: 'SUCCESS' },
        orderBy: { rowIndex: 'asc' },
        select: {
          companyName: true,
          domain: true,
          resolvedDomain: true,
          rowIndex: true,
        },
      },
    },
  });

  if (sourceJob.companies.length === 0) {
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: 'No successfully enriched companies found from the technographic job. Please try uploading a new file.',
    });
    return;
  }

  // 2. Create CONTACT Job record.
  let channelName: string | null = sourceJob.slackChannelName;
  if (!channelName) {
    try {
      const chInfo = await client.conversations.info({ channel: channelId });
      channelName = chInfo.channel?.name ?? null;
    } catch { /* ignore */ }
  }

  // Retrieve credit rate snapshot from conversation state
  const chainConversation = await getConversation(channelId, threadTs);

  // Feature 27: Map enrichDataType to EnrichmentMode
  const enrichDataType = chainConversation?.enrichDataType;
  let enrichmentMode: 'EMAIL_ONLY' | 'PHONE_ONLY' | 'ALL' | null = null;

  if (enrichDataType === 'email') {
    enrichmentMode = 'EMAIL_ONLY';
  } else if (enrichDataType === 'mobile') {
    enrichmentMode = 'PHONE_ONLY';
  } else if (enrichDataType === 'all') {
    enrichmentMode = 'ALL';
  } else if (!enrichDataType || enrichDataType === 'contact_data') {
    // Fallback: derive enrichmentMode from purpose when enrichDataType is not set
    if (purpose === 'EMAILING') enrichmentMode = 'EMAIL_ONLY';
    else if (purpose === 'COLD_CALLING') enrichmentMode = 'ALL';
    else if (purpose === 'ALL') enrichmentMode = 'ALL';
    else if (purpose === 'LINKEDIN') enrichmentMode = 'EMAIL_ONLY';
    // JUST_A_LIST remains null
  }

  const chainClientId = await resolveClientId(teamId, channelId);
  const jobId = uuidv4();
  const job = await prisma.job.create({
    data: {
      id: jobId,
      jobType: 'CONTACT',
      status: 'PENDING',
      purpose,
      isCosell: sourceJob.isCosell,
      cosellProvider: sourceJob.cosellProvider,
      listOwner: sourceJob.listOwner,
      additionalContext: sourceJob.additionalContext,
      slackChannelId: channelId,
      slackChannelName: channelName,
      slackThreadTs: threadTs,
      slackUserId: userId,
      slackTeamId: teamId,
      clientId: chainClientId,
      sourceFileName: sourceJob.sourceFileName,
      sourceFileType: sourceJob.sourceFileType,
      sourceRowCount: sourceJob.companies.length,
      enrichmentMode,
      creditRateSnapshot: chainConversation?.creditRateSnapshot
        ? JSON.parse(JSON.stringify(chainConversation.creditRateSnapshot))
        : undefined,
    },
  });

  // 3. Create JobCompany records using resolved domains from the source job.
  const companyData = sourceJob.companies.map((c, index) => ({
    id: uuidv4(),
    jobId: job.id,
    rowIndex: index,
    domain: c.resolvedDomain ?? c.domain,
    companyName: c.companyName,
    enrichmentStatus: 'PENDING' as const,
  }));

  await prisma.jobCompany.createMany({ data: companyData });

  // 4. Enqueue the contact enrichment job.
  const bullmqJob = await enrichmentQueue.add('contact-enrichment', {
    jobId: job.id,
    companies: companyData.map((c) => ({
      jobCompanyId: c.id,
      domain: c.domain ?? '',
      companyName: c.companyName ?? undefined,
    })),
    purpose,
    contactFilters,
  });

  await prisma.job.update({
    where: { id: job.id },
    data: { bullmqJobId: bullmqJob.id },
  });

  await client.chat.postMessage({
    channel: channelId,
    thread_ts: threadTs,
    text: `Starting contact enrichment for ${companyData.length} companies...`,
  });

  logger.info('Chain contact enrichment job enqueued', {
    jobId: job.id,
    sourceJobId,
    companyCount: companyData.length,
    purpose,
    channelId,
    threadTs,
  });
}

/**
 * Registers action handlers for all purpose selection buttons.
 *
 * Listens for action_id matching 'select_purpose_*' buttons from the
 * purpose selection Block Kit message (per api-contracts.md section 1.3).
 *
 * On click:
 * 1. Acknowledge the action (required within 3 seconds).
 * 2. Update the original message to show the selection.
 * 3. Store the purpose in conversation state (Redis).
 * 4. Post acknowledgment in thread.
 * 5. Retrieve conversation state and kick off contact enrichment flow.
 *
 * @param app - The Slack Bolt application instance.
 */
export function registerPurposeSelectionHandlers(app: App): void {
  // Register a handler for each purpose button
  for (const actionId of Object.keys(PURPOSE_MAP)) {
    app.action(actionId, async ({ ack, body, client }) => {
      // 1. Acknowledge immediately
      await ack();

      const action = body as {
        type: string;
        channel?: { id: string };
        message?: { ts: string; thread_ts?: string };
        user?: { id: string; team_id?: string };
        team?: { id: string };
        actions?: Array<{ action_id: string; value: string }>;
      };

      const channelId = action.channel?.id;
      const messageTs = action.message?.ts;
      const threadTs = action.message?.thread_ts ?? messageTs;
      const userId = action.user?.id;
      const teamId = action.user?.team_id ?? action.team?.id ?? 'unknown';
      const purpose = PURPOSE_MAP[actionId];

      if (!channelId || !threadTs || !purpose) {
        logger.warn('Purpose selection: missing context', {
          actionId,
          channelId,
          threadTs,
        });
        return;
      }

      logger.info('Purpose selected', {
        channelId,
        threadTs,
        userId,
        purpose,
      });

      // 2. Update the original message to show the selection
      if (messageTs) {
        try {
          await client.chat.update({
            channel: channelId,
            ts: messageTs,
            text: `Purpose selected: *${PURPOSE_LABELS[purpose] ?? purpose}*`,
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `Purpose selected: *${PURPOSE_LABELS[purpose] ?? purpose}*`,
                },
              },
            ],
          });
        } catch (err) {
          logger.warn('Failed to update purpose selection message', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // 3. Store purpose in conversation state
      await updateConversation(channelId, threadTs, {
        purpose: purpose as 'COLD_CALLING' | 'EMAILING' | 'JUST_A_LIST' | 'LINKEDIN' | 'ALL',
      });

      // 4. Store teamId in conversation state for later use by filter handlers
      await updateConversation(channelId, threadTs, {
        teamId: action.user?.team_id ?? action.team?.id ?? 'unknown',
      });

      // 5. Post contact filter selection (Use Defaults / Customize)
      const defaultPreset = await prisma.enrichmentPreset.findFirst({
        where: { isDefault: true },
      });
      const defaultFilters = defaultPreset
        ? {
            personSeniorities: defaultPreset.personSeniorities,
            personTitles: defaultPreset.personTitles,
            personDepartments: defaultPreset.personDepartments,
            personFunctions: defaultPreset.personFunctions,
            perPage: defaultPreset.perPage,
          }
        : DEFAULT_APOLLO_FILTERS;

      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        blocks: buildContactFilterSelectionBlocks(defaultFilters),
        text: 'Contact filters - use defaults or customize?',
      });
    });
  }
}

/**
 * Builds the Block Kit message for purpose selection.
 *
 * Call this when posting the initial purpose selection prompt to the user.
 *
 * @returns Block Kit blocks array for the purpose selection message.
 */
export function buildPurposeSelectionBlocks(): KnownBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'What is this list for?',
      },
    },
    {
      type: 'actions',
      block_id: 'purpose_selection',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Just a List' },
          action_id: 'select_purpose_just_a_list',
          value: 'JUST_A_LIST',
          style: 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Email' },
          action_id: 'select_purpose_emailing',
          value: 'EMAILING',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Cold Call' },
          action_id: 'select_purpose_cold_calling',
          value: 'COLD_CALLING',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'LinkedIn' },
          action_id: 'select_purpose_linkedin',
          value: 'LINKEDIN',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'All' },
          action_id: 'select_purpose_all',
          value: 'ALL',
        },
      ],
    },
  ];
}
