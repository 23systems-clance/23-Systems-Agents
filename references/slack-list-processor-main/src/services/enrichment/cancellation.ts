/**
 * Enrichment job cancellation service (T026).
 *
 * Handles cancellation of enrichment jobs with pro-rated credit
 * refunds. Supports both pre-start (full refund) and in-progress
 * (partial refund for unprocessed rows) cancellation.
 */

import { prisma } from '../../models/index.js';
import { addCredits } from '../billing/creditManager.js';
import logger from '../../lib/logger.js';

/** Result of a job cancellation attempt. */
export interface CancelJobResult {
  success: boolean;
  /** Credits refunded to the workspace. */
  creditsRefunded: number;
  /** Number of rows completed before cancellation. */
  rowsCompleted: number;
  /** Total rows in the job. */
  totalRows: number;
  /** Error message if cancellation failed. */
  error?: string;
}

/**
 * Cancels an enrichment job and refunds pro-rated credits.
 *
 * For PENDING jobs: full credit refund (no work done).
 * For PROCESSING jobs: refund credits for unprocessed rows only.
 * For COMPLETED/CANCELLED jobs: no action (already finished).
 *
 * @param jobId       - Job ID to cancel.
 * @param slackTeamId - Workspace team ID for credit refund.
 * @returns CancelJobResult with refund details.
 */
export async function cancelJob(
  jobId: string,
  slackTeamId: string,
): Promise<CancelJobResult> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      status: true,
      sourceRowCount: true,
      companiesProcessed: true,
      totalCost: true,
      slackTeamId: true,
    },
  });

  if (!job) {
    return { success: false, creditsRefunded: 0, rowsCompleted: 0, totalRows: 0, error: 'Job not found' };
  }

  if (job.slackTeamId !== slackTeamId) {
    return { success: false, creditsRefunded: 0, rowsCompleted: 0, totalRows: 0, error: 'Unauthorized' };
  }

  if (job.status === 'COMPLETED' || job.status === 'CANCELLED') {
    return {
      success: false,
      creditsRefunded: 0,
      rowsCompleted: job.companiesProcessed ?? 0,
      totalRows: job.sourceRowCount ?? 0,
      error: `Job is already ${job.status.toLowerCase()}`,
    };
  }

  const totalRows = job.sourceRowCount ?? 0;
  const processedRows = job.companiesProcessed ?? 0;
  const totalCreditsUsed = Math.round(job.totalCost ?? 0);

  // Calculate refund: pro-rate based on unprocessed rows
  let creditsToRefund = 0;
  if (processedRows === 0) {
    // Pre-start: full refund
    creditsToRefund = totalCreditsUsed;
  } else if (processedRows < totalRows && totalRows > 0) {
    // In-progress: refund proportional to unprocessed rows
    const completionRatio = processedRows / totalRows;
    const creditsForCompleted = Math.ceil(totalCreditsUsed * completionRatio);
    creditsToRefund = totalCreditsUsed - creditsForCompleted;
  }
  // If all rows processed, no refund

  // Mark job as cancelled
  await prisma.job.update({
    where: { id: jobId },
    data: { status: 'CANCELLED' },
  });

  // Refund credits
  if (creditsToRefund > 0) {
    await addCredits(
      slackTeamId,
      creditsToRefund,
      jobId,
      `Refund for cancelled enrichment job (${processedRows}/${totalRows} rows completed)`,
      'MANUAL_ADJUSTMENT',
    );
  }

  logger.info('Enrichment job cancelled', {
    jobId,
    slackTeamId,
    processedRows,
    totalRows,
    creditsRefunded: creditsToRefund,
  });

  return {
    success: true,
    creditsRefunded: creditsToRefund,
    rowsCompleted: processedRows,
    totalRows,
  };
}
