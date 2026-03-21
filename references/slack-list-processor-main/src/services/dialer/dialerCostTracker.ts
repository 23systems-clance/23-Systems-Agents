/**
 * Dialer Cost Tracker Service (T109)
 *
 * Tracks and aggregates per-call costs for the power dialer:
 * - Twilio voice: $0.013/min
 * - AMD detection: $0.0075/detection
 * - Recording storage: included (no extra charge tracked)
 * - Deepgram transcription: $0.0043/min
 *
 * Provides functions to calculate, persist, and query cost data
 * for individual calls and client-level monthly/range summaries.
 */

import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

/* ------------------------------------------------------------------ */
/*  Cost constants (USD)                                               */
/* ------------------------------------------------------------------ */

/** Twilio voice per-minute rate. */
const TWILIO_VOICE_PER_MIN = 0.013;

/** Twilio AMD (Answering Machine Detection) per-detection rate. */
const TWILIO_AMD_PER_DETECTION = 0.0075;

/** Deepgram transcription per-minute rate. */
const DEEPGRAM_TRANSCRIPTION_PER_MIN = 0.0043;

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Breakdown of costs for a single call. */
export interface CallCosts {
  /** Twilio voice cost (call duration-based). */
  twilioVoiceCost: number;
  /** Twilio AMD detection cost (flat per-detection). */
  twilioAmdCost: number;
  /** Total Twilio cost (voice + AMD). */
  twilioCostUsd: number;
  /** Deepgram transcription cost (recording duration-based). */
  deepgramCostUsd: number;
  /** Grand total across all providers. */
  totalCostUsd: number;
}

/** Input parameters for cost calculation from a call session. */
export interface CallSessionCostInput {
  /** Call duration in seconds (null if call was not answered). */
  durationSeconds: number | null;
  /** Whether AMD was used on this call. */
  amdUsed: boolean;
  /** Recording duration in seconds (null if not recorded). */
  recordingDurationSeconds: number | null;
  /** Transcription duration in seconds (null if not transcribed). */
  transcriptionDurationSeconds: number | null;
}

/** Monthly cost summary with breakdown. */
export interface MonthlyCostSummary {
  year: number;
  month: number;
  totalTwilioCostUsd: number;
  totalDeepgramCostUsd: number;
  totalCostUsd: number;
  totalCalls: number;
}

/** Date-range cost summary with category breakdown. */
export interface CostSummary {
  startDate: string;
  endDate: string;
  twilioCostUsd: number;
  deepgramCostUsd: number;
  totalCostUsd: number;
  totalCalls: number;
  avgCostPerCall: number;
  breakdown: {
    twilioVoiceCost: number;
    twilioAmdCost: number;
    deepgramTranscriptionCost: number;
  };
}

/* ------------------------------------------------------------------ */
/*  Core functions                                                     */
/* ------------------------------------------------------------------ */

/**
 * Calculate the cost breakdown for a single call session.
 *
 * Applies per-minute rates for Twilio voice and Deepgram transcription,
 * plus a flat per-detection fee for AMD. All costs are rounded to 6
 * decimal places (matching the Prisma Decimal(10,6) column).
 *
 * @param callSession - Cost-relevant fields from the call session.
 * @returns Itemised cost breakdown.
 */
export function calculateCallCosts(callSession: CallSessionCostInput): CallCosts {
  // Twilio voice cost: per-minute, rounded up to next minute
  const durationMinutes = callSession.durationSeconds
    ? Math.ceil(callSession.durationSeconds / 60)
    : 0;
  const twilioVoiceCost = round6(durationMinutes * TWILIO_VOICE_PER_MIN);

  // AMD cost: flat fee per detection
  const twilioAmdCost = callSession.amdUsed ? TWILIO_AMD_PER_DETECTION : 0;

  // Total Twilio
  const twilioCostUsd = round6(twilioVoiceCost + twilioAmdCost);

  // Deepgram transcription cost: per-minute, rounded up
  const transcriptionMinutes = callSession.transcriptionDurationSeconds
    ? Math.ceil(callSession.transcriptionDurationSeconds / 60)
    : 0;
  const deepgramCostUsd = round6(transcriptionMinutes * DEEPGRAM_TRANSCRIPTION_PER_MIN);

  const totalCostUsd = round6(twilioCostUsd + deepgramCostUsd);

  return {
    twilioVoiceCost,
    twilioAmdCost,
    twilioCostUsd,
    deepgramCostUsd,
    totalCostUsd,
  };
}

/**
 * Persist calculated costs to a CallSession record.
 *
 * Updates the twilioCostUsd and deepgramCostUsd columns on the
 * CallSession table via Prisma.
 *
 * @param callSessionId - UUID of the CallSession to update.
 * @param costs - Cost breakdown (typically from calculateCallCosts).
 */
