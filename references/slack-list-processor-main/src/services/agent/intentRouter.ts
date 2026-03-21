/**
 * Intent Router for the agent side-panel.
 *
 * Maps classified intents to action handlers. Implements confidence-based
 * clarification flow per agent-intents.md contract.
 */

import type { WebClient } from '@slack/web-api';
import type { AgentIntentResult, AgentClassificationResult } from '../ai/agentOrchestrator.js';
import { updateThreadState, type AgentThreadState } from './contextStore.js';
import { startStream, type StreamConfig } from './streamingHelper.js';
import { buildInitialPlan, subscribeToProgress } from './taskVisualizer.js';
import { addTurn, resolveJobReference } from './conversationManager.js';
import { parseFilterCriteria } from '../ai/filterParser.js';
import { applyFilters } from '../filter/filterEngine.js';
import { resolveClientId } from '../../lib/clientLookup.js';
import { enrichmentQueue, type TechReportJobData } from '../queue/queues.js';
import { checkLimits } from '../metering/limitEnforcer.js';
import { checkBillingGate } from '../billing/billingGate.js';
import { estimateJobCredits } from '../billing/creditRateCalculator.js';
import type { OperationType } from '../billing/creditRateCalculator.js';
import { getUsageSummary } from '../metering/usageReporter.js';
import { isWorkspaceAdmin } from '../../lib/agentAuth.js';
import { downloadFile } from '../../lib/storage.js';
import { buildCacheDecisionBlocks } from '../../listeners/actions/cacheDecision.js';
import { setConversation } from '../state/conversationStore.js';
import { generateTechReportOutput } from '../file/generator.js';
import type { TechReportCompanyRecord } from '../file/generator.js';
import { uploadSlackFile } from '../file/slackFile.js';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

/** Context passed to every intent handler. */
export interface IntentContext {
  client: WebClient;
  channelId: string;
  threadTs: string;
  userId: string;
  teamId: string;
  threadState: AgentThreadState;
  classification: AgentClassificationResult;
}

/** Result from an intent handler — text to send back to the user. */
export interface IntentHandlerResult {
  text: string;
  /** If true, the handler already sent the response (e.g., via streaming). */
  alreadySent?: boolean;
}

/** Confidence thresholds per agent-intents.md contract. */
const CONFIDENCE_HIGH = 0.85;
const CONFIDENCE_LOW = 0.50;

/**
 * Routes a classified intent to the appropriate handler.
 *
 * Applies confidence-based clarification:
 * - >= 0.85: Execute directly
 * - 0.50-0.84: Ask clarifying question
 * - < 0.50: Ask open-ended question
 */
export async function routeIntent(ctx: IntentContext): Promise<IntentHandlerResult> {
  const { intent, confidence } = ctx.classification.intent;

  // Low confidence — ask open-ended clarification
  if (confidence < CONFIDENCE_LOW) {
    return {
      text: "I'm not quite sure what you'd like to do. Could you describe what you're looking for? For example:\n• \"Enrich this list with tech stacks\"\n• \"Find contacts for these companies\"\n• \"Check on my running jobs\"\n• \"Generate a Salesforce tech report\"",
    };
  }

  // Medium confidence — present top interpretations
  if (confidence < CONFIDENCE_HIGH) {
    return handleClarification(ctx);
  }

  // High confidence — execute the intent
  return executeIntent(intent, ctx);
}

/**
 * Executes an intent handler directly (high confidence path).
 */
async function executeIntent(intent: string, ctx: IntentContext): Promise<IntentHandlerResult> {
  switch (intent) {
    case 'technographic':
    case 'contact':
    case 'combined':
      return handleEnrichmentIntent(ctx);
    case 'tech_report':
      return handleTechReportIntent(ctx);
    case 'job_status':
      return handleJobStatus(ctx);
    case 'job_cancel':
      return handleJobCancel(ctx);
    case 'job_history':
      return handleJobHistory(ctx);
    case 'job_download':
      return handleJobDownload(ctx);
    case 'filter_results':
      return handleFilterResults(ctx);
    case 'usage_query':
      return handleUsageQuery(ctx);
    case 'settings_update':
      return handleSettingsUpdate(ctx);
    case 'help':
      return handleHelp();
    case 'clarification':
      return handleUserClarification(ctx);
    case 'confirmation':
      return handleConfirmation(ctx);
    default:
      return { text: "I'm not sure how to help with that. Type \"help\" to see what I can do." };
  }
}

/**
 * Handles medium-confidence classification by presenting clarifying options.
 */
function handleClarification(ctx: IntentContext): IntentHandlerResult {
  const { intent, confidence } = ctx.classification.intent;

  return {
    text: `I think you might want to *${formatIntentName(intent)}* (${Math.round(confidence * 100)}% confidence). Is that right?\n\nReply "yes" to proceed, or tell me more about what you need.`,
  };
}

