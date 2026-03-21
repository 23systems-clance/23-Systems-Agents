/**
 * Phone enrichment quality gate.
 *
 * Checks contact state (from Apollo metadata) against Do-Not-Call state list.
 * Contacts in DNC states are blocked from phone enrichment.
 *
 * Global defaults can be overridden per-client in the future via a DB config table.
 */

import { CallStatus } from '@prisma/client';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Global DNC state list (default)
// ---------------------------------------------------------------------------

/**
 * US states where phone enrichment is blocked by default.
 * Values are uppercase full state names to match Apollo API response format.
 */
const DEFAULT_DNC_STATES: ReadonlySet<string> = new Set([
  'ARIZONA',
  'TEXAS',
  'LOUISIANA',
  'NEW JERSEY',
  'WYOMING',
  'MARYLAND',
  'OKLAHOMA',
  'FLORIDA',
]);

/**
 * Common abbreviation → full state name mapping for normalisation.
 */
const STATE_ABBREVIATIONS: Record<string, string> = {
  AZ: 'ARIZONA',
  TX: 'TEXAS',
  LA: 'LOUISIANA',
  NJ: 'NEW JERSEY',
  WY: 'WYOMING',
  MD: 'MARYLAND',
  OK: 'OKLAHOMA',
  FL: 'FLORIDA',
  // Add more as needed; only DNC-relevant ones required for now
  AL: 'ALABAMA',
  AK: 'ALASKA',
  AR: 'ARKANSAS',
  CA: 'CALIFORNIA',
  CO: 'COLORADO',
  CT: 'CONNECTICUT',
  DE: 'DELAWARE',
  GA: 'GEORGIA',
  HI: 'HAWAII',
  ID: 'IDAHO',
  IL: 'ILLINOIS',
  IN: 'INDIANA',
  IA: 'IOWA',
  KS: 'KANSAS',
  KY: 'KENTUCKY',
  ME: 'MAINE',
  MA: 'MASSACHUSETTS',
  MI: 'MICHIGAN',
  MN: 'MINNESOTA',
  MS: 'MISSISSIPPI',
  MO: 'MISSOURI',
  MT: 'MONTANA',
  NE: 'NEBRASKA',
  NV: 'NEVADA',
  NH: 'NEW HAMPSHIRE',
  NM: 'NEW MEXICO',
  NY: 'NEW YORK',
  NC: 'NORTH CAROLINA',
  ND: 'NORTH DAKOTA',
  OH: 'OHIO',
  OR: 'OREGON',
  PA: 'PENNSYLVANIA',
  RI: 'RHODE ISLAND',
  SC: 'SOUTH CAROLINA',
  SD: 'SOUTH DAKOTA',
  TN: 'TENNESSEE',
  UT: 'UTAH',
  VT: 'VERMONT',
  VA: 'VIRGINIA',
  WA: 'WASHINGTON',
  WV: 'WEST VIRGINIA',
  WI: 'WISCONSIN',
  DC: 'DISTRICT OF COLUMBIA',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QualityGateContact {
  /** JobContact ID. */
  id: string;
  /** Apollo metadata containing state info. */
  apolloMetadata?: Record<string, unknown> | null;
}

export interface QualityGateResult {
  /** Contacts cleared for phone enrichment. */
  allowed: string[];
  /** Contacts blocked (DNC state). */
  blocked: string[];
  /** Contacts with unknown state. */
  unknown: string[];
  /** Total contacts evaluated. */
  total: number;
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Normalises a state value to uppercase full state name.
 * Handles abbreviations (e.g. "FL" → "FLORIDA") and full names.
 */
function normaliseState(raw: string): string {
  const trimmed = raw.trim().toUpperCase();

  // Check if it's an abbreviation first
  if (STATE_ABBREVIATIONS[trimmed]) {
    return STATE_ABBREVIATIONS[trimmed];
  }

  return trimmed;
}

/**
 * Extracts the state from a contact's Apollo metadata.
 *
 * @returns Normalised state name or null if unavailable.
 */
function extractState(contact: QualityGateContact): string | null {
  const meta = contact.apolloMetadata;
  if (!meta) return null;

  const state = meta.state as string | undefined;
  if (!state || state.trim() === '') return null;

  return normaliseState(state);
}

/**
 * Evaluates phone enrichment eligibility for a batch of contacts.
 *
 * Checks each contact's state (from Apollo metadata) against the DNC list.
 * Updates the `callStatus` field on each JobContact record in the database.
 *
 * @param contacts - Contacts with Apollo metadata.
 * @param jobId - Job ID for logging context.
 * @returns Classification of contacts into allowed, blocked, unknown.
 */
export async function evaluatePhoneQualityGate(
  contacts: QualityGateContact[],
  jobId: string,
): Promise<QualityGateResult> {
  const allowed: string[] = [];
  const blocked: string[] = [];
  const unknown: string[] = [];

  const updates: Array<{ id: string; callStatus: CallStatus }> = [];

  for (const contact of contacts) {
    const state = extractState(contact);

    if (!state) {
      unknown.push(contact.id);
      updates.push({ id: contact.id, callStatus: 'UNKNOWN' });
    } else if (DEFAULT_DNC_STATES.has(state)) {
      blocked.push(contact.id);
      updates.push({ id: contact.id, callStatus: 'DO_NOT_CALL' });
    } else {
      allowed.push(contact.id);
      updates.push({ id: contact.id, callStatus: 'ACCEPTED_STATE' });
    }
  }

  // Batch update callStatus on all contacts
  await Promise.all(
    updates.map((u) =>
      prisma.jobContact.update({
        where: { id: u.id },
        data: { callStatus: u.callStatus },
      }),
    ),
  );

  logger.info('Phone quality gate evaluated', {
    jobId,
    total: contacts.length,
    allowed: allowed.length,
    blocked: blocked.length,
    unknown: unknown.length,
    dncStates: Array.from(DEFAULT_DNC_STATES),
  });

  return {
    allowed,
    blocked,
    unknown,
    total: contacts.length,
  };
}
