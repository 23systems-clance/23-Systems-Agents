/**
 * HubSpot activity service.
 *
 * Handles querying HubSpot for engagement activity (calls, emails, meetings)
 * for individual contacts or across all synced contacts. Also handles pushing
 * activity events to HubSpot and retrying failed syncs.
 */

import { Client as HubSpotClient } from '@hubspot/api-client';
import { prisma } from '../../models/index.js';
import { getAccessToken } from './hubspotOAuth.js';
import { hubspotActivitySyncQueue } from '../queue/queues.js';
import { logAudit } from '../../lib/auditLogger.js';
import logger from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single activity engagement from HubSpot. */
export interface HubSpotActivity {
  type: 'call' | 'email' | 'meeting';
  timestamp: Date;
  subject?: string;
  outcome?: string;
  duration?: number;
  notes?: string;
  contactEmail?: string;
}

/** Summary of activity across multiple contacts. */
export interface HubSpotActivitySummary {
  dateRange: { start: Date; end: Date };
  totalEngagements: number;
  calls: number;
  emails: number;
  meetings: number;
  uniqueContacts: number;
  topContacts: { email: string; count: number }[];
  recentNotes: { email: string; date: Date; note: string }[];
}

// ---------------------------------------------------------------------------
// Engagement type mapping
// ---------------------------------------------------------------------------

const ENGAGEMENT_TYPE_MAP: Record<string, HubSpotActivity['type']> = {
  CALL: 'call',
  EMAIL: 'email',
  MEETING: 'meeting',
  INCOMING_EMAIL: 'email',
};

// ---------------------------------------------------------------------------
// Activity Pull
// ---------------------------------------------------------------------------

/**
 * Queries HubSpot for engagement activity for a specific contact within a date range.
 *
 * @param params - Query parameters including clientId, email, and date range
 * @returns Array of HubSpotActivity objects
 */
