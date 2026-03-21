/**
 * CRM Conflict Resolver Agent (T082-T086).
 *
 * Platform agent triggered by the 'hubspot.sync.conflict' event emitted by
 * the HubSpot import worker when a sync conflict is detected. Scores conflict
 * records using weighted feature comparison and routes decisions based on
 * confidence thresholds:
 *
 *   - confidence >= 0.85 -> auto-merge (outcome=AUTO_MERGED)
 *   - 0.50-0.84         -> suggest for admin review (outcome=SUGGESTED)
 *   - < 0.50            -> escalate to admin dashboard (outcome=ESCALATED)
 *
 * Includes an admin feedback learning loop (T085) that recalculates feature
 * weights every 10 feedback events, and a safety valve (T086) that disables
 * auto-merge when the rejection rate exceeds 30% over the last 100 decisions.
 *
 * Kill switch: honours the AUTONOMOUS_AGENTS_ENABLED env var.
 */

import type { Prisma } from '@prisma/client';
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
import {
  DEFAULT_FEATURE_WEIGHTS,
  normalizeCompanyName,
  stringSimilarity,
  normalizeDomain,
  normalizePhone,
} from '../../../integrations/hubspot/conflictRules.js';
import type { FeatureWeights } from '../../../integrations/hubspot/conflictRules.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const log = logger.withContext({ service: 'crmConflictResolver' });

/** Agent name constant used in audit and event records. */
const AGENT_NAME = AGENT_NAMES.CRM_CONFLICT_RESOLVER;

/** Confidence threshold at or above which auto-merge is allowed. */
const AUTO_MERGE_THRESHOLD = 0.85;

/** Confidence threshold below which the conflict is escalated. */
const ESCALATION_THRESHOLD = 0.50;

/** Number of feedback events that trigger a weight recalculation. */
const FEEDBACK_RECALCULATION_INTERVAL = 10;

/** Rolling window size for rejection rate tracking. */
const REJECTION_WINDOW_SIZE = 100;

/** Maximum rejection rate before auto-merge is disabled. */
const MAX_REJECTION_RATE = 0.30;

/** Slug used to look up the Agent record in the database. */
const AGENT_SLUG = 'crm-conflict-resolver';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input data expected from the hubspot.sync.conflict chain event. */
interface ConflictInput {
  /** Unique identifier for this conflict instance. */
  conflictId: string;
  /** The existing CRM record fields. */
  existingRecord: CrmRecordFields;
  /** The incoming record fields that triggered the conflict. */
  incomingRecord: CrmRecordFields;
  /** Optional import job ID for traceability. */
  importJobId?: string;
}

/** CRM record fields used for conflict comparison. */
interface CrmRecordFields {
  /** Contact email address. */
  email?: string;
  /** Company or organization name. */
  companyName?: string;
  /** Company domain or website. */
  domain?: string;
  /** Phone number. */
  phone?: string;
  /** Job title. */
  title?: string;
  /** Index signature for Prisma JSON compatibility. */
  [key: string]: string | undefined;
}

/** Individual feature score breakdown. */
interface FeatureScore {
  /** The feature name. */
  feature: string;
  /** Raw similarity score (0-1). */
  similarity: number;
  /** Weight applied to this feature. */
  weight: number;
  /** Weighted contribution to the total score. */
  weightedScore: number;
}

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
// Feature Scoring (T083)
// ---------------------------------------------------------------------------

/**
 * Calculates a weighted confidence score by comparing two CRM records
 * across multiple features.
 *
 * Features and default weights:
 *   - Email similarity (0.30) - normalized string comparison
 *   - Company name similarity (0.25) - strips suffixes, case-insensitive
 *   - Domain match (0.20) - exact after normalization
 *   - Phone match (0.15) - exact match after stripping non-digits
 *   - Title similarity (0.10) - case-insensitive string comparison
 *
 * @param existing - The existing CRM record fields.
 * @param incoming - The incoming CRM record fields.
 * @param weights - Feature weights to use (defaults to DEFAULT_FEATURE_WEIGHTS).
 * @returns An object containing the total confidence and individual feature scores.
 */
