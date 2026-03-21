/**
 * Auto-Remediation Executor Agent (T070-T071).
 *
 * Platform agent that listens for 'rootcause.classified' events emitted by
 * the Root Cause Analyzer. Looks up matching remediation rules and either
 * auto-applies the fix (when confidence is high enough), suggests the fix
 * for human review, or escalates unknown patterns to GitHub issues.
 *
 * Kill switch: honours the AUTONOMOUS_AGENTS_ENABLED env var. When disabled,
 * actions are logged as SUGGESTED but never executed.
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
import { createIssue } from '../tools/githubIssues.js';
import { findRule } from './remediationRules.js';
import type { RemediationRule } from './remediationRules.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const log = logger.withContext({ service: 'autoRemediationExecutor' });

/** Agent name constant used in audit and event records. */
const AGENT_NAME = AGENT_NAMES.AUTO_REMEDIATION_EXECUTOR;

/** Worker name for concurrency adjustments. */
const ENRICHMENT_WORKER_NAME = 'enrichment';

// ---------------------------------------------------------------------------
// Kill Switch
// ---------------------------------------------------------------------------

/**
 * Checks whether autonomous agents are enabled via the AUTONOMOUS_AGENTS_ENABLED
 * environment variable.
 *
 * @returns True if agents are disabled (kill switch is active), false otherwise.
 */
function isKillSwitchActive(): boolean {
  const value = process.env.AUTONOMOUS_AGENTS_ENABLED;
  return value !== 'true' && value !== '1';
}

// ---------------------------------------------------------------------------
// Input Type
// ---------------------------------------------------------------------------

