/**
 * HubSpot webhook processing service.
 *
 * Validates webhook signatures and processes deal stage change events
 * for contacts that were imported/enriched by our platform. Posts
 * notifications to the client's Slack channel.
 *
 * Webhook subscriptions are app-level (configured once in the HubSpot
 * Developer App) — NOT per-client. Events are routed by portalId.
 */

import crypto from 'crypto';
import { WebClient } from '@slack/web-api';
import { prisma } from '../../models/index.js';
import { config } from '../../config/index.js';
import { getAccessToken } from './hubspotOAuth.js';
import { logAudit } from '../../lib/auditLogger.js';
import logger from '../../lib/logger.js';

const slackClient = new WebClient(config.slack.botToken);

/** Shape of a HubSpot webhook event in an inbound batch. */
export interface HubSpotWebhookEvent {
  eventId: number;
  subscriptionId: number;
  portalId: number;
  appId: number;
  occurredAt: number;
  subscriptionType: string;
  objectId: number;
  propertyName?: string;
  propertyValue?: string;
  changeSource?: string;
  sourceId?: string;
}

/**
 * Validates HubSpot webhook signature (v1).
 *
 * HubSpot Developer App webhooks use SHA-256 hash of
 * (client_secret + raw request body). The result is compared
 * against the X-HubSpot-Signature header value.
 */
export function validateSignature(
  requestBody: string,
  signatureHeader: string,
): boolean {
  const clientSecret = config.hubspotOAuth.clientSecret;
  if (!clientSecret) {
    logger.warn('HubSpot webhook: no OAuth client secret configured for signature validation');
    return false;
  }

  const hash = crypto
    .createHash('sha256')
    .update(clientSecret + requestBody)
    .digest('hex');

  return hash === signatureHeader;
}

/**
 * Processes a batch of HubSpot webhook events.
 *
 * For each deal.propertyChange event where propertyName = "dealstage":
 * 1. Look up HubSpotConnection by portalId
 * 2. Fetch deal details from HubSpot API
 * 3. Check if associated contact exists in HubSpotContactMapping
 * 4. Resolve client's Slack channel via ChannelClientMapping
 * 5. Post notification to Slack
 * 6. Log in HubSpotSyncLog
 */
