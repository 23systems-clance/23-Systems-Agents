/**
 * Uncallable Manager (T059 - US6 Queue Management)
 *
 * Manages uncallable contacts (DNC, removed, invalid, no phone):
 * - Check if a contact is uncallable
 * - Filter queue items for uncallable contacts pre-session
 * - Mark contacts as uncallable
 * - Re-add removed prospects (audit trail)
 */

import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

/** Uncallable reason types matching the Prisma enum. */
export type UncallableReason = 'DNC' | 'REMOVED' | 'INVALID_NUMBER' | 'NO_PHONE';

interface UncallableContact {
  id: string;
  contactPhone: string;
  contactName: string | null;
  companyName: string | null;
  reason: UncallableReason;
  createdAt: Date;
}

/**
 * Check if a contact phone number is uncallable for a client.
 *
 * Checks both UncallableContact table and ContactOptOut table.
 *
 * @param phone - Contact phone number.
 * @param clientId - ManagedClient UUID.
 * @returns Uncallable reason or null if callable.
 */
export async function checkUncallable(
  phone: string,
  clientId: string,
): Promise<{ uncallable: boolean; reason: UncallableReason | null }> {
  // Check UncallableContact table
  const uncallable: any = await prisma.uncallableContact.findFirst({
    where: {
      clientId,
      contactPhone: phone,
      reAddedAt: null, // Not re-added
    },
  });

  if (uncallable) {
    return { uncallable: true, reason: uncallable.reason as UncallableReason };
  }

  // Check ContactOptOut (DNC) table
  const optOut: any = await prisma.contactOptOut.findUnique({
    where: { phoneNumber: phone },
  });

  if (optOut) {
    return { uncallable: true, reason: 'DNC' };
  }

  return { uncallable: false, reason: null };
}

/**
 * Pre-session scan: filter queue contacts and identify uncallable ones.
 *
 * @param contacts - Array of contacts with phone numbers.
 * @param clientId - ManagedClient UUID.
 * @returns Map of phone -> UncallableReason for uncallable contacts.
 */
export async function filterQueueForUncallable(
  contacts: Array<{ phone: string; index: number }>,
  clientId: string,
): Promise<Map<number, UncallableReason>> {
  const uncallableMap = new Map<number, UncallableReason>();

  // Batch check all phones
  const phones = contacts.map((c) => c.phone);

  // Check UncallableContact table
  const uncallables: any[] = await prisma.uncallableContact.findMany({
    where: {
      clientId,
      contactPhone: { in: phones },
      reAddedAt: null,
    },
    select: { contactPhone: true, reason: true },
  });

  const uncallablePhones = new Map(
    uncallables.map((u: any) => [u.contactPhone, u.reason as UncallableReason]),
  );

  // Check ContactOptOut table
  const optOuts: any[] = await prisma.contactOptOut.findMany({
    where: { phoneNumber: { in: phones } },
    select: { phoneNumber: true },
  });

  const dncPhones = new Set(optOuts.map((o: any) => o.phoneNumber));

  // Build result map
  for (const contact of contacts) {
    if (uncallablePhones.has(contact.phone)) {
      uncallableMap.set(contact.index, uncallablePhones.get(contact.phone)!);
    } else if (dncPhones.has(contact.phone)) {
      uncallableMap.set(contact.index, 'DNC');
    } else if (!contact.phone || contact.phone.replace(/\D/g, '').length < 10) {
      uncallableMap.set(contact.index, 'INVALID_NUMBER');
    }
  }

  return uncallableMap;
}

/**
 * Mark a contact as uncallable.
 *
 * @param params - Contact details and reason.
 */
export async function markUncallable(params: {
  clientId: string;
  phoneNumber: string;
  contactName?: string;
  companyName?: string;
  reason: UncallableReason;
  markedById: string;
}): Promise<void> {
  await prisma.uncallableContact.create({
    data: {
      clientId: params.clientId,
      contactPhone: params.phoneNumber,
      contactName: params.contactName ?? null,
      companyName: params.companyName ?? null,
      reason: params.reason as any,
      source: 'manual',
      removedById: params.markedById,
    },
  });

  logger.info('[UncallableManager] Contact marked uncallable', {
    phone: params.phoneNumber,
    reason: params.reason,
    clientId: params.clientId,
  });
}

/**
 * Re-add a previously removed prospect (not DNC).
 *
 * Only contacts with reason REMOVED can be re-added. DNC contacts
 * cannot be re-added for compliance reasons.
 *
 * Uses soft delete: sets reAddedAt and reAddedById on the record
 * rather than deleting it, preserving the audit trail.
 *
 * @param uncallableId - UncallableContact UUID.
 * @param reAddedById - User ID performing the re-add.
 */
export async function reAddProspect(
  uncallableId: string,
  reAddedById: string,
): Promise<void> {
  const record: any = await prisma.uncallableContact.findUniqueOrThrow({
    where: { id: uncallableId },
  });

  if (record.reason === 'DNC') {
    throw new Error('Cannot re-add DNC contacts — compliance restriction');
  }

  if (record.reAddedAt) {
    throw new Error('Contact has already been re-added');
  }

  await prisma.uncallableContact.update({
    where: { id: uncallableId },
    data: {
      reAddedAt: new Date(),
      reAddedById,
    },
  });

  logger.info('[UncallableManager] Prospect re-added', {
    uncallableId,
    phone: record.contactPhone,
    reAddedById,
  });
}

/**
 * Check if an uncallable contact can be re-added.
 *
 * @param uncallableId - UncallableContact UUID.
 * @returns Whether re-add is allowed.
 */
export async function canReAdd(uncallableId: string): Promise<boolean> {
  const record: any = await prisma.uncallableContact.findUnique({
    where: { id: uncallableId },
  });

  if (!record) return false;
  if (record.reason === 'DNC') return false;
  if (record.reAddedAt) return false;

  return true;
}

/**
 * Get uncallable contacts for a dialer session.
 *
 * @param sessionId - DialerSession UUID.
 * @returns Array of uncallable queue items with reasons.
 */
export async function getSessionUncallables(
  sessionId: string,
): Promise<Array<{
  id: string;
  contactName: string;
  contactPhone: string;
  companyName: string | null;
  jobTitle: string | null;
  reason: string;
  canReAdd: boolean;
}>> {
  // Get SKIPPED queue items that were marked during session start
  const skippedItems: any[] = await prisma.dialerQueueItem.findMany({
    where: {
      dialerSessionId: sessionId,
      status: 'SKIPPED',
    },
    orderBy: { position: 'asc' },
  });

  // For each skipped item, determine the reason
  const results = [];
  for (const item of skippedItems) {
    const check = await checkUncallable(item.contactPhone, item.dialerSessionId);
    results.push({
      id: item.id,
      contactName: item.contactName,
      contactPhone: item.contactPhone,
      companyName: item.companyName,
      jobTitle: item.jobTitle,
      reason: check.reason ?? 'COMPLIANCE',
      canReAdd: check.reason === 'REMOVED',
    });
  }

  return results;
}
