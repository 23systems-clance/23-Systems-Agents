/**
 * Conference Manager (T055 - US4 Manager Call Monitoring)
 *
 * Manages Twilio Conference participant operations for manager monitoring:
 * - Adding a manager as a coach (listen-only) participant
 * - Escalating from coach to barge-in (two-way audio)
 * - Removing participants from conferences
 * - Listing active conferences and their participants
 */

import { prisma } from '../../models/index.js';
import { twilioRestClient, generateAccessToken } from './twilioClient.js';
import logger from '../../lib/logger.js';
import type { ActiveCallResponse, ListenResponse } from '../../types/dialer.js';

/**
 * Get all active calls (RINGING or CONNECTED) for a client.
 *
 * Returns call session data enriched with live duration calculation.
 *
 * @param clientId - ManagedClient UUID to scope results.
 * @returns Array of active call responses.
 */
export async function getActiveCalls(clientId: string): Promise<ActiveCallResponse[]> {
  const activeCalls: any[] = await prisma.callSession.findMany({
    where: {
      clientId,
      status: { in: ['RINGING', 'CONNECTED'] },
    },
    orderBy: { dialedAt: 'desc' },
  });

  return activeCalls.map((call: any) => {
    const now = new Date();
    const dialedAt = call.dialedAt ? new Date(call.dialedAt) : now;
    const durationSeconds = Math.floor((now.getTime() - dialedAt.getTime()) / 1000);

    return {
      callSessionId: call.id,
      bdrName: call.bdrId, // Will be resolved to name by the route if needed
      contactName: call.contactName,
      companyName: call.companyName,
      contactPhone: call.contactPhone,
      status: call.status,
      durationSeconds,
      dialedAt: call.dialedAt?.toISOString() ?? now.toISOString(),
      conferenceSid: call.twilioConferenceSid ?? null,
    };
  });
}

/**
 * Add a manager as a coach (listen-only) participant to an active call's conference.
 *
 * The manager joins muted and in coaching mode, meaning they can hear
 * both parties but neither party can hear them.
 *
 * @param callSessionId - CallSession UUID to listen to.
 * @param managerId - Manager's user ID for Twilio identity.
 * @returns Token and conference SID for the manager's WebRTC connection.
 */
export async function addCoachParticipant(
  callSessionId: string,
  managerId: string,
): Promise<ListenResponse> {
  const callSession: any = await prisma.callSession.findUniqueOrThrow({
    where: { id: callSessionId },
  });

  const conferenceName = callSession.twilioConferenceSid;
  if (!conferenceName) {
    throw new Error(`CallSession ${callSessionId} has no conference name`);
  }

  // Resolve actual Twilio conference SID from friendly name
  const conferences = await twilioRestClient.conferences.list({
    friendlyName: conferenceName,
    status: 'in-progress',
    limit: 1,
  });

  if (conferences.length === 0) {
    throw new Error(`No active conference found for call session ${callSessionId}`);
  }

  const conferenceSid = conferences[0].sid;

  // Generate a Twilio access token for the manager
  const { token } = generateAccessToken(`manager-${managerId}`);

  // Add manager as a coach participant (muted, coaching mode)
  await twilioRestClient
    .conferences(conferenceSid)
    .participants.create({
      from: `client:manager-${managerId}`,
      to: `client:manager-${managerId}`,
      muted: true,
      coaching: true,
      // Coach the BDR's call SID so the manager hears both sides
      callSidToCoach: callSession.twilioCallSid ?? undefined,
    });

  logger.info('[ConferenceManager] Coach participant added', {
    callSessionId,
    conferenceSid,
    managerId,
  });

  return { token, conferenceSid };
}

/**
 * Escalate a manager from coach (listen-only) to barge-in (two-way audio).
 *
 * Updates the manager's conference participant to unmute and disable coaching,
 * allowing both the BDR and contact to hear the manager.
 *
 * @param callSessionId - CallSession UUID.
 * @param managerId - Manager's user ID.
 */
export async function bargeIn(
  callSessionId: string,
  managerId: string,
): Promise<void> {
  const callSession: any = await prisma.callSession.findUniqueOrThrow({
    where: { id: callSessionId },
  });

  const conferenceName = callSession.twilioConferenceSid;
  if (!conferenceName) {
    throw new Error(`CallSession ${callSessionId} has no conference name`);
  }

  // Resolve conference SID
  const conferences = await twilioRestClient.conferences.list({
    friendlyName: conferenceName,
    status: 'in-progress',
    limit: 1,
  });

  if (conferences.length === 0) {
    throw new Error(`No active conference found for call session ${callSessionId}`);
  }

  const conferenceSid = conferences[0].sid;

  // Find the manager's participant in the conference
  const participants = await twilioRestClient
    .conferences(conferenceSid)
    .participants.list();

  const managerParticipant = participants.find(
    (p) => p.label === `manager-${managerId}` || p.callSid?.includes('manager'),
  );

  if (!managerParticipant) {
    throw new Error(`Manager ${managerId} is not in the conference`);
  }

  // Unmute and disable coaching for barge-in
  await twilioRestClient
    .conferences(conferenceSid)
    .participants(managerParticipant.callSid)
    .update({
      muted: false,
      coaching: false,
    });

  logger.info('[ConferenceManager] Manager barged in', {
    callSessionId,
    conferenceSid,
    managerId,
  });
}

/**
 * Remove a participant from a conference.
 *
 * @param conferenceSid - Twilio Conference SID.
 * @param participantCallSid - Call SID of the participant to remove.
 */
export async function removeParticipant(
  conferenceSid: string,
  participantCallSid: string,
): Promise<void> {
  await twilioRestClient
    .conferences(conferenceSid)
    .participants(participantCallSid)
    .remove();

  logger.info('[ConferenceManager] Participant removed', {
    conferenceSid,
    participantCallSid,
  });
}

/**
 * Get participants in a conference.
 *
 * @param conferenceSid - Twilio Conference SID.
 * @returns Array of participant details.
 */
export async function getConferenceParticipants(
  conferenceSid: string,
): Promise<Array<{ callSid: string; muted: boolean; coaching: boolean }>> {
  const participants = await twilioRestClient
    .conferences(conferenceSid)
    .participants.list();

  return participants.map((p) => ({
    callSid: p.callSid,
    muted: p.muted,
    coaching: p.coaching,
  }));
}
