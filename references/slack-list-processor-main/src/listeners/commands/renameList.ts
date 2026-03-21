/**
 * Slash command handler for /rename-list.
 *
 * Allows users to rename an existing enrichment or filter result file
 * following the naming convention:
 *   MMDD [CLIENT] Campaign Name / Target List : Co-Sell Name
 *
 * Subcommands:
 * - (empty)  → shows recent files in the channel for selection
 * - "help"   → ephemeral usage instructions
 */

import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

const RENAME_HELP = `*\`/rename-list\` — Rename an enrichment result file*

Rename a completed enrichment or filter result file following the naming convention:
\`MMDD [CLIENT] Campaign Name / Target List : Co-Sell Name\`

*How to use:*
1. Type \`/rename-list\` in a channel with completed enrichment results
2. Select the file you want to rename
3. Fill in the Campaign Name and optional Co-Sell Name
4. The date and client name are auto-filled

*Naming Pattern:*
• \`0302 [Acme Corp] Q1 Outbound / Target List : AWS\`
• \`0310 [BigCo] Cold Calling List\``;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A recent result file available for renaming. */
interface RecentFile {
  jobId: string;
  jobType: 'enrichment' | 'filter';
  resultFileName: string | null;
  resultFileUrl: string;
  rowCount: number | null;
  completedAt: Date;
  cosellProvider: string | null;
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

/**
 * Registers the /rename-list slash command handler with the Bolt app.
 */
export function registerRenameListCommand(app: App): void {
  app.command('/rename-list', async ({ command, ack, client, respond }) => {
    await ack();

    const channelId = command.channel_id;
    const userId = command.user_id;
    const text = (command.text ?? '').trim().toLowerCase();

    if (text === 'help') {
      await respond({ text: RENAME_HELP, response_type: 'ephemeral' });
      return;
    }

    try {
      // Post a visible channel message to create a thread root
      const initialMsg = await client.chat.postMessage({
        channel: channelId,
        text: `<@${userId}> started a list rename operation.`,
      });

      const threadTs = initialMsg.ts as string;

      // Query DB for recent completed jobs with result files in this channel
      const recentFiles = await findRecentFilesInChannel(channelId);

      if (recentFiles.length > 0) {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          blocks: buildRenameFileSelectionBlocks(recentFiles) as KnownBlock[],
          text: 'Select a file to rename.',
        });
      } else {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: 'No completed enrichment or filter files found in this channel. Run an enrichment first, then use `/rename-list`.',
        });
      }
    } catch (error) {
      logger.error('Error in /rename-list command', { error, channelId, userId });
      await respond({
        text: 'Something went wrong starting the rename. Please try again.',
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
        cosellProvider: true,
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
      rowCount: j.companiesProcessed ?? j.sourceRowCount,
      completedAt: j.completedAt ?? j.createdAt,
      cosellProvider: j.cosellProvider,
    })),
    ...filterJobs.map((j) => ({
      jobId: j.id,
      jobType: 'filter' as const,
      resultFileName: j.resultFileName,
      resultFileUrl: j.resultFileUrl!,
      rowCount: j.resultRowCount,
      completedAt: j.completedAt ?? j.createdAt,
      cosellProvider: null,
    })),
  ];

  // Sort by completion date descending
  files.sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime());

  return files.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Block Kit builders
// ---------------------------------------------------------------------------

/**
 * Builds blocks showing a list of recent files with "Rename" buttons.
 */
function buildRenameFileSelectionBlocks(recentFiles: RecentFile[]): object[] {
  const blocks: object[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Select a file to rename:*\nThe new name will follow the pattern: `MMDD [CLIENT] Campaign Name : Co-Sell Name`',
      },
    },
  ];

  for (const file of recentFiles) {
    const name = file.resultFileName ?? 'Untitled file';
    const date = file.completedAt.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    const rowInfo = file.rowCount != null ? ` | ${file.rowCount} rows` : '';
    const typeLabel = file.jobType === 'filter' ? 'Filtered' : 'Enrichment';

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${name}*\n${typeLabel} | ${date}${rowInfo}`,
      },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: 'Rename' },
        action_id: 'rename_select_file',
        value: JSON.stringify({
          jobId: file.jobId,
          jobType: file.jobType,
          currentName: name,
          cosellProvider: file.cosellProvider,
        }),
      },
    });
  }

  return blocks;
}
