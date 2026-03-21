import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';
import { batchComplianceCheck } from './complianceEngine.js';
import { dialerInactivityQueue } from '../queue/queues.js';
import type { DialerSessionResponse, QueueItemResponse, SessionStats, StartSessionRequest } from '../../types/dialer.js';

/** Inactivity thresholds in milliseconds. */
const INACTIVITY_WARNING_MS = 25 * 60 * 1000; // 25 minutes
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Start a new dialer session.
 * Creates DialerSession, populates DialerQueueItems from campaign phone steps
 * or manual contact list, runs compliance pre-check.
 */
export async function startSession(
  bdrId: string,
  clientId: string,
  request: StartSessionRequest
): Promise<DialerSessionResponse> {
  // 1. Check no active session exists for this BDR
  const existing = await prisma.dialerSession.findFirst({
    where: { bdrId, status: { in: ['ACTIVE', 'PAUSED'] } },
  });
  if (existing) throw new Error('BDR already has an active session');

  // 2. Get contacts based on source
  let contacts: Array<{
    campaignContactId: string | null;
    stepExecutionId: string | null;
    contactName: string;
    contactEmail: string | null;
    contactPhone: string;
    companyName: string | null;
    jobTitle: string | null;
    hubspotContactId: string | null;
  }> = [];

  if (request.source === 'campaign' && request.campaignId) {
    // Get campaign contacts with pending PHONE steps
    const campaignContacts = await prisma.campaignContact.findMany({
      where: {
        campaignId: request.campaignId,
        status: 'ACTIVE',
        // Has a valid phone
        OR: [
          { resolvedPhone: { not: null } },
          { mobilePhone: { not: null } },
          { directPhone: { not: null } },
        ],
      },
      include: {
        stepExecutions: {
          where: { stepType: 'PHONE', status: 'PENDING' },
          orderBy: { stepIndex: 'asc' },
          take: 1,
        },
      },
    });

    contacts = campaignContacts
      .filter(cc => cc.stepExecutions.length > 0)
      .map(cc => ({
        campaignContactId: cc.id,
        stepExecutionId: cc.stepExecutions[0]?.id ?? null,
        contactName: `${cc.firstName} ${cc.lastName}`.trim(),
        contactEmail: cc.email,
        contactPhone: cc.resolvedPhone || cc.mobilePhone || cc.directPhone || '',
        companyName: cc.companyName,
        jobTitle: cc.jobTitle,
        hubspotContactId: cc.hubspotContactId,
      }))
      .filter(c => c.contactPhone);
  } else if (request.source === 'manual' && request.contactIds?.length) {
    const campaignContacts = await prisma.campaignContact.findMany({
      where: { id: { in: request.contactIds } },
    });

    contacts = campaignContacts.map(cc => ({
      campaignContactId: cc.id,
      stepExecutionId: null,
      contactName: `${cc.firstName} ${cc.lastName}`.trim(),
      contactEmail: cc.email,
      contactPhone: cc.resolvedPhone || cc.mobilePhone || cc.directPhone || '',
      companyName: cc.companyName,
      jobTitle: cc.jobTitle,
      hubspotContactId: cc.hubspotContactId,
    })).filter(c => c.contactPhone);
  }

  if (contacts.length === 0) {
    throw new Error('No eligible contacts found for dialing');
  }

  // 3. Run batch compliance check
  const complianceResults = await batchComplianceCheck(
    contacts.map((c, i) => ({ phoneNumber: c.contactPhone, id: String(i) })),
    clientId
  );

  // 4. Create session and queue items in a transaction
  const session = await prisma.$transaction(async (tx) => {
    const dialerSession = await tx.dialerSession.create({
      data: {
        bdrId,
        clientId,
        campaignId: request.campaignId || null,
        status: 'ACTIVE',
      },
    });

    // Create queue items (only eligible contacts get PENDING status)
    const queueItems = contacts.map((contact, index) => {
      const compliance = complianceResults.get(String(index));
      return {
        dialerSessionId: dialerSession.id,
        campaignContactId: contact.campaignContactId,
        stepExecutionId: contact.stepExecutionId,
        contactName: contact.contactName,
        contactEmail: contact.contactEmail,
        contactPhone: contact.contactPhone,
        companyName: contact.companyName,
        jobTitle: contact.jobTitle,
        hubspotContactId: contact.hubspotContactId,
        position: index + 1,
        status: compliance?.eligible ? 'PENDING' : 'SKIPPED',
        tcpaEligible: !compliance?.tcpaBlocked,
        optedOut: compliance?.optedOut ?? false,
      };
    });

    await tx.dialerQueueItem.createMany({ data: queueItems });

    return dialerSession;
  });

  // 5. Start inactivity timeout
  await scheduleInactivityTimeout(session.id);

  // 6. Fetch full session with queue for response
  return getSessionResponse(session.id);
}