/**
 * Handles enrichment intents (technographic, contact, combined).
 * Checks if we have all required params or need to ask for more.
 */
async function handleEnrichmentIntent(ctx: IntentContext): Promise<IntentHandlerResult> {
  const { intent } = ctx.classification.intent;
  const { enrichmentParams } = ctx.threadState;

  // Update accumulated params with the classified enrichment type
  enrichmentParams.enrichIntent = intent as 'technographic' | 'contact' | 'combined';

  // Check if we have a file — required for enrichment
  if (!enrichmentParams.fileId) {
    return {
      text: `Got it — you want a *${formatIntentName(intent)}* enrichment. Please upload your company list file (CSV or XLSX) and I'll get started.`,
    };
  }

  // We have a file — check if we need any other params
  return {
    text: `Ready to run *${formatIntentName(intent)}* enrichment on *${enrichmentParams.fileName || 'your file'}*.\n\nShall I proceed? Reply "yes" to start.`,
  };
}

/**
 * Handles tech_report intent — extract technology param, check cache,
 * initiate tech report job via existing pipeline with streaming.
 *
 * T043: Full tech report handler.
 * T044: Follow-up support via thread context technology persistence.
 * T045: Cached report detection.
 */
async function handleTechReportIntent(ctx: IntentContext): Promise<IntentHandlerResult> {
  // T044: Support follow-up — use thread context technology if not in current message
  const technology = ctx.classification.intent.technology || ctx.threadState.enrichmentParams.technology;

  if (!technology) {
    return {
      text: 'Which technology would you like to generate a report for? For example: "Salesforce", "HubSpot", "AWS".',
    };
  }

  // Persist technology in thread state for follow-up references
  ctx.threadState.enrichmentParams.technology = technology;

  try {
    // T045: Check for cached recent report
    const cachedReport = await prisma.techReportCache.findFirst({
      where: {
        technology: { equals: technology, mode: 'insensitive' },
        createdAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }, // within 90 days
      },
      select: { id: true, createdAt: true, resultCount: true },
      orderBy: { createdAt: 'desc' },
    });

    if (cachedReport) {
      const requestedCount = ctx.classification.intent.requestedCount;
      const cacheClientId = await resolveClientId(ctx.teamId, ctx.channelId);

      // Store conversation state for cache handlers (requestedCount, technology)
      await setConversation(ctx.channelId, ctx.threadTs, {
        fileId: '',
        fileName: '',
        fileType: 'csv',
        userId: ctx.userId,
        channelId: ctx.channelId,
        threadTs: ctx.threadTs,
        status: 'pending',
        teamId: ctx.teamId,
        technology,
        ...(requestedCount && { requestedCount }),
      });

      if (cacheClientId) {
        // Client channel — check if this cached report was already delivered to this client
        const alreadyDelivered = await prisma.job.findFirst({
          where: {
            clientId: cacheClientId,
            jobType: 'TECH_REPORT',
            status: 'COMPLETED',
            sourceFileName: { contains: technology, mode: 'insensitive' },
            createdAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
          },
          select: { id: true },
        });

        if (alreadyDelivered) {
          // Already delivered to this client before — run a fresh query automatically
          logger.info('Cache auto-fresh: cached report already delivered to client', {
            clientId: cacheClientId, technology, cachedReportId: cachedReport.id,
          });
          // Fall through to "no cache" path below to create a fresh job
        } else {
          // Auto-deliver cached result to client (no buttons, charge credits)
          logger.info('Cache auto-use: delivering cached report to client channel', {
            clientId: cacheClientId, technology, cachedReportId: cachedReport.id,
          });
          // Simulate cache_use: trigger delivery via the cache_use action path
          // by importing the handler logic — post a message and let fileGeneration handle it
          await ctx.client.chat.postMessage({
            channel: ctx.channelId,
            thread_ts: ctx.threadTs,
            text: `Preparing *${technology}* report...`,
          });

          // Deliver cached report inline
          const entries = await prisma.techReportCacheEntry.findMany({
            where: { cacheId: cachedReport.id },
          });

          const truncatedEntries = requestedCount && requestedCount > 0 && entries.length > requestedCount
            ? entries.slice(0, requestedCount)
            : entries;

          const companies: TechReportCompanyRecord[] = truncatedEntries.map((entry) => ({
            domain: entry.domain,
            companyName: entry.companyName,
            location: [entry.city, entry.stateRegion, entry.country]
              .filter(Boolean)
              .join(', ') || null,
            trafficRank: entry.trafficRank,
            technologyFirstDetected: null,
            technologyLastDetected: null,
          }));

          const fileBuffer = generateTechReportOutput({ companies, outputFormat: 'XLSX' });
          const filename = `tech-report-${technology.toLowerCase().replace(/\s+/g, '-')}.xlsx`;

          await uploadSlackFile({
            client: ctx.client,
            channelId: ctx.channelId,
            threadTs: ctx.threadTs,
            fileBuffer,
            filename,
            title: `Tech Report: ${technology}`,
            initialComment: `Here is the tech report for *${technology}* with ${companies.length} companies.`,
          });

          return { text: '', alreadySent: true };
        }
      } else {
        // Internal user — show cache decision buttons
        const displayCount = requestedCount && requestedCount > 0 && requestedCount < cachedReport.resultCount
          ? requestedCount
          : cachedReport.resultCount;
        await ctx.client.chat.postMessage({
          channel: ctx.channelId,
          thread_ts: ctx.threadTs,
          blocks: buildCacheDecisionBlocks(
            cachedReport.id,
            technology,
            displayCount,
            cachedReport.createdAt,
            requestedCount,
          ),
          text: `I found a cached ${technology} report with ${displayCount} companies.`,
        });
        return { text: '', alreadySent: true };
      }
    }

    // No cache — create job and start report
    // Billing gate check for tech report
    const reportEstCredits = await estimateJobCredits(100, ['BUILTWITH_CTU_LOOKUP']);
    const reportBillingCheck = await checkBillingGate(ctx.teamId, reportEstCredits, ctx.channelId);
    if (!reportBillingCheck.allowed) {
      return { text: reportBillingCheck.reason ?? 'Billing is not active for this workspace.' };
    }
    if (reportBillingCheck.estimatedCredits) {
      await ctx.client.chat.postMessage({
        channel: ctx.channelId,
        thread_ts: ctx.threadTs,
        text: `Estimated cost: ~${reportBillingCheck.estimatedCredits} credits for this report.`,
      });
    }

    const reportClientId = await resolveClientId(ctx.teamId, ctx.channelId);
    const job = await prisma.job.create({
      data: {
        slackChannelId: ctx.channelId,
        slackThreadTs: ctx.threadTs,
        slackUserId: ctx.userId,
        slackTeamId: ctx.teamId,
        jobType: 'TECH_REPORT',
        sourceInterface: 'AGENT',
        sourceFileName: `${technology} Report`,
        clientId: reportClientId,
        creditRateSnapshot: reportBillingCheck.rateSnapshot
          ? JSON.parse(JSON.stringify(reportBillingCheck.rateSnapshot))
          : undefined,
      },
    });

    const { linkJobToThread } = await import('./conversationManager.js');
    await linkJobToThread(ctx.teamId, ctx.threadTs, job.id);

    // Start streaming with task card visualization
    const streamConfig: StreamConfig = {
      client: ctx.client,
      channel: ctx.channelId,
      threadTs: ctx.threadTs,
      userId: ctx.userId,
      teamId: ctx.teamId,
    };

    const initialChunks = buildInitialPlan('tech_report', `Technology Report: ${technology}`);
    const session = await startStream(streamConfig, {
      taskDisplayMode: 'plan',
      initialChunks,
    });

    // Note: task-mode streams only accept chunks, not markdown_text
    await subscribeToProgress(job.id, 'tech_report', session);

    // Enqueue tech report job
    const requestedCount = ctx.classification.intent.requestedCount;
    const reportData: TechReportJobData = {
      jobId: job.id,
      technology,
      filters: {},
      ...(requestedCount && { requestedCount }),
    };
    await enrichmentQueue.add('tech-report', reportData);

    await addTurn(ctx.teamId, ctx.threadTs, {
      role: 'assistant',
      content: `Tech report job ${job.id.slice(0, 8)} started for ${technology}.`,
    });

    return { text: '', alreadySent: true };
  } catch (error) {
    logger.error('Failed to start tech report', {
      error: error instanceof Error ? error.message : String(error),
      technology,
    });
    return { text: 'Sorry, something went wrong starting the tech report. Please try again.' };
  }
}

