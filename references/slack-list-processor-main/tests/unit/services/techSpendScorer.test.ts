import { describe, it, expect } from 'vitest';
import { scoreTechSpend } from '../../../src/services/builtwith/techSpendScorer.js';
import type {
  TechSpendScoringResult,
  TechSpendTierResult,
} from '../../../src/services/builtwith/techSpendScorer.js';

// ---------------------------------------------------------------------------
// Helper to build a technology entry matching the BuiltWith shape
// ---------------------------------------------------------------------------

/**
 * Creates a technology object for use in test inputs.
 *
 * @param name - Technology name as reported by BuiltWith.
 * @param categories - Optional category strings.
 * @returns Technology input object.
 */
function tech(
  name: string,
  categories: string[] = [],
): { Name: string; Tag: string; Categories: string[] } {
  return { Name: name, Tag: 'analytics', Categories: categories };
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('scoreTechSpend', () => {
  // -----------------------------------------------------------------------
  // 1. Enterprise company -> Tier 1
  // -----------------------------------------------------------------------
  describe('enterprise company with many expensive technologies', () => {
    it('should score as TIER_1 (High)', () => {
      const technologies = [
        tech('Salesforce', ['CRM']),
        tech('SAP', ['ERP']),
        tech('Oracle CRM', ['CRM']),
        tech('Marketo', ['Marketing Automation']),
        tech('Adobe Analytics', ['Analytics']),
        tech('Optimizely', ['A/B Testing']),
        tech('Tealium', ['Tag Management']),
        tech('Akamai', ['CDN']),
        tech('Datadog', ['DevOps & Infrastructure']),
        tech('Snowflake', ['Data & BI']),
      ];

      const result: TechSpendScoringResult = scoreTechSpend(technologies, null);

      expect(result.tier).toBe<TechSpendTierResult>('TIER_1');
      expect(result.score).toBeGreaterThanOrEqual(120);
      expect(result.breakdown.basePoints).toBeGreaterThan(0);
      expect(result.breakdown.bonuses).toBeGreaterThan(0);
      expect(result.breakdown.multiplier).toBe(1.0);
    });

    it('should include enterprise density bonus for 5+ enterprise techs', () => {
      const technologies = [
        tech('Salesforce', ['CRM']),
        tech('SAP', ['ERP']),
        tech('Marketo', ['Marketing Automation']),
        tech('Adobe Analytics', ['Analytics']),
        tech('Optimizely', ['A/B Testing']),
      ];

      const result = scoreTechSpend(technologies, null);

      // 5 enterprise techs => enterprise density bonus of 40
      // 5 distinct paid categories => diversity bonus of 20
      // Total bonuses = 60
      expect(result.breakdown.bonuses).toBe(60);
    });
  });

  // -----------------------------------------------------------------------
  // 2. Mid-market company -> Tier 2
  // -----------------------------------------------------------------------
  describe('mid-market company with moderate tech stack', () => {
    it('should score as TIER_2 (Mid)', () => {
      const technologies = [
        tech('HubSpot Enterprise', ['Marketing Automation']),
        tech('Zendesk Enterprise', ['Support & ITSM']),
        tech('Mixpanel', ['Analytics']),
        // Some free techs that contribute 0 points
        tech('jQuery', []),
        tech('Google Analytics', ['Analytics']),
        tech('WordPress.org', ['CMS']),
      ];

      const result = scoreTechSpend(technologies, null);

      expect(result.tier).toBe<TechSpendTierResult>('TIER_2');
      expect(result.score).toBeGreaterThanOrEqual(50);
      expect(result.score).toBeLessThan(120);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Small business -> Tier 3
  // -----------------------------------------------------------------------
  describe('small business with basic tech', () => {
    it('should score as TIER_3 (Low)', () => {
      const technologies = [
        tech('WordPress.org', ['CMS']),
        tech('Google Analytics', ['Analytics']),
        tech('jQuery', []),
        tech('Bootstrap', []),
        // One paid but non-enterprise tech to avoid UNCLASSIFIED
        tech('Crazy Egg', ['Analytics']),
      ];

      const result = scoreTechSpend(technologies, null);

      expect(result.tier).toBe<TechSpendTierResult>('TIER_3');
      expect(result.score).toBeGreaterThanOrEqual(1);
      expect(result.score).toBeLessThan(50);
    });

    it('should give 0 points for all-free technologies', () => {
      const technologies = [
        tech('WordPress.org', ['CMS']),
        tech('Google Analytics', ['Analytics']),
        tech('jQuery', []),
        tech('Bootstrap', []),
        tech('React', []),
      ];

      const result = scoreTechSpend(technologies, null);

      expect(result.breakdown.basePoints).toBe(0);
      expect(result.breakdown.bonuses).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Empty / no technologies -> Unclassified
  // -----------------------------------------------------------------------
  describe('empty or no technologies', () => {
    it('should score as UNCLASSIFIED when technologies array is empty', () => {
      const result = scoreTechSpend([], null);

      expect(result.tier).toBe<TechSpendTierResult>('UNCLASSIFIED');
      expect(result.score).toBe(0);
      expect(result.breakdown.basePoints).toBe(0);
      expect(result.breakdown.bonuses).toBe(0);
      expect(result.breakdown.multiplier).toBe(1.0);
    });

    it('should score as UNCLASSIFIED when all technologies are free', () => {
      const technologies = [
        tech('Google Analytics', ['Analytics']),
        tech('jQuery', []),
        tech('React', []),
        tech('Next.js', []),
        tech('WordPress.org', ['CMS']),
      ];

      const result = scoreTechSpend(technologies, null);

      expect(result.tier).toBe<TechSpendTierResult>('UNCLASSIFIED');
      expect(result.score).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // 5. Traffic rank multipliers
  // -----------------------------------------------------------------------
  describe('traffic rank multipliers', () => {
    /**
     * Shared mid-tier tech stack used to test multiplier effects.
     * Base score (without multiplier) is stable across all traffic rank tests.
     */
    const midTierTechs = [
      tech('Salesforce', ['CRM']),
      tech('Marketo', ['Marketing Automation']),
      tech('Adobe Analytics', ['Analytics']),
    ];

    it('should apply 2.5x multiplier for top-1000 traffic rank', () => {
      const result = scoreTechSpend(midTierTechs, 500);

      expect(result.breakdown.multiplier).toBe(2.5);
      expect(result.score).toBe(
        Math.round(
          (result.breakdown.basePoints + result.breakdown.bonuses) * 2.5,
        ),
      );
    });

    it('should apply 2.0x multiplier for top-10000 traffic rank', () => {
      const result = scoreTechSpend(midTierTechs, 5_000);

      expect(result.breakdown.multiplier).toBe(2.0);
    });

    it('should apply 1.5x multiplier for top-100000 traffic rank', () => {
      const result = scoreTechSpend(midTierTechs, 50_000);

      expect(result.breakdown.multiplier).toBe(1.5);
    });

    it('should apply 1.2x multiplier for top-500000 traffic rank', () => {
      const result = scoreTechSpend(midTierTechs, 200_000);

      expect(result.breakdown.multiplier).toBe(1.2);
    });

    it('should apply 1.0x multiplier for rank above 500000', () => {
      const result = scoreTechSpend(midTierTechs, 1_000_000);

      expect(result.breakdown.multiplier).toBe(1.0);
    });

    it('should apply 1.0x multiplier for null traffic rank', () => {
      const result = scoreTechSpend(midTierTechs, null);

      expect(result.breakdown.multiplier).toBe(1.0);
    });

    it('should promote a borderline Tier 2 score to Tier 1 with high traffic', () => {
      // Without multiplier this tech stack scores Tier 2
      const baseResult = scoreTechSpend(midTierTechs, null);
      expect(baseResult.tier).toBe('TIER_2');

      // With a high-traffic multiplier, the score should jump to Tier 1
      const boostedResult = scoreTechSpend(midTierTechs, 500);
      expect(boostedResult.tier).toBe('TIER_1');
      expect(boostedResult.score).toBeGreaterThan(baseResult.score);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases and scoring details
  // -----------------------------------------------------------------------
  describe('scoring details', () => {
    it('should use highest-value category for enterprise techs with multiple categories', () => {
      // CRM = 15 points, Analytics = 10 points; should pick max (15)
      const technologies = [
        tech('Salesforce', ['CRM', 'Analytics']),
      ];

      const result = scoreTechSpend(technologies, null);

      // 15 (CRM, highest) + 10 (enterprise density bonus for 1 enterprise)
      expect(result.breakdown.basePoints).toBe(15);
    });

    it('should award DEFAULT_ENTERPRISE_POINTS for enterprise tech in unlisted category', () => {
      const technologies = [
        tech('Datadog', ['DevOps & Infrastructure']),
      ];

      const result = scoreTechSpend(technologies, null);

      // 'DevOps & Infrastructure' is not in ENTERPRISE_CATEGORY_POINTS, so 5 default
      expect(result.breakdown.basePoints).toBe(5);
    });

    it('should award DEFAULT_PAID_POINTS for non-enterprise, non-free tech', () => {
      const technologies = [
        tech('SomeUnknownPaidTool', ['Analytics']),
      ];

      const result = scoreTechSpend(technologies, null);

      // Not in enterpriseTechs or freeTechs => paid => 2 points
      expect(result.breakdown.basePoints).toBe(2);
    });

    it('should calculate diversity bonus based on unique paid categories', () => {
      const technologies = [
        tech('SomePaid1', ['CRM']),
        tech('SomePaid2', ['Marketing Automation']),
        tech('SomePaid3', ['Analytics']),
        tech('SomePaid4', ['CDN']),
        tech('SomePaid5', ['Security']),
      ];

      const result = scoreTechSpend(technologies, null);

      // 5 distinct paid categories => diversity bonus = 20
      // 0 enterprise techs => enterprise density bonus = 0
      expect(result.breakdown.bonuses).toBe(20);
    });

    it('should handle technologies with no Categories field', () => {
      const technologies = [
        { Name: 'Salesforce', Tag: 'crm' },
      ];

      const result = scoreTechSpend(technologies, null);

      // No categories provided => Categories defaults to []
      // Enterprise tech with no matching category => DEFAULT_ENTERPRISE_POINTS = 5
      expect(result.breakdown.basePoints).toBe(5);
      expect(result.tier).not.toBe('UNCLASSIFIED');
    });
  });
});
