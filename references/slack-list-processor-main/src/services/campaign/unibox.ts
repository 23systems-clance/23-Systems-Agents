/**
 * UniBox service for aggregated email + LinkedIn reply management.
 *
 * Reads from UniboxReply table (populated by webhooks) and provides
 * reply-to-email capability via the Instantly API.
 */

import { ReplyChannel, SmartReplyDraftStatus } from '@prisma/client';
import { prisma } from '../../models/index.js';
import { replyToEmail as instantlyReplyToEmail } from '../instantly/instantlyClient.js';
import logger from '../../lib/logger.js';


/** Filters for UniBox queries. */
export interface UniboxFilters {
  campaignId?: string;
  channel?: ReplyChannel;
  isRead?: boolean;
  page?: number;
  limit?: number;
}

/** UniBox reply with contact info and smart reply draft data. */
export interface UniboxReplyWithContact {
  id: string;
  campaignId: string;
  campaignName: string;
  channel: ReplyChannel;
  fromName: string | null;
  fromEmail: string | null;
  fromLinkedinUrl: string | null;
  subject: string | null;
  body: string;
  externalId: string | null;
  isRead: boolean;
  receivedAt: Date;
  draftBody: string | null;
  draftStatus: SmartReplyDraftStatus | null;
  draftIntent: string | null;
  draftGeneratedAt: Date | null;
  draftError: string | null;
  contact: {
    id: string;
    firstName: string;
    lastName: string;
    companyName: string | null;
  } | null;
}

/**
 * Lists UniBox replies for a BDR's campaigns.
 *
 * @param campaignIds - Campaign IDs the BDR is assigned to
 * @param filters - Optional filters (channel, read status, pagination)
 * @returns Paginated list of replies
 */
export async function getUniboxReplies(
  campaignIds: string[],
  filters?: UniboxFilters,
): Promise<{ data: UniboxReplyWithContact[]; total: number }> {
  const page = filters?.page ?? 1;
  const limit = filters?.limit ?? 20;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {
    campaignId: { in: campaignIds },
  };
  if (filters?.campaignId) where.campaignId = filters.campaignId;
  if (filters?.channel) where.channel = filters.channel;
  if (filters?.isRead !== undefined) where.isRead = filters.isRead;

  const [replies, total] = await Promise.all([
    prisma.uniboxReply.findMany({
      where,
      include: {
        campaign: { select: { name: true } },
        campaignContact: {
          select: { id: true, firstName: true, lastName: true, companyName: true },
        },
      },
      orderBy: { receivedAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.uniboxReply.count({ where }),
  ]);

  return {
    data: replies.map((r) => ({
      id: r.id,
      campaignId: r.campaignId,
      campaignName: r.campaign.name,
      channel: r.channel,
      fromName: r.fromName,
      fromEmail: r.fromEmail,
      fromLinkedinUrl: r.fromLinkedinUrl,
      subject: r.subject,
      body: r.body,
      externalId: r.externalId,
      isRead: r.isRead,
      receivedAt: r.receivedAt,
      draftBody: r.draftBody,
      draftStatus: r.draftStatus,
      draftIntent: r.draftIntent,
      draftGeneratedAt: r.draftGeneratedAt,
      draftError: r.draftError,
      contact: r.campaignContact
        ? {
            id: r.campaignContact.id,
            firstName: r.campaignContact.firstName,
            lastName: r.campaignContact.lastName,
            companyName: r.campaignContact.companyName,
          }
        : null,
    })),
    total,
  };
}

/**
 * Marks a UniBox reply as read.
 *
 * @param replyId - UniboxReply ID
 */
export async function markReplyAsRead(replyId: string): Promise<void> {
  await prisma.uniboxReply.update({
    where: { id: replyId },
    data: { isRead: true },
  });
}

/**
 * Replies to an email via the Instantly API.
 *
 * @param replyId - UniboxReply ID to respond to
 * @param body - Reply body text
 */
export async function replyToUniboxEmail(replyId: string, body: string): Promise<void> {
  const reply = await prisma.uniboxReply.findUnique({
    where: { id: replyId },
  });

  if (!reply) {
    throw new Error(`UniBox reply not found: ${replyId}`);
  }

  if (reply.channel !== ReplyChannel.EMAIL) {
    throw new Error('Can only reply to email messages via UniBox');
  }

  if (!reply.externalId) {
    throw new Error('Reply has no external email ID — cannot respond via Instantly');
  }

  await instantlyReplyToEmail(reply.externalId, body);

  // Mark as read
  await prisma.uniboxReply.update({
    where: { id: replyId },
    data: { isRead: true },
  });

  logger.info('UniBox email reply sent', { replyId, externalId: reply.externalId });
}
