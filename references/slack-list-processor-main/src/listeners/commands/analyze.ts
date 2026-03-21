/**
 * Slash command handler for /analyze.
 *
 * Generates an Account Analysis Report from enrichment data, optionally
 * enhanced by per-channel ICP, Use Cases, Campaigns, and Settings docs.
 *
 * Subcommands:
 * - (empty)                  → Start analysis (select data sources)
 * - "upload <type>"          → Upload a config doc (ICP, UseCases, etc.)
 * - "docs"                   → List config docs for this channel
 * - "delete <type>"          → Delete a config doc
 * - "help"                   → Ephemeral usage instructions
 */

import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import { requireFeature } from '../../services/featureToggle/featureGate.js';
import { prisma } from '../../models/index.js';
import {
  setConversation,
} from '../../services/state/conversationStore.js';
import {
  resolveDocType,
  deleteConfigDoc,
  getConfigDocStatus,
} from '../../services/analyze/configDocService.js';
import {
  buildAnalyzeDataSourceBlocks,
  buildConfigDocListBlocks,
} from '../../services/analyze/reportBlocks.js';
import { DOC_TYPE_LABELS } from '../../services/analyze/configDocService.js';
import logger from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

const ANALYZE_HELP = `*\`/analyze\` — Generate an Account Analysis Report*

Cross-reference enriched company + contact data to produce a comprehensive
analysis with opportunity scoring, cloud distribution, AI landscape, and more.

*Subcommands:*
• \`/analyze\` — Start analysis (select enrichment data sources)
• \`/analyze upload ICP\` — Upload your ICP (Ideal Customer Profile) document
• \`/analyze upload UseCases\` — Upload your Use Cases document
• \`/analyze upload Campaigns\` — Upload your Campaigns document
• \`/analyze upload Settings\` — Upload your Settings document
• \`/analyze docs\` — List config docs for this channel
• \`/analyze delete <type>\` — Remove a config doc
• \`/analyze help\` — Show this help

*Config documents* improve analysis quality:
• *ICP* — Ideal Customer Profile for targeted scoring
• *Use Cases* — Product capabilities for opportunity matching
• *Campaigns* — Active campaigns for outreach mapping
• *Settings* — Custom scoring weights and parameters

Without config docs, the report generates data-driven sections only and
indicates what's missing and how each doc would improve the analysis.`;

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

/**
 * Registers the /analyze slash command handler with the Bolt app.
 */
