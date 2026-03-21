/**
 * Remediation rules knowledge base (T072).
 *
 * Maps known error classifications from Root Cause Analyzer to
 * remediation actions for the Auto-Remediation Executor.
 */

/** A single remediation rule linking an error classification to a fix action. */
export interface RemediationRule {
  /** Error classification pattern to match. */
  classification: string;
  /** Human-readable description of the fix. */
  description: string;
  /** Action type to apply. */
  action:
    | 'adjust_retry_backoff'
    | 'adjust_concurrency'
    | 'update_validation'
    | 'restart_workers'
    | 'escalate_to_github';
  /** Configuration for the action. */
  config: Record<string, unknown>;
  /** Minimum confidence needed to auto-apply this fix (vs. suggest). */
  minAutoApplyConfidence: number;
}

/** Canonical set of remediation rules for known error classifications. */
export const REMEDIATION_RULES: RemediationRule[] = [
  {
    classification: 'api_timeout',
    description: 'Increase retry backoff for API timeouts',
    action: 'adjust_retry_backoff',
    config: {
      baseDelayMs: { from: 5000, to: 10000 },
      maxAttempts: { from: 3, to: 5 },
    },
    minAutoApplyConfidence: 0.85,
  },
  {
    classification: 'quota_exceeded',
    description: 'Reduce worker concurrency to prevent rate limit exhaustion',
    action: 'adjust_concurrency',
    config: { targetConcurrency: 2, cooldownMinutes: 30 },
    minAutoApplyConfidence: 0.9,
  },
  {
    classification: 'data_quality',
    description: 'Tighten input validation rules for domain/company names',
    action: 'update_validation',
    config: {
      stripSpecialChars: true,
      requireMinLength: 3,
      rejectKnownInvalid: true,
    },
    minAutoApplyConfidence: 0.8,
  },
  {
    classification: 'infrastructure',
    description: 'Restart affected workers with fresh connections',
    action: 'restart_workers',
    config: { gracefulShutdownMs: 5000 },
    minAutoApplyConfidence: 0.85,
  },
];

/**
 * Finds the matching remediation rule for a classification.
 * Returns undefined for unknown/unmatched classifications.
 *
 * @param classification - The error classification string from the Root Cause Analyzer.
 * @returns The matching RemediationRule, or undefined if no rule matches.
 */
export function findRule(
  classification: string,
): RemediationRule | undefined {
  return REMEDIATION_RULES.find((r) => r.classification === classification);
}