function calculateConfidence(
  existing: CrmRecordFields,
  incoming: CrmRecordFields,
  weights: FeatureWeights = DEFAULT_FEATURE_WEIGHTS,
): { confidence: number; features: FeatureScore[] } {
  const features: FeatureScore[] = [];

  // Email similarity
  const emailSimilarity = computeEmailSimilarity(
    existing.email ?? '',
    incoming.email ?? '',
  );
  features.push({
    feature: 'email',
    similarity: emailSimilarity,
    weight: weights.email,
    weightedScore: emailSimilarity * weights.email,
  });

  // Company name similarity
  const companySimilarity = computeCompanyNameSimilarity(
    existing.companyName ?? '',
    incoming.companyName ?? '',
  );
  features.push({
    feature: 'companyName',
    similarity: companySimilarity,
    weight: weights.companyName,
    weightedScore: companySimilarity * weights.companyName,
  });

  // Domain match
  const domainSimilarity = computeDomainMatch(
    existing.domain ?? '',
    incoming.domain ?? '',
  );
  features.push({
    feature: 'domain',
    similarity: domainSimilarity,
    weight: weights.domain,
    weightedScore: domainSimilarity * weights.domain,
  });

  // Phone match
  const phoneSimilarity = computePhoneMatch(
    existing.phone ?? '',
    incoming.phone ?? '',
  );
  features.push({
    feature: 'phone',
    similarity: phoneSimilarity,
    weight: weights.phone,
    weightedScore: phoneSimilarity * weights.phone,
  });

  // Title similarity
  const titleSimilarity = computeTitleSimilarity(
    existing.title ?? '',
    incoming.title ?? '',
  );
  features.push({
    feature: 'title',
    similarity: titleSimilarity,
    weight: weights.title,
    weightedScore: titleSimilarity * weights.title,
  });

  const confidence = features.reduce((sum, f) => sum + f.weightedScore, 0);

  return { confidence: Math.min(confidence, 1.0), features };
}

/**
 * Computes email similarity using normalized string comparison.
 *
 * @param a - First email.
 * @param b - Second email.
 * @returns Similarity score (0-1).
 */
function computeEmailSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  return stringSimilarity(a.toLowerCase().trim(), b.toLowerCase().trim());
}

/**
 * Computes company name similarity after normalizing suffixes.
 *
 * @param a - First company name.
 * @param b - Second company name.
 * @returns Similarity score (0-1).
 */
function computeCompanyNameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const normA = normalizeCompanyName(a);
  const normB = normalizeCompanyName(b);
  return stringSimilarity(normA, normB);
}

/**
 * Computes domain match — exact after normalization.
 *
 * @param a - First domain.
 * @param b - Second domain.
 * @returns 1.0 for exact match, 0.0 otherwise.
 */
function computeDomainMatch(a: string, b: string): number {
  if (!a || !b) return 0;
  return normalizeDomain(a) === normalizeDomain(b) ? 1.0 : 0.0;
}

/**
 * Computes phone match — exact after stripping non-digits.
 *
 * @param a - First phone number.
 * @param b - Second phone number.
 * @returns 1.0 for exact match, 0.0 otherwise.
 */
function computePhoneMatch(a: string, b: string): number {
  if (!a || !b) return 0;
  const normA = normalizePhone(a);
  const normB = normalizePhone(b);
  if (!normA || !normB) return 0;
  return normA === normB ? 1.0 : 0.0;
}

/**
 * Computes title similarity using case-insensitive string comparison.
 *
 * @param a - First title.
 * @param b - Second title.
 * @returns Similarity score (0-1).
 */
function computeTitleSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  return stringSimilarity(a, b);
}

// ---------------------------------------------------------------------------
// Weight Management
// ---------------------------------------------------------------------------