export async function getContactActivity(params: {
  clientId: string;
  email: string;
  startDate: Date;
  endDate: Date;
}): Promise<HubSpotActivity[]> {
  const { clientId, email, startDate, endDate } = params;

  // Look up contact mapping
  const connection = await prisma.hubSpotConnection.findUnique({
    where: { clientId },
  });
  if (!connection) return [];

  const contactMapping = await prisma.hubSpotContactMapping.findFirst({
    where: { connectionId: connection.id, email },
  });

  if (!contactMapping) return [];

  const accessToken = await getAccessToken(clientId);
  const hubspotClient = new HubSpotClient({ accessToken });

  const activities: HubSpotActivity[] = [];
  let after: string | undefined;

  // Paginate through engagement search results
  do {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (hubspotClient as any).apiRequest({
      method: 'POST',
      path: '/crm/v3/objects/engagements/search',
      body: {
        filterGroups: [
          {
            filters: [
              {
                propertyName: 'hs_timestamp',
                operator: 'BETWEEN',
                value: startDate.toISOString(),
                highValue: endDate.toISOString(),
              },
              {
                propertyName: 'associations.contact',
                operator: 'EQ',
                value: contactMapping.hubspotContactId,
              },
            ],
          },
        ],
        properties: [
          'hs_engagement_type',
          'hs_timestamp',
          'hs_call_body',
          'hs_call_duration',
          'hs_call_disposition',
          'hs_email_subject',
          'hs_email_text',
          'hs_meeting_title',
          'hs_meeting_start_time',
          'hs_meeting_end_time',
        ],
        limit: 100,
        ...(after ? { after } : {}),
      },
    });

    const data = await response.json();

    for (const result of data.results || []) {
      const props = result.properties || {};
      const engagementType = ENGAGEMENT_TYPE_MAP[props.hs_engagement_type] || null;
      if (!engagementType) continue;

      activities.push({
        type: engagementType,
        timestamp: new Date(props.hs_timestamp),
        subject: props.hs_email_subject || props.hs_meeting_title || undefined,
        outcome: props.hs_call_disposition || undefined,
        duration: props.hs_call_duration ? Math.round(Number(props.hs_call_duration) / 1000) : undefined,
        notes: props.hs_call_body || props.hs_email_text || undefined,
        contactEmail: email,
      });
    }

    after = data.paging?.next?.after;
  } while (after);

  return activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

/**
 * Gets an activity summary across all synced contacts within a date range.
 *
 * Uses HubSpot's Search API to fetch engagements in batch, then filters
 * client-side to include only contacts in HubSpotContactMapping.
 *
 * @param params - Query parameters including clientId and date range
 * @returns Activity summary with counts, top contacts, and recent notes
 */
export async function getActivitySummary(params: {
  clientId: string;
  startDate: Date;
  endDate: Date;
}): Promise<HubSpotActivitySummary> {
  const { clientId, startDate, endDate } = params;

  const connection = await prisma.hubSpotConnection.findUnique({
    where: { clientId },
  });

  const summary: HubSpotActivitySummary = {
    dateRange: { start: startDate, end: endDate },
    totalEngagements: 0,
    calls: 0,
    emails: 0,
    meetings: 0,
    uniqueContacts: 0,
    topContacts: [],
    recentNotes: [],
  };

  if (!connection) return summary;

  // Load all contact mappings for this client
  const contactMappings = await prisma.hubSpotContactMapping.findMany({
    where: { connectionId: connection.id },
  });

  if (contactMappings.length === 0) return summary;

  // Build lookup: hubspotContactId → email
  const contactIdToEmail = new Map<string, string>();
  for (const mapping of contactMappings) {
    contactIdToEmail.set(mapping.hubspotContactId, mapping.email);
  }

  const accessToken = await getAccessToken(clientId);
  const hubspotClient = new HubSpotClient({ accessToken });

  // Fetch engagements in the date range
  const contactCounts = new Map<string, number>();
  const notes: { email: string; date: Date; note: string }[] = [];
  let after: string | undefined;

  do {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (hubspotClient as any).apiRequest({
      method: 'POST',
      path: '/crm/v3/objects/engagements/search',
      body: {
        filterGroups: [
          {
            filters: [
              {
                propertyName: 'hs_timestamp',
                operator: 'BETWEEN',
                value: startDate.toISOString(),
                highValue: endDate.toISOString(),
              },
            ],
          },
        ],
        properties: [
          'hs_engagement_type',
          'hs_timestamp',
          'hs_call_body',
          'hs_call_disposition',
          'hs_email_subject',
          'hs_meeting_title',
        ],
        limit: 100,
        ...(after ? { after } : {}),
      },
    });

    const data = await response.json();

    for (const result of data.results || []) {
      const props = result.properties || {};
      const engagementType = ENGAGEMENT_TYPE_MAP[props.hs_engagement_type];
      if (!engagementType) continue;

      // Check associations for known contacts
      const associations = result.associations?.contacts?.results || [];
      let matchedEmail: string | null = null;

      for (const assoc of associations) {
        const email = contactIdToEmail.get(String(assoc.id));
        if (email) {
          matchedEmail = email;
          break;
        }
      }

      // Only count engagements for our mapped contacts
      if (!matchedEmail) continue;

      summary.totalEngagements++;
      if (engagementType === 'call') summary.calls++;
      else if (engagementType === 'email') summary.emails++;
      else if (engagementType === 'meeting') summary.meetings++;

      contactCounts.set(matchedEmail, (contactCounts.get(matchedEmail) || 0) + 1);

      // Collect notes
      const noteText = props.hs_call_body || props.hs_email_subject || props.hs_meeting_title;
      if (noteText && notes.length < 10) {
        notes.push({
          email: matchedEmail,
          date: new Date(props.hs_timestamp),
          note: noteText.slice(0, 200),
        });
      }
    }

    after = data.paging?.next?.after;
  } while (after);

  summary.uniqueContacts = contactCounts.size;
  summary.topContacts = Array.from(contactCounts.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([email, count]) => ({ email, count }));
  summary.recentNotes = notes
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 5);

  return summary;
}

// ---------------------------------------------------------------------------
// Activity Push
// ---------------------------------------------------------------------------

/**
 * Pushes a single activity event to HubSpot.
 *
 * Checks idempotency via HubSpotEngagementMapping before creating the
 * engagement. If the contact doesn't exist in HubSpot, upserts by email.
 *
 * @param params - Activity event details
 */
