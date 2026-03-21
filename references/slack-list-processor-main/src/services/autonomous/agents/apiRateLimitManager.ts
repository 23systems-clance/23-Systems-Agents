/**
 * API Rate Limit Manager Agent (T052–T056).
 *
 * Platform agent that runs on a SCHEDULED trigger (every 5 min) to monitor
 * API quota utilization for BuiltWith and Apollo providers. Dynamically
 * adjusts BullMQ worker concurrency based on utilization thresholds, pauses
 * workers when quota is critically high, and escalates if fluctuations
 * exceed safe limits.
 *
 * Concurrency thresholds:
 *   - <50%  utilization → concurrency 10
 *   - 50–75%            → concurrency 5
 *   - 75–90%            → concurrency 3
 *   - >90%              → concurrency 0 (pause + auto-resume in 15 min)
 *
 * @module apiRateLimitManager
 */

import type { ApiService } from '@prisma/client';
import { prisma } from '../../../models/index.js';
import logger from '../../../lib/logger.js';
import redis from '../../../lib/redis.js';
import { adminQueue } from '../../queue/queues.js';
import { recordAction } from '../auditRecorder.js';
import { emitEvent } from '../systemEventEmitter.js';
import type { AutonomousAgentOutput } from '../../../lib/autonomous/types.js';
import {
  AGENT_NAMES,
  AUDIT_ACTION_TYPES,
  SYSTEM_EVENT_TYPES,
} from '../../../lib/autonomous/types.js';

const log = logger.withContext({ service: 'apiRateLimitManager' });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Agent name used for audit and event records. */
const AGENT_NAME = AGENT_NAMES.API_RATE_LIMIT_MANAGER;

/** BullMQ worker name for the enrichment queue. */
const ENRICHMENT_WORKER_NAME = 'enrichment';

/** Delay in milliseconds for auto-resume after pause (15 minutes). */
const AUTO_RESUME_DELAY_MS = 15 * 60 * 1000;

/** Maximum adjustments per hour before escalation. */
const MAX_ADJUSTMENTS_PER_HOUR = 5;

/** Redis key prefix for hourly adjustment counters. */
const ADJUSTMENT_COUNTER_PREFIX = 'rate-limit-adjustments';

/** Hourly quota limits per provider (requests per hour). */
const HOURLY_QUOTAS: Record<string, number> = {
  BUILTWITH: 500,
  APOLLO: 1000,
};

/**
 * Concurrency thresholds mapping utilization percentage to worker concurrency.
 * Evaluated in order; first match wins.
 */
const CONCURRENCY_THRESHOLDS = [
  { maxUtilization: 50, concurrency: 10 },
  { maxUtilization: 75, concurrency: 5 },
  { maxUtilization: 90, concurrency: 3 },
  { maxUtilization: Infinity, concurrency: 0 },
] as const;

// ---------------------------------------------------------------------------
// Utilization Calculation (T052)
// ---------------------------------------------------------------------------

/** Per-provider utilization result. */
interface ProviderUtilization {
  /** API service name. */
  service: string;
  /** Number of requests in the last hour. */
  requestCount: number;
  /** Configured hourly quota. */
  quota: number;
  /** Utilization as a percentage (0–100). */
  utilizationPct: number;
}

/**
 * Queries the ApiUsageLog table to compute hourly utilization per provider.
 *
 * @returns Array of per-provider utilization results.
 */
