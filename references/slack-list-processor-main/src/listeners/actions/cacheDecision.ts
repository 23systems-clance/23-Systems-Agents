/**
 * Bolt action handler for cache decision buttons (T048).
 *
 * When a tech report query matches an existing cached result in
 * TechReportCache, the bot presents the user with two buttons:
 *   - "Use Cached Result" (action_id: cache_use)
 *   - "Run Fresh Query"   (action_id: cache_fresh)
 *
 * This module provides:
 *   1. `buildCacheDecisionBlocks` -- Block Kit builder for the prompt.
 *   2. `registerCacheDecisionHandlers` -- Bolt action registrations.
 */

import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../../models/index.js';
import { getConversation } from '../../services/state/conversationStore.js';
import { enrichmentQueue } from '../../services/queue/queues.js';
import type { TechReportJobData } from '../../services/queue/queues.js';
import { generateTechReportOutput } from '../../services/file/generator.js';
import type { TechReportCompanyRecord } from '../../services/file/generator.js';
import { uploadSlackFile } from '../../services/file/slackFile.js';
import logger from '../../lib/logger.js';
import { trackUsage } from '../../services/metering/usageTracker.js';
import { checkBillingGate } from '../../services/billing/billingGate.js';
import { estimateJobCredits } from '../../services/billing/creditRateCalculator.js';
import { resolveClientId } from '../../lib/clientLookup.js';
import { startStream, type StreamConfig } from '../../services/agent/streamingHelper.js';
import { buildInitialPlan, subscribeToProgress } from '../../services/agent/taskVisualizer.js';

// ---------------------------------------------------------------------------
// Block Kit builder
// ---------------------------------------------------------------------------

/**
 * Builds Block Kit blocks for the cache decision prompt.
 *
 * Presents the user with a summary of the cached report and three action
 * buttons: "Use Cached Result", "Run Fresh Query", and "Cancel".
 *
 * @param cacheId     - UUID of the TechReportCache record.
 * @param technology  - Technology name the report covers.
 * @param resultCount - Number of companies in the cached report.
 * @param createdAt   - Date the cached report was generated.
 * @returns Block Kit blocks array for the cache decision message.
 */
export function buildCacheDecisionBlocks(
  cacheId: string,
  technology: string,
  resultCount: number,
  createdAt: Date,
  requestedCount?: number,
): KnownBlock[] {
  const formattedDate = createdAt.toISOString().split('T')[0] ?? '';
  // Encode requestedCount in button value so it survives Redis TTL expiry
  const btnValue = requestedCount ? `${cacheId}:${requestedCount}` : cacheId;

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `I found a cached report for *${technology}* with ${resultCount} ` +
          `companies, generated on ${formattedDate}.`,
      },
    },
    {
      type: 'actions',
      block_id: 'cache_decision',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Use Cached Result' },
          action_id: 'cache_use',
          value: btnValue,
          style: 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Run Fresh Query' },
          action_id: 'cache_fresh',
          value: btnValue,
          style: 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Cancel' },
          action_id: 'cache_cancel',
          value: btnValue,
          style: 'danger',
        },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

/**
 * Registers Bolt action handlers for `cache_use`, `cache_fresh`, and `cache_cancel` buttons.
 *
 * - `cache_use`: Delivers the cached tech report file immediately.
 * - `cache_fresh`: Creates a new Job and enqueues a fresh BuiltWith query.
 * - `cache_cancel`: Dismisses the cache decision prompt.
 *
 * @param app - The Slack Bolt application instance.
 */
