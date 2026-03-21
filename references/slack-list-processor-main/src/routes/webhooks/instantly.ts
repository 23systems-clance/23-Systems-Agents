/**
 * Instantly.ai webhook handler.
 *
 * Receives webhook events from Instantly campaigns and processes them
 * to advance contacts through the campaign sequence.
 *
 * Events handled:
 * - email_sent: Mark step COMPLETED, advance contact
 * - reply_received: Mark contact RESPONDED, store in UniboxReply
 * - email_bounced: Mark step FAILED, advance to next step
 * - lead_meeting_booked: Flag contact, update metrics
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  StepExecutionStatus,
  ContactCampaignStatus,
  WebhookSource,
  ReplyChannel,
} from '@prisma/client';
import { WebClient } from '@slack/web-api';
import { prisma } from '../../models/index.js';
import { config } from '../../config/index.js';
import { advanceContact } from '../../services/campaign/sequenceEngine.js';
import { trackActivity, getAssignedBdr } from '../../services/campaign/activityTracker.js';
import { hubspotActivitySyncQueue, smartReplyQueue } from '../../services/queue/queues.js';
import { SmartReplyDraftStatus } from '@prisma/client';
import logger from '../../lib/logger.js';
import crypto from 'crypto';

/** Lazily initialised Slack client for sending BDR notifications. */
let _slackClient: WebClient | null = null;
function getSlackClient(): WebClient {
  if (!_slackClient) {
    _slackClient = new WebClient(config.slack.botToken);
  }
  return _slackClient;
}

const router = Router();

/**
 * POST /api/webhooks/instantly
 *
 * 1. Validates webhook secret
 * 2. Responds 200 immediately
 * 3. Processes event asynchronously
 */
