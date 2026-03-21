/**
 * Bolt action and view handlers for enrichment preset selection.
 *
 * Handles:
 * - `contact_filter_use_defaults` — Apply the default preset and continue flow.
 * - `contact_filter_customize` — Open the customization modal.
 * - `contact_filter_submit` — Process the modal submission.
 */

import type { App } from '@slack/bolt';
import {
  getConversation,
  updateConversation,
} from '../../services/state/conversationStore.js';
import { prisma } from '../../models/index.js';
import { DEFAULT_APOLLO_FILTERS } from '../../types/enrichmentFilters.js';
import type { ApolloContactFilters } from '../../types/enrichmentFilters.js';
import {
  buildContactFilterModal,
  buildContactFilterSelectionBlocks,
  formatFilterSummary,
} from './enrichmentPresetBlocks.js';
import { buildCosellCheckBlocks } from './cosellCheck.js';
import { handleChainContactEnrichment } from './purposeSelection.js';
import { v4 as uuidv4 } from 'uuid';
import { resolveClientId } from '../../lib/clientLookup.js';
import { enrichmentQueue } from '../../services/queue/queues.js';
import { downloadFile } from '../../lib/storage.js';
import { parse } from 'csv-parse/sync';
import { buildInitialPlan, subscribeToProgress } from '../../services/agent/taskVisualizer.js';
import { startStream, type StreamConfig } from '../../services/agent/streamingHelper.js';
import { loadQualityGateConfig } from '../../services/qualityGate/config.js';
import { runQualityGate, buildFilteringSummaryBlocks } from '../../services/qualityGate/qualityGate.js';
import { generateFilteredCsv } from '../../services/qualityGate/filteredCsv.js';
import logger from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a CONTACT enrichment job from tech report domains.
 * Used when user selects "Get Contacts" after a tech report,
 * and has selected purpose and filters.
 * For BOTH flow, this is called after technographic enrichment completes.
 */