export function registerAnalyzeCommand(app: App): void {
  app.command('/analyze', requireFeature('icpAnalysis'), async ({ command, ack, client, respond }) => {
    await ack();

    const channelId = command.channel_id;
    const userId = command.user_id;
    const teamId = command.team_id;
    const rawText = (command.text ?? '').trim();
    const parts = rawText.split(/\s+/);
    const subcommand = parts[0]?.toLowerCase() ?? '';

    logger.info('/analyze command received', {
      userId,
      channelId,
      text: rawText,
      subcommand,
    });

    try {
      // --- help ---
      if (subcommand === 'help') {
        await respond({ text: ANALYZE_HELP, response_type: 'ephemeral' });
        return;
      }

      // --- upload <type> ---
      if (subcommand === 'upload') {
        const typeArg = parts.slice(1).join(' ').trim();
        if (!typeArg) {
          await respond({
            text: 'Please specify a document type: `/analyze upload ICP`, `/analyze upload UseCases`, `/analyze upload Campaigns`, or `/analyze upload Settings`',
            response_type: 'ephemeral',
          });
          return;
        }

        const docType = resolveDocType(typeArg);
        if (!docType) {
          await respond({
            text: `Unknown document type: "${typeArg}". Valid types: ICP, UseCases, Campaigns, Settings`,
            response_type: 'ephemeral',
          });
          return;
        }

        // Post a visible message to create thread + prompt file upload
        const initialMsg = await client.chat.postMessage({
          channel: channelId,
          text: `<@${userId}> is uploading a *${DOC_TYPE_LABELS[docType]}* document. Please upload your file in this thread.`,
        });

        const threadTs = initialMsg.ts as string;

        // Store conversation state for config doc upload flow
        await setConversation(channelId, threadTs, {
          fileId: '',
          fileName: '',
          fileType: 'csv',
          userId,
          channelId,
          threadTs,
          status: 'pending',
          flowType: 'analyze_config_upload',
          configDocType: docType,
          teamId,
        });

        logger.info('Config doc upload flow started', {
          channelId,
          threadTs,
          docType,
        });
        return;
      }

      // --- docs ---
      if (subcommand === 'docs') {
        const { existing, missing } = await getConfigDocStatus(teamId, channelId);

        await respond({
          response_type: 'ephemeral',
          blocks: buildConfigDocListBlocks(existing, missing) as KnownBlock[],
          text: 'Configuration documents for this channel.',
        });
        return;
      }

      // --- delete <type> ---
      if (subcommand === 'delete') {
        const typeArg = parts.slice(1).join(' ').trim();
        if (!typeArg) {
          await respond({
            text: 'Please specify which doc to delete: `/analyze delete ICP`',
            response_type: 'ephemeral',
          });
          return;
        }

        const docType = resolveDocType(typeArg);
        if (!docType) {
          await respond({
            text: `Unknown document type: "${typeArg}". Valid types: ICP, UseCases, Campaigns, Settings`,
            response_type: 'ephemeral',
          });
          return;
        }

        const deleted = await deleteConfigDoc(teamId, channelId, docType);
        if (deleted) {
          await respond({
            text: `Deleted *${DOC_TYPE_LABELS[docType]}* document for this channel.`,
            response_type: 'ephemeral',
          });
        } else {
          await respond({
            text: `No *${DOC_TYPE_LABELS[docType]}* document found for this channel.`,
            response_type: 'ephemeral',
          });
        }
        return;
      }

      // --- run analysis (empty subcommand or unrecognized) ---
      // Post a visible channel message to create a thread root
      const initialMsg = await client.chat.postMessage({
        channel: channelId,
        text: `<@${userId}> started an account analysis.`,
      });

      const threadTs = initialMsg.ts as string;

      // Store conversation state for the analysis flow
      await setConversation(channelId, threadTs, {
        fileId: '',
        fileName: '',
        fileType: 'csv',
        userId,
        channelId,
        threadTs,
        status: 'pending',
        flowType: 'analyze',
        teamId,
      });

      // Query completed enrichment jobs in this channel
      const recentJobs = await prisma.job.findMany({
        where: {
          slackChannelId: channelId,
          status: 'COMPLETED',
          jobType: { in: ['TECHNOGRAPHIC', 'COMBINED'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          jobType: true,
          companiesProcessed: true,
          contactsFound: true,
          createdAt: true,
          sourceFileName: true,
        },
      });

      // Get config doc status
      const { existing: configDocs, missing: missingDocs } = await getConfigDocStatus(
        teamId,
        channelId,
      );

      // Map job data to the format expected by blocks builder
      const jobsForBlocks = recentJobs.map((j) => ({
        id: j.id,
        jobType: j.jobType,
        companyCount: j.companiesProcessed,
        contactCount: j.contactsFound,
        createdAt: j.createdAt,
        sourceFileName: j.sourceFileName,
      }));

      // Post data source selection UI
      const blocks = buildAnalyzeDataSourceBlocks({
        recentJobs: jobsForBlocks,
        configDocs,
        missingDocs,
      });

      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        blocks: blocks as KnownBlock[],
        text: 'Select data sources for analysis.',
      });

      logger.info('Analysis flow started', {
        channelId,
        threadTs,
        recentJobCount: recentJobs.length,
        configDocCount: configDocs.length,
        missingDocCount: missingDocs.length,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error in /analyze command', {
        userId,
        channelId,
        error: errorMessage,
      });

      await respond({
        text: 'Something went wrong starting the analysis. Please try again.',
        response_type: 'ephemeral',
      });
    }
  });
}
