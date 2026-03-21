/**
 * Document list formatter for Slack Block Kit.
 *
 * Formats all active documents for a team into Slack Block Kit blocks,
 * grouped by channel and document type.
 */

import type { KnownBlock } from '@slack/types';
import { prisma } from '../../models/index.js';

/** Human-readable labels for document types. */
const TYPE_LABELS: Record<string, string> = {
  ICP: 'ICP',
  USE_CASE: 'Use Case',
  SETTINGS: 'Settings',
  ONE_PAGER: 'One-Pager',
  UNKNOWN: 'Other',
};

/** Maximum blocks Slack allows per message. */
const SLACK_BLOCK_LIMIT = 50;

/**
 * Formats all active documents for a team as Slack Block Kit blocks.
 *
 * Groups documents by channel, then by type within each channel.
 * Truncates to Slack's 50-block limit with a footer note if needed.
 *
 * @param teamId - Slack workspace/team ID.
 * @returns Array of Slack Block Kit blocks.
 */
export async function formatDocumentList(teamId: string): Promise<KnownBlock[]> {
  const documents = await prisma.clientDocument.findMany({
    where: {
      slackTeamId: teamId,
      status: 'ACTIVE',
    },
    orderBy: [{ slackChannelId: 'asc' }, { documentType: 'asc' }, { slug: 'asc' }],
  });

  if (documents.length === 0) {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'No documents have been uploaded yet. Upload files to a docs channel to get started.',
        },
      },
    ];
  }

  // Group by channel, then by type.
  const byChannel = new Map<string, typeof documents>();
  for (const doc of documents) {
    const ch = doc.slackChannelId;
    if (!byChannel.has(ch)) {
      byChannel.set(ch, []);
    }
    byChannel.get(ch)!.push(doc);
  }

  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `Documents (${documents.length} total)`,
      },
    },
  ];

  let truncated = false;

  for (const [channelId, channelDocs] of byChannel) {
    if (blocks.length >= SLACK_BLOCK_LIMIT - 2) {
      truncated = true;
      break;
    }

    // Channel divider.
    blocks.push({ type: 'divider' });

    // Channel header.
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*<#${channelId}>* (${channelDocs.length} document${channelDocs.length === 1 ? '' : 's'})`,
      },
    });

    // Group by type within channel.
    const byType = new Map<string, typeof channelDocs>();
    for (const doc of channelDocs) {
      const type = doc.documentType;
      if (!byType.has(type)) {
        byType.set(type, []);
      }
      byType.get(type)!.push(doc);
    }

    for (const [type, typeDocs] of byType) {
      if (blocks.length >= SLACK_BLOCK_LIMIT - 2) {
        truncated = true;
        break;
      }

      const typeLabel = TYPE_LABELS[type] ?? type;
      const lines = typeDocs.map((doc) => {
        const updated = doc.updatedAt.toISOString().split('T')[0];
        const summaryPart = doc.summary ? ` -- ${doc.summary}` : '';
        return `\`${doc.slug}\`${summaryPart} (v${doc.version}, ${updated})`;
      });

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${typeLabel}*\n${lines.join('\n')}`,
        },
      });
    }
  }

  // Truncation footer.
  if (truncated) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Showing first ${blocks.length - 1} sections. Total: ${documents.length} documents.`,
        },
      ],
    });
  }

  return blocks;
}