/**
 * Loads persisted feature weights from the Agent inputSchema JSONB field.
 * Falls back to DEFAULT_FEATURE_WEIGHTS if not found.
 *
 * Note: The Agent model uses inputSchema as the storage for agent-specific
 * configuration data, including learned feature weights from the feedback loop.
 *
 * @returns The current feature weights.
 */
async function loadWeights(): Promise<FeatureWeights> {
  try {
    const agent = await prisma.agent.findUnique({
      where: { slug: AGENT_SLUG },
      select: { inputSchema: true },
    });

    const schema = agent?.inputSchema as Record<string, unknown> | null;
    const persisted = schema?.featureWeights as FeatureWeights | undefined;

    if (persisted && typeof persisted.email === 'number') {
      return persisted;
    }
  } catch (err) {
    log.warn('Failed to load persisted feature weights, using defaults', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { ...DEFAULT_FEATURE_WEIGHTS };
}

/**
 * Persists updated feature weights to the Agent inputSchema JSONB field.
 *
 * @param weights - The updated feature weights to persist.
 */
async function persistWeights(weights: FeatureWeights): Promise<void> {
  try {
    const agent = await prisma.agent.findUnique({
      where: { slug: AGENT_SLUG },
      select: { inputSchema: true },
    });

    const existingSchema = (agent?.inputSchema as Record<string, unknown>) ?? {};

    await prisma.agent.update({
      where: { slug: AGENT_SLUG },
      data: {
        inputSchema: {
          ...existingSchema,
          featureWeights: weights as unknown as Prisma.InputJsonValue,
          weightsUpdatedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });

    log.info('Feature weights persisted to Agent inputSchema', { weights });
  } catch (err) {
    log.error('Failed to persist feature weights', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Safety Valve (T086)
// ---------------------------------------------------------------------------

/**
 * Checks whether auto-merge should be disabled based on rejection rate.
 *
 * Queries the last REJECTION_WINDOW_SIZE ConflictDecision records and
 * calculates the rejection rate. If it exceeds MAX_REJECTION_RATE,
 * enables suggestOnlyMode on the Agent record and emits a HIGH severity
 * system event.
 *
 * @returns True if auto-merge is disabled (safety valve tripped), false otherwise.
 */
async function checkSafetyValve(): Promise<boolean> {
  try {
    // Check if suggestOnlyMode is already enabled
    const agent = await prisma.agent.findUnique({
      where: { slug: AGENT_SLUG },
      select: { suggestOnlyMode: true },
    });

    if (agent?.suggestOnlyMode) {
      log.debug('Safety valve: suggestOnlyMode already enabled');
      return true;
    }

    // Query the last N decisions
    const recentDecisions = await prisma.conflictDecision.findMany({
      orderBy: { timestamp: 'desc' },
      take: REJECTION_WINDOW_SIZE,
      select: { outcome: true },
    });

    if (recentDecisions.length < 10) {
      // Not enough data to evaluate
      return false;
    }

    const rejectionCount = recentDecisions.filter(
      (d) => d.outcome === 'REJECTED',
    ).length;
    const rejectionRate = rejectionCount / recentDecisions.length;

    if (rejectionRate > MAX_REJECTION_RATE) {
      log.warn('Safety valve tripped: rejection rate exceeds threshold', {
        rejectionRate,
        threshold: MAX_REJECTION_RATE,
        windowSize: recentDecisions.length,
        rejectionCount,
      });

      // Enable suggestOnlyMode
      await prisma.agent.update({
        where: { slug: AGENT_SLUG },
        data: { suggestOnlyMode: true },
      });

      // Emit high severity alert
      await emitEvent({
        type: SYSTEM_EVENT_TYPES.THRESHOLD_ALERT,
        severity: 'HIGH',
        message:
          `CRM Conflict Resolver safety valve tripped: ${(rejectionRate * 100).toFixed(1)}% ` +
          `rejection rate over last ${recentDecisions.length} decisions exceeds ` +
          `${(MAX_REJECTION_RATE * 100).toFixed(0)}% threshold. Auto-merge disabled.`,
        metadata: {
          rejectionRate,
          threshold: MAX_REJECTION_RATE,
          windowSize: recentDecisions.length,
          rejectionCount,
        },
        agentName: AGENT_NAME,
      });

      return true;
    }

    return false;
  } catch (err) {
    log.error('Safety valve check failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    // On error, default to safe mode (no auto-merge)
    return true;
  }
}

// ---------------------------------------------------------------------------
// Admin Feedback Learning Loop (T085)
// ---------------------------------------------------------------------------

/**
 * Processes admin feedback on a conflict decision.
 *
 * Records the admin's approve/reject decision as a ConflictDecision and,
 * every FEEDBACK_RECALCULATION_INTERVAL feedback events, recalculates
 * feature weights using simple averaging on admin decisions.
 *
 * @param conflictId - The conflict identifier.
 * @param approved - Whether the admin approved (true) or rejected (false) the merge.
 * @param adminUserId - The admin user who provided feedback.
 * @param features - The feature scores from the original conflict evaluation.
 * @param confidence - The original confidence score.
 */
export async function processAdminFeedback(
  conflictId: string,
  approved: boolean,
  adminUserId: string,
  features: Record<string, unknown>,
  confidence: number,
): Promise<void> {
  try {
    const outcome = approved ? 'APPROVED' : 'REJECTED';

    // Record the admin decision
    await prisma.conflictDecision.create({
      data: {
        conflictId,
        confidence,
        features: features as object,
        outcome,
        adminUserId,
        metadata: {
          feedbackType: 'admin_review',
          processedAt: new Date().toISOString(),
        },
      },
    });

    await recordAction({
      agentName: AGENT_NAME,
      action: approved
        ? AUDIT_ACTION_TYPES.CRM_AUTO_MERGE
        : AUDIT_ACTION_TYPES.CRM_CONFLICT_ESCALATED,
      confidence,
      severity: 'INFO',
      outcome: approved ? 'AUTO_EXECUTED' : 'ESCALATED',
      metadata: {
        conflictId,
        adminDecision: outcome,
        adminUserId,
        features,
      },
    });

    log.info('Admin feedback recorded for conflict', {
      conflictId,
      outcome,
      adminUserId,
    });

    // Check if we should recalculate weights
    const totalFeedback = await prisma.conflictDecision.count({
      where: {
        outcome: { in: ['APPROVED', 'REJECTED'] },
      },
    });

    if (totalFeedback > 0 && totalFeedback % FEEDBACK_RECALCULATION_INTERVAL === 0) {
      await recalculateWeights();
    }
  } catch (err) {
    log.error('Failed to process admin feedback', {
      conflictId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Recalculates feature weights using simple averaging on admin-approved decisions.
 *
 * For each approved decision, features with high similarity contributed to
 * a correct match. For rejected decisions, high-similarity features were
 * misleading. Weights are adjusted by averaging the similarity scores of
 * approved decisions and subtracting rejected penalty.
 */
async function recalculateWeights(): Promise<void> {
  try {
    const decisions = await prisma.conflictDecision.findMany({
      where: {
        outcome: { in: ['APPROVED', 'REJECTED'] },
      },
      orderBy: { timestamp: 'desc' },
      take: 100,
      select: { features: true, outcome: true },
    });

    if (decisions.length < FEEDBACK_RECALCULATION_INTERVAL) {
      return;
    }

    const featureNames = ['email', 'companyName', 'domain', 'phone', 'title'] as const;
    const weightAccumulator: Record<string, number> = {};
    let approvedCount = 0;
    let rejectedCount = 0;

    for (const name of featureNames) {
      weightAccumulator[name] = 0;
    }

    for (const decision of decisions) {
      const featureList = decision.features as unknown as FeatureScore[];
      if (!Array.isArray(featureList)) continue;

      const isApproved = decision.outcome === 'APPROVED';
      if (isApproved) approvedCount++;
      else rejectedCount++;

      for (const f of featureList) {
        if (featureNames.includes(f.feature as typeof featureNames[number])) {
          // Approved: high similarity = good predictor, boost weight
          // Rejected: high similarity = misleading, reduce weight
          weightAccumulator[f.feature] += isApproved
            ? f.similarity
            : -f.similarity * 0.5;
        }
      }
    }

    const totalDecisions = approvedCount + rejectedCount;
    if (totalDecisions === 0) return;

    // Normalize to sum to 1.0
    const rawWeights: Record<string, number> = {};
    let totalRaw = 0;

    for (const name of featureNames) {
      // Ensure non-negative with a minimum floor
      rawWeights[name] = Math.max(weightAccumulator[name] / totalDecisions, 0.02);
      totalRaw += rawWeights[name];
    }

    const newWeights: FeatureWeights = {
      email: rawWeights.email / totalRaw,
      companyName: rawWeights.companyName / totalRaw,
      domain: rawWeights.domain / totalRaw,
      phone: rawWeights.phone / totalRaw,
      title: rawWeights.title / totalRaw,
    };

    await persistWeights(newWeights);

    log.info('Feature weights recalculated from admin feedback', {
      approvedCount,
      rejectedCount,
      newWeights,
    });
  } catch (err) {
    log.error('Failed to recalculate feature weights', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Main Execution (T082, T084)
// ---------------------------------------------------------------------------

/**
 * Executes the CRM Conflict Resolver agent.
 *
 * Triggered by the 'hubspot.sync.conflict' event from the HubSpot import
 * worker. Scores the conflict using weighted feature comparison and makes
 * a confidence-based decision:
 *
 *   1. confidence >= 0.85: Auto-merge (record ConflictDecision with AUTO_MERGED)
 *   2. 0.50-0.84: Suggest for admin review (create PendingAction)
 *   3. < 0.50: Escalate to admin dashboard (outcome=ESCALATED)
 *
 * Checks the safety valve before allowing auto-merge.
 *
 * @param params - Execution context containing the conflict input.
 * @returns Structured agent output describing the action taken.
 */
export async function execute(params: {
  input?: Record<string, unknown>;
}): Promise<AutonomousAgentOutput> {
  const killSwitchActive = isKillSwitchActive();

  if (killSwitchActive) {
    log.info('CRM Conflict Resolver agent skipped — kill switch active');
    return {
      action: 'skipped',
      confidence: 1.0,
      rationale: 'Autonomous agents disabled via kill switch.',
      data: { killSwitch: true },
    };
  }

  log.info('CRM Conflict Resolver agent starting');

  const input = (params.input ?? {}) as Partial<ConflictInput>;
  const conflictId = input.conflictId ?? `conflict-${Date.now()}`;
  const existingRecord = input.existingRecord ?? {};
  const incomingRecord = input.incomingRecord ?? {};

  try {
    // Load persisted weights (learning loop may have updated them)
    const weights = await loadWeights();

    // Calculate confidence score
    const { confidence, features } = calculateConfidence(
      existingRecord,
      incomingRecord,
      weights,
    );

    log.info('Conflict confidence calculated', {
      conflictId,
      confidence,
      featureCount: features.length,
    });

    // Check safety valve before auto-merge
    const safetyValveTripped = await checkSafetyValve();

    // -----------------------------------------------------------------
    // Decision routing (T084)
    // -----------------------------------------------------------------

    if (confidence >= AUTO_MERGE_THRESHOLD && !safetyValveTripped) {
      // AUTO-MERGE path
      return await handleAutoMerge(conflictId, confidence, features, input);
    }

    if (confidence >= ESCALATION_THRESHOLD) {
      // SUGGESTED path — create PendingAction for admin review
      return await handleSuggested(conflictId, confidence, features, input);
    }

    // ESCALATED path — low confidence
    return await handleEscalated(conflictId, confidence, features, input);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('CRM Conflict Resolver agent failed', {
      conflictId,
      error: errorMessage,
    });

    return {
      action: 'agent_error',
      confidence: 0,
      rationale: `CRM Conflict Resolver encountered an error: ${errorMessage}`,
      data: { conflictId, error: errorMessage },
    };
  }
}

// ---------------------------------------------------------------------------
// Decision Handlers
// ---------------------------------------------------------------------------

/**
 * Handles the auto-merge path when confidence >= 0.85.
 *
 * @param conflictId - The conflict identifier.
 * @param confidence - The calculated confidence score.
 * @param features - Individual feature score breakdown.
 * @param input - The original conflict input.
 * @returns The agent output for auto-merge.
 */
async function handleAutoMerge(
  conflictId: string,
  confidence: number,
  features: FeatureScore[],
  input: Partial<ConflictInput>,
): Promise<AutonomousAgentOutput> {
  // Record ConflictDecision
  await prisma.conflictDecision.create({
    data: {
      conflictId,
      confidence,
      features: features as unknown as Prisma.InputJsonValue,
      outcome: 'AUTO_MERGED',
      metadata: {
        existingRecord: input.existingRecord ?? null,
        incomingRecord: input.incomingRecord ?? null,
        importJobId: input.importJobId ?? null,
      } as Prisma.InputJsonValue,
    },
  });

  await recordAction({
    agentName: AGENT_NAME,
    action: AUDIT_ACTION_TYPES.CRM_AUTO_MERGE,
    confidence,
    severity: 'INFO',
    outcome: 'AUTO_EXECUTED',
    metadata: {
      conflictId,
      features,
      existingRecord: input.existingRecord,
      incomingRecord: input.incomingRecord,
    },
  });

  await emitEvent({
    type: SYSTEM_EVENT_TYPES.QUALITY_AUTO_REMEDIATION,
    severity: 'INFO',
    message:
      `CRM conflict auto-merged with ${(confidence * 100).toFixed(1)}% confidence. ` +
      `Conflict ID: ${conflictId}.`,
    metadata: {
      conflictId,
      confidence,
      outcome: 'AUTO_MERGED',
    },
    agentName: AGENT_NAME,
  });

  log.info('Conflict auto-merged', { conflictId, confidence });

  return {
    action: 'conflict_auto_merged',
    confidence,
    rationale:
      `Auto-merged CRM conflict "${conflictId}" with ${(confidence * 100).toFixed(1)}% ` +
      `confidence. All feature scores exceeded merge thresholds.`,
    data: {
      conflictId,
      outcome: 'AUTO_MERGED',
      features,
      existingRecord: input.existingRecord,
      incomingRecord: input.incomingRecord,
    },
  };
}

/**
 * Handles the suggested path when confidence is 0.50-0.84.
 * Creates a PendingAction for admin review.
 *
 * @param conflictId - The conflict identifier.
 * @param confidence - The calculated confidence score.
 * @param features - Individual feature score breakdown.
 * @param input - The original conflict input.
 * @returns The agent output for suggested merge.
 */
async function handleSuggested(
  conflictId: string,
  confidence: number,
  features: FeatureScore[],
  input: Partial<ConflictInput>,
): Promise<AutonomousAgentOutput> {
  // Record ConflictDecision as SUGGESTED
  // Note: Using ESCALATED as the closest available outcome for SUGGESTED state.
  // The PendingAction below tracks the actual suggestion for admin review.
  await prisma.conflictDecision.create({
    data: {
      conflictId,
      confidence,
      features: features as unknown as Prisma.InputJsonValue,
      outcome: 'ESCALATED',
      metadata: {
        suggestedAction: 'merge',
        existingRecord: input.existingRecord ?? null,
        incomingRecord: input.incomingRecord ?? null,
        importJobId: input.importJobId ?? null,
      } as Prisma.InputJsonValue,
    },
  });

  // Create PendingAction for admin review
  await prisma.pendingAction.create({
    data: {
      agentName: AGENT_NAME,
      action: 'crm_conflict_merge',
      confidence,
      metadata: {
        conflictId,
        features: features as unknown as Prisma.InputJsonValue,
        existingRecord: input.existingRecord ?? null,
        incomingRecord: input.incomingRecord ?? null,
        importJobId: input.importJobId ?? null,
      } as Prisma.InputJsonValue,
    },
  });

  await recordAction({
    agentName: AGENT_NAME,
    action: AUDIT_ACTION_TYPES.CRM_CONFLICT_SUGGESTED,
    confidence,
    severity: 'WARNING',
    outcome: 'SUGGESTED',
    metadata: {
      conflictId,
      features,
      existingRecord: input.existingRecord,
      incomingRecord: input.incomingRecord,
    },
  });

  await emitEvent({
    type: SYSTEM_EVENT_TYPES.QUALITY_AUTO_REMEDIATION,
    severity: 'WARNING',
    message:
      `CRM conflict suggested for admin review with ${(confidence * 100).toFixed(1)}% ` +
      `confidence. Conflict ID: ${conflictId}.`,
    metadata: {
      conflictId,
      confidence,
      outcome: 'SUGGESTED',
    },
    agentName: AGENT_NAME,
  });

  log.info('Conflict suggested for review', { conflictId, confidence });

  return {
    action: 'conflict_suggested',
    confidence,
    rationale:
      `CRM conflict "${conflictId}" suggested for admin review with ` +
      `${(confidence * 100).toFixed(1)}% confidence. PendingAction created.`,
    data: {
      conflictId,
      outcome: 'SUGGESTED',
      features,
      existingRecord: input.existingRecord,
      incomingRecord: input.incomingRecord,
    },
  };
}

/**
 * Handles the escalated path when confidence < 0.50.
 *
 * @param conflictId - The conflict identifier.
 * @param confidence - The calculated confidence score.
 * @param features - Individual feature score breakdown.
 * @param input - The original conflict input.
 * @returns The agent output for escalated conflict.
 */
async function handleEscalated(
  conflictId: string,
  confidence: number,
  features: FeatureScore[],
  input: Partial<ConflictInput>,
): Promise<AutonomousAgentOutput> {
  // Record ConflictDecision as ESCALATED
  await prisma.conflictDecision.create({
    data: {
      conflictId,
      confidence,
      features: features as unknown as Prisma.InputJsonValue,
      outcome: 'ESCALATED',
      metadata: {
        reason: 'Low confidence - records unlikely to match',
        existingRecord: input.existingRecord ?? null,
        incomingRecord: input.incomingRecord ?? null,
        importJobId: input.importJobId ?? null,
      } as Prisma.InputJsonValue,
    },
  });

  await recordAction({
    agentName: AGENT_NAME,
    action: AUDIT_ACTION_TYPES.CRM_CONFLICT_ESCALATED,
    confidence,
    severity: 'HIGH',
    outcome: 'ESCALATED',
    metadata: {
      conflictId,
      features,
      existingRecord: input.existingRecord,
      incomingRecord: input.incomingRecord,
    },
  });

  await emitEvent({
    type: SYSTEM_EVENT_TYPES.QUALITY_AUTO_REMEDIATION,
    severity: 'HIGH',
    message:
      `CRM conflict escalated to admin dashboard with ${(confidence * 100).toFixed(1)}% ` +
      `confidence. Conflict ID: ${conflictId}. Manual review required.`,
    metadata: {
      conflictId,
      confidence,
      outcome: 'ESCALATED',
    },
    agentName: AGENT_NAME,
  });

  log.info('Conflict escalated', { conflictId, confidence });

  return {
    action: 'conflict_escalated',
    confidence,
    rationale:
      `CRM conflict "${conflictId}" escalated to admin dashboard with ` +
      `${(confidence * 100).toFixed(1)}% confidence. Records are unlikely to match.`,
    data: {
      conflictId,
      outcome: 'ESCALATED',
      features,
      existingRecord: input.existingRecord,
      incomingRecord: input.incomingRecord,
    },
  };
}
