import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';
import { advanceQueue } from './dialerEngine.js';
import { enqueueDispositionSync } from './crmSyncService.js';
import type { DispositionType, DispositionResponse, SessionStats } from '../../types/dialer.js';

/**
 * Submit a disposition for a completed call.
 * Updates CallSession, DialerQueueItem, session stats.
 * Triggers CRM sync (placeholder for US5).
 */
export async function submitDisposition(
  callSessionId: string,
  disposition: DispositionType,
  notes?: string
): Promise<DispositionResponse> {
  const callSession = await prisma.callSession.findUniqueOrThrow({
    where: { id: callSessionId },
  });

  // Update call session with disposition
  await prisma.callSession.update({
    where: { id: callSessionId },
    data: {
      disposition: disposition as any,
      dispositionNotes: notes ?? null,
      dispositionAt: new Date(),
      status: 'COMPLETED',
      endedAt: callSession.endedAt ?? new Date(),
    },
  });

  // Update queue item
  await prisma.dialerQueueItem.updateMany({
    where: { callSessionId },
    data: { status: 'COMPLETED' },
  });

  // Handle DO_NOT_CALL disposition — create opt-out record
  if (disposition === 'DO_NOT_CALL') {
    await prisma.contactOptOut.upsert({
      where: { phoneNumber: normalizePhone(callSession.contactPhone) },
      create: {
        phoneNumber: normalizePhone(callSession.contactPhone),
        contactName: callSession.contactName,
        contactEmail: callSession.contactEmail,
        reason: 'Requested Do Not Call during live call',
        source: 'dialer-disposition',
        recordedById: callSession.bdrId,
        clientId: callSession.clientId,
      },
      update: {}, // Already opted out, no-op
    });

    logger.info('[DispositionService] DNC opt-out recorded', {
      callSessionId,
      phone: callSession.contactPhone,
    });
  }

  // Update session stats
  const sessionStats = await calculateSessionStats(callSession.dialerSessionId);

  // Advance queue to next contact
  const queueResult = await advanceQueue(callSession.dialerSessionId);

  // T046: Enqueue CRM sync to HubSpot (async via BullMQ)
  enqueueDispositionSync(callSessionId, disposition, notes).catch((err) => {
    logger.error('[DispositionService] Failed to enqueue CRM sync', {
      callSessionId,
      error: err.message,
    });
  });

  logger.info('[DispositionService] Disposition submitted', {
    callSessionId,
    disposition,
    nextQueueItem: queueResult.nextItem?.id ?? 'none',
    queueComplete: queueResult.queueComplete,
  });

  return {
    nextQueueItem: queueResult.nextItem,
    sessionStats,
  };
}

/**
 * Calculate session stats.
 */
async function calculateSessionStats(sessionId: string): Promise<SessionStats> {
  const session = await prisma.dialerSession.findUniqueOrThrow({
    where: { id: sessionId },
  });

  const callSessions = await prisma.callSession.findMany({
    where: { dialerSessionId: sessionId },
    select: { status: true, talkTimeSeconds: true, disposition: true },
  });

  const totalDialed = callSessions.length;
  const totalConnected = callSessions.filter((c: any) =>
    c.status === 'CONNECTED' || (c.status === 'COMPLETED' && c.disposition && !['VOICEMAIL_AUTO_SKIPPED', 'NO_ANSWER'].includes(c.disposition))
  ).length;
  const totalVoicemail = callSessions.filter((c: any) => c.status === 'VOICEMAIL' || c.disposition === 'VOICEMAIL_AUTO_SKIPPED').length;
  const totalNoAnswer = callSessions.filter((c: any) => c.status === 'NO_ANSWER' || c.disposition === 'NO_ANSWER').length;
  const totalSkipped = await prisma.dialerQueueItem.count({
    where: { dialerSessionId: sessionId, status: 'SKIPPED' },
  });

  const talkTimes = callSessions.map((c: any) => c.talkTimeSeconds ?? 0).filter((t: number) => t > 0);
  const avgTalkTimeSeconds = talkTimes.length > 0
    ? talkTimes.reduce((a: number, b: number) => a + b, 0) / talkTimes.length
    : 0;

  const sessionDurationMinutes = (new Date().getTime() - session.startedAt.getTime()) / 60000;
  const connectRate = totalDialed > 0 ? (totalConnected / totalDialed) * 100 : 0;

  // Update session stats in DB
  await prisma.dialerSession.update({
    where: { id: sessionId },
    data: { totalDialed, totalConnected, totalVoicemail, totalNoAnswer },
  });

  return {
    totalDialed,
    totalConnected,
    totalVoicemail,
    totalNoAnswer,
    totalSkipped,
    avgTalkTimeSeconds,
    sessionDurationMinutes,
    connectRate,
  };
}

/**
 * Normalize phone to E.164.
 */
function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10) return `+1${cleaned}`;
  if (cleaned.length === 11 && cleaned.startsWith('1')) return `+${cleaned}`;
  return phone;
}
