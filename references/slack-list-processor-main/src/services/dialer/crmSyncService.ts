/**
 * Dialer CRM Sync Service (T045-T048)
 *
 * Maps dialer dispositions to HubSpot call outcomes and enqueues
 * async CRM sync jobs via the existing hubspot-activity-sync queue.
 */

import { hubspotActivitySyncQueue } from '../queue/queues.js';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';
import type { DispositionType, HubSpotDispositionMapping, CallActivity } from '../../types/dialer.js';

// ============================================================
// T045: HubSpot Disposition Mapping (FR-018)
// ============================================================

/**
 * Maps each DispositionType to HubSpot call outcome fields.
 * Per FR-018, these map to hs_call_disposition (outcome) values.
 *
 * HubSpot standard dispositions (hs_call_disposition):
 * - "Connected" — reached a live person
 * - "No Answer" — rang but nobody picked up
 * - "Busy" — line busy
 * - "Left Live Message" — spoke to gatekeeper
 * - "Left Voicemail" — left a voicemail
 * - "Wrong Number" — incorrect number
 *
 * Custom dispositions are also allowed as freeform strings.
 */
const DISPOSITION_MAP: Record<DispositionType, Omit<HubSpotDispositionMapping, 'disposition'>> = {
  CONNECTED_INTERESTED: {
    hubspotOutcome: 'Connected',
    hubspotType: 'CALL',
    hubspotDescription: 'Connected — prospect interested',
  },
  CONNECTED_NOT_INTERESTED: {
    hubspotOutcome: 'Connected',
    hubspotType: 'CALL',
    hubspotDescription: 'Connected — prospect not interested',
  },
  CONNECTED_CALLBACK_REQUESTED: {
    hubspotOutcome: 'Connected',
    hubspotType: 'CALL',
    hubspotDescription: 'Connected — callback requested',
  },
  VOICEMAIL_AUTO_SKIPPED: {
    hubspotOutcome: 'No Answer',
    hubspotType: 'CALL',
    hubspotDescription: 'Voicemail detected — auto-skipped',
  },
  VOICEMAIL_LEFT_MESSAGE: {
    hubspotOutcome: 'Left Voicemail',
    hubspotType: 'CALL',
    hubspotDescription: 'Left voicemail message',
  },
  NO_ANSWER: {
    hubspotOutcome: 'No Answer',
    hubspotType: 'CALL',
    hubspotDescription: 'No answer after ringing',
  },
  WRONG_NUMBER: {
    hubspotOutcome: 'Wrong Number',
    hubspotType: 'CALL',
    hubspotDescription: 'Wrong number — contact unreachable',
  },
  DO_NOT_CALL: {
    hubspotOutcome: 'Connected',
    hubspotType: 'CALL',
    hubspotDescription: 'Connected — requested Do Not Call',
  },
  INVALID_NUMBER: {
    hubspotOutcome: 'Wrong Number',
    hubspotType: 'CALL',
    hubspotDescription: 'Invalid or disconnected number',
  },
  DROPPED_CALL: {
    hubspotOutcome: 'No Answer',
    hubspotType: 'CALL',
    hubspotDescription: 'Call dropped unexpectedly',
  },
};

/**
 * Get the HubSpot mapping for a disposition type.
 */
export function getHubSpotMapping(disposition: DispositionType): HubSpotDispositionMapping {
  const mapping = DISPOSITION_MAP[disposition];
  return {
    disposition,
    ...mapping,
  };
}

/**
 * Format BDR notes and disposition into HubSpot call body (hs_call_body).
 * Includes disposition label and optional notes.
 */
function formatCallBody(disposition: DispositionType, notes?: string | null): string {
  const mapping = DISPOSITION_MAP[disposition];
  const parts = [`Disposition: ${mapping.hubspotDescription}`];
  if (notes) parts.push(`\nBDR Notes: ${notes}`);
  return parts.join('');
}

// ============================================================
// T046: Enqueue CRM sync job
// ============================================================

/**
 * Enqueue a HubSpot call engagement sync after disposition submission.
 * Uses the existing hubspot-activity-sync queue + worker.
 *
 * Requires: callSession must have contactEmail to look up HubSpot contact.
 * If no HubSpot connection is active for the client, the worker will skip.
 */