export function registerCacheDecisionHandlers(app: App): void {
  // -----------------------------------------------------------------------
  // cache_use -- deliver cached report
  // -----------------------------------------------------------------------
  app.action('cache_use', async ({ ack, body, client }) => {
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
    const rawValue = action.actions?.[0]?.value;

    // Parse cacheId and optional requestedCount from button value ("cacheId:count" or "cacheId")
    const valueParts = rawValue?.split(':') ?? [];
    const cacheId = valueParts[0];
    const btnRequestedCount = valueParts[1] ? parseInt(valueParts[1], 10) : undefined;

    if (!channelId || !threadTs || !cacheId) {
      logger.warn('cache_use: missing context', { channelId, threadTs, cacheId });
      return;
    }

    try {
      // 1. Update original message to indicate selection
      if (messageTs) {
        try {
          await client.chat.update({
            channel: channelId,
            ts: messageTs,
            text: 'Using cached result...',
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: 'Using cached result...',
                },
              },
            ],
          });
        } catch (err) {
          logger.warn('cache_use: failed to update decision message', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // 2. Look up the TechReportCache record
      const cache = await prisma.techReportCache.findUnique({
        where: { id: cacheId },
      });

      if (!cache) {
        logger.warn('cache_use: cache record not found', { cacheId });
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: 'The cached report could not be found. It may have been removed. Please run a fresh query.',
        });
        return;
      }

      // 3. Look up all TechReportCacheEntry records for this cache
      const allEntries = await prisma.techReportCacheEntry.findMany({
        where: { cacheId },
      });

      // 3b. Apply requestedCount truncation (button value first, conversation state fallback)
      const conversation = await getConversation(channelId, threadTs);
      const requestedCount = btnRequestedCount ?? conversation?.requestedCount;
      const entries = requestedCount && requestedCount > 0 && allEntries.length > requestedCount
        ? allEntries.slice(0, requestedCount)
        : allEntries;

      // 4. Map entries to TechReportCompanyRecord for file generation
      const companies: TechReportCompanyRecord[] = entries.map((entry) => ({
        domain: entry.domain,
        companyName: entry.companyName,
        location: [entry.city, entry.stateRegion, entry.country]
          .filter(Boolean)
          .join(', ') || null,
        trafficRank: entry.trafficRank,
        technologyFirstDetected: null,
        technologyLastDetected: null,
      }));

      // 5. Generate the report file
      const fileBuffer = generateTechReportOutput({
        companies,
        outputFormat: 'XLSX',
      });

      const filename = `tech-report-${cache.technology.toLowerCase().replace(/\s+/g, '-')}.xlsx`;

      // 6. Upload to Slack in the thread
      await uploadSlackFile({
        client,
        channelId,
        threadTs,
        fileBuffer,
        filename,
        title: `Tech Report: ${cache.technology}`,
        initialComment: `Here is the cached tech report for *${cache.technology}* with ${companies.length} companies.`,
      });

      logger.info('cache_use: delivered cached report', {
        cacheId,
        technology: cache.technology,
        companyCount: companies.length,
        channelId,
        threadTs,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('cache_use: failed to deliver cached report', {
        cacheId,
        channelId,
        threadTs,
        error: errorMsg,
      });
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: 'Sorry, something went wrong delivering the cached report. Please try running a fresh query.',
      });
    }
  });

  // -----------------------------------------------------------------------
  // cache_fresh -- enqueue a new BuiltWith query
  // -----------------------------------------------------------------------
  app.action('cache_fresh', async ({ ack, body, client }) => {
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
    const userId = action.user?.id ?? 'unknown';
    const teamId = action.user?.team_id ?? action.team?.id ?? 'unknown';
    const rawValue = action.actions?.[0]?.value;

    // Parse cacheId and optional requestedCount from button value ("cacheId:count" or "cacheId")
    const valueParts = rawValue?.split(':') ?? [];
    const cacheId = valueParts[0];
    const btnRequestedCount = valueParts[1] ? parseInt(valueParts[1], 10) : undefined;

    if (!channelId || !threadTs || !cacheId) {
      logger.warn('cache_fresh: missing context', { channelId, threadTs, cacheId });
      return;
    }

    try {
      // 1. Update original message to indicate selection
      if (messageTs) {
        try {
          await client.chat.update({
            channel: channelId,
            ts: messageTs,
            text: 'Running a fresh query...',
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: 'Running a fresh query...',
                },
              },
            ],
          });
        } catch (err) {
          logger.warn('cache_fresh: failed to update decision message', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // 2. Retrieve conversation state for technology and filters
      const conversation = await getConversation(channelId, threadTs);

      if (!conversation || !conversation.technology) {
        logger.warn('cache_fresh: conversation state or technology not found', {
          channelId,
          threadTs,
        });
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: 'Unable to find the query context. Please start a new tech report request.',
        });
        return;
      }

      const technology = conversation.technology;
      const filters = conversation.filters ?? {};

      // Billing gate check for fresh tech report
      const estCredits = await estimateJobCredits(100, ['BUILTWITH_CTU_LOOKUP']);
      const billingCheck = await checkBillingGate(teamId, estCredits, channelId);
      if (!billingCheck.allowed) {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: billingCheck.reason ?? 'Billing is not active for this workspace.',
        });
        return;
      }

      // 3. Create a new Job record
      let channelName: string | null = null;
      try {
        const chInfo = await client.conversations.info({ channel: channelId });
        channelName = chInfo.channel?.name ?? null;
      } catch { /* ignore */ }
      const freshClientId = await resolveClientId(teamId, channelId);
      const jobId = uuidv4();
      await prisma.job.create({
        data: {
          id: jobId,
          jobType: 'TECH_REPORT',
          status: 'PENDING',
          slackChannelId: channelId,
          slackChannelName: channelName,
          slackThreadTs: threadTs,
          slackUserId: userId,
          slackTeamId: teamId,
          clientId: freshClientId,
          creditRateSnapshot: billingCheck.rateSnapshot
            ? JSON.parse(JSON.stringify(billingCheck.rateSnapshot))
            : undefined,
        },
      });

      // Log AI intent classification usage now that we have a jobId.
      if (conversation.intentUsage) {
        await trackUsage({
          jobId,
          slackTeamId: teamId,
          service: 'ANTHROPIC',
          endpoint: 'classifyIntent',
          tokensInput: conversation.intentUsage.inputTokens,
          tokensOutput: conversation.intentUsage.outputTokens,
          estimatedCostUsd: conversation.intentUsage.estimatedCostUsd,
          durationMs: conversation.intentUsage.durationMs,
        });
      }

      // 4. Start streaming with task card visualization
      const streamConfig: StreamConfig = {
        client,
        channel: channelId,
        threadTs,
        userId,
        teamId,
      };

      const initialChunks = buildInitialPlan('tech_report', `Technology Report: ${technology}`);
      const session = await startStream(streamConfig, {
        taskDisplayMode: 'plan',
        initialChunks,
      });

      // Note: task-mode streams only accept chunks, not markdown_text
      await subscribeToProgress(jobId, 'tech_report', session);

      // 5. Enqueue the tech-report job (without useCachedResult)
      const requestedCount = btnRequestedCount ?? conversation.requestedCount;
      const jobData: TechReportJobData = {
        jobId,
        technology,
        filters: {
          country: filters.country,
          stateRegion: filters.stateRegion,
          companySize: filters.companySize,
          trafficLevel: filters.trafficLevel,
        },
        ...(requestedCount && { requestedCount }),
      };

      await enrichmentQueue.add('tech-report', jobData);

      logger.info('cache_fresh: enqueued fresh tech report job', {
        jobId,
        technology,
        filters,
        channelId,
        threadTs,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('cache_fresh: failed to enqueue fresh query', {
        cacheId,
        channelId,
        threadTs,
        error: errorMsg,
      });
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: 'Sorry, something went wrong starting the fresh query. Please try again.',
      });
    }
  });

  // -----------------------------------------------------------------------
  // cache_cancel -- dismiss cache decision prompt
  // -----------------------------------------------------------------------
  app.action('cache_cancel', async ({ ack, body, client }) => {
    await ack();

    const channelId = (body as { channel?: { id: string } }).channel?.id;
    const messageTs = (body as { message?: { ts: string } }).message?.ts;

    if (!channelId || !messageTs) return;

    try {
      await client.chat.update({
        channel: channelId,
        ts: messageTs,
        text: 'Cache decision cancelled.',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: 'Cache decision cancelled.',
            },
          },
        ],
      });
    } catch (err) {
      logger.warn('cache_cancel: failed to update message', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
