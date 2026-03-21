/**
 * Feature flag type definitions for multi-tenant SaaS licensing.
 *
 * Each flag controls a major feature module that the platform owner can
 * enable/disable per client workspace via the admin dashboard.
 */

/** Per-workspace feature toggle interface. */
export interface FeatureFlags {
  /** Core enrichment — list upload, BuiltWith + Apollo lookups. */
  enrichment: boolean;
  /** Campaign management — outreach sequences. */
  campaigns: boolean;
  /** Workflow builder — multi-step automation. */
  workflows: boolean;
  /** BDR onboarding system — guided BDR setup. */
  onboarding: boolean;
  /** Power dialer — click-to-call. */
  dialer: boolean;
  /** Analytics dashboard — usage and performance metrics. */
  analytics: boolean;
  /** ICP & analysis reports — document processing and report generation. */
  icpAnalysis: boolean;
  /** AIARC personality analysis — DISC/OCEAN profiles. */
  personalityAnalysis: boolean;
  /** AI agent side panel — conversational assistant (MVP: always false). */
  aiAgent: boolean;
  /** Platform skill routing — enrichment jobs route through skill execution engine (Feature 39). */
  platformSkillRouting: boolean;
}

/** All feature flag keys. */
export type FeatureFlagKey = keyof FeatureFlags;

/**
 * Default flags for new client workspaces.
 * Only enrichment is enabled by default — other features are toggled on
 * via license key presets or admin dashboard.
 */
export const DEFAULT_CLIENT_FLAGS: FeatureFlags = {
  enrichment: true,
  campaigns: false,
  workflows: false,
  onboarding: false,
  dialer: false,
  analytics: false,
  icpAnalysis: false,
  personalityAnalysis: false,
  aiAgent: false,
  platformSkillRouting: false,
};

/**
 * Platform owner workspace flags — all features always enabled.
 */
export const PLATFORM_OWNER_FLAGS: FeatureFlags = {
  enrichment: true,
  campaigns: true,
  workflows: true,
  onboarding: true,
  dialer: true,
  analytics: true,
  icpAnalysis: true,
  personalityAnalysis: true,
  aiAgent: true,
  platformSkillRouting: false,
};
