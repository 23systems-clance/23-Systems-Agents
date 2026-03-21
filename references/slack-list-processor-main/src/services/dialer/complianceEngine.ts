/**
 * Compliance Engine
 * Handles TCPA time-of-day enforcement, two-party consent checks,
 * opt-out list verification, and compliance event logging.
 */

import { prisma } from '../../models/index.js';
import { isTwoPartyConsentState } from '../../data/compliance/two-party-consent-states.js';
import { getTimezoneForAreaCode, getStateForAreaCode } from '../../data/compliance/area-code-timezone-map.js';
import type { ComplianceCheckResult } from '../../types/dialer.js';

/** TCPA calling window: 8 AM to 9 PM in contact's local time. */
const TCPA_START_HOUR = 8;
const TCPA_END_HOUR = 21; // 9 PM

/** Minimum cooldown between calls to the same number (hours). */
const CALL_COOLDOWN_HOURS = 24;

/**
 * Run a full compliance check for a contact before dialing.
 * Checks TCPA time window, opt-out status, cooldown period, and two-party consent.
 *
 * @param phoneNumber - Contact's phone number (E.164)
 * @param clientId - ManagedClient ID
 * @param bdrId - BDR ID (for logging)
 * @returns ComplianceCheckResult with eligibility and reasons
 */
export async function checkCompliance(
  phoneNumber: string,
  clientId: string,
  bdrId?: string
): Promise<ComplianceCheckResult> {
  const reasons: string[] = [];
  let tcpaBlocked = false;
  let optedOut = false;
  let cooldownActive = false;
  let twoPartyConsentRequired = false;

  // 1. TCPA time-of-day check
  const areaCode = extractAreaCode(phoneNumber);
  if (areaCode) {
    const timezone = getTimezoneForAreaCode(areaCode);
    if (timezone && !isWithinTcpaWindow(timezone)) {
      tcpaBlocked = true;
      reasons.push(`Outside TCPA calling window (8 AM - 9 PM) in ${timezone}`);

      await logComplianceEvent({
        eventType: 'TCPA_WINDOW_BLOCKED',
        phoneNumber,
        contactState: getStateForAreaCode(areaCode) ?? undefined,
        details: `Blocked: outside ${TCPA_START_HOUR}:00-${TCPA_END_HOUR}:00 in ${timezone}`,
        clientId,
        bdrId,
      });
    }

    // 2. Two-party consent check
    const state = getStateForAreaCode(areaCode);
    if (state && isTwoPartyConsentState(state)) {
      twoPartyConsentRequired = true;
    }
  }

  // 3. Opt-out list check
  const optOut = await prisma.contactOptOut.findUnique({
    where: { phoneNumber: normalizePhone(phoneNumber) },
  });

  if (optOut) {
    optedOut = true;
    reasons.push(`Contact opted out: ${optOut.reason ?? 'DNC'}`);

    await logComplianceEvent({
      eventType: 'OPT_OUT_BLOCKED',
      phoneNumber,
      details: `Blocked: opt-out recorded on ${optOut.createdAt.toISOString()} via ${optOut.source}`,
      clientId,
      bdrId,
    });
  }

  // 4. 24-hour cooldown check
  const recentCall = await prisma.callSession.findFirst({
    where: {
      contactPhone: normalizePhone(phoneNumber),
      clientId,
      dialedAt: {
        gte: new Date(Date.now() - CALL_COOLDOWN_HOURS * 60 * 60 * 1000),
      },
      status: { not: 'SKIPPED' },
    },
    select: { dialedAt: true },
    orderBy: { dialedAt: 'desc' },
  });

  if (recentCall) {
    cooldownActive = true;
    reasons.push(`Called within last ${CALL_COOLDOWN_HOURS} hours (${recentCall.dialedAt?.toISOString()})`);
  }

  const eligible = !tcpaBlocked && !optedOut && !cooldownActive;

  return {
    eligible,
    reasons,
    tcpaBlocked,
    optedOut,
    cooldownActive,
    twoPartyConsentRequired,
  };
}

/**
 * Batch compliance check for an array of contacts.
 * Used during session creation to pre-scan the queue.
 *
 * @param contacts - Array of { phoneNumber, campaignContactId }
 * @param clientId - ManagedClient ID
 * @returns Map of phoneNumber -> ComplianceCheckResult
 */
