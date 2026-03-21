/**
 * Cost calculation utilities for waterfall enrichment (Feature 27).
 *
 * Calculates costs based on ProviderCost configuration table
 * and generates cost breakdowns per provider and data type.
 */

import { Provider, DataType } from '@prisma/client';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

export interface CostBreakdown {
  provider: Provider;
  dataType: DataType;
  count: number;
  costPerUnit: number;
  subtotal: number;
}

export interface JobCostSummary {
  jobId: string;
  breakdowns: CostBreakdown[];
  grandTotal: number;
  emailTotal: number;
  phoneTotal: number;
  providersUsed: Provider[];
}

/**
 * Get current cost per unit for a provider and data type.
 *
 * @param provider - Provider enum
 * @param dataType - Data type enum
 * @returns Cost in USD per successful enrichment
 */
export async function getCostPerUnit(
  provider: Provider,
  dataType: DataType,
): Promise<number> {
  // Find current pricing (effectiveDate <= now, expiresAt = null or > now)
  const pricing = await prisma.providerCost.findFirst({
    where: {
      provider,
      dataType,
      effectiveDate: { lte: new Date() },
      OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
    },
    orderBy: { effectiveDate: 'desc' },
  });

  if (!pricing) {
    logger.warn('No pricing found for provider, using default', {
      provider,
      dataType,
    });
    return 0; // Fallback to zero cost (prevents errors)
  }

  return pricing.costPerUnit;
}

/**
 * Calculate total cost for successful enrichments.
 *
 * @param provider - Provider that performed enrichment
 * @param dataType - Type of data enriched
 * @param successCount - Number of successful enrichments
 * @returns Total cost in USD
 */
export async function calculateCost(
  provider: Provider,
  dataType: DataType,
  successCount: number,
): Promise<number> {
  if (successCount === 0) {
    return 0;
  }

  const costPerUnit = await getCostPerUnit(provider, dataType);
  return costPerUnit * successCount;
}

/**
 * Get comprehensive cost breakdown for a job.
 *
 * Queries ProviderAttempt table and aggregates costs by provider and data type.
 *
 * @param jobId - Job UUID
 * @returns Cost summary with breakdowns
 */
export async function getCostBreakdown(
  jobId: string,
): Promise<JobCostSummary> {
  // Get all successful attempts for this job
  const attempts = await prisma.providerAttempt.findMany({
    where: {
      jobId,
      status: 'SUCCESS',
    },
    select: {
      provider: true,
      dataType: true,
      cost: true,
    },
  });

  // Group by provider and data type
  const grouped = new Map<string, CostBreakdown>();

  for (const attempt of attempts) {
    const key = `${attempt.provider}:${attempt.dataType}`;
    const existing = grouped.get(key);

    if (existing) {
      existing.count += 1;
      existing.subtotal += attempt.cost ?? 0;
    } else {
      grouped.set(key, {
        provider: attempt.provider,
        dataType: attempt.dataType,
        count: 1,
        costPerUnit: attempt.cost ?? 0,
        subtotal: attempt.cost ?? 0,
      });
    }
  }

  const breakdowns = Array.from(grouped.values());

  // Calculate totals
  const grandTotal = breakdowns.reduce((sum, b) => sum + b.subtotal, 0);
  const emailTotal = breakdowns
    .filter((b) => b.dataType === 'EMAIL')
    .reduce((sum, b) => sum + b.subtotal, 0);
  const phoneTotal = breakdowns
    .filter((b) => b.dataType === 'PHONE')
    .reduce((sum, b) => sum + b.subtotal, 0);

  const providersUsed = Array.from(
    new Set(breakdowns.map((b) => b.provider)),
  );

  return {
    jobId,
    breakdowns,
    grandTotal,
    emailTotal,
    phoneTotal,
    providersUsed,
  };
}

/**
 * Format cost breakdown as human-readable string for Slack notifications.
 *
 * Example: "Emails: Apollo (60 @ $0.05 = $3.00), Wiza (25 @ $0.05 = $1.25) | Total: $4.25"
 *
 * @param summary - Job cost summary
 * @returns Formatted string
 */
export function formatCostBreakdown(summary: JobCostSummary): string {
  const emailBreakdowns = summary.breakdowns.filter(
    (b) => b.dataType === 'EMAIL',
  );
  const phoneBreakdowns = summary.breakdowns.filter(
    (b) => b.dataType === 'PHONE',
  );

  const parts: string[] = [];

  if (emailBreakdowns.length > 0) {
    const emailParts = emailBreakdowns
      .map(
        (b) =>
          `${b.provider} (${b.count} @ $${b.costPerUnit.toFixed(2)} = $${b.subtotal.toFixed(2)})`,
      )
      .join(', ');
    parts.push(`Emails: ${emailParts}`);
  }

  if (phoneBreakdowns.length > 0) {
    const phoneParts = phoneBreakdowns
      .map(
        (b) =>
          `${b.provider} (${b.count} @ $${b.costPerUnit.toFixed(2)} = $${b.subtotal.toFixed(2)})`,
      )
      .join(', ');
    parts.push(`Phones: ${phoneParts}`);
  }

  if (parts.length > 0) {
    parts.push(`Total: $${summary.grandTotal.toFixed(2)}`);
    return parts.join(' | ');
  }

  return 'No enrichment costs incurred';
}

/**
 * Update job total cost from provider attempts.
 *
 * @param jobId - Job UUID
 * @returns Updated total cost
 */
export async function updateJobTotalCost(jobId: string): Promise<number> {
  const summary = await getCostBreakdown(jobId);

  await prisma.job.update({
    where: { id: jobId },
    data: {
      totalCost: summary.grandTotal,
      providersUsed: summary.providersUsed.map(String),
    },
  });

  return summary.grandTotal;
}