/**
 * Handles job_status intent — query active jobs for the user/workspace.
 * Supports channel-scoped queries when viewing a specific channel (T038).
 */
async function handleJobStatus(ctx: IntentContext): Promise<IntentHandlerResult> {
  const { viewingChannelId, viewingChannelName } = ctx.threadState;

  // Check if user is asking about jobs in a specific channel
  const messageText = ctx.classification.intent.filterExpression || '';
  const isChannelScoped = viewingChannelId && /this channel|here|#\w+/i.test(messageText);

  const where: Record<string, unknown> = {
    slackTeamId: ctx.teamId,
    status: { in: ['PENDING', 'PROCESSING', 'AWAITING_PHONES'] },
  };

  if (isChannelScoped && viewingChannelId) {
    where.slackChannelId = viewingChannelId;
  }

  const jobs = await prisma.job.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true,
      jobType: true,
      status: true,
      progress: true,
      sourceFileName: true,
      createdAt: true,
      startedAt: true,
    },
  });

  const scopeLabel = isChannelScoped && viewingChannelName
    ? ` in #${viewingChannelName}`
    : '';

  if (jobs.length === 0) {
    return { text: `No active jobs running${scopeLabel} right now.` };
  }

  const lines = jobs.map((j) => {
    let progressInfo = '';
    if (j.status === 'PROCESSING' && j.progress != null && j.progress > 0) {
      progressInfo = ` (${j.progress}%)`;
      // T039: Estimate ETA based on elapsed time and progress
      if (j.startedAt && j.progress > 5) {
        const elapsedMs = Date.now() - j.startedAt.getTime();
        const remainingMs = (elapsedMs / j.progress) * (100 - j.progress);
        const remainingMin = Math.ceil(remainingMs / 60000);
        progressInfo += ` ~${remainingMin}min remaining`;
      }
    }
    return `• *${j.jobType}* — ${j.sourceFileName || 'N/A'} — ${j.status}${progressInfo} — \`${j.id.slice(0, 8)}\``;
  });

  return { text: `**Active Jobs${scopeLabel}:**\n${lines.join('\n')}` };
}

