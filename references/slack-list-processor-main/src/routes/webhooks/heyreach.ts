/**
 * HeyReach webhook handler.
 *
 * Receives webhook events from HeyReach LinkedIn campaigns and processes
 * them to advance contacts through the campaign sequence.
 *
 * Events handled:
 * - CONNECTION_REQUEST_SENT / MESSAGE_SENT: Mark step COMPLETED, advance
 * - MESSAGE_REPLY_RECEIVED: Mark contact RESPONDED, store in UniboxReply
 * - CONNECTION_REQUEST_ACCEPTED: Update contact metadata
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  StepExecutionStatus,
  ContactCampaignStatus,
  WebhookSource,
  ReplyChannel,
} from '@prisma/client';
import { prisma } from '../../models/index.js';
import { config } from '../../config/index.js';
import { advanceContact } from '../../services/campaign/sequenceEngine.js';
import { trackActivity, getAssignedBdr } from '../../services/campaign/activityTracker.js';
import { hubspotActivitySyncQueue } from '../../services/queue/queues.js';
import logger from '../../lib/logger.js';

const router = Router();

/**
 * POST /api/webhooks/heyreach
 *
 * 1. Validates webhook secret
 * 2. Responds 200 immediately
 * 3. Processes event asynchronously
 */
router.post('/', (req: Request, res: Response) => {
  const secret = req.headers['x-heyreach-webhook-secret'] as string | undefined;

  if (secret !== config.heyreach.webhookSecret) {
    logger.warn('HeyReach webhook: invalid secret');
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  res.status(200).json({ received: true });

  const payload = req.body;
  processHeyReachWebhook(payload).catch((err) => {
    logger.error('Failed to process HeyReach webhook', {
      eventType: payload?.event_type,
      error: err instanceof Error ? err.message : String(err),
    });
  });
});

/**
 * Processes a HeyReach webhook event.
 */
async function processHeyReachWebhook(payload: Record<string, unknown>): Promise<void> {
  const eventType = payload.event_type as string;
  const linkedinUrl = payload.linkedin_url as string | undefined;
  const campaignId = payload.campaign_id as number | undefined;

  if (!eventType) {
    logger.warn('HeyReach webhook: missing event_type');
    return;
  }

  // Store webhook event for audit
  const webhookEvent = await prisma.webhookEvent.create({
    data: {
      source: WebhookSource.HEYREACH,
      eventType,
      campaignId: await resolveInternalCampaignId(campaignId),
      contactLinkedinUrl: linkedinUrl,
      rawPayload: JSON.parse(JSON.stringify(payload)),
    },
  });

  // Find the campaign contact by LinkedIn URL
  const contact = linkedinUrl ? await findContactByLinkedIn(linkedinUrl, campaignId) : null;

  switch (eventType) {
    case 'CONNECTION_REQUEST_SENT':
    case 'MESSAGE_SENT':
      await handleLinkedInActionSent(contact, webhookEvent.id);
      break;
    case 'MESSAGE_REPLY_RECEIVED':
      await handleLinkedInReply(contact, payload, webhookEvent.id);
      break;
    case 'CONNECTION_REQUEST_ACCEPTED':
      await handleConnectionAccepted(contact, webhookEvent.id);
      break;
    default:
      logger.debug('HeyReach webhook: unhandled event type', { eventType });
  }

  // Enqueue HubSpot activity sync if client has an active connection
  if (contact && (eventType === 'MESSAGE_SENT' || eventType === 'MESSAGE_REPLY_RECEIVED')) {
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
          // Look up the contact's email from the campaign contact
          const contactRecord = await prisma.campaignContact.findUnique({
            where: { id: contact.id },
            select: { email: true },
          });
          if (contactRecord?.email) {
            await hubspotActivitySyncQueue.add('sync-activity', {
              clientId: campaign.clientId,
              eventType: 'email',
              eventId: webhookEvent.id,
              eventSource: 'heyreach',
              payload: {
                contactEmail: contactRecord.email,
                timestamp: new Date().toISOString(),
                emailSubject: `LinkedIn ${eventType === 'MESSAGE_SENT' ? 'Message' : 'Reply'}`,
                emailBodyPreview: (payload.message_body as string)?.slice(0, 200) || undefined,
                emailDirection: eventType === 'MESSAGE_SENT' ? 'OUTBOUND' : 'INBOUND',
              },
            });
          }
        }
      }
    } catch (err) {
      logger.warn('Failed to enqueue HubSpot activity sync from HeyReach', { error: err });
    }
  }

  // Mark webhook as processed
  await prisma.webhookEvent.update({
    where: { id: webhookEvent.id },
    data: { processed: true, processedAt: new Date() },
  });
}

