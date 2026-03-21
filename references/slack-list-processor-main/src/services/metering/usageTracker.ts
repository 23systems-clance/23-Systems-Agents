/**
 * Usage tracking module for API metering (T046).
 *
 * Provides a wrapper around the core API usage logger that ensures
 * slackTeamId is always populated for workspace-level billing.
 */

import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';
import { checkThresholds } from '../admin/thresholdChecker.js';
import { ApiService, Prisma } from '@prisma/client';

/**
 * Mapping from public service names to Prisma ApiService enum values.
 */
const SERVICE_MAP: Record<TrackUsageParams['service'], ApiService> = {
  BUILTWITH: 'BUILTWITH',
  APOLLO: 'APOLLO',
  ANTHROPIC: 'AI_ORCHESTRATOR',
  QUALITY_GATE: 'QUALITY_GATE',
};

/**
 * Parameters for tracking API usage with workspace attribution.
 */
export interface TrackUsageParams {
  /** Job ID this usage belongs to. */
  jobId: string;
  /** Slack team/workspace ID for billing attribution (REQUIRED). */
  slackTeamId: string;
  /** External service called. */
  service: 'BUILTWITH' | 'APOLLO' | 'ANTHROPIC' | 'QUALITY_GATE';
  /** API endpoint or operation name. */
  endpoint: string;
  /** Number of requests (default: 1). */
  requestCount?: number;
  /** Vendor-specific credits consumed. */
  creditsConsumed?: number;
  /** Input tokens (LLM calls only). */
  tokensInput?: number;
  /** Output tokens (LLM calls only). */
  tokensOutput?: number;
  /** Estimated cost in USD. */
  estimatedCostUsd?: number;
  /** HTTP response status code (if applicable). */
  responseStatus?: number;
  /** Request duration in milliseconds. */
  durationMs?: number;
}

/**
 * Tracks API usage with workspace attribution and writes to ApiUsageLog.
 *
 * This is the primary entry point for logging API calls across all services.
 * It ensures slackTeamId is always captured for workspace-level metering
 * and triggers budget threshold checks when costs are incurred.
 *
 * @param params - Usage tracking parameters including slackTeamId.
 * @throws Never throws — logs errors internally to avoid disrupting caller flow.
 *
 * @example
 * ```typescript
 * await trackUsage({
 *   jobId: job.id,
 *   slackTeamId: job.slackTeamId,
 *   service: 'APOLLO',
 *   endpoint: '/v1/mixed_people/search',
 *   creditsConsumed: 25,
 *   estimatedCostUsd: 1.25,
 *   durationMs: 450,
 * });
 * ```
 */
export async function trackUsage(params: TrackUsageParams): Promise<void> {
  try {
    const costDecimal = params.estimatedCostUsd
      ? new Prisma.Decimal(params.estimatedCostUsd)
      : null;
    const creditsDecimal = params.creditsConsumed
      ? new Prisma.Decimal(params.creditsConsumed)
      : null;

    await prisma.apiUsageLog.create({
      data: {
        jobId: params.jobId,
        slackTeamId: params.slackTeamId,
        service: SERVICE_MAP[params.service],
        endpoint: params.endpoint,
        requestCount: params.requestCount ?? 1,
        creditsConsumed: creditsDecimal,
        tokensInput: params.tokensInput ?? null,
        tokensOutput: params.tokensOutput ?? null,
        estimatedCostUsd: costDecimal,
        responseStatus: params.responseStatus ?? null,
        durationMs: params.durationMs ?? null,
      },
    });

    logger.debug('API usage tracked', {
      jobId: params.jobId,
      slackTeamId: params.slackTeamId,
      service: params.service,
      endpoint: params.endpoint,
    });

    // Fire-and-forget: check budget thresholds if cost was incurred.
    if (params.estimatedCostUsd && params.estimatedCostUsd > 0) {
      checkThresholds(SERVICE_MAP[params.service], params.estimatedCostUsd).catch(() => {});
    }
  } catch (error) {
    logger.error('Failed to track API usage', {
      jobId: params.jobId,
      slackTeamId: params.slackTeamId,
      service: params.service,
      endpoint: params.endpoint,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
