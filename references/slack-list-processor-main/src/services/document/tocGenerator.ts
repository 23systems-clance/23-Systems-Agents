/**
 * Table of Contents generator for docs channels.
 *
 * Queries all ACTIVE documents in a channel, groups them by type,
 * formats as markdown, uploads to S3, and caches in Redis.
 */

import { prisma } from '../../models/index.js';
import { uploadFile } from '../../lib/storage.js';
import redis from '../../lib/redis.js';
import logger from '../../lib/logger.js';

/** Redis key prefix for cached TOC. */
const TOC_CACHE_PREFIX = 'toc';

/** TTL for cached TOC (5 minutes). */
const TOC_CACHE_TTL = 300;

/** Human-readable headings for each document type. */
const TYPE_HEADINGS: Record<string, string> = {
  ICP: 'ICP (Ideal Customer Profiles)',
  USE_CASE: 'Use Cases',
  SETTINGS: 'Settings',
  ONE_PAGER: 'One-Pagers',
  UNKNOWN: 'Other',
};

/**
 * Generates a table of contents for all active documents in a channel.
 *
 * Queries the database, formats as grouped markdown, uploads to S3,
 * and caches in Redis with a 5-minute TTL.
 *
 * @param teamId - Slack workspace/team ID.
 * @param channelId - Slack channel ID.
 * @returns The generated markdown TOC string.
 */
export async function generateTableOfContents(
  teamId: string,
  channelId: string,
): Promise<string> {
  const documents = await prisma.clientDocument.findMany({
    where: {
      slackTeamId: teamId,
      slackChannelId: channelId,
      status: 'ACTIVE',
    },
    orderBy: [{ documentType: 'asc' }, { slug: 'asc' }],
  });

  if (documents.length === 0) {
    const emptyToc = '# Table of Contents\n\nNo documents have been uploaded yet.\n';
    await cacheToc(teamId, channelId, emptyToc);
    await uploadTocToS3(teamId, channelId, emptyToc);
    return emptyToc;
  }

  // Group documents by type.
  const grouped = new Map<string, typeof documents>();
  for (const doc of documents) {
    const type = doc.documentType;
    if (!grouped.has(type)) {
      grouped.set(type, []);
    }
    grouped.get(type)!.push(doc);
  }

  // Build markdown.
  let markdown = '# Table of Contents\n\n';
  markdown += `*${documents.length} active document${documents.length === 1 ? '' : 's'}*\n\n`;

  // Order types by the TYPE_HEADINGS keys order.
  const typeOrder = Object.keys(TYPE_HEADINGS);
  const sortedTypes = Array.from(grouped.keys()).sort(
    (a, b) => (typeOrder.indexOf(a) === -1 ? 99 : typeOrder.indexOf(a)) -
              (typeOrder.indexOf(b) === -1 ? 99 : typeOrder.indexOf(b)),
  );

  for (const type of sortedTypes) {
    const docs = grouped.get(type)!;
    const heading = TYPE_HEADINGS[type] ?? type;

    markdown += `## ${heading}\n\n`;
    for (const doc of docs) {
      const updated = doc.updatedAt.toISOString().split('T')[0];
      const summaryPart = doc.summary ? ` -- ${doc.summary}` : '';
      markdown += `- \`${doc.slug}\`${summaryPart} (v${doc.version}, updated ${updated})\n`;
    }
    markdown += '\n';
  }

  // Upload to S3 and cache.
  await uploadTocToS3(teamId, channelId, markdown);
  await cacheToc(teamId, channelId, markdown);

  logger.info('Table of contents generated', {
    teamId,
    channelId,
    documentCount: documents.length,
  });

  return markdown;
}

/**
 * Uploads TOC markdown to S3.
 */
async function uploadTocToS3(teamId: string, channelId: string, markdown: string): Promise<void> {
  const s3Key = `docs/${teamId}/${channelId}/table-of-contents.md`;
  await uploadFile(s3Key, Buffer.from(markdown, 'utf-8'), 'text/markdown');
}

/**
 * Caches TOC markdown in Redis with TTL.
 */
async function cacheToc(teamId: string, channelId: string, markdown: string): Promise<void> {
  const cacheKey = `${TOC_CACHE_PREFIX}:${teamId}:${channelId}`;
  await redis.set(cacheKey, markdown, 'EX', TOC_CACHE_TTL);
}
