/**
 * Root Cause Analyzer Agent (T068–T069).
 *
 * Platform agent triggered by the 'anomaly.detected' event emitted by
 * the Anomaly Detector. Queries CloudWatch error logs for the anomaly
 * time window, classifies the dominant error pattern, and emits a
 * 'rootcause.classified' event for the Auto-Remediation Executor.
 *
 * Error classifications:
 *   - 'api_timeout': HTTP/connection timeout errors
 *   - 'invalid_domain': DNS resolution failures, invalid URLs
 *   - 'quota_exceeded': 429 status codes, rate limit errors
 *   - 'data_quality': Validation failures, malformed data
 *   - 'infrastructure': OOM, container failures
 *   - 'unknown': Unclassifiable patterns
 *
 * Kill switch: honours the AUTONOMOUS_AGENTS_ENABLED env var.
 */

import logger from '../../../lib/logger.js';
import type { AutonomousAgentOutput } from '../../../lib/autonomous/types.js';
import {
  AGENT_NAMES,
  AUDIT_ACTION_TYPES,
  SYSTEM_EVENT_TYPES,
} from '../../../lib/autonomous/types.js';
import { queryErrorLogs } from '../tools/cloudWatchLogs.js';
import type { LogEntry } from '../tools/cloudWatchLogs.js';
import { recordAction } from '../auditRecorder.js';
import { emitEvent } from '../systemEventEmitter.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const log = logger.withContext({ service: 'rootCauseAnalyzer' });

/** Agent name constant used in audit and event records. */
const AGENT_NAME = AGENT_NAMES.ROOT_CAUSE_ANALYZER;

/** CloudWatch log group for fetching error context. */
const LOG_GROUP = process.env.CW_LOG_GROUP ?? '/ecs/prod-slack-list-processor';

/** Maximum number of sample error messages to include in output. */
const MAX_SAMPLE_ERRORS = 3;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Root cause classification categories. */
type RootCauseClassification =
  | 'api_timeout'
  | 'invalid_domain'
  | 'quota_exceeded'
  | 'data_quality'
  | 'infrastructure'
  | 'unknown';

/** Input data expected from the Anomaly Detector chain event. */
interface AnomalyInput {
  /** Classification of the anomaly. */
  anomalyType: string;
  /** Failure rate metric. */
  failureRate: number;
  /** Average job duration in milliseconds. */
  avgDurationMs: number;
  /** Match percentage, or null if unavailable. */
  matchPercentage: number | null;
  /** IDs of affected jobs. */
  affectedJobIds: string[];
  /** ISO date string for the start of the anomaly window. */
  timeWindowStart: string;
  /** ISO date string for the end of the anomaly window. */
  timeWindowEnd: string;
}

// ---------------------------------------------------------------------------
// Error Pattern Classification
// ---------------------------------------------------------------------------

/**
 * Pattern definitions for classifying error log entries.
 * Each entry maps a classification to an array of regex patterns.
 */
const ERROR_PATTERNS: Record<
  Exclude<RootCauseClassification, 'unknown'>,
  RegExp[]
> = {
  api_timeout: [
    /timeout/i,
    /ETIMEDOUT/i,
    /ESOCKETTIMEDOUT/i,
    /ECONNABORTED/i,
    /ECONNRESET/i,
    /socket hang up/i,
    /request timeout/i,
    /connect timeout/i,
    /AbortError/i,
    /network timeout/i,
  ],
  invalid_domain: [
    /ENOTFOUND/i,
    /DNS/i,
    /getaddrinfo/i,
    /invalid.*url/i,
    /invalid.*domain/i,
    /ERR_INVALID_URL/i,
    /hostname.*not.*found/i,
    /name.*resolution/i,
  ],
  quota_exceeded: [
    /429/,
    /rate.?limit/i,
    /too many requests/i,
    /quota.*exceeded/i,
    /throttl/i,
    /API.*limit/i,
    /credit.*exhaust/i,
    /billing.*limit/i,
  ],
  data_quality: [
    /validation.*fail/i,
    /malformed/i,
    /invalid.*data/i,
    /parse.*error/i,
    /unexpected.*token/i,
    /schema.*mismatch/i,
    /required.*field/i,
    /type.*error/i,
    /cannot.*read.*propert/i,
    /undefined.*is.*not/i,
  ],
  infrastructure: [
    /OOM/i,
    /out of memory/i,
    /OutOfMemory/i,
    /container.*kill/i,
    /SIGKILL/i,
    /SIGTERM/i,
    /exit.*code.*137/i,
    /exit.*code.*139/i,
    /disk.*full/i,
    /no.*space/i,
    /heap.*overflow/i,
    /allocation.*fail/i,
  ],
};

