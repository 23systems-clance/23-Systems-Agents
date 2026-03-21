/**
 * Local Presence Dialing Service
 * Selects the best caller ID number for each contact based on area code matching.
 * Maximizes answer rates by showing a local number to the contact.
 *
 * Matching priority (fallback chain):
 * 1. Exact area code match from client's phone pool
 * 2. Same state match
 * 3. Client's primary number
 */

import { prisma } from '../../models/index.js';

/**
 * Select the best caller ID for a contact based on area code matching.
 *
 * @param contactPhone - Contact's phone number (E.164 format: +1XXXXXXXXXX)
 * @param clientId - ManagedClient ID for tenant isolation
 * @returns Best matching phone number in E.164 format, or null if no numbers available
 */
export async function selectCallerId(
  contactPhone: string,
  clientId: string
): Promise<string | null> {
  const contactAreaCode = extractAreaCode(contactPhone);
  if (!contactAreaCode) {
    return getPrimaryNumber(clientId);
  }

  // 1. Try exact area code match
  const exactMatch = await prisma.twilioPhoneNumber.findFirst({
    where: {
      clientId,
      areaCode: contactAreaCode,
      isActive: true,
    },
    select: { phoneNumber: true },
  });

  if (exactMatch) {
    return exactMatch.phoneNumber;
  }

  // 2. Try same state match (requires area code -> state lookup via the phone number's state field)
  const contactStateNumber = await prisma.twilioPhoneNumber.findFirst({
    where: {
      areaCode: contactAreaCode,
      isActive: true,
    },
    select: { state: true },
  });

  if (contactStateNumber?.state) {
    const stateMatch = await prisma.twilioPhoneNumber.findFirst({
      where: {
        clientId,
        state: contactStateNumber.state,
        isActive: true,
      },
      select: { phoneNumber: true },
    });

    if (stateMatch) {
      return stateMatch.phoneNumber;
    }
  }

  // 3. Fallback: client's primary number
  return getPrimaryNumber(clientId);
}

/**
 * Get the client's primary phone number.
 */
async function getPrimaryNumber(clientId: string): Promise<string | null> {
  const primary = await prisma.twilioPhoneNumber.findFirst({
    where: {
      clientId,
      isPrimary: true,
      isActive: true,
    },
    select: { phoneNumber: true },
  });

  if (primary) {
    return primary.phoneNumber;
  }

  // Last resort: any active number assigned to client
  const anyNumber = await prisma.twilioPhoneNumber.findFirst({
    where: {
      clientId,
      isActive: true,
    },
    select: { phoneNumber: true },
  });

  return anyNumber?.phoneNumber ?? null;
}

/**
 * Extract the 3-digit area code from a phone number.
 * Handles E.164 (+1XXXXXXXXXX) and domestic (XXXXXXXXXX) formats.
 */
function extractAreaCode(phone: string): string | null {
  const cleaned = phone.replace(/\D/g, '');

  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return cleaned.substring(1, 4);
  }

  if (cleaned.length === 10) {
    return cleaned.substring(0, 3);
  }

  return null;
}
