/**
 * Campaign Optimizer Agent (T075-T081).
 *
 * Platform agent that runs on a SCHEDULED trigger (daily at 6 AM UTC).
 * Aggregates campaign DM open rates and response rates from the
 * CampaignMetrics table, identifies optimal send times via chi-square
 * testing, manages A/B test lifecycle, and emits EOD summary reports.
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
import {
  chiSquareTimeOfDay,
  abTestSignificance,
} from '../tools/statisticalTests.js';
import type { HourlyData } from '../tools/statisticalTests.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const log = logger.withContext({ service: 'campaignOptimizer' });

/** Agent name constant used in audit and event records. */
const AGENT_NAME = AGENT_NAMES.CAMPAIGN_OPTIMIZER;

/** Minimum total sends required per time slot for analysis. */
const MIN_SENDS_PER_SLOT = 100;

/** Minimum total sends for any analysis to proceed. */
const MIN_TOTAL_SENDS = 100;

/** Minimum sends per A/B test variant before declaring a winner. */
const MIN_AB_VARIANT_SENDS = 100;

/** Extended A/B test target sends when initial confidence is insufficient. */
const EXTENDED_AB_TARGET_SENDS = 200;

/** Confidence threshold for auto-executing schedule changes. */
const AUTO_EXECUTE_THRESHOLD = 0.85;

/** Confidence threshold for suggesting (but not auto-applying) changes. */
const SUGGEST_THRESHOLD = 0.50;

/** Minimum confidence for any action (below this = defer). */
const MIN_CONFIDENCE_THRESHOLD = 0.70;

/** Weight assigned to open rate in engagement score (0-1). */
const OPEN_RATE_WEIGHT = 0.4;

/** Weight assigned to response rate in engagement score (0-1). */
const RESPONSE_RATE_WEIGHT = 0.6;

/** Number of days of historical data to analyse. */
const LOOKBACK_DAYS = 30;

/** Threshold ratio of completed daily jobs to consider the day "done". */
const EOD_COMPLETION_RATIO = 0.95;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Aggregated metrics for a single hour slot. */
interface HourSlotMetrics {
  /** Hour of day (0-23). */
  sendHour: number;
  /** Weighted-average open rate across all campaigns for this hour. */
  avgOpenRate: number;
  /** Weighted-average response rate across all campaigns for this hour. */
  avgResponseRate: number;
  /** Total sends across all campaigns for this hour. */
  totalSends: number;
  /** Computed engagement score (weighted combo of open and response rates). */
  engagementScore: number;
}

/** Result of A/B test evaluation for a single campaign. */
interface ABTestEvaluation {
  /** The campaign ID being tested. */
  campaignId: string;
  /** Whether the test has enough data to conclude. */
  conclusive: boolean;
  /** The winning variant name, if conclusive. */
  winningVariant?: string;
  /** Statistical p-value from the two-proportion z-test. */
  pValue?: number;
  /** Whether the difference is statistically significant. */
  significant?: boolean;
  /** The engagement score of the winning variant. */
  winnerEngagement?: number;
  /** Total sends across all variants. */
  totalSends: number;
}

// ---------------------------------------------------------------------------
// Data Aggregation
// ---------------------------------------------------------------------------

/**
 * Fetches campaign metrics from the past 30 days and aggregates them
 * by send hour across all campaigns.
 *
 * Only includes hour slots that meet the minimum send threshold.
 *
 * @returns Array of HourSlotMetrics for qualifying hour slots.
 */
async function aggregateMetricsByHour(): Promise<HourSlotMetrics[]> {
  const cutoffDate = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const metrics = await prisma.campaignMetrics.findMany({
    where: {
      lastUpdated: { gte: cutoffDate },
      abTestVariant: null, // Exclude A/B test variant rows from aggregate
    },
  });

  // Group by sendHour
  const hourMap = new Map<number, { totalSends: number; weightedOpen: number; weightedResponse: number }>();

  for (const m of metrics) {
    const existing = hourMap.get(m.sendHour) ?? {
      totalSends: 0,
      weightedOpen: 0,
      weightedResponse: 0,
    };

    existing.totalSends += m.sendCount;
    existing.weightedOpen += m.openRate * m.sendCount;
    existing.weightedResponse += m.responseRate * m.sendCount;
    hourMap.set(m.sendHour, existing);
  }

  const result: HourSlotMetrics[] = [];

  for (const [sendHour, data] of hourMap.entries()) {
    if (data.totalSends < MIN_SENDS_PER_SLOT) {
      continue;
    }

    const avgOpenRate = data.weightedOpen / data.totalSends;
    const avgResponseRate = data.weightedResponse / data.totalSends;
    const engagementScore =
      avgOpenRate * OPEN_RATE_WEIGHT + avgResponseRate * RESPONSE_RATE_WEIGHT;

    result.push({
      sendHour,
      avgOpenRate,
      avgResponseRate,
      totalSends: data.totalSends,
      engagementScore,
    });
  }

  // Sort by engagement score descending
  result.sort((a, b) => b.engagementScore - a.engagementScore);

  return result;
}