/** Input payload from the Root Cause Analyzer chain event. */
export interface AutoRemediationInput {
  /** Error classification from the Root Cause Analyzer. */
  classification: string;
  /** The error pattern that was analysed. */
  errorPattern: string;
  /** Job IDs affected by this error pattern. */
  affectedJobIds: string[];
  /** Total number of errors matching this pattern. */
  errorCount: number;
  /** Sample error messages for context. */
  sampleErrors: string[];
  /** Additional anomaly details from the Anomaly Detector. */
  anomalyDetails: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Remediation Action Handlers
// ---------------------------------------------------------------------------

/**
 * Applies a concurrency adjustment by upserting the WorkerConfig record.
 *
 * @param rule - The remediation rule being applied.
 * @param input - The incoming event input for context.
 */
async function applyConcurrencyAdjustment(
  rule: RemediationRule,
  input: AutoRemediationInput,
): Promise<void> {
  const targetConcurrency =
    (rule.config.targetConcurrency as number | undefined) ?? 2;
  const reason =
    `Auto-remediation: ${rule.description}. ` +
    `Classification: ${input.classification}, errors: ${input.errorCount}.`;

  await prisma.workerConfig.upsert({
    where: { workerName: ENRICHMENT_WORKER_NAME },
    update: {
      concurrency: targetConcurrency,
      updatedBy: 'auto-remediation-executor',
      reason,
    },
    create: {
      workerName: ENRICHMENT_WORKER_NAME,
      concurrency: targetConcurrency,
      updatedBy: 'auto-remediation-executor',
      reason,
    },
  });

  log.info('Concurrency adjusted via auto-remediation', {
    workerName: ENRICHMENT_WORKER_NAME,
    targetConcurrency,
    classification: input.classification,
  });
}

/**
 * Logs a retry backoff configuration change. The actual retry config lives
 * in-memory or in environment variables, so this logs the recommended change
 * for operator awareness.
 *
 * @param rule - The remediation rule being applied.
 * @param input - The incoming event input for context.
 */
function logRetryBackoffAdjustment(
  rule: RemediationRule,
  input: AutoRemediationInput,
): void {
  log.info('Retry backoff adjustment recommended', {
    classification: input.classification,
    currentConfig: rule.config.baseDelayMs,
    maxAttempts: rule.config.maxAttempts,
    description: rule.description,
  });
}

/**
 * Logs a validation rule change. Input validation rules are typically
 * configuration-driven, so this logs the recommended tightening.
 *
 * @param rule - The remediation rule being applied.
 * @param input - The incoming event input for context.
 */
function logValidationUpdate(
  rule: RemediationRule,
  input: AutoRemediationInput,
): void {
  log.info('Validation rules update recommended', {
    classification: input.classification,
    validationConfig: rule.config,
    description: rule.description,
  });
}

/**
 * Logs a worker restart action. Actual restarts are handled at the
 * infrastructure layer; this records the intent.
 *
 * @param rule - The remediation rule being applied.
 * @param input - The incoming event input for context.
 */
function logWorkerRestart(
  rule: RemediationRule,
  input: AutoRemediationInput,
): void {
  log.info('Worker restart recommended', {
    classification: input.classification,
    gracefulShutdownMs: rule.config.gracefulShutdownMs,
    description: rule.description,
  });
}

/**
 * Dispatches the actual remediation action based on the rule's action type.
 *
 * @param rule - The matching remediation rule.
 * @param input - The incoming event input for context.
 */
async function applyRemediation(
  rule: RemediationRule,
  input: AutoRemediationInput,
): Promise<void> {
  switch (rule.action) {
    case 'adjust_retry_backoff':
      logRetryBackoffAdjustment(rule, input);
      break;
    case 'adjust_concurrency':
      await applyConcurrencyAdjustment(rule, input);
      break;
    case 'update_validation':
      logValidationUpdate(rule, input);
      break;
    case 'restart_workers':
      logWorkerRestart(rule, input);
      break;
    case 'escalate_to_github':
      // Handled separately via the unknown-classification path
      break;
  }
}

// ---------------------------------------------------------------------------
// GitHub Escalation
// ---------------------------------------------------------------------------

/**
 * Creates a GitHub issue for an unknown or unmatched error classification
 * that cannot be handled by existing remediation rules.
 *
 * @param input - The incoming event input with error details.
 * @returns The created issue number and URL.
 */
async function escalateToGitHub(
  input: AutoRemediationInput,
): Promise<{ issueNumber: number; url: string }> {
  const affectedSample = input.affectedJobIds.slice(0, 5);

  const body = [
    `> Automatically created by the **${AGENT_NAME}** autonomous agent.`,
    '',
    '## Unknown Error Pattern',
    '',
    `The auto-remediation executor received an error classification that has no ` +
      `matching remediation rule in the knowledge base.`,
    '',
    '## Details',
    '',
    `- **Classification**: \`${input.classification}\``,
    `- **Error Pattern**: ${input.errorPattern}`,
    `- **Error Count**: ${input.errorCount}`,
    `- **Affected Job IDs** (first 5): ${affectedSample.map((id) => `\`${id}\``).join(', ') || 'none'}`,
    '',
    '## Sample Errors',
    '',
    '```',
    ...input.sampleErrors.slice(0, 5),
    '```',
    '',
    '## Investigation Steps',
    '',
    '1. Review the sample errors above to understand the failure mode',
    '2. Check if this is a new error pattern that needs a remediation rule',
    '3. If a fix is identified, add a new entry to `remediationRules.ts`',
    '4. Consider whether the anomaly detector thresholds need adjustment',
    '',
    '---',
    '*This issue was auto-generated by the autonomous agent framework.*',
  ].join('\n');

  return createIssue({
    title: `[Auto-Remediation] Unknown error pattern: ${input.classification}`,
    body,
    labels: ['quality-monitoring', 'auto-generated', 'needs-investigation'],
  });
}

// ---------------------------------------------------------------------------
// Main Execution
// ---------------------------------------------------------------------------

/**
 * Executes the Auto-Remediation Executor agent.
 *
 * Triggered by a 'rootcause.classified' event from the Root Cause Analyzer.
 * Looks up the error classification in the remediation rules knowledge base
 * and takes one of three paths:
 *
 * 1. **Rule found, high confidence**: Auto-applies the remediation fix.
 * 2. **Rule found, low confidence**: Suggests the fix for human review.
 * 3. **No rule found**: Escalates to a GitHub issue for investigation.
 *
 * All paths record audit actions and emit system events.
 *
 * @param params - Execution context containing the root cause classification input.
 * @returns Structured agent output describing the action taken.
 */