router.post('/', (req: Request, res: Response) => {
  const secret = req.headers['x-instantly-webhook-secret'] as string | undefined;

  if (secret !== config.instantly.webhookSecret) {
    logger.warn('Instantly webhook: invalid secret');
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  res.status(200).json({ received: true });

  const payload = req.body;
  processInstantlyWebhook(payload).catch((err) => {
    logger.error('Failed to process Instantly webhook', {
      eventType: payload?.event_type,
      error: err instanceof Error ? err.message : String(err),
    });
  });
});

/**
 * Processes an Instantly webhook event.
 */
async function processInstantlyWebhook(payload: Record<string, unknown>): Promise<void> {
  const eventType = payload.event_type as string;
  const campaignId = payload.campaign_id as string | undefined;
  const leadEmail = payload.lead_email as string | undefined;

  if (!eventType) {
    logger.warn('Instantly webhook: missing event_type');
    return;
  }

  // Deduplicate: check if we've already processed this exact event
  const dedupeHash = generateDedupeHash('INSTANTLY', eventType, leadEmail, payload.timestamp as string);
  const existing = await prisma.webhookEvent.findFirst({
    where: { source: WebhookSource.INSTANTLY, eventType, contactEmail: leadEmail },
    orderBy: { createdAt: 'desc' },
  });

  if (existing && existing.rawPayload && generateDedupeHashFromEvent(existing) === dedupeHash) {
    logger.debug('Instantly webhook: duplicate event, skipping', { eventType, leadEmail });
    return;
  }

  // Store webhook event for audit
  const webhookEvent = await prisma.webhookEvent.create({
    data: {
      source: WebhookSource.INSTANTLY,
      eventType,
      campaignId: await resolveInternalCampaignId(campaignId),
      contactEmail: leadEmail,
      rawPayload: JSON.parse(JSON.stringify(payload)),
    },
  });

  // Find the campaign contact
  const contact = leadEmail ? await findContactByEmail(leadEmail, campaignId) : null;

  switch (eventType) {
    case 'email_sent':
      await handleEmailSent(contact, webhookEvent.id);
      break;
    case 'reply_received':
      await handleReplyReceived(contact, payload, webhookEvent.id);
      break;
    case 'email_bounced':
      await handleEmailBounced(contact, webhookEvent.id);
      break;
    case 'lead_meeting_booked':
      await handleMeetingBooked(contact, webhookEvent.id);
      break;
    default:
      logger.debug('Instantly webhook: unhandled event type', { eventType });
  }

  // Enqueue HubSpot activity sync if client has an active connection
  if (leadEmail && contact && (eventType === 'email_sent' || eventType === 'reply_received' || eventType === 'lead_meeting_booked')) {
    try {
      const campaign = await prisma.campaign.findUnique({
        where: { id: contact.campaignId },
        select: { clientId: true },
      });
      if (campaign?.clientId) {
        const hsConn = await prisma.hubSpotConnection.findUnique({
          where: { clientId: campaign.clientId },
          select: { status: true },
        });
        if (hsConn?.status === 'ACTIVE') {
          const hsEventType = eventType === 'lead_meeting_booked' ? 'meeting' : 'email';
          await hubspotActivitySyncQueue.add('sync-activity', {
            clientId: campaign.clientId,
            eventType: hsEventType as 'call' | 'email' | 'meeting',
            eventId: webhookEvent.id,
            eventSource: 'instantly',
            payload: {
              contactEmail: leadEmail,
              timestamp: new Date().toISOString(),
              emailSubject: payload.subject as string || undefined,
              emailBodyPreview: payload.body_preview as string || undefined,
              emailDirection: 'OUTBOUND',
              meetingTitle: eventType === 'lead_meeting_booked' ? 'Meeting Booked' : undefined,
            },
          });
        }
      }
    } catch (err) {
      logger.warn('Failed to enqueue HubSpot activity sync from Instantly', { error: err });
    }
  }

  // Mark webhook as processed
  await prisma.webhookEvent.update({
    where: { id: webhookEvent.id },
    data: { processed: true, processedAt: new Date() },
  });
}

/**
 * Handles email_sent: marks step COMPLETED, advances contact.
 */
async function handleEmailSent(
  contact: Awaited<ReturnType<typeof findContactByEmail>>,
  webhookEventId: string,
): Promise<void> {
  if (!contact) {
    logger.warn('Instantly email_sent: contact not found', { webhookEventId });
    return;
  }

  // Find the active WAITING_WEBHOOK execution for this contact
  const execution = await prisma.campaignContactStepExecution.findFirst({
    where: {
      campaignContactId: contact.id,
      status: StepExecutionStatus.WAITING_WEBHOOK,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (execution) {
    await prisma.campaignContactStepExecution.update({
      where: { id: execution.id },
      data: {
        status: StepExecutionStatus.COMPLETED,
        result: 'sent',
        completedAt: new Date(),
      },
    });
  }

  // Track activity
  const bdr = await getAssignedBdr(contact.campaignId);
  if (bdr) {
    await trackActivity(contact.campaignId, bdr, 'emailsSent');
  }

  // Advance to next step
  await advanceContact(contact.id);

  logger.info('Instantly email_sent processed', { contactId: contact.id });
}

/**
 * Handles reply_received: marks contact RESPONDED, stores in UniboxReply.
 */
async function handleReplyReceived(
  contact: Awaited<ReturnType<typeof findContactByEmail>>,
  payload: Record<string, unknown>,
  webhookEventId: string,
): Promise<void> {
  if (!contact) {
    logger.warn('Instantly reply_received: contact not found', { webhookEventId });
    return;
  }

  // Mark contact as RESPONDED
  await prisma.campaignContact.update({
    where: { id: contact.id },
    data: {
      status: ContactCampaignStatus.RESPONDED,
      statusReason: 'Email reply received',
      lastActivityAt: new Date(),
    },
  });

  // Update campaign counters
  await prisma.campaign.update({
    where: { id: contact.campaignId },
    data: {
      activeContacts: { decrement: 1 },
    },
  });

  // Mark current step execution as completed
  const execution = await prisma.campaignContactStepExecution.findFirst({
    where: {
      campaignContactId: contact.id,
      status: { in: [StepExecutionStatus.WAITING_WEBHOOK, StepExecutionStatus.COMPLETED] },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (execution && execution.status === StepExecutionStatus.WAITING_WEBHOOK) {
    await prisma.campaignContactStepExecution.update({
      where: { id: execution.id },
      data: {
        status: StepExecutionStatus.COMPLETED,
        result: 'replied',
        completedAt: new Date(),
      },
    });
  }

  // Store in UniboxReply with GENERATING draft status for smart reply
  const uniboxReply = await prisma.uniboxReply.create({
    data: {
      campaignId: contact.campaignId,
      campaignContactId: contact.id,
      channel: ReplyChannel.EMAIL,
      fromName: (payload.from_name as string) ?? null,
      fromEmail: (payload.from_email as string) ?? (payload.lead_email as string) ?? null,
      subject: (payload.subject as string) ?? null,
      body: (payload.body as string) ?? '',
      rawPayload: JSON.parse(JSON.stringify(payload)),
      externalId: (payload.email_id as string) ?? null,
      receivedAt: new Date(),
      draftStatus: SmartReplyDraftStatus.GENERATING,
    },
  });

  // Enqueue smart reply generation (non-blocking — FR-010)
  try {
    await smartReplyQueue.add('generate-draft', { replyId: uniboxReply.id });
    logger.debug('Smart reply job enqueued', { replyId: uniboxReply.id });
  } catch (err) {
    logger.warn('Failed to enqueue smart reply job', {
      replyId: uniboxReply.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Track activity
  const bdr = await getAssignedBdr(contact.campaignId);
  if (bdr) {
    await trackActivity(contact.campaignId, bdr, 'emailRepliesReceived');
  }

  // Send Slack notifications to assigned BDRs (FR-022, FR-023)
  try {
    await notifyBdrsOfReply(contact, uniboxReply.id, payload);
  } catch (err) {
    logger.warn('Failed to send BDR Slack notifications', {
      contactId: contact.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  logger.info('Instantly reply_received processed', { contactId: contact.id });
}

/**
 * Sends Slack DMs to all BDRs assigned to a campaign when a reply arrives.
 *
 * Includes reply preview (first 200 chars), contact info, personality archetype
 * and communication style (if enriched), plus action buttons.
 */
async function notifyBdrsOfReply(
  contactRef: { id: string; campaignId: string },
  replyId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  // Get all assigned BDRs
  const bdrs = await prisma.campaignBdr.findMany({
    where: { campaignId: contactRef.campaignId },
    select: { slackUserId: true, displayName: true },
  });

  if (bdrs.length === 0) return;

  // Get contact details + campaign name + personality data
  const contactDetail = await prisma.campaignContact.findUnique({
    where: { id: contactRef.id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      companyName: true,
      email: true,
      personalityData: true,
      campaign: { select: { name: true } },
    },
  });

  if (!contactDetail) return;

  const contactName = `${contactDetail.firstName} ${contactDetail.lastName}`.trim();
  const campaignName = contactDetail.campaign?.name ?? 'Unknown Campaign';
  const replyBody = ((payload.body as string) ?? '').slice(0, 200);
  const subject = (payload.subject as string) ?? '';

  // Build personality summary if available
  let personalitySummary = '';
  if (contactDetail.personalityData) {
    const pd = contactDetail.personalityData as Record<string, unknown>;
    const archetype = pd.archetype as Record<string, unknown> | undefined;
    const comm = pd.communication as Record<string, unknown> | undefined;
    if (archetype?.name) {
      personalitySummary += `\n*Archetype:* ${archetype.name}`;
    }
    if (comm?.adjectives && Array.isArray(comm.adjectives)) {
      personalitySummary += `\n*Communication Style:* ${(comm.adjectives as string[]).join(', ')}`;
    }
  }

  const dashboardBaseUrl = config.adminDashboardUrl ?? '';
  const contactProfileUrl = dashboardBaseUrl
    ? `${dashboardBaseUrl}/contacts/${contactDetail.id}`
    : '';

  const client = getSlackClient();

  // Build message blocks
  const blocks: Record<string, unknown>[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*New reply from ${contactName}*${contactDetail.companyName ? ` (${contactDetail.companyName})` : ''}\n*Campaign:* ${campaignName}${subject ? `\n*Subject:* ${subject}` : ''}${personalitySummary}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `> ${replyBody}${replyBody.length >= 200 ? '...' : ''}`,
      },
    },
  ];

  // Action buttons
  const actions: Record<string, unknown>[] = [];
  if (contactProfileUrl) {
    actions.push({
      type: 'button',
      text: { type: 'plain_text', text: 'View Contact Profile' },
      url: contactProfileUrl,
      action_id: 'reply_notify_view_profile',
    });
  }
  if (dashboardBaseUrl) {
    actions.push({
      type: 'button',
      text: { type: 'plain_text', text: 'Open UniBox' },
      url: `${dashboardBaseUrl}/bdr/unibox`,
      action_id: 'reply_notify_open_unibox',
    });
  }

  if (actions.length > 0) {
    blocks.push({ type: 'actions', elements: actions });
  }

  const fallbackText = `New reply from ${contactName} in campaign "${campaignName}": ${replyBody}`;

  // Send DM to each assigned BDR
  await Promise.allSettled(
    bdrs.map(async (bdr) => {
      try {
        await client.chat.postMessage({
          channel: bdr.slackUserId,
          blocks: blocks as any,
          text: fallbackText,
        });
      } catch (err) {
        logger.warn('Failed to DM BDR about reply', {
          bdrSlackUserId: bdr.slackUserId,
          replyId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );

  logger.debug('BDR reply notifications sent', {
    replyId,
    bdrCount: bdrs.length,
    contactId: contactRef.id,
  });
}

/**
 * Handles email_bounced: marks step FAILED, advances to next step.
 */
async function handleEmailBounced(
  contact: Awaited<ReturnType<typeof findContactByEmail>>,
  webhookEventId: string,
): Promise<void> {
  if (!contact) {
    logger.warn('Instantly email_bounced: contact not found', { webhookEventId });
    return;
  }

  const execution = await prisma.campaignContactStepExecution.findFirst({
    where: {
      campaignContactId: contact.id,
      status: StepExecutionStatus.WAITING_WEBHOOK,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (execution) {
    await prisma.campaignContactStepExecution.update({
      where: { id: execution.id },
      data: {
        status: StepExecutionStatus.FAILED,
        result: 'bounced',
        completedAt: new Date(),
      },
    });
  }

  // Mark email as no longer valid
  await prisma.campaignContact.update({
    where: { id: contact.id },
    data: {
      canEmail: false,
      emailVerified: false,
    },
  });

  // Advance to next step despite bounce
  await advanceContact(contact.id);

  logger.info('Instantly email_bounced processed', { contactId: contact.id });
}

/**
 * Handles lead_meeting_booked: updates contact status reason.
 */
async function handleMeetingBooked(
  contact: Awaited<ReturnType<typeof findContactByEmail>>,
  webhookEventId: string,
): Promise<void> {
  if (!contact) {
    logger.warn('Instantly meeting_booked: contact not found', { webhookEventId });
    return;
  }

  await prisma.campaignContact.update({
    where: { id: contact.id },
    data: {
      statusReason: 'Meeting booked',
      lastActivityAt: new Date(),
    },
  });

  logger.info('Instantly meeting_booked processed', { contactId: contact.id });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Finds a CampaignContact by email, scoped to a specific Instantly campaign.
 */
async function findContactByEmail(
  email: string,
  instantlyCampaignId?: string,
): Promise<{ id: string; campaignId: string } | null> {
  const where: Record<string, unknown> = {
    email: email.toLowerCase(),
    status: { in: [ContactCampaignStatus.ACTIVE, ContactCampaignStatus.RESPONDED] },
  };

  // If we have the Instantly campaign ID, narrow down to the matching campaign
  if (instantlyCampaignId) {
    const campaign = await prisma.campaign.findFirst({
      where: { instantlyCampaignId },
      select: { id: true },
    });
    if (campaign) {
      where.campaignId = campaign.id;
    }
  }

  return prisma.campaignContact.findFirst({
    where,
    select: { id: true, campaignId: true },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Resolves an Instantly campaign ID to our internal campaign UUID.
 */
async function resolveInternalCampaignId(instantlyCampaignId?: string): Promise<string | null> {
  if (!instantlyCampaignId) return null;
  const campaign = await prisma.campaign.findFirst({
    where: { instantlyCampaignId },
    select: { id: true },
  });
  return campaign?.id ?? null;
}

/**
 * Generates a deduplication hash for a webhook event.
 */
function generateDedupeHash(source: string, eventType: string, contactId?: string, timestamp?: string): string {
  return crypto
    .createHash('sha256')
    .update(`${source}:${eventType}:${contactId ?? ''}:${timestamp ?? ''}`)
    .digest('hex');
}

/**
 * Generates a dedupe hash from a stored webhook event.
 */
function generateDedupeHashFromEvent(event: { source: string; eventType: string; contactEmail: string | null; rawPayload: unknown }): string {
  const payload = event.rawPayload as Record<string, unknown>;
  return generateDedupeHash(event.source, event.eventType, event.contactEmail ?? undefined, payload?.timestamp as string);
}

export { router as instantlyWebhookRouter };