// ---------------------------------------------------------------------------
// Send Time Optimization (T076)
// ---------------------------------------------------------------------------

/**
 * Identifies the statistically optimal send time using a chi-square
 * goodness-of-fit test on hourly engagement data.
 *
 * Uses engagement score as the "conversion" metric: for each hour slot,
 * the conversion count is computed as engagementScore * totalSends to
 * create a proportional measure suitable for chi-square testing.
 *
 * @param hourSlots - Aggregated metrics per hour slot.
 * @returns Object with optimal hour, confidence, and statistical details,
 *          or null if insufficient data.
 */
function identifyOptimalSendTime(hourSlots: HourSlotMetrics[]): {
  optimalHour: number;
  confidence: number;
  pValue: number;
  significant: boolean;
  currentBestHour: number;
  engagementImprovement: number;
} | null {
  if (hourSlots.length < 2) {
    return null;
  }

  // Build HourlyData for chi-square test
  // Use engagement score * totalSends as a pseudo-conversion count
  const hourlyData: HourlyData[] = hourSlots.map((slot) => ({
    hour: slot.sendHour,
    sends: slot.totalSends,
    conversions: Math.round(slot.engagementScore * slot.totalSends * 100),
  }));

  const chiResult = chiSquareTimeOfDay(hourlyData);

  // Find the hour with the highest engagement score
  const bestSlot = hourSlots[0]; // Already sorted by engagement descending
  const currentBestHour = bestSlot.sendHour;

  // Derive confidence from the chi-square significance and engagement gap
  let confidence = 0;
  if (chiResult.significant) {
    // Base confidence from statistical significance
    confidence = 0.70;

    // Boost based on how low the p-value is
    if (chiResult.pValue < 0.01) {
      confidence += 0.15;
    } else if (chiResult.pValue < 0.025) {
      confidence += 0.10;
    } else {
      confidence += 0.05;
    }

    // Boost based on engagement gap between best and second-best
    if (hourSlots.length >= 2) {
      const gap = bestSlot.engagementScore - hourSlots[1].engagementScore;
      if (gap > 0.05) {
        confidence += 0.10;
      } else if (gap > 0.02) {
        confidence += 0.05;
      }
    }
  } else {
    // Not significant -- low confidence
    confidence = 0.30 + (1 - chiResult.pValue) * 0.20;
  }

  confidence = Math.min(confidence, 0.99);

  // Calculate engagement improvement over second-best
  const secondBest = hourSlots.length >= 2 ? hourSlots[1] : hourSlots[0];
  const engagementImprovement =
    secondBest.engagementScore > 0
      ? ((bestSlot.engagementScore - secondBest.engagementScore) /
          secondBest.engagementScore) *
        100
      : 0;

  return {
    optimalHour: chiResult.optimalHour,
    confidence,
    pValue: chiResult.pValue,
    significant: chiResult.significant,
    currentBestHour,
    engagementImprovement,
  };
}

// ---------------------------------------------------------------------------
// A/B Testing Framework (T077-T078)
// ---------------------------------------------------------------------------

/**
 * Evaluates active A/B tests across all campaigns.
 *
 * For each campaign that has metrics with abTestVariant set, groups
 * data by variant, and when both variants have at least MIN_AB_VARIANT_SENDS,
 * uses a two-proportion z-test to determine a winner.
 *
 * @returns Array of A/B test evaluations.
 */
