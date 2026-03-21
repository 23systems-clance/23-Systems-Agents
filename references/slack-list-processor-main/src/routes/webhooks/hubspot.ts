/**
 * HubSpot webhook handlers.
 *
 * Two endpoint families:
 *
 * 1. POST /calls — Call engagement events (Private App webhooks, v3 signature).
 *    Receives call completion callbacks from HubSpot and auto-completes
 *    pending phone step executions for matching contacts.
 *
 * 2. POST / — Developer App webhooks (v1 signature).
 *    Receives deal.propertyChange events for deal stage changes and posts
 *    Slack notifications when the deal involves an enriched/imported contact.
 *
 * All clients share the same webhook URLs. Events are routed to the
 * correct client by matching portalId in the event payload.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import crypto from 'crypto';
import {
  StepExecutionStatus,
  StepType,
  ContactCampaignStatus,
  WebhookSource,
} from '@prisma/client';
import { prisma } from '../../models/index.js';
import { config } from '../../config/index.js';
import { getDecryptedKey } from '../../lib/clientApiService.js';
import { advanceContact } from '../../services/campaign/sequenceEngine.js';
import { trackActivity, getAssignedBdr } from '../../services/campaign/activityTracker.js';
import {
  validateSignature,
  processEvents,
  type HubSpotWebhookEvent,
} from '../../services/hubspot/hubspotWebhook.js';
import logger from '../../lib/logger.js';

const router = Router();

/**
 * POST /api/webhooks/hubspot
 *
 * Developer App webhooks for deal.propertyChange events.
 * Uses v1 signature validation (SHA-256 of client_secret + body).
 * Responds 200 immediately and processes events asynchronously.
 */
router.post('/', (req: Request, res: Response) => {
  const rawBody = JSON.stringify(req.body);
  const signatureHeader = req.headers['x-hubspot-signature'] as string | undefined;

  // Validate signature if OAuth client secret is configured.
  if (config.hubspotOAuth.clientSecret) {
    if (!signatureHeader) {
      logger.warn('HubSpot deal webhook: missing X-HubSpot-Signature header');
      res.status(401).json({ error: 'Missing signature' });
      return;
    }

    if (!validateSignature(rawBody, signatureHeader)) {
      logger.warn('HubSpot deal webhook: invalid signature');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }
  }

  // Respond 200 immediately (HubSpot requires response within 5 seconds).
  res.status(200).json({ received: true });

  // Process events asynchronously.
  const events: HubSpotWebhookEvent[] = Array.isArray(req.body) ? req.body : [req.body];
  processEvents(events).catch((err) => {
    logger.error('Failed to process HubSpot deal webhook events', {
      error: err instanceof Error ? err.message : String(err),
    });
  });
});

/**
 * POST /api/webhooks/hubspot/calls
 *
 * HubSpot sends an array of webhook events.
 * We respond 200 immediately and process asynchronously.
 */
