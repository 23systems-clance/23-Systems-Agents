/**
 * Slash command handler for /filter.
 *
 * Allows users to filter an uploaded CSV/XLSX file using natural language
 * or a structured form. The filtered file is returned in the thread.
 *
 * Subcommands:
 * - (empty) or "help" → ephemeral usage instructions
 * - natural language   → starts filter flow with recent file
 */

import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import { setConversation } from '../../services/state/conversationStore.js';
import {
  buildFilterEnrichmentFileSelectionBlocks,
  buildFilterUploadPromptBlocks,
  type RecentFile,
} from '../../services/filter/filterBlocks.js';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

const FILTER_HELP = `*\`/filter\` — Filter an uploaded list*

Upload a CSV or XLSX file, then use \`/filter\` to remove or keep rows based on criteria.

*How to use:*
1. Upload a CSV/XLSX file to a channel
2. Type \`/filter\` in that channel
3. Describe your filter in plain English _or_ use the structured form

*Examples:*
• \`/filter\` → starts interactive filter flow
• Natural language: "exclude companies with more than 200 employees"
• Natural language: "only keep rows where country is US"

*Supported operators:*
equals, not equals, contains, greater than, less than, is empty, is not empty`;

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

/**
 * Registers the /filter slash command handler with the Bolt app.
 */
export function registerFilterCommand(app: App): void {
  app.command('/filter', async ({ command, ack, client, respond }) => {
    await ack();

    const channelId = command.channel_id;
    const userId = command.user_id;
    const teamId = command.team_id;
    const text = (command.text ?? '').trim().toLowerCase();

    // Handle help subcommand
    if (text === 'help') {
      await respond({ text: FILTER_HELP, response_type: 'ephemeral' });
      return;
    }

    try {
      // Post a visible channel message to create a thread root
      const initialMsg = await client.chat.postMessage({
        channel: channelId,
        text: `<@${userId}> started a filter operation.`,
      });

      const threadTs = initialMsg.ts as string;

      // Initialize conversation state for this filter flow
      await setConversation(channelId, threadTs, {
        fileId: '',
        fileName: '',
        fileType: 'csv',
        userId,
        channelId,
        threadTs,
        status: 'pending',
        flowType: 'filter',
        teamId,
      });

      // Query DB for recent completed jobs with result files in this channel
      const recentFiles = await findRecentFilesInChannel(channelId);

      if (recentFiles.length > 0) {
        // Show dropdown of recent enrichment/filter files
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          blocks: buildFilterEnrichmentFileSelectionBlocks(recentFiles) as KnownBlock[],
          text: 'Select a file to filter.',
        });
      } else {
        // No files found — prompt upload
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          blocks: buildFilterUploadPromptBlocks() as KnownBlock[],
          text: 'Upload a file to filter.',
        });
      }
    } catch (error) {
      logger.error('Error in /filter command', { error, channelId, userId });
      await respond({
        text: 'Something went wrong starting the filter. Please try again.',
        response_type: 'ephemeral',
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Queries the Job and FilterJob tables for recent completed jobs with
 * result files in the given channel. Returns up to 10 files sorted by
 * completion date (most recent first).
 */
async function findRecentFilesInChannel(
  channelId: string,
): Promise<RecentFile[]> {
  const [enrichmentJobs, filterJobs] = await Promise.all([
    prisma.job.findMany({
      where: {
        slackChannelId: channelId,
        status: 'COMPLETED',
        resultFileUrl: { not: null },
      },
      orderBy: { completedAt: 'desc' },
      take: 7,
      select: {
        id: true,
        resultFileName: true,
        resultFileUrl: true,
        sourceRowCount: true,
        companiesProcessed: true,
        completedAt: true,
        createdAt: true,
      },
    }),
    prisma.filterJob.findMany({
      where: {
        slackChannelId: channelId,
        status: 'COMPLETED',
        resultFileUrl: { not: null },
      },
      orderBy: { completedAt: 'desc' },
      take: 3,
      select: {
        id: true,
        resultFileName: true,
        resultFileUrl: true,
        resultRowCount: true,
        completedAt: true,
        createdAt: true,
      },
    }),
  ]);

  const files: RecentFile[] = [
    ...enrichmentJobs.map((j) => ({
      jobId: j.id,
      jobType: 'enrichment' as const,
      resultFileName: j.resultFileName,
      resultFileUrl: j.resultFileUrl!,
      rowCount: j.companiesProcessed || j.sourceRowCount,
      completedAt: j.completedAt ?? j.createdAt,
    })),
    ...filterJobs.map((j) => ({
      jobId: j.id,
      jobType: 'filter' as const,
      resultFileName: j.resultFileName,
      resultFileUrl: j.resultFileUrl!,
      rowCount: j.resultRowCount,
      completedAt: j.completedAt ?? j.createdAt,
    })),
  ];

  // Sort by completion date (most recent first) and take top 10
  files.sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime());
  return files.slice(0, 10);
}