async function evaluateABTests(): Promise<ABTestEvaluation[]> {
  const cutoffDate = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const abMetrics = await prisma.campaignMetrics.findMany({
    where: {
      lastUpdated: { gte: cutoffDate },
      abTestVariant: { not: null },
    },
  });

  if (abMetrics.length === 0) {
    return [];
  }

  // Group by campaignId -> variant -> aggregated metrics
  const campaignMap = new Map<
    string,
    Map<string, { totalSends: number; weightedOpen: number; weightedResponse: number }>
  >();

  for (const m of abMetrics) {
    if (!m.abTestVariant) continue;

    let variantMap = campaignMap.get(m.campaignId);
    if (!variantMap) {
      variantMap = new Map();
      campaignMap.set(m.campaignId, variantMap);
    }

    const existing = variantMap.get(m.abTestVariant) ?? {
      totalSends: 0,
      weightedOpen: 0,
      weightedResponse: 0,
    };

    existing.totalSends += m.sendCount;
    existing.weightedOpen += m.openRate * m.sendCount;
    existing.weightedResponse += m.responseRate * m.sendCount;
    variantMap.set(m.abTestVariant, existing);
  }

  const evaluations: ABTestEvaluation[] = [];

  for (const [campaignId, variantMap] of campaignMap.entries()) {
    const variants = Array.from(variantMap.entries());
    const totalSends = variants.reduce((sum, [, v]) => sum + v.totalSends, 0);

    // Need at least 2 variants
    if (variants.length < 2) {
      evaluations.push({
        campaignId,
        conclusive: false,
        totalSends,
      });
      continue;
    }

    // Check if all variants meet minimum send threshold
    const allMeetMinimum = variants.every(
      ([, v]) => v.totalSends >= MIN_AB_VARIANT_SENDS,
    );

    if (!allMeetMinimum) {
      evaluations.push({
        campaignId,
        conclusive: false,
        totalSends,
      });
      continue;
    }

    // Compare first two variants (A vs B) using engagement score
    const [variantAName, variantAData] = variants[0];
    const [variantBName, variantBData] = variants[1];

    const engagementA =
      (variantAData.weightedOpen / variantAData.totalSends) * OPEN_RATE_WEIGHT +
      (variantAData.weightedResponse / variantAData.totalSends) * RESPONSE_RATE_WEIGHT;

    const engagementB =
      (variantBData.weightedOpen / variantBData.totalSends) * OPEN_RATE_WEIGHT +
      (variantBData.weightedResponse / variantBData.totalSends) * RESPONSE_RATE_WEIGHT;

    // Use response rate for z-test (more meaningful outcome metric)
    const responseRateA = variantAData.weightedResponse / variantAData.totalSends;
    const responseRateB = variantBData.weightedResponse / variantBData.totalSends;

    const conversionsA = Math.round(responseRateA * variantAData.totalSends);
    const conversionsB = Math.round(responseRateB * variantBData.totalSends);

    const testResult = abTestSignificance(
      conversionsA,
      variantAData.totalSends,
      conversionsB,
      variantBData.totalSends,
    );

    const winner = engagementA >= engagementB ? variantAName : variantBName;
    const winnerEngagement = Math.max(engagementA, engagementB);

    evaluations.push({
      campaignId,
      conclusive: testResult.significant,
      winningVariant: testResult.significant ? winner : undefined,
      pValue: testResult.pValue,
      significant: testResult.significant,
      winnerEngagement,
      totalSends,
    });
  }

  return evaluations;
}

// ---------------------------------------------------------------------------
// EOD Report Logic (T079)
// ---------------------------------------------------------------------------

/**
 * Checks whether the daily campaign jobs have completed (95% threshold)
 * and returns an EOD summary if so.
 *
 * Monitors Job records created today with status COMPLETED or FAILED.
 *
 * @returns EOD summary data if 95% of today's jobs are done, null otherwise.
 */
async function checkEODCompletion(): Promise<Record<string, unknown> | null> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const todayEnd = new Date();
  todayEnd.setUTCHours(23, 59, 59, 999);

  const [totalJobs, completedJobs, failedJobs] = await Promise.all([
    prisma.job.count({
      where: {
        createdAt: { gte: todayStart, lte: todayEnd },
      },
    }),
    prisma.job.count({
      where: {
        createdAt: { gte: todayStart, lte: todayEnd },
        status: 'COMPLETED',
      },
    }),
    prisma.job.count({
      where: {
        createdAt: { gte: todayStart, lte: todayEnd },
        status: 'FAILED',
      },
    }),
  ]);

  if (totalJobs === 0) {
    return null;
  }

  const doneJobs = completedJobs + failedJobs;
  const completionRatio = doneJobs / totalJobs;

  if (completionRatio < EOD_COMPLETION_RATIO) {
    return null;
  }

  return {
    totalJobs,
    completedJobs,
    failedJobs,
    pendingJobs: totalJobs - doneJobs,
    completionRatio,
    date: todayStart.toISOString().split('T')[0],
  };
}

