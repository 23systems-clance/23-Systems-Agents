/**
 * Callback Service (T077 + T085)
 *
 * Manages scheduled callbacks for the power dialer:
 * - Schedule, reschedule, complete callbacks
 * - Detect overdue (missed) callbacks via repeatable scan
 * - Insert callback contacts at the top of the active session queue
 * - Detect missed inbound calls and auto-create callbacks
 */

import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

/** 30-minute grace period before marking a callback as MISSED. */
const MISSED_THRESHOLD_MS = 30 * 60 * 1000;

/**
 * Schedule a new callback linked to a call session.
 *
 * @param callSessionId - The original CallSession that triggered the callback
 * @param bdrId - BDR who owns the callback
 * @param scheduledAt - When the callback should occur
 * @param notes - Optional free-text notes
 * @returns The created ScheduledCallback record
 */
export async function scheduleCallback(
  callSessionId: string,
  bdrId: string,
  scheduledAt: Date,
  notes?: string,
): Promise<any> {
  // Look up the original call session for contact + client info
  const callSession = await prisma.callSession.findUniqueOrThrow({
    where: { id: callSessionId },
  }) as any;

  const callback = await prisma.scheduledCallback.create({
    data: {
      callSessionId,
      bdrId,
      clientId: callSession.clientId,
      campaignContactId: callSession.campaignContactId ?? undefined,
      contactName: callSession.contactName,
      contactPhone: callSession.contactPhone,
      companyName: callSession.companyName,
      scheduledAt,
      notes: notes ?? null,
      status: 'PENDING',
    },
  });

  logger.info('[CallbackService] Callback scheduled', {
    callbackId: callback.id,
    callSessionId,
    bdrId,
    scheduledAt: scheduledAt.toISOString(),
  });

  return callback;
}

/**
 * Get callbacks that are due now (scheduledAt <= now, status PENDING).
 *
 * @param bdrId - BDR to query for
 * @returns Array of due ScheduledCallback records
 */
export async function getDueCallbacks(bdrId: string): Promise<any[]> {
  const now = new Date();
  const callbacks = await prisma.scheduledCallback.findMany({
    where: {
      bdrId,
      scheduledAt: { lte: now },
      status: 'PENDING',
    },
    orderBy: { scheduledAt: 'asc' },
    include: {
      callSession: {
        select: {
          id: true,
          contactName: true,
          contactPhone: true,
          contactEmail: true,
          companyName: true,
          jobTitle: true,
          disposition: true,
        },
      },
    },
  });

  return callbacks;
}

/**
 * Mark a callback as completed.
 *
 * @param callbackId - The ScheduledCallback ID
 * @param completedCallSessionId - Optional CallSession from the completed callback call
 * @returns The updated ScheduledCallback record
 */
export async function completeCallback(
  callbackId: string,
  completedCallSessionId?: string,
): Promise<any> {
  const callback = await prisma.scheduledCallback.update({
    where: { id: callbackId },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
      completedCallSessionId: completedCallSessionId ?? null,
    },
  });

  logger.info('[CallbackService] Callback completed', {
    callbackId,
    completedCallSessionId,
  });

  return callback;
}

/**
 * Reschedule a callback to a new time, keeping status as PENDING.
 *
 * @param callbackId - The ScheduledCallback ID
 * @param newScheduledAt - The new scheduled time
 * @returns The updated ScheduledCallback record
 */
export async function rescheduleCallback(
  callbackId: string,
  newScheduledAt: Date,
): Promise<any> {
  const callback = await prisma.scheduledCallback.update({
    where: { id: callbackId },
    data: {
      scheduledAt: newScheduledAt,
      status: 'PENDING',
    },
  });

  logger.info('[CallbackService] Callback rescheduled', {
    callbackId,
    newScheduledAt: newScheduledAt.toISOString(),
  });

  return callback;
}

/**
 * List all callbacks for a BDR, optionally filtered by status.
 * Includes related call session contact info, ordered by scheduledAt desc.
 *
 * @param bdrId - BDR to query for
 * @param status - Optional status filter (PENDING, COMPLETED, MISSED)
 * @returns Array of ScheduledCallback records with related call session
 */
export async function getCallbacksByBdr(
  bdrId: string,
  status?: string,
): Promise<any[]> {
  const where: any = { bdrId };
  if (status) {
    where.status = status;
  }

  const callbacks = await prisma.scheduledCallback.findMany({
    where,
    orderBy: { scheduledAt: 'desc' },
    include: {
      callSession: {
        select: {
          id: true,
          contactName: true,
          contactPhone: true,
          contactEmail: true,
          companyName: true,
          jobTitle: true,
          disposition: true,
        },
      },
    },
  });

  return callbacks;
}

/**
 * Scan for missed callbacks: scheduledAt + 30 min < now and still PENDING.
 * Marks them as MISSED with a missedAt timestamp.
 *
 * @returns Count of newly missed callbacks
 */
export async function missedCallbackCheck(): Promise<number> {
  const threshold = new Date(Date.now() - MISSED_THRESHOLD_MS);

  const result = await prisma.scheduledCallback.updateMany({
    where: {
      status: 'PENDING',
      scheduledAt: { lt: threshold },
    },
    data: {
      status: 'MISSED',
      missedAt: new Date(),
    },
  });

  if (result.count > 0) {
    logger.info('[CallbackService] Missed callbacks detected', {
      count: result.count,
    });
  }

  return result.count;
}