/**
 * Pause an active session.
 */
export async function pauseSession(sessionId: string, bdrId: string): Promise<void> {
  await prisma.dialerSession.update({
    where: { id: sessionId },
    data: { status: 'PAUSED', pausedAt: new Date() },
  });
  // Clear inactivity timeout while paused
  await clearInactivityTimeout(sessionId);
  logger.info('[SessionManager] Session paused', { sessionId, bdrId });
}

/**
 * Resume a paused session.
 */
export async function resumeSession(sessionId: string, bdrId: string): Promise<void> {
  await prisma.dialerSession.update({
    where: { id: sessionId },
    data: { status: 'ACTIVE', pausedAt: null },
  });
  // Restart inactivity timeout on resume
  await scheduleInactivityTimeout(sessionId);
  logger.info('[SessionManager] Session resumed', { sessionId, bdrId });
}

/**
 * Complete a session and return stats.
 */
export async function completeSession(sessionId: string, bdrId: string): Promise<SessionStats> {
  // Clear inactivity timeout on completion
  await clearInactivityTimeout(sessionId);

  const session = await prisma.dialerSession.update({
    where: { id: sessionId },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });

  // Calculate stats
  const callSessions = await prisma.callSession.findMany({
    where: { dialerSessionId: sessionId },
    select: { status: true, talkTimeSeconds: true, disposition: true },
  });

  const totalDialed = callSessions.length;
  const totalConnected = callSessions.filter((c: any) => c.status === 'CONNECTED' || c.status === 'COMPLETED').length;
  const totalVoicemail = callSessions.filter((c: any) => c.status === 'VOICEMAIL').length;
  const totalNoAnswer = callSessions.filter((c: any) => c.status === 'NO_ANSWER').length;
  const totalSkipped = await prisma.dialerQueueItem.count({
    where: { dialerSessionId: sessionId, status: 'SKIPPED' },
  });

  const talkTimes = callSessions.map((c: any) => c.talkTimeSeconds ?? 0).filter((t: number) => t > 0);
  const avgTalkTimeSeconds = talkTimes.length > 0
    ? talkTimes.reduce((a: number, b: number) => a + b, 0) / talkTimes.length
    : 0;

  const sessionDurationMinutes = (new Date().getTime() - session.startedAt.getTime()) / 60000;
  const connectRate = totalDialed > 0 ? (totalConnected / totalDialed) * 100 : 0;

  // Update session stats
  await prisma.dialerSession.update({
    where: { id: sessionId },
    data: { totalDialed, totalConnected, totalVoicemail, totalNoAnswer },
  });

  logger.info('[SessionManager] Session completed', { sessionId, bdrId, totalDialed, totalConnected });

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
 * Get the BDR's active session.
 */
export async function getActiveSession(bdrId: string): Promise<DialerSessionResponse | null> {
  const session = await prisma.dialerSession.findFirst({
    where: { bdrId, status: { in: ['ACTIVE', 'PAUSED'] } },
  });

  if (!session) return null;
  return getSessionResponse(session.id);
}

/**
 * Build the full session response with queue.
 */
async function getSessionResponse(sessionId: string): Promise<DialerSessionResponse> {
  const session = await prisma.dialerSession.findUniqueOrThrow({
    where: { id: sessionId },
  });

  const queueItems = await prisma.dialerQueueItem.findMany({
    where: { dialerSessionId: sessionId },
    orderBy: { position: 'asc' },
  });

  const currentIndex = queueItems.findIndex((q: any) => q.status === 'PENDING');

  return {
    id: session.id,
    status: session.status as any,
    campaignId: session.campaignId,
    totalDialed: session.totalDialed,
    totalConnected: session.totalConnected,
    totalVoicemail: session.totalVoicemail,
    totalNoAnswer: session.totalNoAnswer,
    startedAt: session.startedAt.toISOString(),
    queue: queueItems.map((q: any) => ({
      id: q.id,
      position: q.position,
      status: q.status as any,
      contactName: q.contactName,
      contactEmail: q.contactEmail,
      contactPhone: q.contactPhone,
      companyName: q.companyName,
      jobTitle: q.jobTitle,
      hubspotContactId: q.hubspotContactId,
      tcpaEligible: q.tcpaEligible,
      optedOut: q.optedOut,
      lastCalledAt: q.lastCalledAt?.toISOString() ?? null,
    })),
    currentIndex: currentIndex >= 0 ? currentIndex : queueItems.length,
  };
}

// ---------------------------------------------------------------------------
// Inactivity Timeout (T062)
// ---------------------------------------------------------------------------

/**
 * Schedule inactivity timeout jobs for a session.
 * Creates two delayed jobs:
 *   - Warning at 25 minutes (job name: `inactivity-warning:{sessionId}`)
 *   - Auto-complete at 30 minutes (job name: `inactivity-timeout:{sessionId}`)
 *
 * Call this when a session starts and on every heartbeat.
 */
export async function scheduleInactivityTimeout(sessionId: string): Promise<void> {
  // Remove any existing jobs for this session first
  await clearInactivityTimeout(sessionId);

  // Schedule warning at 25 minutes
  await dialerInactivityQueue.add(
    `inactivity-warning:${sessionId}`,
    { sessionId, type: 'warning' },
    { delay: INACTIVITY_WARNING_MS, jobId: `warn-${sessionId}` },
  );

  // Schedule auto-complete at 30 minutes
  await dialerInactivityQueue.add(
    `inactivity-timeout:${sessionId}`,
    { sessionId, type: 'timeout' },
    { delay: INACTIVITY_TIMEOUT_MS, jobId: `timeout-${sessionId}` },
  );

  logger.debug('[SessionManager] Inactivity timeout scheduled', { sessionId });
}

/**
 * Clear inactivity timeout jobs for a session.
 * Called when session is paused, completed, or before rescheduling.
 */
export async function clearInactivityTimeout(sessionId: string): Promise<void> {
  try {
    const warnJob = await dialerInactivityQueue.getJob(`warn-${sessionId}`);
    if (warnJob) await warnJob.remove();
  } catch {
    // Job may already have been processed/removed
  }

  try {
    const timeoutJob = await dialerInactivityQueue.getJob(`timeout-${sessionId}`);
    if (timeoutJob) await timeoutJob.remove();
  } catch {
    // Job may already have been processed/removed
  }
}

/**
 * Record a heartbeat for the session — resets the inactivity timer.
 * Should be called on: dials, dispositions, pause/resume, and explicit heartbeat pings.
 */
export async function recordHeartbeat(sessionId: string): Promise<void> {
  // Verify session is still active
  const session = await prisma.dialerSession.findUnique({
    where: { id: sessionId },
    select: { status: true },
  });

  if (!session || !['ACTIVE', 'PAUSED'].includes(session.status)) {
    logger.warn('[SessionManager] Heartbeat for non-active session', { sessionId, status: session?.status });
    return;
  }

  // Only reschedule if ACTIVE (paused sessions don't timeout)
  if (session.status === 'ACTIVE') {
    await scheduleInactivityTimeout(sessionId);
  }

  logger.debug('[SessionManager] Heartbeat recorded', { sessionId });
}

/**
 * Handle inactivity timeout — auto-completes the session.
 * Called by the inactivity worker when the 30-minute timeout fires.
 */
export async function handleInactivityTimeout(sessionId: string): Promise<SessionStats | null> {
  const session = await prisma.dialerSession.findUnique({
    where: { id: sessionId },
    select: { status: true, bdrId: true },
  });

  if (!session || session.status === 'COMPLETED') {
    logger.info('[SessionManager] Inactivity timeout for already-completed session', { sessionId });
    return null;
  }

  logger.warn('[SessionManager] Auto-completing session due to inactivity', { sessionId, bdrId: session.bdrId });

  return completeSession(sessionId, session.bdrId);
}
