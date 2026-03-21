/**
 * Statistical testing utilities for the autonomous agent framework (T024).
 *
 * Provides A/B test significance testing (two-proportion z-test) and
 * chi-square goodness-of-fit tests for send-time optimisation.
 */

import {
  cumulativeStdNormalProbability,
  chiSquaredDistributionTable,
} from 'simple-statistics';
import logger from '../../../lib/logger.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Result of a two-proportion z-test for A/B testing. */
export interface ABTestResult {
  /** Computed z-score for the difference between proportions. */
  zScore: number;
  /** Two-tailed p-value. */
  pValue: number;
  /** Whether the result is statistically significant (p < 0.05). */
  significant: boolean;
}

/** Hourly engagement data for a single hour slot. */
export interface HourlyData {
  /** Hour of day (0-23). */
  hour: number;
  /** Total sends during this hour. */
  sends: number;
  /** Observed conversions during this hour. */
  conversions: number;
}

/** Result of a chi-square goodness-of-fit test for send-time optimisation. */
export interface ChiSquareResult {
  /** Computed chi-square statistic. */
  chiSquare: number;
  /** Approximate p-value from the chi-square distribution table. */
  pValue: number;
  /** Whether the result is statistically significant (p < 0.05). */
  significant: boolean;
  /** The hour with the highest conversion rate. */
  optimalHour: number;
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const log = logger.withContext({ service: 'statisticalTests' });

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Performs a two-proportion z-test to determine if the conversion rate
 * difference between variant A and variant B is statistically significant.
 *
 * Uses the pooled proportion to compute standard error and derives the
 * two-tailed p-value via the cumulative standard normal distribution.
 *
 * @param conversionsA - Number of conversions in group A.
 * @param samplesA     - Total samples in group A.
 * @param conversionsB - Number of conversions in group B.
 * @param samplesB     - Total samples in group B.
 * @returns An {@link ABTestResult} with z-score, p-value, and significance flag.
 */
export function abTestSignificance(
  conversionsA: number,
  samplesA: number,
  conversionsB: number,
  samplesB: number,
): ABTestResult {
  try {
    log.debug('Running A/B test significance', {
      conversionsA,
      samplesA,
      conversionsB,
      samplesB,
    });

    if (samplesA <= 0 || samplesB <= 0) {
      throw new Error(
        `Sample sizes must be positive (got A=${samplesA}, B=${samplesB})`,
      );
    }

    const pA = conversionsA / samplesA;
    const pB = conversionsB / samplesB;

    // Pooled proportion under H0
    const pooled = (conversionsA + conversionsB) / (samplesA + samplesB);

    // Standard error of the difference
    const se = Math.sqrt(pooled * (1 - pooled) * (1 / samplesA + 1 / samplesB));

    // Guard against zero standard error (all or no conversions)
    if (se === 0) {
      return { zScore: 0, pValue: 1, significant: false };
    }

    const zScore = (pA - pB) / se;

    // Two-tailed p-value
    const pValue = 2 * (1 - cumulativeStdNormalProbability(Math.abs(zScore)));

    const result: ABTestResult = {
      zScore: roundTo(zScore, 4),
      pValue: roundTo(pValue, 6),
      significant: pValue < 0.05,
    };

    log.info('A/B test result', {
      zScore: result.zScore,
      pValue: result.pValue,
      significant: result.significant,
    });

    return result;
  } catch (error) {
    log.error('A/B test significance calculation failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Performs a chi-square goodness-of-fit test to determine whether conversion
 * rates vary significantly across hours of the day.
 *
 * Compares observed per-hour conversions against the expected conversions
 * under a uniform conversion rate (total conversions distributed
 * proportionally by sends per hour).
 *
 * @param hourlyData - Array of per-hour send and conversion counts.
 * @returns A {@link ChiSquareResult} with chi-square statistic, p-value,
 *          significance flag, and the optimal hour.
 */
export function chiSquareTimeOfDay(
  hourlyData: HourlyData[],
): ChiSquareResult {
  try {
    log.debug('Running chi-square time-of-day test', {
      hourCount: hourlyData.length,
    });

    if (hourlyData.length === 0) {
      throw new Error('hourlyData must contain at least one entry');
    }

    const totalSends = hourlyData.reduce((sum, h) => sum + h.sends, 0);
    const totalConversions = hourlyData.reduce((sum, h) => sum + h.conversions, 0);

    if (totalSends === 0) {
      throw new Error('Total sends must be greater than zero');
    }

    // Overall conversion rate (used to compute expected per-hour conversions)
    const overallRate = totalConversions / totalSends;

    // Chi-square statistic: sum of (observed - expected)^2 / expected
    let chiSquare = 0;
    for (const h of hourlyData) {
      const expected = h.sends * overallRate;
      if (expected > 0) {
        chiSquare += Math.pow(h.conversions - expected, 2) / expected;
      }
    }

    chiSquare = roundTo(chiSquare, 4);

    // Degrees of freedom = number of categories - 1
    const df = hourlyData.length - 1;

    // Look up p-value from chi-squared distribution table
    const pValue = lookupChiSquaredPValue(chiSquare, df);

    // Determine optimal hour (highest conversion rate among hours with sends)
    const hoursWithSends = hourlyData.filter((h) => h.sends > 0);
    const optimalHour =
      hoursWithSends.length > 0
        ? hoursWithSends.reduce((best, h) =>
            h.conversions / h.sends > best.conversions / best.sends ? h : best,
          ).hour
        : 0;

    const result: ChiSquareResult = {
      chiSquare,
      pValue,
      significant: pValue < 0.05,
      optimalHour,
    };

    log.info('Chi-square time-of-day result', {
      chiSquare: result.chiSquare,
      pValue: result.pValue,
      significant: result.significant,
      optimalHour: result.optimalHour,
    });

    return result;
  } catch (error) {
    log.error('Chi-square time-of-day test failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Looks up an approximate p-value from the chi-squared distribution table
 * for a given statistic and degrees of freedom.
 *
 * Returns the smallest significance level alpha where the observed statistic
 * exceeds the critical value. Falls back to 1.0 if the statistic is smaller
 * than all critical values.
 */
function lookupChiSquaredPValue(chiSquare: number, df: number): number {
  // The table supports specific df values; find the closest available one
  const table = chiSquaredDistributionTable as unknown as Record<
    number,
    Record<number, number> | undefined
  >;

  const availableDf = Object.keys(table)
    .map(Number)
    .sort((a, b) => a - b);

  // Clamp to the closest available df in the table
  let closestDf = availableDf[0];
  for (const d of availableDf) {
    if (Math.abs(d - df) < Math.abs(closestDf - df)) {
      closestDf = d;
    }
  }

  const row = table[closestDf];
  if (!row) {
    return 1.0;
  }

  // Significance levels in the table (descending order for lookup)
  const alphas = [0.005, 0.01, 0.025, 0.05, 0.1, 0.5, 0.9, 0.95, 0.975, 0.99, 0.995];

  // Walk through alpha levels from most significant to least significant.
  // The table stores critical values where P(X >= critical) = alpha.
  for (const alpha of alphas) {
    const criticalValue = row[alpha];
    if (criticalValue !== undefined && chiSquare >= criticalValue) {
      return alpha;
    }
  }

  return 1.0;
}

/**
 * Rounds a number to a specified number of decimal places.
 */
function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
