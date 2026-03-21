/**
 * Slash command handler for /split.
 *
 * Allows users to split an uploaded CSV/XLSX file into multiple parts
 * by equal division, column value grouping, or custom N-way splitting.
 *
 * Subcommands:
 * - "help" → ephemeral usage instructions
 * - (empty) → starts interactive split flow
 */

import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import { setConversation } from '../../services/state/conversationStore.js';
import {
  buildSplitFileSelectionBlocks,
  buildSplitUploadPromptBlocks,
  type RecentFile,
} from '../../services/split/splitBlocks.js';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

const SPLIT_HELP = `*\`/split\` — Split a list into multiple parts*

Upload a CSV or XLSX file, then use \`/split\` to divide it into parts.

*Split options:*
- *In Half* — 2 equal parts
- *In Quarters* — 4 equal parts
- *By Column Value* — group rows by unique values in a column
- *Custom N-way* — split into any number of equal parts

*How to use:*
1. Type \`/split\` in a channel
2. Select a recent enrichment/filter result (or upload a new file)
3. Provide a client name and campaign/target list name
4. Choose your split method
5. Confirm and receive your split files

*Output format:* \`MMDD [Client] Campaign Name - Part 1.csv\``;

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

/**
 * Registers the /split slash command handler with the Bolt app.
 */
export function registerSplitCommand(app: App): void {
  app.command('/split', async ({ command, ack, client, respond }) => {
    await ack();

    const channelId = command.channel_id;
    const userId = command.user_id;
    const teamId = command.team_id;
    const text = (command.text ?? '').trim().toLowerCase();

    // Handle help subcommand
    if (text === 'help') {
      await respond({ text: SPLIT_HELP, response_type: 'ephemeral' });
      return;
    }

    try {
      // Post a visible channel message to create a thread root
      const initialMsg = await client.chat.postMessage({
        channel: channelId,
        text: `<@${userId}> started a split operation.`,
      });

      const threadTs = initialMsg.ts as string;

      // Initialize conversation state for this split flow
      await setConversation(channelId, threadTs, {
        fileId: '',
        fileName: '',
        fileType: 'csv',
        userId,
        channelId,
        threadTs,
        status: 'pending',
        flowType: 'split',
        teamId,
      });

      // Query DB for recent completed jobs with result files in this channel
      const recentFiles = await findRecentFilesInChannel(channelId);

      if (recentFiles.length > 0) {
        // Show dropdown of recent enrichment/filter files
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          blocks: buildSplitFileSelectionBlocks(recentFiles) as KnownBlock[],
          text: 'Select a file to split.',
        });
      } else {
        // No files found — prompt upload
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          blocks: buildSplitUploadPromptBlocks() as KnownBlock[],
          text: 'Upload a file to split.',
        });
      }
    } catch (error) {
      logger.error('Error in /split command', { error, channelId, userId });
      await respond({
        text: 'Something went wrong starting the split. Please try again.',
        response_type: 'ephemeral',
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Queries the Job, FilterJob, and SplitJob tables for recent completed jobs
 * with result files in the given channel. Returns up to 10 files sorted by
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
