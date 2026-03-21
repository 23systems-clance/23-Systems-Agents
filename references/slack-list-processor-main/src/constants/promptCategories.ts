/**
 * Prompt Categories & Constants
 * Feature 23: Dynamic Suggested Prompts
 */

export enum PromptCategory {
  ONBOARDING = 'onboarding',
  ENRICHMENT = 'enrichment',
  JOB_MANAGEMENT = 'job_management',
  FOLLOW_UP = 'follow_up',
  REPORTING = 'reporting',
  CHANNEL_SPECIFIC = 'channel_specific',
}

export enum ContextType {
  DEFAULT = 'default',
  CHANNEL = 'channel',
  ACTIVITY = 'activity',
  WORKSPACE = 'workspace',
}

export const STATE_PRIORITY = {
  active: 1000,
  failed: 800,
  completed: 400,
  pending: 200,
} as const;

export const PRIORITY_WEIGHTS = {
  STATE_WEIGHT: 1.5,
  RECENCY_WEIGHT: 1.0,
  DIVERSITY_PENALTY: 500,
} as const;

export const POWER_USER_JOB_COUNT = 10;

export const PROMPT_CACHE_CONFIG = {
  TTL_SECONDS: 300,
  USER_CONTEXT_KEY_PREFIX: 'prompt:context',
  CHANNEL_HISTORY_KEY_PREFIX: 'prompt:channel',
  RECENT_PROMPTS_KEY_PREFIX: 'prompt:recent',
} as const;

export const ACTIVITY_WINDOWS = {
  COMPLETED_JOBS_HOURS: 48,
  FAILED_JOBS_HOURS: 24,
  RECENT_PROMPTS_COUNT: 20,
} as const;

export const SLACK_LIMITS = {
  MAX_PROMPTS: 4,
  MAX_TITLE_LENGTH: 25,
  MAX_MESSAGE_LENGTH: 150,
} as const;

export const PERFORMANCE_TARGETS = {
  GENERATION_LATENCY_MS_P95: 500,
  GENERATION_LATENCY_MS_P50: 100,
  CACHE_HIT_RATE_TARGET: 0.8,
  FALLBACK_LATENCY_MS: 50,
} as const;

export const CATEGORY_BASE_PRIORITIES = {
  [PromptCategory.ONBOARDING]: 600,
  [PromptCategory.ENRICHMENT]: 700,
  [PromptCategory.JOB_MANAGEMENT]: 800,
  [PromptCategory.FOLLOW_UP]: 500,
  [PromptCategory.REPORTING]: 400,
  [PromptCategory.CHANNEL_SPECIFIC]: 650,
} as const;