export async function enqueueDispositionSync(
  callSessionId: string,
  disposition: DispositionType,
  notes?: string | null,
): Promise<void> {
  const callSession = await prisma.callSession.findUnique({
    where: { id: callSessionId },
  });

  if (!callSession) {
    logger.warn('[CrmSync] Call session not found for CRM sync', { callSessionId });
    return;
  }

  // Need contact email to match HubSpot contact
  if (!callSession.contactEmail) {
    logger.info('[CrmSync] No contact email — skipping CRM sync', { callSessionId });
    return;
  }

  const mapping = getHubSpotMapping(disposition);
  const durationSeconds = callSession.durationSeconds ?? callSession.talkTimeSeconds ?? 0;

  const payload: Record<string, unknown> = {
    contactEmail: callSession.contactEmail,
    contactName: callSession.contactName,
    companyName: callSession.companyName,
    contactPhone: callSession.contactPhone,
    callerIdNumber: callSession.callerIdNumber,
    timestamp: callSession.dialedAt?.toISOString() ?? new Date().toISOString(),
    callDuration: durationSeconds,
    callOutcome: mapping.hubspotOutcome,
    callNotes: formatCallBody(disposition, notes),
    disposition,
    dispositionLabel: mapping.hubspotDescription,
  };

  await hubspotActivitySyncQueue.add(
    'dialer-disposition-sync',
    {
      clientId: callSession.clientId,
      eventType: 'call',
      eventId: callSessionId,
      eventSource: 'power-dialer',
      payload,
    },
    {
      // T047: Retry configuration — 3 attempts with exponential backoff
      attempts: 3,
      backoff: {
        type: 'exponential' as const,
        delay: 5000,
      },
      // Deduplicate by callSessionId to prevent double-syncing
      jobId: `dialer-crm-${callSessionId}`,
    },
  );

  logger.info('[CrmSync] Disposition sync job enqueued', {
    callSessionId,
    clientId: callSession.clientId,
    disposition,
    hubspotOutcome: mapping.hubspotOutcome,
  });
}

// ============================================================
// T048: Voicemail auto-skip CRM sync
// ============================================================

/**
 * Enqueue a HubSpot sync for an AMD auto-skipped voicemail call.
 * Creates an engagement with outcome "No Answer" and type "Voicemail".
 */
export async function enqueueVoicemailAutoSkipSync(
  callSessionId: string,
): Promise<void> {
  await enqueueDispositionSync(
    callSessionId,
    'VOICEMAIL_AUTO_SKIPPED' as DispositionType,
    null,
  );

  logger.info('[CrmSync] Voicemail auto-skip sync enqueued', { callSessionId });
}

// ============================================================
// T047: Graceful error handling for expired HubSpot connections
// ============================================================

/**
 * Check if a HubSpot connection error indicates an expired/revoked token.
 * Used by the worker to decide whether to retry or fail permanently.
 */
export function isTokenError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('token') ||
      msg.includes('unauthorized') ||
      msg.includes('401') ||
      msg.includes('bad_refresh_token') ||
      msg.includes('expired')
    );
  }
  return false;
}

/**
 * Handle a permanently failed CRM sync (e.g. expired token).
 * Marks the connection as TOKEN_EXPIRED and logs an admin notification.
 */
export async function handlePermanentSyncFailure(
  clientId: string,
  error: string,
): Promise<void> {
  const connection = await prisma.hubSpotConnection.findUnique({
    where: { clientId },
  });

  if (!connection) return;

  // Only mark as expired if it's a token error
  if (error.toLowerCase().includes('token') || error.toLowerCase().includes('401')) {
    await prisma.hubSpotConnection.update({
      where: { id: connection.id },
      data: { status: 'TOKEN_EXPIRED' as any },
    });

    logger.warn('[CrmSync] HubSpot connection marked as TOKEN_EXPIRED', {
      clientId,
      connectionId: connection.id,
      error,
    });
  }

  // Log failure for admin visibility
  await prisma.hubSpotSyncLog.create({
    data: {
      connectionId: connection.id,
      syncType: 'ACTIVITY_PUSH',
      direction: 'push',
      recordsProcessed: 1,
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsFailed: 1,
      errorMessage: `Permanent failure: ${error}`,
      metadata: { source: 'power-dialer', clientId },
    },
  });
}