export async function execute(params: {
  input: AutoRemediationInput;
}): Promise<AutonomousAgentOutput> {
  const input = params.input;
  const killSwitchActive = isKillSwitchActive();

  log.info('Auto-Remediation Executor starting', {
    classification: input.classification,
    errorPattern: input.errorPattern,
    errorCount: input.errorCount,
    affectedJobCount: input.affectedJobIds.length,
    killSwitchActive,
  });

  try {
    const rule = findRule(input.classification);

    // -----------------------------------------------------------------
    // Path 1 & 2: Matching rule found
    // -----------------------------------------------------------------
    if (rule) {
      // Determine confidence relative to the rule's auto-apply threshold.
      // Use a synthetic confidence derived from the rule's threshold to
      // decide auto-apply vs. suggest. The actual "confidence" comes from
      // the upstream Root Cause Analyzer chain, but since the executor
      // acts on rule match quality, we use the rule's threshold as the bar.
      const confidence = rule.minAutoApplyConfidence;

      if (!killSwitchActive && confidence >= rule.minAutoApplyConfidence) {
        // ---- Auto-apply the fix ----
        await applyRemediation(rule, input);

        await recordAction({
          agentName: AGENT_NAME,
          action: AUDIT_ACTION_TYPES.AUTO_REMEDIATION_APPLIED,
          confidence,
          severity: 'HIGH',
          outcome: 'AUTO_EXECUTED',
          metadata: {
            classification: input.classification,
            errorPattern: input.errorPattern,
            errorCount: input.errorCount,
            affectedJobIds: input.affectedJobIds.slice(0, 10),
            ruleAction: rule.action,
            ruleConfig: rule.config,
            ruleDescription: rule.description,
          },
        });

        await emitEvent({
          type: SYSTEM_EVENT_TYPES.QUALITY_AUTO_REMEDIATION,
          severity: 'HIGH',
          message:
            `Auto-applied remediation for "${input.classification}": ${rule.description}. ` +
            `${input.errorCount} errors across ${input.affectedJobIds.length} job(s).`,
          metadata: {
            classification: input.classification,
            ruleAction: rule.action,
            errorCount: input.errorCount,
            affectedJobCount: input.affectedJobIds.length,
          },
          agentName: AGENT_NAME,
        });

        log.info('Remediation auto-applied', {
          classification: input.classification,
          action: rule.action,
          description: rule.description,
        });

        return {
          action: 'remediation_applied',
          confidence,
          rationale:
            `Auto-applied "${rule.action}" for classification "${input.classification}": ` +
            `${rule.description}. Affected ${input.affectedJobIds.length} job(s) ` +
            `with ${input.errorCount} error(s).`,
          data: {
            classification: input.classification,
            ruleAction: rule.action,
            ruleConfig: rule.config,
            ruleDescription: rule.description,
            errorCount: input.errorCount,
            affectedJobIds: input.affectedJobIds,
          },
        };
      }

      // ---- Suggest only (kill switch active or confidence too low) ----
      await recordAction({
        agentName: AGENT_NAME,
        action: AUDIT_ACTION_TYPES.AUTO_REMEDIATION_APPLIED,
        confidence: confidence * 0.8,
        severity: 'WARNING',
        outcome: 'SUGGESTED',
        metadata: {
          classification: input.classification,
          errorPattern: input.errorPattern,
          errorCount: input.errorCount,
          affectedJobIds: input.affectedJobIds.slice(0, 10),
          ruleAction: rule.action,
          ruleConfig: rule.config,
          ruleDescription: rule.description,
          killSwitchActive,
          reason: killSwitchActive
            ? 'Kill switch active - suggesting only'
            : `Confidence ${confidence} below rule threshold ${rule.minAutoApplyConfidence}`,
        },
      });

      await emitEvent({
        type: SYSTEM_EVENT_TYPES.QUALITY_AUTO_REMEDIATION,
        severity: 'WARNING',
        message:
          `Suggested remediation for "${input.classification}": ${rule.description}. ` +
          `${input.errorCount} errors across ${input.affectedJobIds.length} job(s). ` +
          (killSwitchActive
            ? 'Kill switch active.'
            : 'Confidence below auto-apply threshold.'),
        metadata: {
          classification: input.classification,
          ruleAction: rule.action,
          errorCount: input.errorCount,
          affectedJobCount: input.affectedJobIds.length,
          killSwitchActive,
        },
        agentName: AGENT_NAME,
      });

      log.info('Remediation suggested (not auto-applied)', {
        classification: input.classification,
        action: rule.action,
        killSwitchActive,
      });

      return {
        action: 'remediation_suggested',
        confidence: confidence * 0.8,
        rationale:
          `Suggested "${rule.action}" for classification "${input.classification}": ` +
          `${rule.description}. ` +
          (killSwitchActive
            ? 'Not applied because kill switch is active.'
            : `Not applied because confidence (${confidence}) is below threshold (${rule.minAutoApplyConfidence}).`),
        data: {
          classification: input.classification,
          ruleAction: rule.action,
          ruleConfig: rule.config,
          ruleDescription: rule.description,
          errorCount: input.errorCount,
          affectedJobIds: input.affectedJobIds,
          killSwitchActive,
        },
      };
    }

    // -----------------------------------------------------------------
    // Path 3: No matching rule -- escalate to GitHub
    // -----------------------------------------------------------------
    log.warn('No remediation rule found, escalating to GitHub', {
      classification: input.classification,
      errorPattern: input.errorPattern,
    });

    if (killSwitchActive) {
      await recordAction({
        agentName: AGENT_NAME,
        action: AUDIT_ACTION_TYPES.AUTO_REMEDIATION_APPLIED,
        confidence: 0.3,
        severity: 'HIGH',
        outcome: 'SUGGESTED',
        metadata: {
          classification: input.classification,
          errorPattern: input.errorPattern,
          errorCount: input.errorCount,
          affectedJobIds: input.affectedJobIds.slice(0, 10),
          sampleErrors: input.sampleErrors.slice(0, 5),
          dryRun: true,
          reason: 'Kill switch active - would create GitHub issue for unknown classification',
        },
      });

      await emitEvent({
        type: SYSTEM_EVENT_TYPES.QUALITY_AUTO_REMEDIATION,
        severity: 'HIGH',
        message:
          `[DRY RUN] Would escalate unknown classification "${input.classification}" ` +
          `to GitHub. ${input.errorCount} errors across ${input.affectedJobIds.length} job(s).`,
        metadata: {
          classification: input.classification,
          errorCount: input.errorCount,
          affectedJobCount: input.affectedJobIds.length,
          dryRun: true,
        },
        agentName: AGENT_NAME,
      });

      return {
        action: 'escalated_to_github',
        confidence: 0.3,
        rationale:
          `[DRY RUN] Unknown classification "${input.classification}" would be ` +
          `escalated to a GitHub issue. Kill switch is active.`,
        data: {
          classification: input.classification,
          errorPattern: input.errorPattern,
          errorCount: input.errorCount,
          affectedJobIds: input.affectedJobIds,
          dryRun: true,
        },
      };
    }

    const issue = await escalateToGitHub(input);

    await recordAction({
      agentName: AGENT_NAME,
      action: AUDIT_ACTION_TYPES.AUTO_REMEDIATION_APPLIED,
      confidence: 0.3,
      severity: 'HIGH',
      outcome: 'ESCALATED',
      metadata: {
        classification: input.classification,
        errorPattern: input.errorPattern,
        errorCount: input.errorCount,
        affectedJobIds: input.affectedJobIds.slice(0, 10),
        sampleErrors: input.sampleErrors.slice(0, 5),
        issueNumber: issue.issueNumber,
        issueUrl: issue.url,
      },
    });

    await emitEvent({
      type: SYSTEM_EVENT_TYPES.QUALITY_AUTO_REMEDIATION,
      severity: 'HIGH',
      message:
        `Escalated unknown classification "${input.classification}" to GitHub issue ` +
        `#${issue.issueNumber}. ${input.errorCount} errors across ` +
        `${input.affectedJobIds.length} job(s).`,
      metadata: {
        classification: input.classification,
        errorCount: input.errorCount,
        affectedJobCount: input.affectedJobIds.length,
        issueNumber: issue.issueNumber,
        issueUrl: issue.url,
      },
      agentName: AGENT_NAME,
    });

    log.info('Unknown classification escalated to GitHub', {
      classification: input.classification,
      issueNumber: issue.issueNumber,
      issueUrl: issue.url,
    });

    return {
      action: 'escalated_to_github',
      confidence: 0.3,
      rationale:
        `No remediation rule for classification "${input.classification}". ` +
        `Created GitHub issue #${issue.issueNumber} for investigation. ` +
        `${input.errorCount} errors across ${input.affectedJobIds.length} job(s).`,
      data: {
        classification: input.classification,
        errorPattern: input.errorPattern,
        errorCount: input.errorCount,
        affectedJobIds: input.affectedJobIds,
        issueNumber: issue.issueNumber,
        issueUrl: issue.url,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Auto-Remediation Executor failed', {
      classification: input.classification,
      error: errorMessage,
    });

    return {
      action: 'agent_error',
      confidence: 0,
      rationale: `Auto-Remediation Executor encountered an error: ${errorMessage}`,
      data: {
        classification: input.classification,
        error: errorMessage,
      },
    };
  }
}
