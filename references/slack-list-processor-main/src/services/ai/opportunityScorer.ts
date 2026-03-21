/**
 * Deterministic opportunity scoring engine for account analysis.
 *
 * Computes a composite opportunity score for each company based on
 * cloud migration potential, AI adoption, organizational scale, tech
 * spend, and contact coverage. No AI calls -- pure TypeScript logic.
 *
 * Scoring model matches the reference report (~145 max points):
 * - AI Adoption:        +25 pts
 * - On AWS (migration):  +20 pts
 * - On Azure (migration):+20 pts
 * - Multi-Cloud:         +18 pts
 * - Other hosting:       +15 pts
 * - On Google Cloud:     +15 pts
 * - Enterprise Revenue:  +15 pts
 * - Contacts available:  +10 pts
 * - US-Based:            +10 pts
 * - Workforce size:      up to +10 pts
 * - Social presence:     up to +15 pts
 * - Tech spend:          up to +10 pts
 * - High-value vertical: +10 pts
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input data for scoring a single company. */
export interface ScoringInput {
  companyId: string;
  companyName: string | null;
  domain: string | null;
  cloudProviderPrimary: string | null;
  cloudProvidersAll: string | null;
  vertical: string | null;
  salesRevenue: number | null;
  employeeCount: number | null;
  techSpendUsd: number | null;
  techSpendTier: string | null;
  technologyCount: number;
  socialProfiles: string[];
  locationCountry: string | null;
  hasContacts: boolean;
  contactCount: number;
  /** List of detected AI technology names (e.g. "OpenAI", "ChatGPT"). */
  aiTechnologies: string[];
}

/** Scored result for a single company. */
export interface ScoredCompany {
  companyId: string;
  companyName: string | null;
  domain: string | null;
  score: number;
  tier: 'EXCELLENT' | 'STRONG' | 'GOOD' | 'MODERATE';
  /** Breakdown of which signals contributed points. */
  signals: string[];
}

/** Aggregate scoring summary for the full report. */
export interface ScoringSummary {
  totalCompanies: number;
  excellentCount: number;
  strongCount: number;
  goodCount: number;
  moderateCount: number;
  highOpportunityCount: number;
  migrationTargetCount: number;
  aiEnabledCount: number;
}

// ---------------------------------------------------------------------------
// Known AI technologies
// ---------------------------------------------------------------------------

const AI_TECH_KEYWORDS = [
  'openai', 'chatgpt', 'gpt', 'gemini', 'copilot', 'anthropic', 'claude',
  'hugging face', 'tensorflow', 'pytorch', 'vertex ai', 'sagemaker',
  'azure ai', 'bedrock', 'midjourney', 'dall-e', 'stable diffusion',
  'elevenlabs', 'wonderchat', 'zoominfo chat', 'iadvize', 'sitegpt',
  'secure privacy', 'chatgpt image', 'securiti', 'dialogflow',
];

/** High-value verticals that receive bonus scoring points. */
const HIGH_VALUE_VERTICALS = [
  'business and industrial',
  'technology and computing',
  'finance',
  'health and fitness',
  'science',
];

// ---------------------------------------------------------------------------
// Scoring logic
// ---------------------------------------------------------------------------

/**
 * Detects AI technologies from a company's tech stack.
 */
export function detectAiTechnologies(techNames: string[]): string[] {
  return techNames.filter((name) =>
    AI_TECH_KEYWORDS.some((kw) => name.toLowerCase().includes(kw)),
  );
}

/**
 * Scores a single company and returns the result with tier classification.
 */