/**
 * Insert a callback's contact at the top of the active session queue.
 * Shifts existing queue items' positions down by 1 to make room at position 0.
 *
 * @param callbackId - The ScheduledCallback to pull contact info from
 * @param sessionId - The active DialerSession to insert into
 * @returns The newly created DialerQueueItem
 */
export async function insertCallbackInQueue(
  callbackId: string,
  sessionId: string,
): Promise<any> {
  const callback = await prisma.scheduledCallback.findUniqueOrThrow({
    where: { id: callbackId },
    include: {
      callSession: {
        select: {
          contactName: true,
          contactEmail: true,
          contactPhone: true,
          companyName: true,
          jobTitle: true,
          campaignContactId: true,
          dialerQueueItem: { select: { hubspotContactId: true } },
        },
      },
    },
  }) as any;

  // Shift all existing PENDING items down by 1
  await prisma.dialerQueueItem.updateMany({
    where: {
      dialerSessionId: sessionId,
      status: 'PENDING',
    },
    data: {
      position: { increment: 1 },
    },
  });

  // Insert new queue item at position 0
  const queueItem = await prisma.dialerQueueItem.create({
    data: {
      dialerSessionId: sessionId,
      campaignContactId: callback.callSession.campaignContactId ?? undefined,
      contactName: callback.callSession.contactName,
      contactEmail: callback.callSession.contactEmail,
      contactPhone: callback.callSession.contactPhone,
      companyName: callback.callSession.companyName,
      jobTitle: callback.callSession.jobTitle,
      hubspotContactId: callback.callSession.dialerQueueItem?.hubspotContactId ?? null,
      position: 0,
      status: 'PENDING',
    },
  });

  logger.info('[CallbackService] Callback inserted into queue', {
    callbackId,
    sessionId,
    queueItemId: queueItem.id,
  });

  return queueItem;
}

/**
 * Detect a missed inbound call and auto-create a callback.
 * Checks if the phone number matches any CallSession or DialerQueueItem.
 * If found and the BDR is currently in an active session (on another call),
 * creates a ScheduledCallback with notes indicating MISSED_INBOUND.
 *
 * @param phoneNumber - The inbound caller's phone number
 * @param bdrId - The BDR ID to check
 * @returns The created ScheduledCallback if applicable, or null
 */
export async function detectMissedInboundCall(
  phoneNumber: string,
  bdrId: string,
): Promise<any | null> {
  // Check if phone matches any CallSession for this BDR
  const matchingCallSession = await prisma.callSession.findFirst({
    where: {
      bdrId,
      contactPhone: phoneNumber,
    },
    orderBy: { createdAt: 'desc' },
  }) as any;

  // Also check DialerQueueItem if no call session match
  let matchingQueueItem: any = null;
  if (!matchingCallSession) {
    matchingQueueItem = await prisma.dialerQueueItem.findFirst({
      where: {
        contactPhone: phoneNumber,
        dialerSession: { bdrId },
      },
      include: { dialerSession: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  if (!matchingCallSession && !matchingQueueItem) {
    return null;
  }

  // Check if BDR is in an active session (on another call)
  const activeSession = await prisma.dialerSession.findFirst({
    where: { bdrId, status: 'ACTIVE' },
  });

  if (!activeSession) {
    return null;
  }

  // Get contact info from whichever match we found
  const contactInfo = matchingCallSession
    ? {
        callSessionId: matchingCallSession.id,
        clientId: matchingCallSession.clientId,
        campaignContactId: matchingCallSession.campaignContactId,
        contactName: matchingCallSession.contactName,
        contactPhone: matchingCallSession.contactPhone,
        companyName: matchingCallSession.companyName,
      }
    : {
        callSessionId: matchingQueueItem.callSessionId,
        clientId: (matchingQueueItem.dialerSession as any).clientId,
        campaignContactId: matchingQueueItem.campaignContactId,
        contactName: matchingQueueItem.contactName,
        contactPhone: matchingQueueItem.contactPhone,
        companyName: matchingQueueItem.companyName,
      };

  // Need a valid callSessionId for the relation — use the matched one
  // If only a queue item matched without a call session, find the most recent
  // call session for this BDR to associate with
  let callSessionId = contactInfo.callSessionId;
  if (!callSessionId) {
    const recentSession = await prisma.callSession.findFirst({
      where: { bdrId },
      orderBy: { createdAt: 'desc' },
    });
    if (!recentSession) return null;
    callSessionId = recentSession.id;
  }

  const callback = await prisma.scheduledCallback.create({
    data: {
      callSessionId,
      bdrId,
      clientId: contactInfo.clientId,
      campaignContactId: contactInfo.campaignContactId ?? undefined,
      contactName: contactInfo.contactName,
      contactPhone: contactInfo.contactPhone,
      companyName: contactInfo.companyName,
      scheduledAt: new Date(), // Due now
      notes: 'MISSED_INBOUND: Inbound call received while BDR was on another call',
      status: 'PENDING',
    },
  });

  logger.info('[CallbackService] Missed inbound call detected, callback created', {
    callbackId: callback.id,
    phoneNumber,
    bdrId,
  });

  return callback;
}