async function getProviderUtilizations(): Promise<ProviderUtilization[]> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const aggregations = await prisma.apiUsageLog.groupBy({
    by: ['service'],
    where: {
      createdAt: { gte: oneHourAgo },
      service: { in: ['BUILTWITH', 'APOLLO'] as ApiService[] },
    },
    _sum: { requestCount: true },
  });

  const results: ProviderUtilization[] = [];

  for (const [serviceName, quota] of Object.entries(HOURLY_QUOTAS)) {
    const agg = aggregations.find((a) => a.service === serviceName);
    const requestCount = agg?._sum?.requestCount ?? 0;
    const utilizationPct = quota > 0 ? (requestCount / quota) * 100 : 0;

    results.push({
      service: serviceName,
      requestCount,
      quota,
      utilizationPct: Math.min(utilizationPct, 100),
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Concurrency Adjustment (T053)
// ---------------------------------------------------------------------------

/**
 * Determines the optimal concurrency level based on the highest utilization
 * percentage across all providers.
 *
 * @param maxUtilizationPct - The highest utilization percentage among providers.
 * @returns The recommended concurrency value.
 */
function calculateOptimalConcurrency(maxUtilizationPct: number): number {
  for (const threshold of CONCURRENCY_THRESHOLDS) {
    if (maxUtilizationPct < threshold.maxUtilization) {
      return threshold.concurrency;
    }
  }
  return 0;
}

/**
 * Reads the current worker concurrency from the WorkerConfig table.
 *
 * @returns The current concurrency value, or null if no config exists.
 */
async function getCurrentConcurrency(): Promise<{ concurrency: number; reason: string } | null> {
  const config = await prisma.workerConfig.findUnique({
    where: { workerName: ENRICHMENT_WORKER_NAME },
  });

  if (!config) return null;

  return { concurrency: config.concurrency, reason: config.reason };
}

/**
 * Upserts the WorkerConfig with the new concurrency value and rationale.
 *
 * @param concurrency - New concurrency value.
 * @param reason - Human-readable rationale string.
 */
async function updateWorkerConcurrency(concurrency: number, reason: string): Promise<void> {
  await prisma.workerConfig.upsert({
    where: { workerName: ENRICHMENT_WORKER_NAME },
    update: {
      concurrency,
      updatedBy: 'api-rate-limit-manager',
      reason,
    },
    create: {
      workerName: ENRICHMENT_WORKER_NAME,
      concurrency,
      updatedBy: 'api-rate-limit-manager',
      reason,
    },
  });
}

// ---------------------------------------------------------------------------
// Worker Pause & Auto-Resume (T054)
// ---------------------------------------------------------------------------

/**
 * Schedules a delayed BullMQ job on the admin queue that will restore
 * the previous concurrency value after 15 minutes.
 *
 * The previous concurrency is encoded in the WorkerConfig.reason field
 * for restoration by the resume handler.
 *
 * @param previousConcurrency - The concurrency value to restore.
 */
async function scheduleAutoResume(previousConcurrency: number): Promise<void> {
  const resumeJobId = `rate-limit-resume-${Date.now()}`;

  await adminQueue.add(
    'rate-limit-resume',
    {
      workerName: ENRICHMENT_WORKER_NAME,
      restoreConcurrency: previousConcurrency,
    },
    {
      jobId: resumeJobId,
      delay: AUTO_RESUME_DELAY_MS,
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
    },
  );

  log.info('Auto-resume job scheduled', {
    resumeJobId,
    delayMs: AUTO_RESUME_DELAY_MS,
    restoreConcurrency: previousConcurrency,
  });
}

// ---------------------------------------------------------------------------
// Quota Fluctuation Escalation (T055)
// ---------------------------------------------------------------------------

/**
 * Increments the hourly adjustment counter in Redis and checks whether
 * the escalation threshold has been reached.
 *
 * Uses a Redis key with the current hour appended so counters auto-expire.
 *
 * @returns True if the escalation threshold was reached (5+ adjustments in 1 hour).
 */
async function trackAndCheckEscalation(): Promise<boolean> {
  const currentHour = new Date().toISOString().slice(0, 13); // "YYYY-MM-DDTHH"
  const key = `${ADJUSTMENT_COUNTER_PREFIX}:${currentHour}`;

  const count = await redis.incr(key);

  // Set expiry on first increment (1 hour + 5 min buffer).
  if (count === 1) {
    await redis.expire(key, 3900);
  }

  if (count >= MAX_ADJUSTMENTS_PER_HOUR) {
    log.warn('Adjustment escalation threshold reached', {
      count,
      threshold: MAX_ADJUSTMENTS_PER_HOUR,
      hour: currentHour,
    });
    return true;
  }

  return false;
}

/**
 * Checks the current hourly adjustment count without incrementing.
 *
 * @returns True if the escalation threshold has already been reached.
 */
async function isEscalated(): Promise<boolean> {
  const currentHour = new Date().toISOString().slice(0, 13);
  const key = `${ADJUSTMENT_COUNTER_PREFIX}:${currentHour}`;
  const count = await redis.get(key);

  return count !== null && parseInt(count, 10) >= MAX_ADJUSTMENTS_PER_HOUR;
}

// ---------------------------------------------------------------------------
// Audit & Event Recording (T056)
// ---------------------------------------------------------------------------

/**
 * Records an audit action and system event after a concurrency change.
 *
 * @param beforeConcurrency - Previous concurrency value.
 * @param afterConcurrency - New concurrency value.
 * @param maxUtilizationPct - Highest utilization percentage that drove the change.
 * @param providerDetails - Per-provider utilization breakdown.
 */
async function recordConcurrencyChange(
  beforeConcurrency: number,
  afterConcurrency: number,
  maxUtilizationPct: number,
  providerDetails: ProviderUtilization[],
): Promise<void> {
  const isPaused = afterConcurrency === 0;
  const actionType = isPaused
    ? AUDIT_ACTION_TYPES.CONCURRENCY_PAUSE
    : AUDIT_ACTION_TYPES.CONCURRENCY_UPDATE;

  // Audit record
  await recordAction({
    agentName: AGENT_NAME,
    action: actionType,
    confidence: 0.9,
    severity: isPaused ? 'HIGH' : 'WARNING',
    outcome: 'AUTO_EXECUTED',
    metadata: {
      beforeConcurrency,
      afterConcurrency,
      maxUtilizationPct,
      providers: providerDetails,
    },
  });

  // System event
  await emitEvent({
    type: SYSTEM_EVENT_TYPES.WORKER_CONFIG_UPDATE,
    severity: isPaused ? 'HIGH' : 'INFO',
    message: isPaused
      ? `Enrichment worker paused (utilization ${maxUtilizationPct.toFixed(1)}%). Auto-resume in 15 min.`
      : `Enrichment worker concurrency adjusted ${beforeConcurrency} -> ${afterConcurrency} (utilization ${maxUtilizationPct.toFixed(1)}%)`,
    metadata: {
      workerName: ENRICHMENT_WORKER_NAME,
      beforeConcurrency,
      afterConcurrency,
      maxUtilizationPct,
      providers: providerDetails,
    },
    agentName: AGENT_NAME,
  });
}

// ---------------------------------------------------------------------------
// Main Execution (T052 entry point)
// ---------------------------------------------------------------------------

/** Input payload for the scheduled execution. */
interface ExecuteInput {
  /** Optional override for testing. */
  input?: Record<string, unknown>;
}

/**
 * Main handler for the API Rate Limit Manager agent.
 *
 * Runs on a scheduled trigger (every 5 minutes) to:
 * 1. Query API usage aggregated by provider (BuiltWith, Apollo).
 * 2. Calculate hourly quota utilization percentage.
 * 3. Determine optimal concurrency based on utilization thresholds.
 * 4. Upsert WorkerConfig if concurrency changed.
 * 5. Schedule auto-resume if worker is paused.
 * 6. Track adjustment frequency and escalate if threshold exceeded.
 * 7. Record audit trail and system events.
 *
 * @param params - Execution context with optional input overrides.
 * @returns Structured agent output with action, confidence, and details.
 */
export async function execute(params: ExecuteInput): Promise<AutonomousAgentOutput> {
  log.info('API Rate Limit Manager agent executing');

  try {
    // Step 1: Get provider utilizations
    const utilizations = await getProviderUtilizations();
    const maxUtilization = Math.max(...utilizations.map((u) => u.utilizationPct), 0);

    log.debug('Provider utilizations calculated', {
      utilizations,
      maxUtilization,
    });

    // Step 2: Check if we're in escalated state (too many adjustments)
    const escalated = await isEscalated();
    if (escalated) {
      log.warn('Agent in escalated state — skipping auto-adjustment until admin review');

      return {
        action: 'no_action_escalated',
        confidence: 0.95,
        rationale: 'Too many adjustments in the last hour. Waiting for admin review.',
        data: {
          utilizations,
          maxUtilizationPct: maxUtilization,
          escalated: true,
        },
      };
    }

    // Step 3: Calculate optimal concurrency
    const optimalConcurrency = calculateOptimalConcurrency(maxUtilization);

    // Step 4: Compare against current WorkerConfig
    const currentConfig = await getCurrentConcurrency();
    const currentConcurrency = currentConfig?.concurrency ?? 10;

    if (optimalConcurrency === currentConcurrency) {
      log.debug('No concurrency change needed', {
        currentConcurrency,
        optimalConcurrency,
        maxUtilization,
      });

      return {
        action: 'no_change',
        confidence: 0.95,
        rationale: `Current concurrency (${currentConcurrency}) matches optimal for ${maxUtilization.toFixed(1)}% utilization.`,
        data: {
          currentConcurrency,
          optimalConcurrency,
          maxUtilizationPct: maxUtilization,
          utilizations,
        },
      };
    }

    // Step 5: Build rationale string
    const rationale = optimalConcurrency === 0
      ? `PAUSED: API utilization at ${maxUtilization.toFixed(1)}% (>90%). Previous concurrency: ${currentConcurrency}. Auto-resume in 15 min.`
      : `Concurrency adjusted ${currentConcurrency} -> ${optimalConcurrency}. API utilization at ${maxUtilization.toFixed(1)}%.`;

    // Step 6: Upsert WorkerConfig
    await updateWorkerConcurrency(optimalConcurrency, rationale);

    log.info('Worker concurrency updated', {
      workerName: ENRICHMENT_WORKER_NAME,
      before: currentConcurrency,
      after: optimalConcurrency,
      maxUtilization,
    });

    // Step 7: Schedule auto-resume if paused (T054)
    if (optimalConcurrency === 0) {
      await scheduleAutoResume(currentConcurrency);
    }

    // Step 8: Track adjustment frequency and check escalation (T055)
    const shouldEscalate = await trackAndCheckEscalation();

    if (shouldEscalate) {
      await emitEvent({
        type: SYSTEM_EVENT_TYPES.THRESHOLD_ALERT,
        severity: 'HIGH',
        message: `API Rate Limit Manager: ${MAX_ADJUSTMENTS_PER_HOUR}+ concurrency adjustments in the last hour. Auto-adjustment paused until admin review.`,
        metadata: {
          adjustmentCount: MAX_ADJUSTMENTS_PER_HOUR,
          maxUtilizationPct: maxUtilization,
          utilizations,
        },
        agentName: AGENT_NAME,
      });
    }

    // Step 9: Record audit and events (T056)
    await recordConcurrencyChange(
      currentConcurrency,
      optimalConcurrency,
      maxUtilization,
      utilizations,
    );

    return {
      action: optimalConcurrency === 0 ? 'worker_paused' : 'concurrency_adjusted',
      confidence: 0.9,
      rationale,
      data: {
        workerName: ENRICHMENT_WORKER_NAME,
        beforeConcurrency: currentConcurrency,
        afterConcurrency: optimalConcurrency,
        maxUtilizationPct: maxUtilization,
        utilizations,
        autoResumeScheduled: optimalConcurrency === 0,
        escalated: shouldEscalate,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('API Rate Limit Manager agent failed', { error: errorMessage });

    return {
      action: 'error',
      confidence: 0,
      rationale: `Agent execution failed: ${errorMessage}`,
      data: { error: errorMessage },
    };
  }
}

/**
 * Handles the auto-resume job dispatched by the admin queue worker.
 *
 * Restores the enrichment worker to its previous concurrency after a
 * rate-limit-induced pause period has elapsed.
 *
 * @param data - Job data containing the worker name and concurrency to restore.
 */
export async function handleAutoResume(data: {
  workerName: string;
  restoreConcurrency: number;
}): Promise<void> {
  log.info('Processing auto-resume', {
    workerName: data.workerName,
    restoreConcurrency: data.restoreConcurrency,
  });

  const currentConfig = await getCurrentConcurrency();

  // Only resume if the worker is still paused (concurrency 0).
  // An admin may have manually adjusted it in the meantime.
  if (currentConfig && currentConfig.concurrency !== 0) {
    log.info('Worker already resumed — skipping auto-resume', {
      currentConcurrency: currentConfig.concurrency,
    });
    return;
  }

  const reason = `Auto-resumed after 15 min pause. Restored concurrency to ${data.restoreConcurrency}.`;

  await updateWorkerConcurrency(data.restoreConcurrency, reason);

  // Record the resume action
  await recordAction({
    agentName: AGENT_NAME,
    action: AUDIT_ACTION_TYPES.CONCURRENCY_RESUME,
    confidence: 0.95,
    severity: 'WARNING',
    outcome: 'AUTO_EXECUTED',
    metadata: {
      workerName: data.workerName,
      restoredConcurrency: data.restoreConcurrency,
    },
  });

  await emitEvent({
    type: SYSTEM_EVENT_TYPES.WORKER_CONFIG_UPDATE,
    severity: 'INFO',
    message: `Enrichment worker auto-resumed with concurrency ${data.restoreConcurrency} after rate-limit pause.`,
    metadata: {
      workerName: data.workerName,
      restoredConcurrency: data.restoreConcurrency,
    },
    agentName: AGENT_NAME,
  });

  log.info('Auto-resume completed', {
    workerName: data.workerName,
    restoredConcurrency: data.restoreConcurrency,
  });
}