export async function processEvents(events: HubSpotWebhookEvent[]): Promise<void> {
  for (const event of events) {
    try {
      await processSingleEvent(event);
    } catch (err) {
      logger.error('HubSpot webhook: failed to process event', {
        eventId: event.eventId,
        portalId: event.portalId,
        objectId: event.objectId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Processes a single deal stage change event.
 */
async function processSingleEvent(event: HubSpotWebhookEvent): Promise<void> {
  // Only process deal stage changes.
  if (
    event.subscriptionType !== 'deal.propertyChange' ||
    event.propertyName !== 'dealstage'
  ) {
    return;
  }

  const portalId = String(event.portalId);

  // 1. Look up active connection by portalId.
  const connection = await prisma.hubSpotConnection.findFirst({
    where: {
      hubspotPortalId: portalId,
      status: 'ACTIVE',
    },
    include: {
      client: {
        include: {
          channelMappings: {
            select: { slackChannelId: true, slackTeamId: true },
            take: 1,
          },
        },
      },
    },
  });

  if (!connection) {
    logger.debug('HubSpot webhook: no active connection for portal', { portalId });
    return;
  }

  // 2. Get access token for this client.
  const accessToken = await getAccessToken(connection.clientId);
  if (!accessToken) {
    logger.warn('HubSpot webhook: could not get access token', {
      clientId: connection.clientId,
    });
    return;
  }

  // 3. Fetch deal details from HubSpot API.
  const deal = await fetchDealDetails(String(event.objectId), accessToken);
  if (!deal) {
    return;
  }

  // 4. Check if any associated contact was imported/enriched by us.
  let matchedContact: { email: string; hubspotContactId: string } | null = null;
  for (const contactId of deal.associatedContactIds) {
    const mapping = await prisma.hubSpotContactMapping.findFirst({
      where: {
        connectionId: connection.id,
        hubspotContactId: contactId,
      },
    });
    if (mapping) {
      matchedContact = { email: mapping.email, hubspotContactId: contactId };
      break;
    }
  }

  if (!matchedContact) {
    logger.debug('HubSpot webhook: deal contacts not in our mappings', {
      dealId: event.objectId,
      contactCount: deal.associatedContactIds.length,
    });
    return;
  }

  // 5. Find Slack channel for this client.
  const channelMapping = connection.client.channelMappings[0];
  if (!channelMapping) {
    logger.warn('HubSpot webhook: no channel mapping for client', {
      clientId: connection.clientId,
    });
    return;
  }

  // 6. Post notification to Slack.
  const stageLabel = deal.dealStage || event.propertyValue || 'Unknown';
  const isClosedWon = stageLabel.toLowerCase().includes('closedwon') ||
    stageLabel.toLowerCase().includes('closed won');
  const emoji = isClosedWon ? ':tada:' : ':handshake:';

  const amountText = deal.amount
    ? `*Amount:* $${Number(deal.amount).toLocaleString()}\n`
    : '';

  const hubspotLink = `https://app.hubspot.com/contacts/${portalId}/deal/${event.objectId}`;
  const occurredDate = new Date(event.occurredAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  try {
    await slackClient.chat.postMessage({
      channel: channelMapping.slackChannelId,
      text: `${emoji} Deal Update — ${deal.dealName || 'Untitled Deal'} moved to ${stageLabel}`,
      blocks: [
        {
          type: 'section' as const,
          text: {
            type: 'mrkdwn' as const,
            text: [
              `${emoji} *Deal Update* — ${stageLabel}`,
              '',
              `*Deal:* ${deal.dealName || 'Untitled Deal'}`,
              amountText ? amountText.trim() : null,
              `*Contact:* ${matchedContact.email}`,
              `*Stage:* ${stageLabel}`,
              '',
              `<${hubspotLink}|View deal in HubSpot>`,
            ]
              .filter((line) => line !== null)
              .join('\n'),
          },
        },
        {
          type: 'context' as const,
          elements: [
            {
              type: 'mrkdwn' as const,
              text: `Via HubSpot webhook \u2022 ${occurredDate}`,
            },
          ],
        },
      ],
    });
  } catch (slackErr) {
    logger.error('HubSpot webhook: failed to post Slack notification', {
      channel: channelMapping.slackChannelId,
      error: slackErr instanceof Error ? slackErr.message : String(slackErr),
    });
  }

  // 7. Log in HubSpotSyncLog.
  await prisma.hubSpotSyncLog.create({
    data: {
      connectionId: connection.id,
      syncType: 'WEBHOOK_EVENT',
      direction: 'inbound',
      recordsProcessed: 1,
      metadata: {
        eventId: event.eventId,
        dealId: event.objectId,
        dealStage: stageLabel,
        contactEmail: matchedContact.email,
      },
    },
  });

  logger.info('HubSpot webhook: deal stage notification posted', {
    clientId: connection.clientId,
    dealId: event.objectId,
    stage: stageLabel,
    contact: matchedContact.email,
  });

  logAudit({
    action: 'hubspot_webhook_received',
    actorUserId: 'system',
    targetType: 'HubSpotConnection',
    targetId: connection.id,
    channelId: channelMapping.slackChannelId,
    metadata: { dealId: event.objectId, stage: stageLabel, contactEmail: matchedContact.email },
  }).catch(() => {});
}

/**
 * Fetches deal details from HubSpot CRM API.
 *
 * Includes deal name, amount, stage, and associated contact IDs.
 */
async function fetchDealDetails(
  dealId: string,
  accessToken: string,
): Promise<{
  dealName: string;
  amount: string | null;
  dealStage: string;
  associatedContactIds: string[];
} | null> {
  try {
    const response = await fetch(
      `https://api.hubapi.com/crm/v3/objects/deals/${dealId}?properties=dealname,amount,dealstage&associations=contacts`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (!response.ok) {
      logger.warn('HubSpot webhook: deal fetch failed', {
        dealId,
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
      dealName: data.properties.dealname ?? '',
      amount: data.properties.amount ?? null,
      dealStage: data.properties.dealstage ?? '',
      associatedContactIds:
        data.associations?.contacts?.results?.map((r) => r.id) ?? [],
    };
  } catch (err) {
    logger.error('HubSpot webhook: failed to fetch deal details', {
      dealId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Checks if the app-level deal.propertyChange webhook subscription
 * is registered and active in the HubSpot Developer App.
 *
 * Returns a diagnostic object for the /hubspot status display.
 */
export async function getWebhookStatus(): Promise<{
  configured: boolean;
  active: boolean;
  subscriptionId?: number;
  error?: string;
}> {
  const { clientId, clientSecret } = config.hubspotOAuth;

  if (!clientId || !clientSecret) {
    return { configured: false, active: false, error: 'OAuth credentials not configured' };
  }

  try {
    // HubSpot Developer App ID is derived from the OAuth client ID.
    // The Webhooks API uses the appId which we can get from any
    // existing connection's appId field, or we use the hapikey approach.
    // For Developer Apps, we use developer API key authentication.
    // Since we don't store the developer API key separately, we'll
    // use the OAuth token approach: GET /webhooks/v3/{appId}/subscriptions
    // requires hapikey or developer API key auth.
    //
    // Alternative: query our own DB for recent webhook events as a proxy.
    const recentEvent = await prisma.hubSpotSyncLog.findFirst({
      where: { syncType: 'WEBHOOK_EVENT' },
      orderBy: { createdAt: 'desc' },
    });

    if (recentEvent) {
      return {
        configured: true,
        active: true,
      };
    }

    // No recent events — webhooks may or may not be configured.
    // We can't definitively check without the developer API key.
    return {
      configured: true,
      active: false,
      error: 'No webhook events received yet',
    };
  } catch (err) {
    return {
      configured: false,
      active: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
