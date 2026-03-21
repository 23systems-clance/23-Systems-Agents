/**
 * Anomaly Detector Agent (T066–T067).
 *
 * Platform agent that runs on a SCHEDULED trigger (every 15 minutes).
 * Queries job tables for hourly stats, detects anomalies based on
 * failure rate, match percentage, and average duration thresholds,
 * then emits an 'anomaly.detected' event for the Root Cause Analyzer
 * to consume.
 *
 * Kill switch: honours the AUTONOMOUS_AGENTS_ENABLED env var.
 */

import { prisma } from '../../../models/index.js';
import logger from '../../../lib/logger.js';
import type { AutonomousAgentOutput } from '../../../lib/autonomous/types.js';
import {
  AGENT_NAMES,
  AUDIT_ACTION_TYPES,
  SYSTEM_EVENT_TYPES,
} from '../../../lib/autonomous/types.js';
import { recordAction } from '../auditRecorder.js';
import { emitEvent } from '../systemEventEmitter.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const log = logger.withContext({ service: 'anomalyDetector' });

/** Agent name constant used in audit and event records. */
const AGENT_NAME = AGENT_NAMES.ANOMALY_DETECTOR;

/** Failure rate threshold above which an anomaly is flagged. */
const FAILURE_RATE_THRESHOLD = 0.05;

/** Match percentage threshold below which an anomaly is flagged. */
const MATCH_PERCENTAGE_THRESHOLD = 20;

/** Average job duration threshold in milliseconds (30 minutes). */
const AVG_DURATION_THRESHOLD_MS = 1_800_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Anomaly classification type emitted in the chain event data. */
type AnomalyType =
  | 'high_failure_rate'
  | 'low_match_rate'
  | 'slow_duration'
  | 'multiple';

// ---------------------------------------------------------------------------
// Hourly Stats Query
// ---------------------------------------------------------------------------

/**
 * Hourly job statistics used for anomaly detection.
 */
interface HourlyStats {
  /** Number of jobs completed in the last hour. */
  completedCount: number;
  /** Number of jobs failed in the last hour. */
  failedCount: number;
  /** Failure rate (failed / (completed + failed)), 0 if no jobs. */
  failureRate: number;
  /** Average duration of completed jobs in milliseconds, null if none. */
  avgDurationMs: number | null;
  /** Average match percentage from quality gate results, null if unavailable. */
  matchPercentage: number | null;
  /** IDs of jobs that completed or failed in the window. */
  affectedJobIds: string[];
}

/**
 * Queries the Job table for statistics within the last hour.
 *
 * - Counts completed and failed jobs
 * - Calculates failure rate
 * - Computes average duration for completed jobs
 * - Extracts match percentage from qualityGateResult JSON field
 *
 * @returns Aggregated hourly statistics.
 */
async function getHourlyStats(): Promise<HourlyStats> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  // Fetch jobs completed or failed in the last hour
  const recentJobs = await prisma.job.findMany({
    where: {
      updatedAt: { gte: oneHourAgo },
      status: { in: ['COMPLETED', 'FAILED'] },
    },
    select: {
      id: true,
      status: true,
      startedAt: true,
      completedAt: true,
      qualityGateResult: true,
    },
  });

  const completedJobs = recentJobs.filter((j) => j.status === 'COMPLETED');
  const failedJobs = recentJobs.filter((j) => j.status === 'FAILED');
  const completedCount = completedJobs.length;
  const failedCount = failedJobs.length;
  const totalCount = completedCount + failedCount;
  const failureRate = totalCount > 0 ? failedCount / totalCount : 0;

  // Calculate average duration for completed jobs with both timestamps
  let avgDurationMs: number | null = null;
  const durations: number[] = [];
  for (const job of completedJobs) {
    if (job.startedAt && job.completedAt) {
      const duration =
        new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime();
      if (duration > 0) {
        durations.push(duration);
      }
    }
  }
  if (durations.length > 0) {
    avgDurationMs =
      durations.reduce((sum, d) => sum + d, 0) / durations.length;
  }

  // Extract match percentage from qualityGateResult JSON
  // qualityGateResult typically contains { total, passed, filtered, ... }
  // match percentage = (passed / total) * 100
  let matchPercentage: number | null = null;
  const matchPercentages: number[] = [];
  for (const job of completedJobs) {
    if (job.qualityGateResult && typeof job.qualityGateResult === 'object') {
      const qgr = job.qualityGateResult as Record<string, unknown>;
      const total = typeof qgr.total === 'number' ? qgr.total : 0;
      const passed = typeof qgr.passed === 'number' ? qgr.passed : 0;
      if (total > 0) {
        matchPercentages.push((passed / total) * 100);
      }
    }
  }
  if (matchPercentages.length > 0) {
    matchPercentage =
      matchPercentages.reduce((sum, p) => sum + p, 0) / matchPercentages.length;
  }

  const affectedJobIds = recentJobs.map((j) => j.id);

  return {
    completedCount,
    failedCount,
    failureRate,
    avgDurationMs,
    matchPercentage,
    affectedJobIds,
  };
}