/** A classified error with its category and count. */
interface ClassifiedPattern {
  /** The root cause classification. */
  classification: RootCauseClassification;
  /** Number of log entries matching this classification. */
  count: number;
  /** The specific patterns that matched. */
  matchedPatterns: string[];
  /** Sample error messages (up to MAX_SAMPLE_ERRORS). */
  sampleMessages: string[];
}

/**
 * Classifies error log entries against known error patterns.
 *
 * Each log entry is tested against all pattern categories. A single
 * entry can only match one category (first match wins, in order of
 * pattern definition priority).
 *
 * @param entries - Parsed CloudWatch log entries.
 * @returns Array of classified patterns sorted by count (descending).
 */
function classifyErrorPatterns(entries: LogEntry[]): ClassifiedPattern[] {
  const buckets = new Map<
    RootCauseClassification,
    { count: number; matchedPatterns: Set<string>; samples: string[] }
  >();

  for (const entry of entries) {
    const text = `${entry.message} ${entry.error}`;
    let matched = false;

    for (const [classification, patterns] of Object.entries(ERROR_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          const bucket = buckets.get(
            classification as RootCauseClassification,
          ) ?? {
            count: 0,
            matchedPatterns: new Set<string>(),
            samples: [],
          };

          bucket.count++;
          bucket.matchedPatterns.add(pattern.source);
          if (bucket.samples.length < MAX_SAMPLE_ERRORS) {
            bucket.samples.push(
              entry.message.length > 200
                ? entry.message.slice(0, 200) + '...'
                : entry.message,
            );
          }

          buckets.set(
            classification as RootCauseClassification,
            bucket,
          );

          matched = true;
          break; // First classification match wins for this entry
        }
      }
      if (matched) break;
    }

    // If no pattern matched, count as unknown
    if (!matched) {
      const bucket = buckets.get('unknown') ?? {
        count: 0,
        matchedPatterns: new Set<string>(),
        samples: [],
      };
      bucket.count++;
      if (bucket.samples.length < MAX_SAMPLE_ERRORS) {
        bucket.samples.push(
          entry.message.length > 200
            ? entry.message.slice(0, 200) + '...'
            : entry.message,
        );
      }
      buckets.set('unknown', bucket);
    }
  }

  // Convert to array and sort by count descending
  const results: ClassifiedPattern[] = [];
  for (const [classification, bucket] of buckets) {
    results.push({
      classification,
      count: bucket.count,
      matchedPatterns: Array.from(bucket.matchedPatterns),
      sampleMessages: bucket.samples,
    });
  }

  results.sort((a, b) => b.count - a.count);
  return results;
}

/**
 * Calculates confidence based on pattern classification clarity.
 *
 * - Dominant single pattern = high confidence
 * - Mixed patterns with no clear winner = lower confidence
 * - All unknown = low confidence
 *
 * @param patterns - Classified error patterns sorted by count.
 * @param totalEntries - Total number of log entries analyzed.
 * @returns Confidence score between 0 and 1.
 */
