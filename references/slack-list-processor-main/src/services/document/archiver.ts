/**
 * Document archive service.
 *
 * Archives a document by slug, checking ownership/admin permissions,
 * and triggers TOC regeneration for the affected channel.
 */

import { prisma } from '../../models/index.js';
import { logAudit } from '../../lib/auditLogger.js';
import { generateTableOfContents } from './tocGenerator.js';
import logger from '../../lib/logger.js';

/** Result of an archive operation. */
export interface ArchiveResult {
  success: boolean;
  error?: string;
}

/**
 * Archives a document by slug within a team.
 *
 * Checks ownership or admin permission before archiving. Regenerates
 * the channel TOC after successful archive.
 *
 * @param teamId - Slack workspace/team ID.
 * @param slug - The document slug to archive.
 * @param requestingUserId - The user requesting the archive.
 * @param isAdmin - Whether the requesting user is a workspace admin.
 * @returns Archive result with success status or error message.
 */
export async function archiveDocument(
  teamId: string,
  slug: string,
  requestingUserId: string,
  isAdmin: boolean,
): Promise<ArchiveResult> {
  // Look up document across all channels.
  const matches = await prisma.clientDocument.findMany({
    where: {
      slackTeamId: teamId,
      slug,
      status: 'ACTIVE',
    },
  });

  if (matches.length === 0) {
    return { success: false, error: `Document \`${slug}\` not found or already archived.` };
  }

  if (matches.length > 1) {
    const channels = matches.map((d) => `<#${d.slackChannelId}>`).join(', ');
    return {
      success: false,
      error: `Document \`${slug}\` exists in multiple channels (${channels}). Please specify which channel.`,
    };
  }

  const doc = matches[0];

  // Permission check: uploader or workspace admin.
  if (doc.slackUserId !== requestingUserId && !isAdmin) {
    return {
      success: false,
      error: `Permission denied. Only the uploader or a workspace admin can archive \`${slug}\`.`,
    };
  }

  // Archive the document.
  await prisma.clientDocument.update({
    where: { id: doc.id },
    data: { status: 'ARCHIVED' },
  });

  // Log audit event.
  logAudit({
    action: 'doc_archive',
    actorUserId: requestingUserId,
    actorTeamId: teamId,
    targetType: 'document',
    targetId: doc.id,
    channelId: doc.slackChannelId,
    metadata: { slug, previousStatus: doc.status },
  });

  // Regenerate TOC for the affected channel (fire-and-forget).
  generateTableOfContents(teamId, doc.slackChannelId).catch((err) => {
    logger.warn('Failed to regenerate TOC after archiving', {
      slug,
      channelId: doc.slackChannelId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  logger.info('Document archived', {
    slug,
    channelId: doc.slackChannelId,
    archivedBy: requestingUserId,
  });

  return { success: true };
}