export async function pushActivity(params: {
  connectionId: string;
  eventType: 'call' | 'email' | 'meeting';
  eventId: string;
  eventSource: string;
  contactEmail: string;
  engagementData: Record<string, unknown>;
}): Promise<void> {
  const { connectionId, eventType, eventId, eventSource, contactEmail, engagementData } = params;

  const connection = await prisma.hubSpotConnection.findUnique({
    where: { id: connectionId },
  });
  if (!connection || connection.status !== 'ACTIVE') return;

  // Idempotency check
  const existing = await prisma.hubSpotEngagementMapping.findFirst({
    where: { connectionId, eventType, eventId, eventSource },
  });
  if (existing) return;

  const accessToken = await getAccessToken(connection.clientId);
  const hubspotClient = new HubSpotClient({ accessToken });

  // Look up or upsert contact
  let contactMapping = await prisma.hubSpotContactMapping.findFirst({
    where: { connectionId, email: contactEmail },
  });

  if (!contactMapping) {
    // Upsert contact in HubSpot by email
    try {
      const upsertResult = await hubspotClient.crm.contacts.batchApi.upsert({
        inputs: [{ idProperty: 'email', id: contactEmail, properties: { email: contactEmail } }],
      });
      const contact = upsertResult.results[0];
      if (contact) {
        contactMapping = await prisma.hubSpotContactMapping.create({
          data: {
            connectionId,
            email: contactEmail,
            hubspotContactId: contact.id,
          },
        });
      }
    } catch (err) {
      logger.error('Failed to upsert contact for activity push', { error: err, contactEmail });
      throw err;
    }
  }

  if (!contactMapping) return;

  // Build engagement properties based on type
  const engagementProps: Record<string, string> = {
    hs_timestamp: (engagementData.timestamp as string) || new Date().toISOString(),
  };

  if (eventType === 'call') {
    engagementProps.hs_engagement_type = 'CALL';
    if (engagementData.callDuration) engagementProps.hs_call_duration = String(Number(engagementData.callDuration) * 1000);
    if (engagementData.callOutcome) engagementProps.hs_call_disposition = engagementData.callOutcome as string;
    if (engagementData.callNotes) engagementProps.hs_call_body = engagementData.callNotes as string;
  } else if (eventType === 'email') {
    engagementProps.hs_engagement_type = 'EMAIL';
    if (engagementData.emailSubject) engagementProps.hs_email_subject = engagementData.emailSubject as string;
    if (engagementData.emailBodyPreview) engagementProps.hs_email_text = engagementData.emailBodyPreview as string;
    if (engagementData.emailDirection) engagementProps.hs_email_direction = engagementData.emailDirection as string;
  } else if (eventType === 'meeting') {
    engagementProps.hs_engagement_type = 'MEETING';
    if (engagementData.meetingTitle) engagementProps.hs_meeting_title = engagementData.meetingTitle as string;
    if (engagementData.meetingStartTime) engagementProps.hs_meeting_start_time = engagementData.meetingStartTime as string;
    if (engagementData.meetingEndTime) engagementProps.hs_meeting_end_time = engagementData.meetingEndTime as string;
  }

  // Create engagement in HubSpot
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (hubspotClient as any).apiRequest({
    method: 'POST',
    path: '/crm/v3/objects/engagements',
    body: {
      properties: engagementProps,
      associations: [
        {
          to: { id: contactMapping.hubspotContactId },
          types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 194 }],
        },
      ],
    },
  });

  const engagementResult = await response.json();
  const hubspotEngagementId = engagementResult.id;

  // Create engagement mapping (idempotency marker)
  await prisma.hubSpotEngagementMapping.create({
    data: {
      connectionId,
      eventType,
      eventId,
      eventSource,
      hubspotEngagementId: hubspotEngagementId || 'unknown',
      hubspotContactId: contactMapping.hubspotContactId,
    },
  });

  // Create sync log
  await prisma.hubSpotSyncLog.create({
    data: {
      connectionId,
      syncType: 'ACTIVITY_PUSH',
      direction: 'push',
      recordsProcessed: 1,
      recordsCreated: 1,
      recordsUpdated: 0,
      recordsFailed: 0,
      metadata: { eventType, eventId, eventSource, contactEmail },
    },
  });

  // Update connection stats
  await prisma.hubSpotConnection.update({
    where: { id: connectionId },
    data: {
      totalActivitiesLogged: { increment: 1 },
      lastSyncAt: new Date(),
    },
  });

  logAudit({
    action: 'hubspot_activity_synced',
    actorUserId: 'system',
    targetType: 'HubSpotEngagementMapping',
    targetId: hubspotEngagementId || eventId,
    metadata: { connectionId, eventType, eventSource, contactEmail },
  }).catch(() => {});
}

/**
 * Retries all failed activity syncs for a client by re-queuing them.
 *
 * @param clientId - ManagedClient UUID
 * @returns Count of queued retry jobs
 */
export async function retrySyncs(clientId: string): Promise<{ queued: number }> {
  const connection = await prisma.hubSpotConnection.findUnique({
    where: { clientId },
  });
  if (!connection) return { queued: 0 };

  // Find failed sync logs
  const failedLogs = await prisma.hubSpotSyncLog.findMany({
    where: {
      connectionId: connection.id,
      syncType: 'ACTIVITY_PUSH',
      recordsFailed: { gt: 0 },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  let queued = 0;
  for (const log of failedLogs) {
    const metadata = log.metadata as Record<string, unknown> | null;
    if (!metadata) continue;

    await hubspotActivitySyncQueue.add('sync-activity', {
      clientId,
      eventType: (metadata.eventType as 'call' | 'email' | 'meeting') || 'email',
      eventId: (metadata.eventId as string) || '',
      eventSource: (metadata.eventSource as string) || 'retry',
      payload: metadata,
    });
    queued++;
  }

  return { queued };
}