/**
 * Handles job_cancel intent — validate ownership, check cancellable state,
 * cancel BullMQ job and update DB status.
 *
 * T040: Enhanced job cancellation with BullMQ removal.
 */
async function handleJobCancel(ctx: IntentContext): Promise<IntentHandlerResult> {
  const jobId = resolveJobReference(ctx.threadState, ctx.classification.intent.jobId);

  if (!jobId) {
    return { text: 'Which job would you like to cancel? Provide the job ID, or I can show your active jobs.' };
  }

  const job = await prisma.job.findFirst({
    where: { id: jobId, slackTeamId: ctx.teamId },
  });

  if (!job) {
    return { text: `Job \`${jobId.slice(0, 8)}\` not found in your workspace.` };
  }

  if (job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'CANCELLED') {
    return { text: `Job \`${jobId.slice(0, 8)}\` is already ${job.status.toLowerCase()}.` };
  }

  // Update DB status
  await prisma.job.update({
    where: { id: jobId },
    data: { status: 'CANCELLED' },
  });

  // Attempt to remove from BullMQ queue
  try {
    const bullmqJobs = await enrichmentQueue.getJobs(['waiting', 'delayed']);
    for (const bJob of bullmqJobs) {
      if (bJob.data?.jobId === jobId) {
        await bJob.remove();
        break;
      }
    }
  } catch {
    // Queue removal is best-effort — DB status is authoritative
  }

  return { text: `Job \`${jobId.slice(0, 8)}\` has been cancelled.` };
}

/**
 * Handles job_history intent — show recent completed jobs.
 * Supports channel-scoped queries when viewing a specific channel (T038).
 */
async function handleJobHistory(ctx: IntentContext): Promise<IntentHandlerResult> {
  const { viewingChannelId, viewingChannelName } = ctx.threadState;

  const messageText = ctx.classification.intent.filterExpression || '';
  const isChannelScoped = viewingChannelId && /this channel|here|#\w+/i.test(messageText);

  const where: Record<string, unknown> = { slackTeamId: ctx.teamId };

  if (isChannelScoped && viewingChannelId) {
    where.slackChannelId = viewingChannelId;
  }

  const jobs = await prisma.job.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      jobType: true,
      status: true,
      sourceFileName: true,
      sourceRowCount: true,
      companiesProcessed: true,
      contactsFound: true,
      createdAt: true,
      completedAt: true,
    },
  });

  const scopeLabel = isChannelScoped && viewingChannelName
    ? ` in #${viewingChannelName}`
    : '';

  if (jobs.length === 0) {
    return { text: `No enrichment history found${scopeLabel} for your workspace.` };
  }

  const lines = jobs.map((j) => {
    const date = j.createdAt.toLocaleDateString();
    const rows = j.sourceRowCount ? `${j.sourceRowCount} rows` : '';
    return `• *${j.jobType}* — ${j.sourceFileName || 'N/A'} — ${j.status} — ${rows} — ${date} — \`${j.id.slice(0, 8)}\``;
  });

  return { text: `**Recent Enrichments${scopeLabel}:**\n${lines.join('\n')}` };
}

/**
 * Handles job_download intent — retrieve output file from S3 and share
 * in the agent thread via files.uploadV2.
 *
 * T042: Full file download and sharing implementation.
 */