export function scoreCompany(input: ScoringInput): ScoredCompany {
  let score = 0;
  const signals: string[] = [];
  const cloud = (input.cloudProviderPrimary ?? '').toLowerCase();
  const allClouds = (input.cloudProvidersAll ?? '').toLowerCase();

  // --- Cloud migration potential ---
  if (cloud.includes('aws') || cloud.includes('amazon')) {
    score += 20;
    signals.push('AWS customer - Google Cloud migration opportunity');
  } else if (cloud.includes('azure') || cloud.includes('microsoft')) {
    score += 20;
    signals.push('Azure customer - Google Cloud migration opportunity');
  } else if (cloud.includes('multi') || (allClouds.includes('aws') && allClouds.includes('azure'))) {
    score += 18;
    signals.push('Multi-cloud without Google - migration opportunity');
  } else if (cloud.includes('google')) {
    score += 15;
    signals.push('Already on Google Cloud - expand/upsell opportunity');
  } else if (cloud && cloud !== 'none' && cloud !== 'unknown') {
    score += 15;
    signals.push('Non-hyperscaler hosting - Google Cloud migration opportunity');
  }

  // Multi-cloud with Google gets consolidation points
  if (cloud.includes('multi') && allClouds.includes('google')) {
    score += 15;
    signals.push('Multi-cloud with Google - consolidation opportunity');
  }

  // --- AI Adoption ---
  if (input.aiTechnologies.length > 0) {
    score += 25;
    signals.push(`AI adoption detected: ${input.aiTechnologies.join(';')}`);
  }

  // --- Enterprise Revenue ---
  if (input.salesRevenue !== null && input.salesRevenue > 0) {
    if (input.salesRevenue >= 100_000_000) {
      score += 15;
      signals.push(`Enterprise revenue: $${input.salesRevenue.toLocaleString()}`);
    } else if (input.salesRevenue >= 10_000_000) {
      score += 10;
      signals.push(`Meaningful revenue: $${input.salesRevenue.toLocaleString()}`);
    } else if (input.salesRevenue >= 1_000_000) {
      score += 5;
      signals.push(`Revenue: $${input.salesRevenue.toLocaleString()}`);
    }
  }

  // --- Contact coverage ---
  if (input.hasContacts && input.contactCount > 0) {
    score += 10;
    signals.push('Enriched contacts available for outreach');
  }

  // --- US-Based ---
  const country = (input.locationCountry ?? '').toLowerCase();
  if (country.includes('us') || country.includes('united states') || country === 'usa') {
    score += 10;
    signals.push('US-based organization');
  }

  // --- Workforce size ---
  if (input.employeeCount !== null && input.employeeCount > 0) {
    if (input.employeeCount >= 1000) {
      score += 10;
      signals.push(`Large workforce: ${input.employeeCount.toLocaleString()}`);
    } else if (input.employeeCount >= 500) {
      score += 8;
      signals.push(`Significant workforce: ${input.employeeCount.toLocaleString()}`);
    } else if (input.employeeCount >= 200) {
      score += 5;
      signals.push(`Moderate workforce: ${input.employeeCount.toLocaleString()}`);
    } else if (input.employeeCount >= 50) {
      score += 3;
    }
  }

  // --- Social presence ---
  if (input.socialProfiles.length > 0) {
    const socialScore = Math.min(input.socialProfiles.length * 5, 15);
    score += socialScore;
    signals.push(`Active social presence (${input.socialProfiles.length} channel(s))`);
  }

  // --- Tech spend ---
  if (input.techSpendUsd !== null && input.techSpendUsd > 0) {
    if (input.techSpendUsd >= 10_000) {
      score += 10;
      signals.push(`High tech spend: $${input.techSpendUsd.toLocaleString()}`);
    } else if (input.techSpendUsd >= 1_000) {
      score += 5;
      signals.push(`Moderate tech spend: $${input.techSpendUsd.toLocaleString()}`);
    }
  }

  // --- High-value vertical ---
  const verticalLower = (input.vertical ?? '').toLowerCase();
  if (HIGH_VALUE_VERTICALS.some((v) => verticalLower.includes(v))) {
    score += 10;
    signals.push(`High-value vertical: ${input.vertical}`);
  }

  // --- Tier classification ---
  let tier: ScoredCompany['tier'];
  if (score >= 100) tier = 'EXCELLENT';
  else if (score >= 85) tier = 'STRONG';
  else if (score >= 70) tier = 'GOOD';
  else tier = 'MODERATE';

  return {
    companyId: input.companyId,
    companyName: input.companyName,
    domain: input.domain,
    score,
    tier,
    signals,
  };
}

/**
 * Scores all companies and returns sorted results with summary.
 */
export function scoreAllCompanies(
  inputs: ScoringInput[],
): { scored: ScoredCompany[]; summary: ScoringSummary } {
  const scored = inputs
    .map(scoreCompany)
    .sort((a, b) => b.score - a.score);

  const summary: ScoringSummary = {
    totalCompanies: scored.length,
    excellentCount: scored.filter((c) => c.tier === 'EXCELLENT').length,
    strongCount: scored.filter((c) => c.tier === 'STRONG').length,
    goodCount: scored.filter((c) => c.tier === 'GOOD').length,
    moderateCount: scored.filter((c) => c.tier === 'MODERATE').length,
    highOpportunityCount: scored.filter((c) => c.score >= 85).length,
    migrationTargetCount: scored.filter((c) =>
      c.signals.some((s) => s.includes('migration')),
    ).length,
    aiEnabledCount: scored.filter((c) =>
      c.signals.some((s) => s.includes('AI adoption')),
    ).length,
  };

  return { scored, summary };
}