async function createJobFromTechReportDomains(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  channelId: string,
  threadTs: string,
  userId: string,
  teamId: string,
  sourceJob: { resultFileUrl: string | null; sourceFileName: string | null; slackChannelName: string | null },
  sourceJobId: string,
  jobType: 'CONTACT',
  purpose: 'COLD_CALLING' | 'EMAILING' | 'JUST_A_LIST' | 'LINKEDIN' | 'ALL',
  contactFilters: ApolloContactFilters,
  creditRateSnapshot: unknown,
): Promise<void> {
  if (!sourceJob.resultFileUrl) {
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: 'Could not find the tech report file. Please try generating a new report.',
    });
    return;
  }

  // Start streaming with task card visualization early (before quality gate)
  // Use special task type for tech report chain with quality gate visible
  const enrichType = 'tech_report_contact';

  const streamConfig: StreamConfig = {
    client,
    channel: channelId,
    threadTs,
    userId,
    teamId,
  };

  const initialChunks = buildInitialPlan(enrichType, `${jobType} Enrichment`);
  const session = await startStream(streamConfig, {
    taskDisplayMode: 'plan',
    initialChunks,
  });

  // Import publishProgress for manual quality gate updates
  const { publishProgress } = await import('../../services/agent/taskVisualizer.js');

  // Create Job record early so we can use its ID for all progress events
  const jobId = uuidv4();

  // Subscribe to the new job's progress (before quality gate starts)
  await subscribeToProgress(jobId, enrichType, session);

  // Download and parse the CSV to extract domains
  await publishProgress({ jobId, stage: 'quality_gate', status: 'in_progress' });

  const csvBuffer = await downloadFile(sourceJob.resultFileUrl);
  const records = parse(csvBuffer, { columns: true, skip_empty_lines: true }) as Array<Record<string, string>>;

  // Normalize column names for quality gate
  const normalizedRecords = records.map((r) => ({
    domain: r['Domain'] ?? r['domain'] ?? '',
    companyName: r['Company Name'] ?? r['companyName'] ?? r['company_name'] ?? '',
  }));

  // Resolve chainClientId early since quality gate needs it
  const chainClientId = await resolveClientId(teamId, channelId);

  // Run quality gate on the domains
  const gateConfig = await loadQualityGateConfig(chainClientId);
  const { result: gateResult, passedRows, filteredRowDetails, uniqueDomainsList } = runQualityGate(
    normalizedRecords,
    gateConfig,
    {
      emailColumn: null,
      domainColumn: 'domain',
      companyNameColumn: 'companyName',
    },
  );

  // Quality gate complete - update task card
  const detail = gateResult.filteredRows > 0
    ? `${gateResult.passedRows} passed, ${gateResult.filteredRows} filtered`
    : `${gateResult.passedRows} companies validated`;
  await publishProgress({ jobId, stage: 'quality_gate', status: 'complete', detail });

  // If rows were filtered, post summary and filtered CSV
  if (gateResult.filteredRows > 0) {
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      blocks: buildFilteringSummaryBlocks(gateResult, null),
      text: `Quality gate filtered ${gateResult.filteredRows} of ${gateResult.totalRows} rows.`,
    });

    // Generate and upload filtered CSV
    const originalHeaders = ['Domain', 'Company Name'];
    const filteredCsvBuffer = await generateFilteredCsv(filteredRowDetails, originalHeaders, sourceJobId);
    await client.files.uploadV2({
      channel_id: channelId,
      thread_ts: threadTs,
      file_uploads: [
        {
          file: filteredCsvBuffer,
          filename: 'filtered_rows.csv',
        },
      ],
      initial_comment: 'Companies filtered by quality gate (for reference):',
    });
  }

  if (passedRows.length === 0) {
    await publishProgress({ jobId, stage: 'quality_gate', status: 'error', detail: 'No valid companies found' });
    await session.stop();
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: 'No valid domains found after quality gate filtering. Please try with a different tech report or adjust quality gate settings.',
    });
    return;
  }

  logger.info('Tech report domains passed quality gate', {
    totalRows: gateResult.totalRows,
    passedRows: gateResult.passedRows,
    filteredRows: gateResult.filteredRows,
    uniqueDomains: uniqueDomainsList.length,
  });

  // Parse and validate are already done (we parsed CSV for quality gate)
  await publishProgress({ jobId, stage: 'parse', status: 'complete' });
  await publishProgress({ jobId, stage: 'validate', status: 'complete' });

  // Resolve channel name
  let channelName = sourceJob.slackChannelName;
  if (!channelName) {
    try {
      const chInfo = await client.conversations.info({ channel: channelId });
      channelName = chInfo.channel?.name ?? null;
    } catch { /* ignore */ }
  }

  // Feature 27: Map enrichDataType to EnrichmentMode
  const conversation = await getConversation(channelId, threadTs);
  const enrichDataType = conversation?.enrichDataType;
  let enrichmentMode: 'EMAIL_ONLY' | 'PHONE_ONLY' | 'ALL' | null = null;

  if (enrichDataType === 'email') {
    enrichmentMode = 'EMAIL_ONLY';
  } else if (enrichDataType === 'mobile') {
    enrichmentMode = 'PHONE_ONLY';
  } else if (enrichDataType === 'all') {
    enrichmentMode = 'ALL';
  }
  // 'contact_data' maps to null (standard Apollo flow, not waterfall)

  // Create Job record (jobId already generated earlier for progress events)
  const job = await prisma.job.create({
    data: {
      id: jobId,
      jobType,
      status: 'PENDING',
      slackChannelId: channelId,
      slackChannelName: channelName,
      slackThreadTs: threadTs,
      slackUserId: userId,
      slackTeamId: teamId,
      clientId: chainClientId,
      sourceFileName: sourceJob.sourceFileName ?? 'tech-report',
      sourceFileType: 'CSV',
      sourceRowCount: passedRows.length,
      enrichmentMode,
      creditRateSnapshot: creditRateSnapshot
        ? JSON.parse(JSON.stringify(creditRateSnapshot))
        : undefined,
    },
  });

  // Create JobCompany records from passed rows
  const companyData = passedRows.map((row, index) => ({
    id: uuidv4(),
    jobId: job.id,
    rowIndex: index,
    domain: row['domain'] ?? null,
    companyName: row['companyName'] ?? null,
    enrichmentStatus: 'PENDING' as const,
  }));

  await prisma.jobCompany.createMany({ data: companyData });

  // Enqueue the contact enrichment job
  const enrichJobName = 'contact-enrichment';

  const queueData = {
    jobId: job.id,
    companies: companyData.map((c) => ({
      jobCompanyId: c.id,
      rowIndex: c.rowIndex,
      domain: c.domain,
      companyName: c.companyName ?? undefined,
    })),
    purpose,
    contactFilters,
    skipInitialStages: true, // parse/validate already published during quality gate
  };

  // Enqueue the enrichment job with purpose and filters
  // (Already subscribed to progress events earlier with this jobId)
  await enrichmentQueue.add(enrichJobName, queueData);

  logger.info('Tech report chain contact enrichment job created from domains', {
    jobId: job.id,
    sourceJobId,
    purpose,
    companyCount: passedRows.length,
    filteredCount: gateResult.filteredRows,
    uniqueDomains: uniqueDomainsList.length,
  });
}