export async function updateCallSessionCosts(
  callSessionId: string,
  costs: CallCosts,
): Promise<void> {
  try {
    await prisma.callSession.update({
      where: { id: callSessionId },
      data: {
        twilioCostUsd: costs.twilioCostUsd,
        deepgramCostUsd: costs.deepgramCostUsd,
      },
    });

    logger.info('[CostTracker] Updated call session costs', {
      callSessionId,
      twilioCostUsd: costs.twilioCostUsd,
      deepgramCostUsd: costs.deepgramCostUsd,
      totalCostUsd: costs.totalCostUsd,
    });
  } catch (error: any) {
    logger.error('[CostTracker] Failed to update call session costs', {
      callSessionId,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Aggregate costs for a client in a given calendar month.
 *
 * Uses raw SQL to SUM twilioCostUsd and deepgramCostUsd from
 * the call_sessions table, filtered by clientId and month.
 *
 * @param clientId - ManagedClient UUID.
 * @param year - Calendar year (e.g., 2026).
 * @param month - Calendar month (1-12).
 * @returns Monthly cost summary with totals and call count.
 */
export async function getClientMonthlyCosts(
  clientId: string,
  year: number,
  month: number,
): Promise<MonthlyCostSummary> {
  try {
    // Build start/end of the target month
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 1); // first day of next month

    const rows: any[] = await (prisma as any).$queryRawUnsafe(
      `
      SELECT
        COALESCE(SUM(twilio_cost_usd), 0)::float AS "totalTwilioCostUsd",
        COALESCE(SUM(deepgram_cost_usd), 0)::float AS "totalDeepgramCostUsd",
        COALESCE(SUM(twilio_cost_usd) + SUM(deepgram_cost_usd), 0)::float AS "totalCostUsd",
        COUNT(*)::int AS "totalCalls"
      FROM "call_sessions"
      WHERE "client_id" = $1
        AND "dialed_at" >= $2
        AND "dialed_at" < $3
      `,
      clientId,
      startDate,
      endDate,
    );

    const row = rows[0] || {};

    return {
      year,
      month,
      totalTwilioCostUsd: Number(row.totalTwilioCostUsd) || 0,
      totalDeepgramCostUsd: Number(row.totalDeepgramCostUsd) || 0,
      totalCostUsd: Number(row.totalCostUsd) || 0,
      totalCalls: Number(row.totalCalls) || 0,
    };
  } catch (error: any) {
    logger.error('[CostTracker] Failed to get monthly costs', {
      clientId,
      year,
      month,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Get a cost summary for a client within a date range, with category breakdown.
 *
 * Queries call_sessions for total Twilio and Deepgram costs, then estimates
 * the voice vs. AMD split using duration and AMD result data.
 *
 * @param clientId - ManagedClient UUID.
 * @param startDate - Range start (inclusive).
 * @param endDate - Range end (inclusive).
 * @returns Cost summary with per-category breakdown.
 */
export async function getCostSummary(
  clientId: string,
  startDate: Date,
  endDate: Date,
): Promise<CostSummary> {
  try {
    // Aggregate totals
    const rows: any[] = await (prisma as any).$queryRawUnsafe(
      `
      SELECT
        COALESCE(SUM(twilio_cost_usd), 0)::float AS "twilioCostUsd",
        COALESCE(SUM(deepgram_cost_usd), 0)::float AS "deepgramCostUsd",
        COALESCE(SUM(twilio_cost_usd) + SUM(deepgram_cost_usd), 0)::float AS "totalCostUsd",
        COUNT(*)::int AS "totalCalls",
        COALESCE(SUM(CEIL(duration_seconds::float / 60) * $4), 0)::float AS "twilioVoiceCost",
        COUNT(*) FILTER (WHERE amd_result IS NOT NULL)::int AS "amdDetections"
      FROM "call_sessions"
      WHERE "client_id" = $1
        AND "dialed_at" >= $2
        AND "dialed_at" <= $3
      `,
      clientId,
      startDate,
      endDate,
      TWILIO_VOICE_PER_MIN,
    );

    const row = rows[0] || {};
    const totalCalls = Number(row.totalCalls) || 0;
    const twilioCostUsd = Number(row.twilioCostUsd) || 0;
    const deepgramCostUsd = Number(row.deepgramCostUsd) || 0;
    const totalCostUsd = Number(row.totalCostUsd) || 0;
    const twilioVoiceCost = Number(row.twilioVoiceCost) || 0;
    const amdDetections = Number(row.amdDetections) || 0;
    const twilioAmdCost = round6(amdDetections * TWILIO_AMD_PER_DETECTION);

    return {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      twilioCostUsd: round6(twilioCostUsd),
      deepgramCostUsd: round6(deepgramCostUsd),
      totalCostUsd: round6(totalCostUsd),
      totalCalls,
      avgCostPerCall: totalCalls > 0 ? round6(totalCostUsd / totalCalls) : 0,
      breakdown: {
        twilioVoiceCost: round6(twilioVoiceCost),
        twilioAmdCost,
        deepgramTranscriptionCost: round6(deepgramCostUsd),
      },
    };
  } catch (error: any) {
    logger.error('[CostTracker] Failed to get cost summary', {
      clientId,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      error: error.message,
    });
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Round a number to 6 decimal places to match Decimal(10,6) precision.
 *
 * @param value - Numeric value.
 * @returns Rounded value.
 */
function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