async function handleJobDownload(ctx: IntentContext): Promise<IntentHandlerResult> {
  const jobId = resolveJobReference(ctx.threadState, ctx.classification.intent.jobId);

  if (!jobId) {
    return { text: 'Which job results would you like to download? Provide the job ID, or I can show your recent jobs.' };
  }

  const job = await prisma.job.findFirst({
    where: { id: jobId, slackTeamId: ctx.teamId },
    select: { id: true, status: true, resultFileUrl: true, resultFileName: true },
  });

  if (!job) {
    return { text: `Job \`${jobId.slice(0, 8)}\` not found.` };
  }

  if (job.status !== 'COMPLETED' || !job.resultFileUrl) {
    return { text: `Job \`${jobId.slice(0, 8)}\` is ${job.status.toLowerCase()} — no results file available yet.` };
  }

  try {
    // Download from S3
    const fileBuffer = await downloadFile(job.resultFileUrl);
    const fileName = job.resultFileName || `enrichment-${jobId.slice(0, 8)}.csv`;

    // Upload to Slack thread
    await ctx.client.files.uploadV2({
      channel_id: ctx.channelId,
      thread_ts: ctx.threadTs,
      file: fileBuffer,
      filename: fileName,
      title: fileName,
      initial_comment: `Here are the results from job \`${jobId.slice(0, 8)}\`.`,
    });

    return {
      text: '',
      alreadySent: true,
    };
  } catch (error) {
    logger.error('Failed to download/share job results', {
      error: error instanceof Error ? error.message : String(error),
      jobId,
    });
    return { text: `Sorry, I couldn't retrieve the results file for job \`${jobId.slice(0, 8)}\`. The file may have expired.` };
  }
}

/**
 * Handles filter_results intent — parse filterExpression, resolve job
 * reference, load results, apply filter, and return summary.
 *
 * T035: Full filter_results implementation.
 */
async function handleFilterResults(ctx: IntentContext): Promise<IntentHandlerResult> {
  const { filterExpression } = ctx.classification.intent;

  if (!filterExpression) {
    return { text: 'What filter would you like to apply? For example: "only companies with 50+ employees" or "exclude tier 3 tech spend".' };
  }

  // Resolve which job to filter
  const jobId = resolveJobReference(ctx.threadState, ctx.classification.intent.jobId);

  if (!jobId) {
    return { text: 'No enrichment results found to filter. Run an enrichment first, then tell me how to filter the results.' };
  }

  // Load job and its companies for filtering
  const job = await prisma.job.findFirst({
    where: { id: jobId, slackTeamId: ctx.teamId },
    select: { id: true, status: true, sourceFileName: true },
  });

  if (!job) {
    return { text: `Job \`${jobId.slice(0, 8)}\` not found in your workspace.` };
  }

  if (job.status !== 'COMPLETED') {
    return { text: `Job \`${jobId.slice(0, 8)}\` is still ${job.status.toLowerCase()} — filters can only be applied to completed results.` };
  }

  // Load enriched company data as rows
  const companies = await prisma.jobCompany.findMany({
    where: { jobId, enrichmentStatus: 'SUCCESS' },
    select: {
      companyName: true,
      resolvedDomain: true,
      cloudProviderPrimary: true,
      techSpendTier: true,
      techSpendScore: true,
      technologyCount: true,
      enterpriseTechCount: true,
      employeeCount: true,
      vertical: true,
      locationCity: true,
      locationState: true,
      locationCountry: true,
    },
  });

  if (companies.length === 0) {
    return { text: `Job \`${jobId.slice(0, 8)}\` has no successfully enriched companies to filter.` };
  }

  // Convert to row format for filter engine
  const headers = [
    'Company Name', 'Domain', 'Cloud Provider', 'Tech Spend Tier',
    'Tech Spend Score', 'Technology Count', 'Enterprise Tech Count',
    'Employee Count', 'Vertical', 'City', 'State', 'Country',
  ];

  const rows = companies.map((c) => ({
    'Company Name': c.companyName || '',
    'Domain': c.resolvedDomain || '',
    'Cloud Provider': c.cloudProviderPrimary || '',
    'Tech Spend Tier': c.techSpendTier || '',
    'Tech Spend Score': c.techSpendScore?.toString() || '',
    'Technology Count': c.technologyCount?.toString() || '',
    'Enterprise Tech Count': c.enterpriseTechCount?.toString() || '',
    'Employee Count': c.employeeCount?.toString() || '',
    'Vertical': c.vertical || '',
    'City': c.locationCity || '',
    'State': c.locationState || '',
    'Country': c.locationCountry || '',
  }));

  try {
    // Parse natural language filter to structured criteria
    const parseResult = await parseFilterCriteria(filterExpression, headers, rows);

    // Apply the filter
    const filterResult = applyFilters(rows, parseResult.filters, headers);

    return {
      text: `*Filter applied to job \`${jobId.slice(0, 8)}\`:*\n${parseResult.explanation}\n\n• Original: ${filterResult.originalCount} companies\n• After filter: ${filterResult.filtered.length} companies\n• Removed: ${filterResult.removedCount} companies`,
    };
  } catch (error) {
    logger.error('Failed to apply filter', {
      error: error instanceof Error ? error.message : String(error),
      jobId,
      filterExpression,
    });
    return { text: `Sorry, I couldn't parse that filter. Try something like "only companies with 50+ employees" or "exclude tier 3 tech spend".` };
  }
}

