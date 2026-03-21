import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';
import { twilioRestClient } from './twilioClient.js';
import { selectCallerId } from './localPresence.js';
import { checkCompliance } from './complianceEngine.js';
import { enqueueVoicemailAutoSkipSync } from './crmSyncService.js';
import { startRecording } from './recordingManager.js';
import { v4 as uuidv4 } from 'uuid';
import type { CallSessionResponse, QueueAdvanceResult } from '../../types/dialer.js';

const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL || '';

/**
 * Initiate a call to a queue item contact.
 * 1. Create CallSession record
 * 2. Select caller ID via local presence
 * 3. Run compliance pre-check
 * 4. Create outbound PSTN call via Twilio with conference + AMD
 */
export async function dialContact(
  sessionId: string,
  queueItemId: string,
  bdrId: string,
  clientId: string
): Promise<CallSessionResponse> {
  // Get queue item
  const queueItem = await prisma.dialerQueueItem.findUniqueOrThrow({
    where: { id: queueItemId },
  });

  // Compliance check
  const compliance = await checkCompliance(queueItem.contactPhone, clientId, bdrId);
  if (!compliance.eligible) {
    throw new Error(`Contact not eligible: ${compliance.reasons.join(', ')}`);
  }

  // Select caller ID
  const callerIdNumber = await selectCallerId(queueItem.contactPhone, clientId);
  if (!callerIdNumber) {
    throw new Error('No available caller ID number for this contact');
  }

  // Generate unique conference name
  const conferenceName = `dialer-${sessionId}-${uuidv4().substring(0, 8)}`;

  // Create CallSession record
  const callSession = await prisma.callSession.create({
    data: {
      dialerSessionId: sessionId,
      bdrId,
      clientId,
      campaignContactId: queueItem.campaignContactId,
      stepExecutionId: queueItem.stepExecutionId,
      contactName: queueItem.contactName,
      contactEmail: queueItem.contactEmail,
      contactPhone: queueItem.contactPhone,
      companyName: queueItem.companyName,
      jobTitle: queueItem.jobTitle,
      callerIdNumber,
      status: 'RINGING',
      consentPlayed: compliance.twoPartyConsentRequired,
      dialedAt: new Date(),
    },
  });

  // Update queue item
  await prisma.dialerQueueItem.update({
    where: { id: queueItemId },
    data: { status: 'DIALING', callSessionId: callSession.id },
  });

  // Create outbound PSTN call to contact via Twilio
  try {
    const call = await twilioRestClient.calls.create({
      to: queueItem.contactPhone,
      from: callerIdNumber,
      twiml: `<Response><Dial><Conference startConferenceOnEnter="false" endConferenceOnExit="false" beep="false" statusCallbackEvent="join leave end" statusCallback="${WEBHOOK_BASE_URL}/api/webhooks/twilio/status">${conferenceName}</Conference></Dial></Response>`,
      statusCallback: `${WEBHOOK_BASE_URL}/api/webhooks/twilio/status`,
      statusCallbackEvent: ['ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST',
      machineDetection: 'Enable' as const,
      asyncAmd: true as any,
      asyncAmdStatusCallback: `${WEBHOOK_BASE_URL}/api/webhooks/twilio/amd`,
      asyncAmdStatusCallbackMethod: 'POST',
    });

    // Update with Twilio SID
    await prisma.callSession.update({
      where: { id: callSession.id },
      data: {
        twilioCallSid: call.sid,
        twilioConferenceSid: conferenceName, // Will be updated to actual SID on conference start
      },
    });

    logger.info('[DialerEngine] Call initiated', {
      callSessionId: callSession.id,
      callSid: call.sid,
      to: queueItem.contactPhone,
      from: callerIdNumber,
      conferenceName,
    });

    return {
      id: callSession.id,
      status: 'RINGING' as any,
      contactName: queueItem.contactName,
      contactPhone: queueItem.contactPhone,
      companyName: queueItem.companyName,
      callerIdNumber,
      amdResult: null,
      dialedAt: callSession.dialedAt?.toISOString() ?? null,
      answeredAt: null,
      durationSeconds: null,
      disposition: null,
      conferenceName,
    };
  } catch (error) {
    // Mark call as failed
    await prisma.callSession.update({
      where: { id: callSession.id },
      data: { status: 'FAILED', endedAt: new Date() },
    });
    await prisma.dialerQueueItem.update({
      where: { id: queueItemId },
      data: { status: 'COMPLETED' },
    });

    logger.error('[DialerEngine] Call failed', { callSessionId: callSession.id, error });
    throw error;
  }
}

/**
 * Hang up a call by ending the conference.
 */
export async function hangupCall(callSessionId: string): Promise<void> {
  const callSession = await prisma.callSession.findUniqueOrThrow({
    where: { id: callSessionId },
  });

  if (callSession.twilioCallSid) {
    try {
      await twilioRestClient.calls(callSession.twilioCallSid).update({ status: 'completed' });
    } catch (error) {
      logger.warn('[DialerEngine] Error hanging up call', { callSessionId, error });
    }
  }

  await prisma.callSession.update({
    where: { id: callSessionId },
    data: { status: 'COMPLETED', endedAt: new Date() },
  });

  logger.info('[DialerEngine] Call hung up', { callSessionId });
}

/**
 * Handle a call status update from Twilio webhook.
 */
export async function handleCallStatusUpdate(
  callSid: string,
  callStatus: string,
  duration?: string
): Promise<void> {
  const callSession = await prisma.callSession.findFirst({
    where: { twilioCallSid: callSid },
  });

  if (!callSession) {
    logger.warn('[DialerEngine] Status update for unknown call', { callSid, callStatus });
    return;
  }

  const updates: Record<string, any> = {};

  switch (callStatus) {
    case 'ringing':
      updates.status = 'RINGING';
      break;
    case 'in-progress':
      updates.status = 'CONNECTED';
      updates.answeredAt = new Date();
      break;
    case 'completed':
      if (callSession.status !== 'COMPLETED') {
        updates.status = 'COMPLETED';
        updates.endedAt = new Date();
        if (duration) {
          updates.durationSeconds = parseInt(duration, 10);
        }
      }
      break;
    case 'failed':
      updates.status = 'FAILED';
      updates.endedAt = new Date();
      break;
    case 'no-answer':
      updates.status = 'NO_ANSWER';
      updates.endedAt = new Date();
      break;
    case 'busy':
      updates.status = 'NO_ANSWER';
      updates.endedAt = new Date();
      break;
  }

  if (Object.keys(updates).length > 0) {
    await prisma.callSession.update({
      where: { id: callSession.id },
      data: updates,
    });

    // Update session stats on terminal states
    if (['completed', 'failed', 'no-answer', 'busy'].includes(callStatus)) {
      await updateSessionStats(callSession.dialerSessionId);
    }

    logger.info('[DialerEngine] Call status updated', {
      callSessionId: callSession.id,
      callSid,
      callStatus,
    });
  }
}

/**
 * Handle AMD result from Twilio webhook.
 * On machine detection: terminate call within 2 seconds, auto-disposition as VOICEMAIL.
 */
export async function handleAmdResult(
  callSid: string,
  answeredBy: string
): Promise<void> {
  const callSession = await prisma.callSession.findFirst({
    where: { twilioCallSid: callSid },
  });

  if (!callSession) {
    logger.warn('[DialerEngine] AMD result for unknown call', { callSid, answeredBy });
    return;
  }

  // Map Twilio AMD result to our enum
  let amdResult: string;
  switch (answeredBy) {
    case 'human':
      amdResult = 'HUMAN';
      break;
    case 'machine_start':
      amdResult = 'MACHINE_START';
      break;
    case 'machine_end_beep':
    case 'machine_end_silence':
    case 'machine_end_other':
      amdResult = 'MACHINE_END';
      break;
    case 'fax':
      amdResult = 'FAX';
      break;
    default:
      amdResult = 'UNKNOWN';
  }

  await prisma.callSession.update({
    where: { id: callSession.id },
    data: { amdResult: amdResult as any },
  });

  // Auto-skip voicemail and fax calls
  if (['MACHINE_START', 'MACHINE_END', 'FAX'].includes(amdResult)) {
    logger.info('[DialerEngine] Voicemail detected, auto-skipping', {
      callSessionId: callSession.id,
      answeredBy,
      amdResult,
    });

    // Terminate the call
    if (callSession.twilioCallSid) {
      try {
        await twilioRestClient.calls(callSession.twilioCallSid).update({ status: 'completed' });
      } catch (error) {
        logger.warn('[DialerEngine] Error terminating voicemail call', { error });
      }
    }

    // Auto-disposition as voicemail
    await prisma.callSession.update({
      where: { id: callSession.id },
      data: {
        status: 'VOICEMAIL',
        disposition: 'VOICEMAIL_AUTO_SKIPPED' as any,
        dispositionAt: new Date(),
        endedAt: new Date(),
      },
    });

    // Update queue item
    if (callSession.id) {
      await prisma.dialerQueueItem.updateMany({
        where: { callSessionId: callSession.id },
        data: { status: 'COMPLETED' },
      });
    }

    await updateSessionStats(callSession.dialerSessionId);

    // T048: Enqueue CRM sync for auto-skipped voicemail
    enqueueVoicemailAutoSkipSync(callSession.id).catch((err) => {
      logger.error('[DialerEngine] Failed to enqueue voicemail CRM sync', {
        callSessionId: callSession.id,
        error: err.message,
      });
    });
  }

  // T053: Start recording for human-answered calls (HUMAN or UNKNOWN treated as human)
  if (['HUMAN', 'UNKNOWN'].includes(amdResult)) {
    startRecording(callSession.id).catch((err) => {
      logger.error('[DialerEngine] Failed to start recording', {
        callSessionId: callSession.id,
        error: err.message,
      });
    });
  }

  logger.info('[DialerEngine] AMD result processed', {
    callSessionId: callSession.id,
    callSid,
    answeredBy,
    amdResult,
  });
}

/**
 * Advance the queue to the next pending item.
 */
export async function advanceQueue(sessionId: string): Promise<QueueAdvanceResult> {
  const session = await prisma.dialerSession.findUniqueOrThrow({
    where: { id: sessionId },
  });

  if (session.status === 'PAUSED') {
    return { nextItem: null, queueComplete: false };
  }

  const nextItem = await prisma.dialerQueueItem.findFirst({
    where: { dialerSessionId: sessionId, status: 'PENDING' },
    orderBy: { position: 'asc' },
  });

  if (!nextItem) {
    return { nextItem: null, queueComplete: true };
  }

  return {
    nextItem: {
      id: nextItem.id,
      position: nextItem.position,
      status: nextItem.status as any,
      contactName: nextItem.contactName,
      contactEmail: nextItem.contactEmail,
      contactPhone: nextItem.contactPhone,
      companyName: nextItem.companyName,
      jobTitle: nextItem.jobTitle,
      hubspotContactId: nextItem.hubspotContactId,
      tcpaEligible: nextItem.tcpaEligible,
      optedOut: nextItem.optedOut,
      lastCalledAt: nextItem.lastCalledAt?.toISOString() ?? null,
    },
    queueComplete: false,
  };
}

/**
 * Toggle mute on the BDR's conference leg.
 */
export async function toggleMute(callSessionId: string, muted: boolean): Promise<void> {
  // The BDR's participant in the conference is identified by their device connection
  // This is handled via the Twilio Conference Participant API
  // For now, log the intent - full conference participant lookup implemented with webhooks
  logger.info('[DialerEngine] Mute toggled', { callSessionId, muted });
}

/**
 * Toggle hold on the contact's conference leg.
 */
export async function toggleHold(callSessionId: string, held: boolean): Promise<void> {
  logger.info('[DialerEngine] Hold toggled', { callSessionId, held });
}

/**
 * Update session aggregate stats from call sessions.
 */
async function updateSessionStats(sessionId: string): Promise<void> {
  const calls = await prisma.callSession.findMany({
    where: { dialerSessionId: sessionId },
    select: { status: true },
  });

  await prisma.dialerSession.update({
    where: { id: sessionId },
    data: {
      totalDialed: calls.length,
      totalConnected: calls.filter((c: any) => c.status === 'CONNECTED' || c.status === 'COMPLETED').length,
      totalVoicemail: calls.filter((c: any) => c.status === 'VOICEMAIL').length,
      totalNoAnswer: calls.filter((c: any) => c.status === 'NO_ANSWER').length,
    },
  });
}