/**
 * Loads the default preset from the database.
 * Falls back to hardcoded defaults if none exists.
 *
 * @returns The default Apollo contact filters.
 */
async function loadDefaultFilters(): Promise<ApolloContactFilters> {
  const defaultPreset = await prisma.enrichmentPreset.findFirst({
    where: { isDefault: true },
  });

  if (!defaultPreset) {
    return DEFAULT_APOLLO_FILTERS;
  }

  return {
    personSeniorities: defaultPreset.personSeniorities,
    personTitles: defaultPreset.personTitles,
    personDepartments: defaultPreset.personDepartments,
    personFunctions: defaultPreset.personFunctions,
    perPage: defaultPreset.perPage,
  };
}

/**
 * Parses a comma-separated string into a trimmed array.
 * Returns an empty array for empty/undefined input.
 *
 * @param input - Comma-separated string.
 * @returns Trimmed string array.
 */
function parseCommaSeparated(input: string | undefined | null): string[] {
  if (!input || !input.trim()) return [];
  return input
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Continues the enrichment flow after filters have been selected.
 * For chain flows, goes straight to enrichment. Otherwise posts co-sell check.
 *
 * @param client    - Slack WebClient.
 * @param channelId - Slack channel ID.
 * @param threadTs  - Thread timestamp.
 * @param filters   - Selected Apollo contact filters.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function continueAfterFilterSelection(
  client: any,
  channelId: string,
  threadTs: string,
  filters: ApolloContactFilters,
): Promise<void> {
  // Store filters in conversation state
  await updateConversation(channelId, threadTs, { contactFilters: filters });

  const conversation = await getConversation(channelId, threadTs);

  // Chain flow: skip co-sell, go directly to enrichment using existing companies
  if (conversation?.sourceJobId) {
    const purpose = (conversation.purpose ?? 'JUST_A_LIST') as
      | 'COLD_CALLING'
      | 'EMAILING'
      | 'JUST_A_LIST'
      | 'LINKEDIN'
      | 'ALL';

    logger.info('Chain flow: proceeding to enrichment after filter selection', {
      channelId,
      threadTs,
      sourceJobId: conversation.sourceJobId,
      enrichIntent: conversation.enrichIntent,
    });

    // Check if this is from a tech report chain (contact or combined)
    // For tech report chain, the source job is TECH_REPORT and doesn't have companies
    // We need to create a new job from the tech report CSV domains
    if (conversation.enrichIntent === 'contact' || conversation.enrichIntent === 'combined') {
      const sourceJob = await prisma.job.findUnique({
        where: { id: conversation.sourceJobId },
        select: { jobType: true, resultFileUrl: true, sourceFileName: true, slackChannelName: true },
      });

      if (sourceJob?.jobType === 'TECH_REPORT') {
        // Tech report chain flow
        logger.info('Tech report chain flow detected', {
          sourceJobId: conversation.sourceJobId,
          enrichIntent: conversation.enrichIntent,
          purpose,
        });

        // Tech report chain: create CONTACT job from tech report domains
        // (BOTH flow already ran technographic, now running contact)
        await createJobFromTechReportDomains(
          client,
          channelId,
          threadTs,
          conversation.userId ?? 'unknown',
          conversation.teamId ?? 'unknown',
          sourceJob,
          conversation.sourceJobId,
          'CONTACT',
          purpose,
          filters,
          conversation.creditRateSnapshot,
        );
        return;
      }
    }

    // Regular technographic → contact chain: use companies from source job
    await handleChainContactEnrichment(
      client,
      channelId,
      threadTs,
      conversation.userId ?? 'unknown',
      conversation.teamId ?? 'unknown',
      purpose,
      conversation.sourceJobId,
      filters,
    );
    return;
  }

  // Normal flow: post co-sell check
  await client.chat.postMessage({
    channel: channelId,
    thread_ts: threadTs,
    blocks: buildCosellCheckBlocks(),
    text: 'Is this a co-sell list?',
  });
}

// ---------------------------------------------------------------------------
// Public registration
// ---------------------------------------------------------------------------

/**
 * Registers Bolt action and view handlers for enrichment preset selection.
 *
 * @param app - The Slack Bolt application instance.
 */
export function registerEnrichmentPresetHandlers(app: App): void {
  // -------------------------------------------------------------------------
  // "Use Defaults" button
  // -------------------------------------------------------------------------
  app.action('contact_filter_use_defaults', async ({ ack, body, client }) => {
    await ack();

    const action = body as {
      channel?: { id: string };
      message?: { ts: string; thread_ts?: string };
      user?: { id: string };
    };

    const channelId = action.channel?.id;
    const messageTs = action.message?.ts;
    const threadTs = action.message?.thread_ts ?? messageTs;

    if (!channelId || !threadTs) {
      logger.warn('contact_filter_use_defaults: missing context');
      return;
    }

    // Load default filters
    const filters = await loadDefaultFilters();

    // Update original message to show selection
    if (messageTs) {
      try {
        const summary = formatFilterSummary(filters);
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: `Contact filters: Using defaults (${summary})`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `Contact filters: *Using defaults*\n${summary}`,
              },
            },
          ],
        });
      } catch (err) {
        logger.warn('Failed to update filter selection message', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await continueAfterFilterSelection(client, channelId, threadTs, filters);
  });

  // -------------------------------------------------------------------------
  // "Customize" button — opens modal
  // -------------------------------------------------------------------------
  app.action('contact_filter_customize', async ({ ack, body, client }) => {
    await ack();

    const action = body as {
      trigger_id: string;
      channel?: { id: string };
      message?: { ts: string; thread_ts?: string };
      user?: { id: string };
    };

    const channelId = action.channel?.id;
    const messageTs = action.message?.ts;
    const threadTs = action.message?.thread_ts ?? messageTs;
    const triggerId = action.trigger_id;

    if (!channelId || !threadTs || !triggerId) {
      logger.warn('contact_filter_customize: missing context');
      return;
    }

    // Update original message to show "customizing..."
    if (messageTs) {
      try {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: 'Contact filters: Customizing...',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: 'Contact filters: *Customizing...*',
              },
            },
          ],
        });
      } catch (err) {
        logger.warn('Failed to update filter selection message', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Load presets visible to this user: global + their own private presets
    const userId = action.user?.id ?? 'unknown';
    const presets = await prisma.enrichmentPreset.findMany({
      where: {
        OR: [
          { scope: 'global' },
          { scope: 'private', createdByUserId: userId },
        ],
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });

    const defaultFilters = await loadDefaultFilters();

    // Open the customization modal
    try {
      await client.views.open({
        trigger_id: triggerId,
        view: buildContactFilterModal(presets, threadTs, channelId, defaultFilters) as any,
      });
    } catch (err) {
      logger.error('Failed to open contact filter modal', {
        error: err instanceof Error ? err.message : String(err),
      });

      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: 'Sorry, I was unable to open the filter customization form. Using default filters instead.',
      });

      await continueAfterFilterSelection(client, channelId, threadTs, defaultFilters);
    }
  });

  // -------------------------------------------------------------------------
  // Modal closed / cancelled — re-post selection buttons
  // -------------------------------------------------------------------------
  app.view(
    { callback_id: 'contact_filter_submit', type: 'view_closed' },
    async ({ ack, view, client }) => {
      await ack();

      let threadTs: string;
      let channelId: string;
      try {
        const meta = JSON.parse(view.private_metadata);
        threadTs = meta.threadTs;
        channelId = meta.channelId;
      } catch {
        logger.error('contact_filter_submit view_closed: failed to parse private_metadata');
        return;
      }

      const defaultFilters = await loadDefaultFilters();
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        blocks: buildContactFilterSelectionBlocks(defaultFilters),
        text: 'Contact filter customization was cancelled. Please select an option below.',
      });

      logger.info('Contact filter modal dismissed, re-posted selection buttons', {
        channelId,
        threadTs,
      });
    },
  );

  // -------------------------------------------------------------------------
  // Modal submission handler
  // -------------------------------------------------------------------------
  app.view('contact_filter_submit', async ({ ack, view, client, body }) => {
    await ack();

    // Parse private_metadata for routing
    let threadTs: string;
    let channelId: string;
    try {
      const meta = JSON.parse(view.private_metadata);
      threadTs = meta.threadTs;
      channelId = meta.channelId;
    } catch {
      logger.error('contact_filter_submit: failed to parse private_metadata');
      return;
    }

    const userId = body.user?.id ?? 'unknown';

    // Extract form values
    const values = view.state?.values ?? {};

    // Seniorities (required checkboxes)
    const senioritySelected =
      values['seniorities']?.['seniority_select']?.selected_options ?? [];
    const personSeniorities = senioritySelected.map(
      (opt: { value: string }) => opt.value,
    );

    if (personSeniorities.length === 0) {
      logger.warn('contact_filter_submit: no seniorities selected, using defaults');
      const defaultFilters = await loadDefaultFilters();
      await continueAfterFilterSelection(client, channelId, threadTs, defaultFilters);
      return;
    }

    // Titles (comma-separated text)
    const titlesRaw = values['titles']?.['titles_input']?.value;
    const personTitles = parseCommaSeparated(titlesRaw);

    // Departments (comma-separated text)
    const departmentsRaw = values['departments']?.['departments_input']?.value;
    const personDepartments = parseCommaSeparated(departmentsRaw);

    // Functions (comma-separated text)
    const functionsRaw = values['functions']?.['functions_input']?.value;
    const personFunctions = parseCommaSeparated(functionsRaw);

    // Build the filters object
    const filters: ApolloContactFilters = {
      personSeniorities,
      personTitles,
      personDepartments,
      personFunctions,
      perPage: 25,
    };

    // Save as preset if name provided
    const presetNameRaw = values['save_preset']?.['preset_name_input']?.value;
    if (presetNameRaw && presetNameRaw.trim()) {
      try {
        await prisma.enrichmentPreset.create({
          data: {
            name: presetNameRaw.trim(),
            isDefault: false,
            scope: 'private',
            personSeniorities: filters.personSeniorities,
            personTitles: filters.personTitles,
            personDepartments: filters.personDepartments,
            personFunctions: filters.personFunctions,
            perPage: filters.perPage,
            createdByUserId: userId,
            createdByName: null,
          },
        });

        logger.info('Enrichment preset saved from Slack modal', {
          name: presetNameRaw.trim(),
          userId,
          channelId,
        });
      } catch (err) {
        logger.error('Failed to save enrichment preset', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Post confirmation with filter summary
    const summary = formatFilterSummary(filters);
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `Contact filters applied: ${summary}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Custom contact filters applied*\n${summary}`,
          },
        },
      ],
    });

    await continueAfterFilterSelection(client, channelId, threadTs, filters);
  });
}