/**
 * Handles usage_query intent — check admin role, return usage summary.
 *
 * T049: Full usage_query implementation with admin check.
 */
async function handleUsageQuery(ctx: IntentContext): Promise<IntentHandlerResult> {
  const isAdmin = await isWorkspaceAdmin(ctx.client, ctx.userId);
  if (!isAdmin) {
    return { text: 'Usage reports are only available to workspace admins. Ask your workspace admin for current usage.' };
  }

  try {
    const summary = await getUsageSummary(ctx.teamId);
    return { text: summary.formattedSummary };
  } catch (error) {
    logger.error('Failed to generate usage summary', {
      error: error instanceof Error ? error.message : String(error),
      teamId: ctx.teamId,
    });
    return { text: "Sorry, I couldn't retrieve usage data right now. Please try again later." };
  }
}

/**
 * Handles help intent — show capabilities.
 */
function handleHelp(): IntentHandlerResult {
  return {
    text: `Here's what I can help with:

*Enrichment:*
• Enrich a company list with tech stacks, contacts, or both
• Generate a technology adoption report
• Filter enrichment results

*Job Management:*
• Check on running jobs
• View enrichment history
• Download results
• Cancel active jobs

*Admin:*
• View workspace API usage and costs
• Update workspace settings (spending caps, API limits)

Just describe what you need in plain language, or upload a CSV/XLSX file to get started!`,
  };
}

/**
 * Handles clarification intent — user is responding to agent's question.
 * Updates accumulated params with newly provided info. Checks if all
 * required params are present to auto-prompt for confirmation.
 *
 * T033: Multi-turn clarification with accumulated parameter checking.
 */
async function handleUserClarification(ctx: IntentContext): Promise<IntentHandlerResult> {
  const { enrichmentType, technology } = ctx.classification.intent;
  const { enrichmentParams } = ctx.threadState;

  if (enrichmentType) {
    enrichmentParams.enrichIntent = enrichmentType as 'technographic' | 'contact' | 'combined';
  }

  if (technology) {
    enrichmentParams.technology = technology;
  }

  // Check if we now have all required params for enrichment
  if (enrichmentParams.enrichIntent && enrichmentParams.fileId) {
    return {
      text: `Got it — *${formatIntentName(enrichmentParams.enrichIntent)}* enrichment on *${enrichmentParams.fileName || 'your file'}*. Ready to start?\n\nReply "yes" to proceed.`,
    };
  }

  // Check if we have enrichment type but missing file
  if (enrichmentParams.enrichIntent) {
    return {
      text: `Got it — *${formatIntentName(enrichmentParams.enrichIntent)}* enrichment. Please upload your company list file (CSV or XLSX) to get started.`,
    };
  }

  // Check if we have tech report params
  if (enrichmentParams.technology) {
    return {
      text: `Got it — a tech report for *${enrichmentParams.technology}*. Shall I proceed?`,
    };
  }

  return { text: "Thanks for the additional info. Could you tell me a bit more about what you'd like to do?" };
}

/**
 * Handles confirmation intent — assemble all accumulated params from
 * thread state and execute the pending action.
 *
 * T032: Full confirmation handler with accumulated parameter assembly.
 */
async function handleConfirmation(ctx: IntentContext): Promise<IntentHandlerResult> {
  const { enrichmentParams } = ctx.threadState;

  // If we have accumulated enrichment params, start the job
  if (enrichmentParams.enrichIntent && enrichmentParams.fileId) {
    return startEnrichmentFlow(ctx);
  }

  // If user has file but no intent, ask what type
  if (enrichmentParams.fileId && !enrichmentParams.enrichIntent) {
    return {
      text: `I have your file *${enrichmentParams.fileName || 'uploaded file'}* ready. What type of enrichment would you like?\n\n• *Technographic* — Tech stack data\n• *Contact* — Find decision makers\n• *Combined* — Both tech stacks and contacts`,
    };
  }

  // If user has enrichment type but no file
  if (enrichmentParams.enrichIntent && !enrichmentParams.fileId) {
    return {
      text: `I need your company list file to run the *${formatIntentName(enrichmentParams.enrichIntent)}* enrichment. Please upload a CSV or XLSX file.`,
    };
  }

  if (enrichmentParams.technology) {
    // Re-route to the tech report handler which handles caching/execution
    return handleTechReportIntent(ctx);
  }

  return { text: "I'm not sure what to confirm. Could you describe what you'd like me to do?" };
}