// ---------------------------------------------------------------------------
// Anomaly Detection
// ---------------------------------------------------------------------------

/** An individual anomaly finding. */
interface AnomalyFinding {
  /** Classification of this specific anomaly. */
  type: Exclude<AnomalyType, 'multiple'>;
  /** Human-readable description. */
  description: string;
  /** How far above/below the threshold the metric is (0-1). */
  severity: number;
}

/**
 * Evaluates hourly stats against anomaly thresholds.
 *
 * @param stats - Aggregated hourly job statistics.
 * @returns Array of anomaly findings (empty if no anomalies detected).
 */
function detectAnomalies(stats: HourlyStats): AnomalyFinding[] {
  const findings: AnomalyFinding[] = [];

  // Check failure rate
  if (stats.failureRate > FAILURE_RATE_THRESHOLD) {
    const severityFactor = Math.min(
      (stats.failureRate - FAILURE_RATE_THRESHOLD) / FAILURE_RATE_THRESHOLD,
      1,
    );
    findings.push({
      type: 'high_failure_rate',
      description: `Failure rate ${(stats.failureRate * 100).toFixed(1)}% exceeds ${(FAILURE_RATE_THRESHOLD * 100).toFixed(1)}% threshold`,
      severity: severityFactor,
    });
  }

  // Check match percentage (only if data is available)
  if (
    stats.matchPercentage !== null &&
    stats.matchPercentage < MATCH_PERCENTAGE_THRESHOLD
  ) {
    const severityFactor = Math.min(
      (MATCH_PERCENTAGE_THRESHOLD - stats.matchPercentage) /
        MATCH_PERCENTAGE_THRESHOLD,
      1,
    );
    findings.push({
      type: 'low_match_rate',
      description: `Match percentage ${stats.matchPercentage.toFixed(1)}% below ${MATCH_PERCENTAGE_THRESHOLD}% threshold`,
      severity: severityFactor,
    });
  }

  // Check average duration (only if data is available)
  if (
    stats.avgDurationMs !== null &&
    stats.avgDurationMs > AVG_DURATION_THRESHOLD_MS
  ) {
    const severityFactor = Math.min(
      (stats.avgDurationMs - AVG_DURATION_THRESHOLD_MS) /
        AVG_DURATION_THRESHOLD_MS,
      1,
    );
    findings.push({
      type: 'slow_duration',
      description: `Average duration ${(stats.avgDurationMs / 60_000).toFixed(1)} min exceeds ${(AVG_DURATION_THRESHOLD_MS / 60_000).toFixed(0)} min threshold`,
      severity: severityFactor,
    });
  }

  return findings;
}

/**
 * Calculates a confidence score based on the number and severity of anomalies.
 *
 * - Multiple anomalies yield higher confidence.
 * - Single borderline anomalies yield lower confidence.
 * - No anomalies yield 0 confidence.
 *
 * @param findings - Array of anomaly findings.
 * @returns Confidence score between 0 and 1.
 */
function calculateConfidence(findings: AnomalyFinding[]): number {
  if (findings.length === 0) return 0;

  // Average severity of all findings
  const avgSeverity =
    findings.reduce((sum, f) => sum + f.severity, 0) / findings.length;

  // Multiple anomalies boost confidence
  const countBoost = Math.min(findings.length * 0.15, 0.3);

  // Base confidence from average severity
  const baseConfidence = 0.5 + avgSeverity * 0.3;

  return Math.min(baseConfidence + countBoost, 0.99);
}

/**
 * Determines the overall anomaly type from the findings.
 *
 * @param findings - Array of anomaly findings.
 * @returns The composite anomaly type.
 */
function classifyAnomalyType(findings: AnomalyFinding[]): AnomalyType {
  if (findings.length > 1) return 'multiple';
  if (findings.length === 1) return findings[0].type;
  return 'high_failure_rate'; // fallback, should not reach here
}