function calculateClassificationConfidence(
  patterns: ClassifiedPattern[],
  totalEntries: number,
): number {
  if (patterns.length === 0 || totalEntries === 0) return 0.3;

  const dominant = patterns[0];

  // If the dominant pattern is 'unknown', confidence is lower
  if (dominant.classification === 'unknown') return 0.3;

  // Dominance ratio: how much of the total does the top pattern cover
  const dominanceRatio = dominant.count / totalEntries;

  // Base confidence from dominance
  if (dominanceRatio >= 0.8) return 0.95;
  if (dominanceRatio >= 0.6) return 0.85;
  if (dominanceRatio >= 0.4) return 0.7;
  if (dominanceRatio >= 0.2) return 0.55;

  return 0.4;
}

/**
 * Generates a human-readable error pattern description.
 *
 * @param classification - The dominant root cause classification.
 * @param patterns - All classified error patterns.
 * @returns A description string.
 */
function buildErrorPatternDescription(
  classification: RootCauseClassification,
  patterns: ClassifiedPattern[],
): string {
  const descriptions: Record<RootCauseClassification, string> = {
    api_timeout:
      'HTTP/connection timeouts detected — external API calls failing to respond',
    invalid_domain:
      'DNS resolution failures — invalid or unreachable domain names in input data',
    quota_exceeded:
      'API rate limits or quota exceeded — providers throttling requests',
    data_quality:
      'Data validation failures — malformed or unexpected input data',
    infrastructure:
      'Infrastructure failures — memory exhaustion or container crashes',
    unknown:
      'Unclassifiable error patterns — manual investigation recommended',
  };

  const baseDesc = descriptions[classification];
  const totalErrors = patterns.reduce((sum, p) => sum + p.count, 0);
  const dominantCount = patterns[0]?.count ?? 0;
  const dominancePercent =
    totalErrors > 0
      ? ((dominantCount / totalErrors) * 100).toFixed(0)
      : '0';

  return `${baseDesc} (${dominancePercent}% of ${totalErrors} errors)`;
}

// ---------------------------------------------------------------------------
// Main Execution
// ---------------------------------------------------------------------------

/**
 * Executes the Root Cause Analyzer agent.
 *
 * Triggered by the 'anomaly.detected' event from the Anomaly Detector.
 * Queries CloudWatch for error logs in the anomaly time window, classifies
 * error patterns, and emits a 'rootcause.classified' event with the
 * classification details for the Auto-Remediation Executor (T069).
 *
 * Output data conforms to the chain event contract:
 * - classification: the dominant error pattern category
 * - errorPattern: human-readable description
 * - affectedJobIds: IDs of affected jobs
 * - errorCount: total errors found
 * - sampleErrors: first 3 error messages
 * - timeWindowStart, timeWindowEnd: ISO date bounds
 * - anomalyDetails: pass-through of the input anomaly data
 *
 * @param params - Input parameters containing anomaly details from the chain.
 * @returns An AutonomousAgentOutput summarising the classification result.
 */