/**
 * Initiates an enrichment job via the existing BullMQ pipeline.
 * Creates a Job record with sourceInterface=AGENT and enqueues work.
 * Uses streaming with task card visualization for real-time progress.
 *
 * T021 + T022 + T029: Enrichment flow with AGENT source + streaming task cards.
 */
async function startEnrichmentFlow(ctx: IntentContext): Promise<IntentHandlerResult> {
  const { enrichmentParams } = ctx.threadState;
  const enrichType = enrichmentParams.enrichIntent || 'combined';
  const jobType = enrichType === 'technographic'
    ? 'TECHNOGRAPHIC'
    : enrichType === 'contact'
      ? 'CONTACT'
      : 'COMBINED';

  try {
    // T052: Check workspace usage limits before starting job
    const limitCheck = await checkLimits(ctx.teamId);
    if (!limitCheck.allowed) {
      return {
        text: `Your workspace has reached its usage limit and new enrichments are blocked.\n\n${limitCheck.reason}\n\nContact your workspace admin to increase limits.`,
      };
    }

    // Billing gate: check credit balance before job creation
    const opTypes: OperationType[] = jobType === 'TECHNOGRAPHIC'
      ? ['BUILTWITH_CTU_LOOKUP']
      : jobType === 'CONTACT'
        ? ['APOLLO_PEOPLE_SEARCH', 'APOLLO_BULK_ENRICH']
        : ['BUILTWITH_CTU_LOOKUP', 'APOLLO_PEOPLE_SEARCH', 'APOLLO_BULK_ENRICH'];
    const estCredits = await estimateJobCredits(100, opTypes);
    const billingCheck = await checkBillingGate(ctx.teamId, estCredits, ctx.channelId);
    if (!billingCheck.allowed) {
      return { text: billingCheck.reason ?? 'Billing is not active for this workspace.' };
    }
    if (billingCheck.estimatedCredits) {
      await ctx.client.chat.postMessage({
        channel: ctx.channelId,
        thread_ts: ctx.threadTs,
        text: `Estimated cost: ~${billingCheck.estimatedCredits} credits for this enrichment.`,
      });
    }

    // Create the Job record with sourceInterface=AGENT
    const enrichClientId = await resolveClientId(ctx.teamId, ctx.channelId);
    const job = await prisma.job.create({
      data: {
        slackChannelId: ctx.channelId,
        slackThreadTs: ctx.threadTs,
        slackUserId: ctx.userId,
        slackTeamId: ctx.teamId,
        jobType: jobType as 'TECHNOGRAPHIC' | 'CONTACT' | 'COMBINED',
        sourceInterface: 'AGENT',
        sourceFileName: enrichmentParams.fileName,
        clientId: enrichClientId,
        creditRateSnapshot: billingCheck.rateSnapshot
          ? JSON.parse(JSON.stringify(billingCheck.rateSnapshot))
          : undefined,
        // Persist post-enrichment filter for auto-filtering after job completion
        parsedIntent: enrichmentParams.postEnrichmentFilter
          ? { postEnrichmentFilter: enrichmentParams.postEnrichmentFilter }
          : undefined,
      },
    });

    // Clear post-enrichment filter from thread state after persisting to Job
    if (enrichmentParams.postEnrichmentFilter) {
      delete enrichmentParams.postEnrichmentFilter;
      await updateThreadState(ctx.teamId, ctx.threadTs, { enrichmentParams });
    }

    // Link job to agent thread
    const { linkJobToThread } = await import('./conversationManager.js');
    await linkJobToThread(ctx.teamId, ctx.threadTs, job.id);

    // Start streaming with task card pipeline visualization
    const streamConfig: StreamConfig = {
      client: ctx.client,
      channel: ctx.channelId,
      threadTs: ctx.threadTs,
      userId: ctx.userId,
      teamId: ctx.teamId,
    };

    const initialChunks = buildInitialPlan(enrichType);

    const session = await startStream(streamConfig, {
      taskDisplayMode: 'plan',
      initialChunks,
    });

    // Subscribe to worker progress events for real-time task card updates
    await subscribeToProgress(job.id, enrichType, session);

    // Record assistant turn
    await addTurn(ctx.teamId, ctx.threadTs, {
      role: 'assistant',
      content: `Enrichment job ${job.id.slice(0, 8)} started with streaming task visualization.`,
    });

    return {
      text: '',
      alreadySent: true,
    };
  } catch (error) {
    logger.error('Failed to start enrichment flow', {
      error: error instanceof Error ? error.message : String(error),
      teamId: ctx.teamId,
    });
    return { text: 'Sorry, something went wrong starting the enrichment. Please try again.' };
  }
}