// ---------------------------------------------------------------------------
// Main Execution
// ---------------------------------------------------------------------------

/**
 * Executes the Anomaly Detector agent.
 *
 * Runs on a 15-minute schedule to scan job tables for hourly anomalies.
 * Detects high failure rates, low match percentages, and slow durations.
 * When anomalies are found, records an audit action and emits an
 * 'anomaly.detected' system event for the Root Cause Analyzer chain.
 *
 * Output data conforms to the chain event contract (T067):
 * - anomalyType: classification of the anomaly
 * - failureRate, avgDurationMs, matchPercentage: raw metrics
 * - affectedJobIds: IDs of jobs in the anomaly window
 * - timeWindowStart, timeWindowEnd: ISO date bounds
 *
 * @param params - Input parameters (optional overrides via input field).
 * @returns An AutonomousAgentOutput summarising the detection result.
 */
export async function execute(params: {
  input?: Record<string, unknown>;
}): Promise<AutonomousAgentOutput> {
  // Kill switch check
  if (process.env.AUTONOMOUS_AGENTS_ENABLED === 'false') {
    log.info('Anomaly Detector agent skipped — kill switch active');
    return {
      action: 'skipped',
      confidence: 1.0,
      rationale: 'Autonomous agents disabled via kill switch.',
      data: { killSwitch: true },
    };
  }

  log.info('Anomaly Detector agent starting');

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const timeWindowStart = oneHourAgo.toISOString();
  const timeWindowEnd = now.toISOString();

  try {
    // Step 1: Gather hourly stats
    const stats = await getHourlyStats();

    log.info('Hourly stats computed', {
      completedCount: stats.completedCount,
      failedCount: stats.failedCount,
      failureRate: stats.failureRate,
      avgDurationMs: stats.avgDurationMs,
      matchPercentage: stats.matchPercentage,
      jobCount: stats.affectedJobIds.length,
    });

    // Step 2: Detect anomalies
    const findings = detectAnomalies(stats);

    if (findings.length === 0) {
      log.info('No anomalies detected');
      return {
        action: 'no_anomaly',
        confidence: 1.0,
        rationale: 'All metrics within normal thresholds.',
        data: {
          failureRate: stats.failureRate,
          avgDurationMs: stats.avgDurationMs,
          matchPercentage: stats.matchPercentage,
          jobCount: stats.completedCount + stats.failedCount,
          timeWindowStart,
          timeWindowEnd,
        },
      };
    }

    // Step 3: Calculate confidence and classify
    const confidence = calculateConfidence(findings);
    const anomalyType = classifyAnomalyType(findings);
    const descriptions = findings.map((f) => f.description).join('; ');

    log.warn('Anomaly detected', {
      anomalyType,
      confidence,
      findingCount: findings.length,
      descriptions,
    });

    // T067: Chain event data format for Root Cause Analyzer
    const chainData = {
      anomalyType,
      failureRate: stats.failureRate,
      avgDurationMs: stats.avgDurationMs ?? 0,
      matchPercentage: stats.matchPercentage,
      affectedJobIds: stats.affectedJobIds,
      timeWindowStart,
      timeWindowEnd,
      findings: findings.map((f) => ({
        type: f.type,
        description: f.description,
        severity: f.severity,
      })),
    };

    // Step 4: Record audit action
    await recordAction({
      agentName: AGENT_NAME,
      action: AUDIT_ACTION_TYPES.ANOMALY_DETECTED,
      confidence,
      severity: confidence > 0.8 ? 'HIGH' : 'WARNING',
      outcome: 'AUTO_EXECUTED',
      metadata: chainData,
    });

    // Step 5: Emit system event for chain consumption
    await emitEvent({
      type: SYSTEM_EVENT_TYPES.QUALITY_AUTO_REMEDIATION,
      severity: confidence > 0.8 ? 'HIGH' : 'WARNING',
      message: `Anomaly detected: ${descriptions}`,
      metadata: chainData,
      agentName: AGENT_NAME,
    });

    log.info('Anomaly Detector agent completed', {
      anomalyType,
      confidence,
      affectedJobCount: stats.affectedJobIds.length,
    });

    return {
      action: 'anomaly_detected',
      confidence,
      rationale: `Anomaly detected: ${descriptions}`,
      data: chainData,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Anomaly Detector agent failed', { error: errorMessage });

    return {
      action: 'agent_error',
      confidence: 0,
      rationale: `Anomaly Detector encountered an error: ${errorMessage}`,
      data: { error: errorMessage },
    };
  }
}