export async function execute(params: {
  input?: Record<string, unknown>;
}): Promise<AutonomousAgentOutput> {
  // Kill switch check
  if (process.env.AUTONOMOUS_AGENTS_ENABLED === 'false') {
    log.info('Root Cause Analyzer agent skipped — kill switch active');
    return {
      action: 'skipped',
      confidence: 1.0,
      rationale: 'Autonomous agents disabled via kill switch.',
      data: { killSwitch: true },
    };
  }

  log.info('Root Cause Analyzer agent starting');

  // Extract anomaly details from chain input
  const input = (params.input ?? {}) as Partial<AnomalyInput>;
  const anomalyType = input.anomalyType ?? 'unknown';
  const affectedJobIds = input.affectedJobIds ?? [];
  const timeWindowStart =
    input.timeWindowStart ?? new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const timeWindowEnd = input.timeWindowEnd ?? new Date().toISOString();

  log.info('Processing anomaly', {
    anomalyType,
    affectedJobCount: affectedJobIds.length,
    timeWindowStart,
    timeWindowEnd,
  });

  try {
    // Step 1: Query CloudWatch for error logs in the anomaly window
    const startTime = new Date(timeWindowStart).getTime();
    const endTime = new Date(timeWindowEnd).getTime();

    let errorLogs: LogEntry[] = [];
    try {
      errorLogs = await queryErrorLogs({
        logGroupName: LOG_GROUP,
        startTime,
        endTime,
        limit: 200,
      });
    } catch (logError) {
      log.warn('Failed to query CloudWatch error logs', {
        error:
          logError instanceof Error ? logError.message : String(logError),
      });
      // Continue with empty logs — we can still classify from anomaly context
    }

    log.info('Error logs retrieved', { count: errorLogs.length });

    // Step 2: Classify error patterns
    const patterns = classifyErrorPatterns(errorLogs);

    // Step 3: Determine dominant classification
    let classification: RootCauseClassification = 'unknown';
    let sampleErrors: string[] = [];
    let errorCount = errorLogs.length;

    if (patterns.length > 0) {
      classification = patterns[0].classification;
      sampleErrors = patterns[0].sampleMessages.slice(0, MAX_SAMPLE_ERRORS);
    }

    // If no log entries found, infer from anomaly type
    if (errorLogs.length === 0) {
      classification = inferFromAnomalyType(anomalyType);
      errorCount = 0;
    }

    // Step 4: Calculate confidence
    const confidence = calculateClassificationConfidence(patterns, errorLogs.length);
    const errorPattern = buildErrorPatternDescription(classification, patterns);

    log.info('Root cause classified', {
      classification,
      confidence,
      errorCount,
      patternCount: patterns.length,
    });

    // T069: Chain event data format for Auto-Remediation Executor
    const chainData = {
      classification,
      errorPattern,
      affectedJobIds,
      errorCount,
      sampleErrors,
      timeWindowStart,
      timeWindowEnd,
      anomalyDetails: input as Record<string, unknown>,
    };

    // Step 5: Record audit action
    await recordAction({
      agentName: AGENT_NAME,
      action: AUDIT_ACTION_TYPES.ROOT_CAUSE_CLASSIFIED,
      confidence,
      severity: confidence > 0.8 ? 'HIGH' : 'WARNING',
      outcome: 'AUTO_EXECUTED',
      metadata: {
        ...chainData,
        allPatterns: patterns.map((p) => ({
          classification: p.classification,
          count: p.count,
          matchedPatterns: p.matchedPatterns,
        })),
      },
    });

    // Step 6: Emit system event for chain consumption
    await emitEvent({
      type: SYSTEM_EVENT_TYPES.QUALITY_AUTO_REMEDIATION,
      severity: confidence > 0.8 ? 'HIGH' : 'WARNING',
      message: `Root cause classified as '${classification}': ${errorPattern}`,
      metadata: chainData,
      agentName: AGENT_NAME,
    });

    log.info('Root Cause Analyzer agent completed', {
      classification,
      confidence,
      errorCount,
    });

    return {
      action: 'root_cause_classified',
      confidence,
      rationale: `Root cause classified as '${classification}': ${errorPattern}`,
      data: chainData,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Root Cause Analyzer agent failed', { error: errorMessage });

    return {
      action: 'agent_error',
      confidence: 0,
      rationale: `Root Cause Analyzer encountered an error: ${errorMessage}`,
      data: { error: errorMessage },
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Infers a root cause classification from the anomaly type when no log
 * entries are available for pattern matching.
 *
 * @param anomalyType - The anomaly type from the Anomaly Detector.
 * @returns A best-guess root cause classification.
 */
function inferFromAnomalyType(anomalyType: string): RootCauseClassification {
  switch (anomalyType) {
    case 'high_failure_rate':
      return 'api_timeout'; // Most common cause of bulk failures
    case 'low_match_rate':
      return 'data_quality'; // Low matches usually signal bad input
    case 'slow_duration':
      return 'api_timeout'; // Slow jobs often caused by timeouts
    case 'multiple':
      return 'unknown'; // Multiple anomalies need manual investigation
    default:
      return 'unknown';
  }
}