router.post('/calls', (req: Request, res: Response) => {
  // Validate HubSpot signature if client secret is configured
  if (config.hubspot.clientSecret) {
    const signature = req.headers['x-hubspot-signature-v3'] as string | undefined;
    const timestamp = req.headers['x-hubspot-request-timestamp'] as string | undefined;

    if (!signature || !timestamp) {
      logger.warn('HubSpot webhook: missing signature headers');
      res.status(401).json({ error: 'Missing signature' });
      return;
    }

    // Reject if timestamp is more than 5 minutes old
    const timestampMs = Number(timestamp);
    if (Date.now() - timestampMs > 300_000) {
      logger.warn('HubSpot webhook: timestamp too old');
      res.status(401).json({ error: 'Timestamp expired' });
      return;
    }

    // v3 signature: HMAC-SHA256 of (requestMethod + requestUri + requestBody + timestamp)
    const requestUri = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const sourceString = `${req.method}${requestUri}${JSON.stringify(req.body)}${timestamp}`;
    const expectedSignature = crypto
      .createHmac('sha256', config.hubspot.clientSecret)
      .update(sourceString)
      .digest('base64');

    if (signature !== expectedSignature) {
      logger.warn('HubSpot webhook: invalid signature');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }
  }

  res.status(200).json({ received: true });

  // HubSpot sends an array of events
  const events = Array.isArray(req.body) ? req.body : [req.body];

  for (const event of events) {
    processHubSpotCallEvent(event).catch((err) => {
      logger.error('Failed to process HubSpot call event', {
        objectId: event?.objectId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
});

/**
 * Processes a single HubSpot call event.
 *
 * Looks up the client by portalId, uses their API key to fetch call details,
 * then auto-completes matching pending phone step executions.
 */
async function processHubSpotCallEvent(event: Record<string, unknown>): Promise<void> {
  const objectId = String(event.objectId ?? '');
  const portalId = String(event.portalId ?? '');

  if (!objectId) {
    logger.warn('HubSpot call webhook: missing objectId');
    return;
  }

  logger.info('Processing HubSpot call event', {
    objectId,
    subscriptionType: event.subscriptionType,
    portalId,
  });

  // Look up the client by HubSpot portal ID
  const client = portalId
    ? await prisma.managedClient.findFirst({
        where: { hubspotPortalId: portalId, isActive: true },
        select: { id: true, name: true },
      })
    : null;

  // Get the HubSpot API key: per-client first, fall back to global
  let apiKey: string | null = null;
  if (client) {
    apiKey = await getDecryptedKey(client.id, 'hubspot');
  }
  if (!apiKey && config.hubspot.apiKey) {
    apiKey = config.hubspot.apiKey;
  }

  if (!apiKey) {
    logger.warn('HubSpot call webhook: no API key available', {
      portalId,
      clientId: client?.id,
    });
    return;
  }

  // Fetch call engagement details from HubSpot
  const callDetails = await fetchCallEngagement(objectId, apiKey);
  if (!callDetails) {
    logger.warn('HubSpot call webhook: could not fetch call engagement', { objectId });
    return;
  }

  const contactIds = callDetails.associatedContactIds;
  if (!contactIds.length) {
    logger.warn('HubSpot call webhook: no associated contacts', { objectId });
    return;
  }

  // Store webhook event for audit
  await prisma.webhookEvent.create({
    data: {
      source: WebhookSource.HUBSPOT,
      eventType: 'call.completion',
      rawPayload: JSON.parse(JSON.stringify({
        event,
        callDetails: {
          disposition: callDetails.disposition,
          durationMs: callDetails.durationMs,
          status: callDetails.status,
          associatedContactIds: contactIds,
        },
        clientId: client?.id,
      })),
    },
  });

  // Find matching campaign contacts by hubspotContactId
  for (const hsContactId of contactIds) {
    const contact = await prisma.campaignContact.findFirst({
      where: {
        hubspotContactId: String(hsContactId),
        status: ContactCampaignStatus.ACTIVE,
      },
      select: { id: true, campaignId: true },
    });

    if (!contact) {
      logger.debug('HubSpot call webhook: no matching campaign contact', {
        hubspotContactId: hsContactId,
      });
      continue;
    }

    // Find pending phone execution
    const execution = await prisma.campaignContactStepExecution.findFirst({
      where: {
        campaignContactId: contact.id,
        status: StepExecutionStatus.PENDING,
        stepType: StepType.PHONE,
      },
    });

    if (!execution) {
      logger.debug('HubSpot call webhook: no pending phone step', {
        contactId: contact.id,
      });
      continue;
    }

    // Map HubSpot disposition to our outcome
    const result = mapDisposition(callDetails.disposition);

    // Complete the step execution
    await prisma.campaignContactStepExecution.update({
      where: { id: execution.id },
      data: {
        status: StepExecutionStatus.COMPLETED,
        result,
        completedAt: new Date(),
      },
    });

    // Track activity
    const bdr = await getAssignedBdr(contact.campaignId);
    if (bdr) {
      await trackActivity(contact.campaignId, bdr, 'callsCompleted');
    }

    // Advance contact to next step
    await advanceContact(contact.id);

    logger.info('HubSpot call auto-completed', {
      contactId: contact.id,
      campaignId: contact.campaignId,
      clientId: client?.id,
      disposition: callDetails.disposition,
      result,
    });
  }
}

/**
 * Fetches call engagement details from HubSpot CRM API
 * using the provided (per-client) API key.
 */
async function fetchCallEngagement(
  engagementId: string,
  apiKey: string,
): Promise<{
  disposition: string;
  durationMs: number;
  status: string;
  associatedContactIds: string[];
} | null> {
  try {
    const response = await fetch(
      `https://api.hubapi.com/crm/v3/objects/calls/${engagementId}?properties=hs_call_disposition,hs_call_duration,hs_call_status&associations=contacts`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (!response.ok) {
      logger.warn('HubSpot call fetch failed', {
        engagementId,
        status: response.status,
      });
      return null;
    }

    const data = (await response.json()) as {
      properties: Record<string, string>;
      associations?: {
        contacts?: {
          results: Array<{ id: string }>;
        };
      };
    };

    return {
      disposition: data.properties.hs_call_disposition ?? '',
      durationMs: Number(data.properties.hs_call_duration ?? 0),
      status: data.properties.hs_call_status ?? '',
      associatedContactIds:
        data.associations?.contacts?.results?.map((r) => r.id) ?? [],
    };
  } catch (err) {
    logger.error('Failed to fetch HubSpot call engagement', {
      engagementId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Maps HubSpot call disposition GUID to a human-readable outcome.
 *
 * These are HubSpot's default disposition GUIDs. Custom dispositions
 * will pass through as-is.
 */
function mapDisposition(disposition: string): string {
  const map: Record<string, string> = {
    'f240bbac-87c9-4f6e-bf70-924b57d47db7': 'Connected',
    '9d9162e7-6cf3-4944-bf63-4dff82258764': 'Left Voicemail',
    '73a0d17f-1163-4015-bdd5-ec830791da20': 'No Answer',
    'a4c4c377-d246-4b32-a13b-75a56a4cd0ff': 'Wrong Number',
    'b2cf5968-551e-4856-9783-52b3da59a7d0': 'Not Interested',
    '2b77097c-4e79-4cef-8dcb-6f2b2f8d8f7a': 'Meeting Booked',
  };

  return map[disposition] ?? (disposition || 'Completed');
}

export { router as hubspotWebhookRouter };