/**
 * Handles settings_update intent — allows workspace admins to configure
 * spending caps, per-service limits, and default enrichment parameters
 * via conversational interface.
 *
 * T071: Workspace settings management via agent.
 */
async function handleSettingsUpdate(ctx: IntentContext): Promise<IntentHandlerResult> {
  // Require workspace admin
  const isAdmin = await isWorkspaceAdmin(ctx.client, ctx.userId);
  if (!isAdmin) {
    return { text: 'Only workspace admins can update settings. Ask your admin to make changes.' };
  }

  const { filterExpression } = ctx.classification.intent;

  // Load current workspace settings
  const workspace = await prisma.workspaceInstallation.findUnique({
    where: { slackTeamId: ctx.teamId },
    select: {
      monthlySpendCapUsd: true,
      maxBuiltwithLookups: true,
      maxApolloCredits: true,
      maxAiTokens: true,
    },
  });

  if (!workspace) {
    return { text: 'Workspace not found. Please reinstall the app.' };
  }

  // If no specific setting requested, show current settings
  if (!filterExpression) {
    const capDisplay = workspace.monthlySpendCapUsd
      ? `$${workspace.monthlySpendCapUsd}`
      : 'No limit';
    const bwDisplay = workspace.maxBuiltwithLookups ?? 'No limit';
    const apolloDisplay = workspace.maxApolloCredits ?? 'No limit';
    const aiDisplay = workspace.maxAiTokens ?? 'No limit';

    return {
      text: `**Current Workspace Settings:**\n• Monthly spend cap: ${capDisplay}\n• Max BuiltWith lookups/month: ${bwDisplay}\n• Max Apollo credits/month: ${apolloDisplay}\n• Max AI tokens/month: ${aiDisplay}\n\nTo update, say something like "set monthly cap to $500" or "set max Apollo credits to 10000".`,
    };
  }

  // Parse setting changes from natural language
  const updates: Record<string, unknown> = {};
  const changes: string[] = [];

  // Match patterns like "cap to $500", "spend cap 500", "monthly cap $1000"
  const capMatch = filterExpression.match(/(?:spend\s*cap|monthly\s*cap|cap)\s*(?:to\s*)?\$?(\d+(?:\.\d{2})?)/i);
  if (capMatch) {
    const value = parseFloat(capMatch[1]);
    updates.monthlySpendCapUsd = value;
    changes.push(`Monthly spend cap: $${value}`);
  }

  // Match "builtwith lookups" or "bw lookups"
  const bwMatch = filterExpression.match(/(?:builtwith|bw)\s*(?:lookups?)?\s*(?:to\s*)?(\d+)/i);
  if (bwMatch) {
    const value = parseInt(bwMatch[1], 10);
    updates.maxBuiltwithLookups = value;
    changes.push(`Max BuiltWith lookups: ${value}`);
  }

  // Match "apollo credits"
  const apolloMatch = filterExpression.match(/(?:apollo)\s*(?:credits?)?\s*(?:to\s*)?(\d+)/i);
  if (apolloMatch) {
    const value = parseInt(apolloMatch[1], 10);
    updates.maxApolloCredits = value;
    changes.push(`Max Apollo credits: ${value}`);
  }

  // Match "ai tokens"
  const aiMatch = filterExpression.match(/(?:ai)\s*(?:tokens?)?\s*(?:to\s*)?(\d+)/i);
  if (aiMatch) {
    const value = parseInt(aiMatch[1], 10);
    updates.maxAiTokens = value;
    changes.push(`Max AI tokens: ${value}`);
  }

  if (changes.length === 0) {
    return {
      text: 'I couldn\'t parse the setting you want to update. Try:\n• "Set monthly cap to $500"\n• "Set max BuiltWith lookups to 5000"\n• "Set max Apollo credits to 10000"',
    };
  }

  // Apply updates
  await prisma.workspaceInstallation.update({
    where: { slackTeamId: ctx.teamId },
    data: updates,
  });

  return {
    text: `**Settings updated:**\n${changes.map((c) => `• ${c}`).join('\n')}\n\nChanges take effect immediately.`,
  };
}

/**
 * Formats an intent name for display.
 */
export function formatIntentName(intent: string): string {
  const names: Record<string, string> = {
    technographic: 'Technographic',
    contact: 'Contact Finder',
    combined: 'Combined (Tech + Contacts)',
    tech_report: 'Technology Report',
    job_status: 'Job Status',
    job_cancel: 'Cancel Job',
    job_history: 'Job History',
    job_download: 'Download Results',
    filter_results: 'Filter Results',
    usage_query: 'Usage Report',
    settings_update: 'Settings Update',
    help: 'Help',
  };
  return names[intent] || intent;
}