export async function batchComplianceCheck(
  contacts: Array<{ phoneNumber: string; id: string }>,
  clientId: string
): Promise<Map<string, ComplianceCheckResult>> {
  const results = new Map<string, ComplianceCheckResult>();

  // Batch fetch opt-outs
  const phoneNumbers = contacts.map(c => normalizePhone(c.phoneNumber));
  const optOuts = await prisma.contactOptOut.findMany({
    where: { phoneNumber: { in: phoneNumbers } },
    select: { phoneNumber: true },
  });
  const optOutSet = new Set(optOuts.map((o: any) => o.phoneNumber));

  // Batch fetch recent calls (within cooldown period)
  const recentCalls = await prisma.callSession.findMany({
    where: {
      contactPhone: { in: phoneNumbers },
      clientId,
      dialedAt: {
        gte: new Date(Date.now() - CALL_COOLDOWN_HOURS * 60 * 60 * 1000),
      },
      status: { not: 'SKIPPED' },
    },
    select: { contactPhone: true },
    distinct: ['contactPhone'],
  });
  const recentCallSet = new Set(recentCalls.map((c: any) => c.contactPhone));

  for (const contact of contacts) {
    const normalized = normalizePhone(contact.phoneNumber);
    const areaCode = extractAreaCode(contact.phoneNumber);
    const reasons: string[] = [];
    let tcpaBlocked = false;
    let optedOut = false;
    let cooldownActive = false;
    let twoPartyConsentRequired = false;

    // TCPA check
    if (areaCode) {
      const timezone = getTimezoneForAreaCode(areaCode);
      if (timezone && !isWithinTcpaWindow(timezone)) {
        tcpaBlocked = true;
        reasons.push(`Outside TCPA window in ${timezone}`);
      }

      const state = getStateForAreaCode(areaCode);
      if (state && isTwoPartyConsentState(state)) {
        twoPartyConsentRequired = true;
      }
    }

    // Opt-out check
    if (optOutSet.has(normalized)) {
      optedOut = true;
      reasons.push('Contact opted out (DNC)');
    }

    // Cooldown check
    if (recentCallSet.has(normalized)) {
      cooldownActive = true;
      reasons.push(`Called within last ${CALL_COOLDOWN_HOURS} hours`);
    }

    results.set(contact.id, {
      eligible: !tcpaBlocked && !optedOut && !cooldownActive,
      reasons,
      tcpaBlocked,
      optedOut,
      cooldownActive,
      twoPartyConsentRequired,
    });
  }

  return results;
}

/**
 * Log a compliance event to the audit trail.
 */
export async function logComplianceEvent(event: {
  eventType: string;
  phoneNumber?: string;
  contactState?: string;
  details?: string;
  clientId: string;
  bdrId?: string;
  callSessionId?: string;
}): Promise<void> {
  await prisma.complianceLog.create({
    data: {
      eventType: event.eventType as any,
      phoneNumber: event.phoneNumber,
      contactState: event.contactState,
      details: event.details,
      clientId: event.clientId,
      bdrId: event.bdrId,
      callSessionId: event.callSessionId,
    },
  });
}

/**
 * Check if the current time is within the TCPA calling window
 * for a given timezone (8 AM - 9 PM local time).
 */
function isWithinTcpaWindow(timezone: string): boolean {
  const now = new Date();
  const localTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  const hour = localTime.getHours();
  return hour >= TCPA_START_HOUR && hour < TCPA_END_HOUR;
}

/**
 * Extract 3-digit area code from a phone number.
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

// --- Two-Party Consent Disclosure TwiML (T113) ---

/**
 * US states that require two-party consent for call recording.
 */
const TWO_PARTY_CONSENT_STATES = new Set([
  'CA', 'CT', 'FL', 'IL', 'MD', 'MA', 'MT', 'NH', 'PA', 'WA', 'HI',
]);

const CONSENT_DISCLOSURE_TEXT =
  'This call may be recorded for quality assurance and training purposes.';

/**
 * Generate a TwiML <Say> disclosure for two-party consent states.
 * Returns null if the state does not require disclosure.
 *
 * @param contactState - Two-letter US state code
 * @returns TwiML XML string or null
 */
export function generateConsentDisclosureTwiML(contactState: string | null): string | null {
  if (!contactState || !TWO_PARTY_CONSENT_STATES.has(contactState.toUpperCase())) {
    return null;
  }
  return `<Response><Say voice="Polly.Joanna">${CONSENT_DISCLOSURE_TEXT}</Say></Response>`;
}

/**
 * Determine if a phone number belongs to a two-party consent state.
 *
 * @param phoneNumber - E.164 format phone number
 * @returns true if disclosure is required
 */
export function requiresConsentDisclosure(phoneNumber: string): boolean {
  const areaCode = extractAreaCode(phoneNumber);
  if (!areaCode) return false;
  const state = getStateForAreaCode(areaCode);
  return state ? TWO_PARTY_CONSENT_STATES.has(state) : false;
}

/**
 * Normalize phone number to E.164 format for consistent lookups.
 */
function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10) {
    return `+1${cleaned}`;
  }
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+${cleaned}`;
  }
  return phone;
}
