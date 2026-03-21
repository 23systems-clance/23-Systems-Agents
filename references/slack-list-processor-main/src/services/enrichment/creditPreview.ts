/**
 * Credit cost preview service (T023).
 *
 * Estimates the credit cost of an enrichment job before execution,
 * using the existing credit rate calculator. Returns a structured
 * estimate that powers the confirm/cancel/go-back UI.
 */

import { estimateJobCredits, type OperationType } from '../billing/creditRateCalculator.js';
import { getCreditBalance } from '../billing/creditManager.js';
import logger from '../../lib/logger.js';

/** Credit estimate for a pending enrichment job. */
export interface CreditEstimate {
  /** Estimated credits for this job. */
  estimatedCredits: number;
  /** Current workspace credit balance. */
  currentBalance: number;
  /** Projected balance after enrichment. */
  balanceAfter: number;
  /** Whether the workspace has insufficient credits. */
  insufficientBalance: boolean;
  /** Operation types included in the estimate. */
  operationTypes: OperationType[];
  /** Number of rows to be enriched. */
  rowCount: number;
}

/**
 * Calculates the credit estimate for a pending enrichment job.
 *
 * Uses the active CreditRateConfig to compute effective costs per
 * operation type, multiplied by row count. Compares against the
 * workspace's current credit balance.
 *
 * @param rowCount       - Number of rows in the uploaded file.
 * @param operationTypes - Enrichment operations to perform.
 * @param slackTeamId    - Workspace team ID for balance lookup.
 * @returns CreditEstimate with cost breakdown and balance check.
 */
export async function calculateCreditEstimate(
  rowCount: number,
  operationTypes: OperationType[],
  slackTeamId: string,
): Promise<CreditEstimate> {
  const [estimatedCredits, currentBalance] = await Promise.all([
    estimateJobCredits(rowCount, operationTypes),
    getCreditBalance(slackTeamId),
  ]);

  const balance = currentBalance ?? 0;
  const balanceAfter = balance - estimatedCredits;

  logger.info('Credit estimate calculated', {
    slackTeamId,
    rowCount,
    operationTypes,
    estimatedCredits,
    currentBalance: balance,
    balanceAfter,
  });

  return {
    estimatedCredits,
    currentBalance: balance,
    balanceAfter,
    insufficientBalance: balanceAfter < 0,
    operationTypes,
    rowCount,
  };
}
