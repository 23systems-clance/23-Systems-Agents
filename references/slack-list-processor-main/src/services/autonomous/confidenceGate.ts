/**
 * Confidence gate service (T018).
 *
 * Pure evaluation function that determines whether an autonomous agent's
 * recommended action should be auto-executed, suggested for review, or
 * escalated based on the agent's confidence score and configured thresholds.
 *
 * No database access -- thresholds are read from the agent's metadata JSON
 * field with fallback to the default thresholds defined in the types module.
 */

import type { Agent } from '@prisma/client';
import type {
  AutonomousAgentOutput,
  ConfidenceGateResult,
  ConfidenceThresholds,
  ConfidenceDecision,
} from '../../lib/autonomous/types.js';
import { DEFAULT_CONFIDENCE_THRESHOLDS } from '../../lib/autonomous/types.js';
import logger from '../../lib/logger.js';

const log = logger.withContext({ service: 'confidenceGate' });

/**
 * Extracts confidence thresholds from an agent's metadata JSON field.
 *
 * Falls back to DEFAULT_CONFIDENCE_THRESHOLDS when the metadata is missing,
 * malformed, or does not contain threshold values.
 *
 * @param agent - The Agent record whose metadata may contain threshold overrides.
 * @returns The resolved confidence thresholds.
 */
function resolveThresholds(agent: Agent): ConfidenceThresholds {
  try {
    // Agent metadata is stored as a Prisma Json field; cast to access properties.
    const meta = (agent as Record<string, unknown>).metadata as
      | Record<string, unknown>
      | null
      | undefined;

    if (meta && typeof meta === 'object') {
      const autoThreshold =
        typeof meta.autoThreshold === 'number'
          ? meta.autoThreshold
          : DEFAULT_CONFIDENCE_THRESHOLDS.autoThreshold;

      const suggestThreshold =
        typeof meta.suggestThreshold === 'number'
          ? meta.suggestThreshold
          : DEFAULT_CONFIDENCE_THRESHOLDS.suggestThreshold;

      return { autoThreshold, suggestThreshold };
    }
  } catch {
    // Malformed metadata -- fall through to defaults.
  }

  return { ...DEFAULT_CONFIDENCE_THRESHOLDS };
}

/**
 * Evaluates an autonomous agent's output against its confidence thresholds
 * to determine the appropriate action disposition.
 *
 * Decision logic:
 * - If the agent is in suggest-only mode, actions are never auto-executed:
 *   - confidence >= suggestThreshold => "suggest"
 *   - confidence <  suggestThreshold => "escalate"
 * - If the agent is in full-autonomy mode:
 *   - confidence >= autoThreshold    => "auto_execute"
 *   - confidence >= suggestThreshold => "suggest"
 *   - confidence <  suggestThreshold => "escalate"
 *
 * @param agent  - The Agent record (includes suggestOnlyMode flag and metadata).
 * @param output - The structured output from the agent's evaluation.
 * @returns A ConfidenceGateResult containing the decision and resolved thresholds.
 */
export function evaluateAction(
  agent: Agent,
  output: AutonomousAgentOutput,
): ConfidenceGateResult {
  const thresholds = resolveThresholds(agent);
  let decision: ConfidenceDecision;

  if (agent.suggestOnlyMode) {
    // Suggest-only mode: never auto-execute, only suggest or escalate.
    decision =
      output.confidence >= thresholds.suggestThreshold ? 'suggest' : 'escalate';
  } else {
    // Full-autonomy mode: three-tier gate.
    if (output.confidence >= thresholds.autoThreshold) {
      decision = 'auto_execute';
    } else if (output.confidence >= thresholds.suggestThreshold) {
      decision = 'suggest';
    } else {
      decision = 'escalate';
    }
  }

  log.debug('Confidence gate evaluated', {
    agentName: agent.name,
    confidence: output.confidence,
    decision,
    suggestOnlyMode: agent.suggestOnlyMode,
    autoThreshold: thresholds.autoThreshold,
    suggestThreshold: thresholds.suggestThreshold,
  });

  return { decision, thresholds };
}
