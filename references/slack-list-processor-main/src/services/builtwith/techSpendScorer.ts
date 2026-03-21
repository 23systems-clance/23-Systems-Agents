/**
 * Scores a company's technology spend tier based on BuiltWith technographic
 * data and traffic rank.
 *
 * Implements the scoring algorithm from research.md section 4:
 *   1. Classify each technology as enterprise, free, or paid
 *   2. Assign weighted points by category
 *   3. Apply bonuses for category diversity and enterprise density
 *   4. Multiply by traffic rank factor
 *   5. Bucket the final score into TIER_1 / TIER_2 / TIER_3 / UNCLASSIFIED
 */

import { enterpriseTechs } from '../../data/enterpriseTechs.js';
import { freeTechs } from '../../data/freeTechs.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Tech spend tier classification. */
export type TechSpendTierResult = 'TIER_1' | 'TIER_2' | 'TIER_3' | 'UNCLASSIFIED';

/** Full scoring result with breakdown for transparency and debugging. */
export interface TechSpendScoringResult {
  /** Final tier classification. */
  tier: TechSpendTierResult;
  /** Final computed score after multiplier. */
  score: number;
  /** Itemized scoring breakdown. */
  breakdown: {
    /** Sum of category-weighted technology points. */
    basePoints: number;
    /** Sum of diversity and enterprise density bonuses. */
    bonuses: number;
    /** Traffic rank multiplier applied. */
    multiplier: number;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Points awarded per category when the technology is enterprise-grade. */
const ENTERPRISE_CATEGORY_POINTS: Record<string, number> = {
  CRM: 15,
  'Marketing Automation': 15,
  Analytics: 10,
  CDN: 5,
  'A/B Testing': 10,
  'Tag Management': 8,
};

/** Default points for enterprise technologies in unlisted categories. */
const DEFAULT_ENTERPRISE_POINTS = 5;

/** Default points for paid (non-enterprise, non-free) technologies. */
const DEFAULT_PAID_POINTS = 2;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Technology classification used internally during scoring. */
type TechClass = 'enterprise' | 'free' | 'paid';

/**
 * Classifies a technology as enterprise, free, or paid.
 *
 * @param name - Technology name as reported by BuiltWith.
 * @returns The classification bucket.
 */
function classifyTech(name: string): TechClass {
  if (enterpriseTechs.has(name)) {
    return 'enterprise';
  }
  if (freeTechs.has(name)) {
    return 'free';
  }
  return 'paid';
}

/**
 * Computes the base points contribution for a single technology based on
 * its classification and categories.
 *
 * Enterprise technologies receive category-specific points (or the default
 * enterprise points). Paid technologies always contribute 2 points. Free
 * technologies contribute 0 points.
 *
 * @param classification - The tech's enterprise / free / paid class.
 * @param categories - Category strings from BuiltWith (may be empty).
 * @returns Points contributed by this technology.
 */
function computeTechPoints(
  classification: TechClass,
  categories: string[],
): number {
  if (classification === 'free') {
    return 0;
  }

  if (classification === 'enterprise') {
    // Use the highest-value matching category
    let maxPoints = 0;
    let matched = false;

    for (const cat of categories) {
      const pts = ENTERPRISE_CATEGORY_POINTS[cat];
      if (pts !== undefined) {
        matched = true;
        maxPoints = Math.max(maxPoints, pts);
      }
    }

    return matched ? maxPoints : DEFAULT_ENTERPRISE_POINTS;
  }

  // Paid (non-enterprise, non-free)
  return DEFAULT_PAID_POINTS;
}

/**
 * Calculates the category diversity bonus.
 *
 * Only categories with at least one paid or enterprise technology count.
 *
 * @param paidCategoryCount - Number of distinct categories with paid/enterprise techs.
 * @returns Bonus points.
 */
function diversityBonus(paidCategoryCount: number): number {
  if (paidCategoryCount >= 7) {
    return 30;
  }
  if (paidCategoryCount >= 5) {
    return 20;
  }
  if (paidCategoryCount >= 3) {
    return 10;
  }
  return 0;
}

/**
 * Calculates the enterprise density bonus.
 *
 * @param enterpriseCount - Number of distinct enterprise technologies detected.
 * @returns Bonus points.
 */
function enterpriseDensityBonus(enterpriseCount: number): number {
  if (enterpriseCount >= 5) {
    return 40;
  }
  if (enterpriseCount >= 3) {
    return 25;
  }
  if (enterpriseCount >= 1) {
    return 10;
  }
  return 0;
}

/**
 * Determines the traffic rank multiplier.
 *
 * @param rank - Numeric traffic rank, or null if unavailable.
 * @returns Multiplier factor.
 */
function trafficMultiplier(rank: number | null): number {
  if (rank === null || rank <= 0) {
    return 1.0;
  }
  if (rank <= 1_000) {
    return 2.5;
  }
  if (rank <= 10_000) {
    return 2.0;
  }
  if (rank <= 100_000) {
    return 1.5;
  }
  if (rank <= 500_000) {
    return 1.2;
  }
  return 1.0;
}

/**
 * Maps a final score to a tier bucket.
 *
 * @param score - The computed score after multiplier.
 * @returns Tier classification.
 */
function scoreToBucket(score: number): TechSpendTierResult {
  if (score >= 120) {
    return 'TIER_1';
  }
  if (score >= 50) {
    return 'TIER_2';
  }
  if (score >= 1) {
    return 'TIER_3';
  }
  return 'UNCLASSIFIED';
}

// ---------------------------------------------------------------------------
// Main scoring function
// ---------------------------------------------------------------------------

/**
 * Scores a company's technology spend tier from BuiltWith technographic data.
 *
 * @param technologies - Array of technologies with Name, Tag, and optional
 *   Categories as returned by the BuiltWith Domain API.
 * @param trafficRank - Numeric traffic rank (Quantcast or Majestic), or null.
 * @returns Tier classification, numeric score, and scoring breakdown.
 */
export function scoreTechSpend(
  technologies: Array<{ Name: string; Tag: string; Categories?: string[] }>,
  trafficRank: number | null,
): TechSpendScoringResult {
  let basePoints = 0;
  let enterpriseCount = 0;
  const paidCategories = new Set<string>();

  for (const tech of technologies) {
    const classification = classifyTech(tech.Name);
    const categories = tech.Categories ?? [];
    const points = computeTechPoints(classification, categories);

    basePoints += points;

    if (classification === 'enterprise') {
      enterpriseCount++;
    }

    // Track unique categories that have paid or enterprise techs
    if (classification !== 'free') {
      for (const cat of categories) {
        paidCategories.add(cat);
      }
    }
  }

  const bonuses =
    diversityBonus(paidCategories.size) +
    enterpriseDensityBonus(enterpriseCount);

  const multiplier = trafficMultiplier(trafficRank);
  const score = Math.round((basePoints + bonuses) * multiplier);
  const tier = scoreToBucket(score);

  return {
    tier,
    score,
    breakdown: { basePoints, bonuses, multiplier },
  };
}