/**
 * Handles CONNECTION_REQUEST_SENT / MESSAGE_SENT:
 * marks step COMPLETED, advances contact.
 */
async function handleLinkedInActionSent(
  contact: Awaited<ReturnType<typeof findContactByLinkedIn>>,
  webhookEventId: string,
): Promise<void> {
  if (!contact) {
    logger.warn('HeyReach action sent: contact not found', { webhookEventId });
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
    await trackActivity(contact.campaignId, bdr, 'linkedinActionsSent');
  }

  // Advance to next step
  await advanceContact(contact.id);

  logger.info('HeyReach action sent processed', { contactId: contact.id });
}

/**
 * Handles MESSAGE_REPLY_RECEIVED: marks contact RESPONDED,
 * stores in UniboxReply.
 */
async function handleLinkedInReply(
  contact: Awaited<ReturnType<typeof findContactByLinkedIn>>,
  payload: Record<string, unknown>,
  webhookEventId: string,
): Promise<void> {
  if (!contact) {
    logger.warn('HeyReach reply received: contact not found', { webhookEventId });
    return;
  }

  // Mark contact as RESPONDED
  await prisma.campaignContact.update({
    where: { id: contact.id },
    data: {
      status: ContactCampaignStatus.RESPONDED,
      statusReason: 'LinkedIn reply received',
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

  // Store in UniboxReply
  await prisma.uniboxReply.create({
    data: {
      campaignId: contact.campaignId,
      campaignContactId: contact.id,
      channel: ReplyChannel.LINKEDIN,
      fromName: [payload.first_name, payload.last_name].filter(Boolean).join(' ') || null,
      fromLinkedinUrl: (payload.linkedin_url as string) ?? null,
      body: (payload.message_body as string) ?? '',
      rawPayload: JSON.parse(JSON.stringify(payload)),
      receivedAt: new Date(),
    },
  });

  // Track activity
  const bdr = await getAssignedBdr(contact.campaignId);
  if (bdr) {
    await trackActivity(contact.campaignId, bdr, 'linkedinRepliesReceived');
  }

  logger.info('HeyReach reply received processed', { contactId: contact.id });
}

/**
 * Handles CONNECTION_REQUEST_ACCEPTED: updates contact metadata.
 */
async function handleConnectionAccepted(
  contact: Awaited<ReturnType<typeof findContactByLinkedIn>>,
  webhookEventId: string,
): Promise<void> {
  if (!contact) {
    logger.warn('HeyReach connection accepted: contact not found', { webhookEventId });
    return;
  }

  await prisma.campaignContact.update({
    where: { id: contact.id },
    data: {
      lastActivityAt: new Date(),
    },
  });

  logger.info('HeyReach connection accepted processed', { contactId: contact.id });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Finds a CampaignContact by LinkedIn URL, scoped to a HeyReach campaign.
 */
async function findContactByLinkedIn(
  linkedinUrl: string,
  heyreachCampaignId?: number,
): Promise<{ id: string; campaignId: string } | null> {
  const normalizedUrl = linkedinUrl.toLowerCase().replace(/\/$/, '');

  const where: Record<string, unknown> = {
    linkedinUrl: { contains: normalizedUrl.split('/in/')[1] ?? normalizedUrl, mode: 'insensitive' },
    status: { in: [ContactCampaignStatus.ACTIVE, ContactCampaignStatus.RESPONDED] },
  };

  // If we have the HeyReach campaign ID, narrow down
  if (heyreachCampaignId) {
    const campaign = await prisma.campaign.findFirst({
      where: { heyreachCampaignId: String(heyreachCampaignId) },
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
 * Resolves a HeyReach campaign ID to our internal campaign UUID.
 */
async function resolveInternalCampaignId(heyreachCampaignId?: number): Promise<string | null> {
  if (!heyreachCampaignId) return null;
  const campaign = await prisma.campaign.findFirst({
    where: { heyreachCampaignId: String(heyreachCampaignId) },
    select: { id: true },
  });
  return campaign?.id ?? null;
}

export { router as heyreachWebhookRouter };