// ---------------------------------------------------------------------------
// Main Execution
// ---------------------------------------------------------------------------

/**
 * Executes the Campaign Optimizer agent.
 *
 * Runs daily at 6 AM UTC to:
 * 1. Aggregate campaign DM open/response rates by send hour (past 30 days).
 * 2. Identify the statistically optimal send time via chi-square testing.
 * 3. Evaluate active A/B tests and declare winners when significant.
 * 4. Defer optimization when data is insufficient (<100 sends or <0.70 confidence).
 * 5. Emit an EOD summary when 95% of daily jobs have completed.
 *
 * All decisions are recorded to AuditAction and SystemEvents are emitted (T081).
 *
 * @param params - Input parameters (optional overrides via input field).
 * @returns An AutonomousAgentOutput summarising the optimization result.
 */
export async function execute(params: {
  input?: Record<string, unknown>;
}): Promise<AutonomousAgentOutput> {
  // Kill switch check
  if (process.env.AUTONOMOUS_AGENTS_ENABLED === 'false') {
    log.info('Campaign Optimizer agent skipped — kill switch active');
    return {
      action: 'skipped',
      confidence: 1.0,
      rationale: 'Autonomous agents disabled via kill switch.',
      data: { killSwitch: true },
    };
  }

  // Determine suggest-only mode from Agent record
  let suggestOnly = true;
  try {
    const agentRecord = await prisma.agent.findUnique({
      where: { slug: 'campaign-optimizer' },
      select: { suggestOnlyMode: true },
    });
    if (agentRecord) {
      suggestOnly = agentRecord.suggestOnlyMode;
    }
  } catch {
    log.warn('Could not query Agent record for suggest-only mode, defaulting to true');
  }

  log.info('Campaign Optimizer agent starting', { suggestOnly });

  try {
    const results: Record<string, unknown> = {};

    // -----------------------------------------------------------------
    // Step 1: Aggregate metrics by hour (T075)
    // -----------------------------------------------------------------

    const hourSlots = await aggregateMetricsByHour();
    const totalSendsAcrossSlots = hourSlots.reduce(
      (sum, s) => sum + s.totalSends,
      0,
    );

    log.info('Metrics aggregated', {
      qualifyingSlots: hourSlots.length,
      totalSends: totalSendsAcrossSlots,
    });

    results.hourSlots = hourSlots;
    results.totalSends = totalSendsAcrossSlots;

    // -----------------------------------------------------------------
    // Step 2: Insufficient data deferral check (T078)
    // -----------------------------------------------------------------

    if (totalSendsAcrossSlots < MIN_TOTAL_SENDS) {
      log.info('Insufficient data for optimization', {
        totalSends: totalSendsAcrossSlots,
        minimum: MIN_TOTAL_SENDS,
      });

      await recordAction({
        agentName: AGENT_NAME,
        action: AUDIT_ACTION_TYPES.CAMPAIGN_SCHEDULE_UPDATE,
        confidence: 0,
        severity: 'INFO',
        outcome: 'SUGGESTED',
        metadata: {
          reason: 'insufficient_data',
          totalSends: totalSendsAcrossSlots,
          minimumRequired: MIN_TOTAL_SENDS,
        },
      });

      return {
        action: 'insufficient_data',
        confidence: 0,
        rationale: `Insufficient data for optimization: ${totalSendsAcrossSlots} total sends (minimum ${MIN_TOTAL_SENDS} required).`,
        data: {
          totalSends: totalSendsAcrossSlots,
          minimumRequired: MIN_TOTAL_SENDS,
        },
      };
    }

    // -----------------------------------------------------------------
    // Step 3: Send time optimization (T076)
    // -----------------------------------------------------------------

    const sendTimeResult = identifyOptimalSendTime(hourSlots);

    if (sendTimeResult) {
      log.info('Send time analysis complete', {
        optimalHour: sendTimeResult.optimalHour,
        confidence: sendTimeResult.confidence,
        pValue: sendTimeResult.pValue,
        significant: sendTimeResult.significant,
      });

      results.sendTimeOptimization = sendTimeResult;

      if (
        sendTimeResult.confidence >= AUTO_EXECUTE_THRESHOLD &&
        sendTimeResult.significant &&
        !suggestOnly
      ) {
        // Auto-execute: update campaign cron pattern
        log.info('Auto-executing send time update', {
          optimalHour: sendTimeResult.optimalHour,
          confidence: sendTimeResult.confidence,
        });

        await recordAction({
          agentName: AGENT_NAME,
          action: AUDIT_ACTION_TYPES.CAMPAIGN_SCHEDULE_UPDATE,
          confidence: sendTimeResult.confidence,
          severity: 'INFO',
          outcome: 'AUTO_EXECUTED',
          metadata: {
            optimalHour: sendTimeResult.optimalHour,
            previousBestHour: sendTimeResult.currentBestHour,
            pValue: sendTimeResult.pValue,
            engagementImprovement: sendTimeResult.engagementImprovement,
            cronPattern: `0 ${sendTimeResult.optimalHour} * * *`,
          },
        });

        await emitEvent({
          type: SYSTEM_EVENT_TYPES.CAMPAIGN_OPTIMIZATION,
          severity: 'INFO',
          message: `Campaign send time auto-updated to ${sendTimeResult.optimalHour}:00 UTC (confidence: ${(sendTimeResult.confidence * 100).toFixed(0)}%, p=${sendTimeResult.pValue.toFixed(4)})`,
          metadata: {
            optimalHour: sendTimeResult.optimalHour,
            confidence: sendTimeResult.confidence,
            pValue: sendTimeResult.pValue,
            autoExecuted: true,
          },
          agentName: AGENT_NAME,
        });
      } else if (sendTimeResult.confidence >= SUGGEST_THRESHOLD) {
        // Suggest: record recommendation without executing
        const reason = suggestOnly
          ? 'suggest-only mode active'
          : `confidence ${(sendTimeResult.confidence * 100).toFixed(0)}% below auto-execute threshold`;

        log.info('Suggesting send time update', {
          optimalHour: sendTimeResult.optimalHour,
          confidence: sendTimeResult.confidence,
          reason,
        });

        await recordAction({
          agentName: AGENT_NAME,
          action: AUDIT_ACTION_TYPES.CAMPAIGN_SCHEDULE_UPDATE,
          confidence: sendTimeResult.confidence,
          severity: 'INFO',
          outcome: 'SUGGESTED',
          metadata: {
            optimalHour: sendTimeResult.optimalHour,
            previousBestHour: sendTimeResult.currentBestHour,
            pValue: sendTimeResult.pValue,
            engagementImprovement: sendTimeResult.engagementImprovement,
            cronPattern: `0 ${sendTimeResult.optimalHour} * * *`,
            reason,
          },
        });

        await emitEvent({
          type: SYSTEM_EVENT_TYPES.CAMPAIGN_OPTIMIZATION,
          severity: 'INFO',
          message: `Suggested campaign send time change to ${sendTimeResult.optimalHour}:00 UTC (confidence: ${(sendTimeResult.confidence * 100).toFixed(0)}%, p=${sendTimeResult.pValue.toFixed(4)})`,
          metadata: {
            optimalHour: sendTimeResult.optimalHour,
            confidence: sendTimeResult.confidence,
            pValue: sendTimeResult.pValue,
            autoExecuted: false,
            reason,
          },
          agentName: AGENT_NAME,
        });
      } else if (sendTimeResult.confidence < MIN_CONFIDENCE_THRESHOLD) {
        // T078: Defer - confidence too low
        log.info('Deferring send time optimization — confidence too low', {
          confidence: sendTimeResult.confidence,
          threshold: MIN_CONFIDENCE_THRESHOLD,
        });

        await recordAction({
          agentName: AGENT_NAME,
          action: AUDIT_ACTION_TYPES.CAMPAIGN_SCHEDULE_UPDATE,
          confidence: sendTimeResult.confidence,
          severity: 'INFO',
          outcome: 'SUGGESTED',
          metadata: {
            reason: 'insufficient_confidence',
            confidence: sendTimeResult.confidence,
            threshold: MIN_CONFIDENCE_THRESHOLD,
            optimalHour: sendTimeResult.optimalHour,
            pValue: sendTimeResult.pValue,
          },
        });
      }
    }

    // -----------------------------------------------------------------
    // Step 4: A/B test evaluation (T077)
    // -----------------------------------------------------------------

    const abEvaluations = await evaluateABTests();
    results.abTests = abEvaluations;

    for (const evaluation of abEvaluations) {
      if (evaluation.conclusive && evaluation.winningVariant) {
        log.info('A/B test winner declared', {
          campaignId: evaluation.campaignId,
          winningVariant: evaluation.winningVariant,
          pValue: evaluation.pValue,
        });

        await recordAction({
          agentName: AGENT_NAME,
          action: AUDIT_ACTION_TYPES.AB_TEST_WINNER,
          confidence: evaluation.pValue !== undefined ? 1 - evaluation.pValue : 0.95,
          severity: 'INFO',
          outcome: suggestOnly ? 'SUGGESTED' : 'AUTO_EXECUTED',
          metadata: {
            campaignId: evaluation.campaignId,
            winningVariant: evaluation.winningVariant,
            pValue: evaluation.pValue,
            winnerEngagement: evaluation.winnerEngagement,
            totalSends: evaluation.totalSends,
          },
        });

        await emitEvent({
          type: SYSTEM_EVENT_TYPES.CAMPAIGN_OPTIMIZATION,
          severity: 'INFO',
          message: `A/B test winner for campaign ${evaluation.campaignId}: variant "${evaluation.winningVariant}" (p=${evaluation.pValue?.toFixed(4)})`,
          metadata: {
            campaignId: evaluation.campaignId,
            winningVariant: evaluation.winningVariant,
            pValue: evaluation.pValue,
            totalSends: evaluation.totalSends,
          },
          agentName: AGENT_NAME,
        });
      } else if (!evaluation.conclusive && evaluation.totalSends < EXTENDED_AB_TARGET_SENDS) {
        // T078: Defer - need more data
        log.info('A/B test deferred — insufficient data', {
          campaignId: evaluation.campaignId,
          totalSends: evaluation.totalSends,
          targetSends: EXTENDED_AB_TARGET_SENDS,
        });
      }
    }

    // -----------------------------------------------------------------
    // Step 5: EOD report (T079)
    // -----------------------------------------------------------------

    const eodSummary = await checkEODCompletion();

    if (eodSummary) {
      log.info('EOD summary ready', eodSummary);
      results.eodSummary = eodSummary;

      await emitEvent({
        type: SYSTEM_EVENT_TYPES.CAMPAIGN_EOD_REPORT,
        severity: 'INFO',
        message: `Campaign EOD report: ${eodSummary.completedJobs}/${eodSummary.totalJobs} jobs completed, ${eodSummary.failedJobs} failed`,
        metadata: eodSummary,
        agentName: AGENT_NAME,
      });
    }

    // -----------------------------------------------------------------
    // Build final output
    // -----------------------------------------------------------------

    const actionsPerformed: string[] = [];

    if (sendTimeResult?.significant) {
      const verb =
        sendTimeResult.confidence >= AUTO_EXECUTE_THRESHOLD && !suggestOnly
          ? 'updated'
          : 'suggested';
      actionsPerformed.push(
        `Send time ${verb} to ${sendTimeResult.optimalHour}:00 UTC`,
      );
    }

    const abWinners = abEvaluations.filter((e) => e.conclusive);
    if (abWinners.length > 0) {
      actionsPerformed.push(
        `${abWinners.length} A/B test winner(s) declared`,
      );
    }

    const abPending = abEvaluations.filter((e) => !e.conclusive);
    if (abPending.length > 0) {
      actionsPerformed.push(
        `${abPending.length} A/B test(s) pending more data`,
      );
    }

    if (eodSummary) {
      actionsPerformed.push('EOD summary emitted');
    }

    if (actionsPerformed.length === 0) {
      actionsPerformed.push('No actionable optimizations found');
    }

    const overallConfidence = sendTimeResult?.confidence ?? 0;
    const rationale = actionsPerformed.join('; ') + '.';

    log.info('Campaign Optimizer agent completed', {
      actions: actionsPerformed,
      confidence: overallConfidence,
    });

    return {
      action: actionsPerformed.length > 0 ? 'campaign_optimization' : 'no_action',
      confidence: overallConfidence,
      rationale,
      data: results,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Campaign Optimizer agent failed', { error: errorMessage });

    return {
      action: 'agent_error',
      confidence: 0,
      rationale: `Campaign Optimizer encountered an error: ${errorMessage}`,
      data: { error: errorMessage },
    };
  }
}
