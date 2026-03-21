/**
 * Prompt Templates
 * Feature 23: Dynamic Suggested Prompts - T013-T017
 */

import { PromptTemplate, PromptContext, SuggestedPrompt } from '../../types/promptTypes';
import { PromptCategory, POWER_USER_JOB_COUNT } from '../../constants/promptCategories';

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  // T013: Onboarding
  {
    id: 'onboarding_upload',
    category: PromptCategory.ONBOARDING,
    subcategory: 'getting_started',
    basePriority: 600,
    isApplicable(ctx: PromptContext) {
      return ctx.totalEnrichmentCount === 0;
    },
    render(): SuggestedPrompt {
      return { title: 'Upload a list', message: 'Upload a company list to get started with enrichment' };
    },
  },
  {
    id: 'onboarding_help',
    category: PromptCategory.ONBOARDING,
    subcategory: 'getting_started',
    basePriority: 550,
    isApplicable(ctx: PromptContext) {
      return ctx.totalEnrichmentCount < 3;
    },
    render(): SuggestedPrompt {
      return { title: 'What can you do?', message: 'Show me all available enrichment and reporting features' };
    },
  },

  // T014: Active Jobs
  {
    id: 'active_job_status',
    category: PromptCategory.JOB_MANAGEMENT,
    subcategory: 'active',
    basePriority: 900,
    isApplicable(ctx: PromptContext) {
      return ctx.activeJobs.length > 0;
    },
    render(ctx: PromptContext): SuggestedPrompt {
      const job = ctx.activeJobs[0];
      return { title: 'Check your job', message: `Check status of your ${job.type} enrichment` };
    },
  },
  {
    id: 'active_job_details',
    category: PromptCategory.JOB_MANAGEMENT,
    subcategory: 'active',
    basePriority: 850,
    isApplicable(ctx: PromptContext) {
      return ctx.activeJobs.length > 0;
    },
    render(ctx: PromptContext): SuggestedPrompt {
      const count = ctx.activeJobs.length;
      return { title: 'Running jobs', message: `You have ${count} ${count === 1 ? 'job' : 'jobs'} in progress` };
    },
  },

  // T015: Failed Jobs
  {
    id: 'failed_job_retry',
    category: PromptCategory.JOB_MANAGEMENT,
    subcategory: 'failed',
    basePriority: 850,
    isApplicable(ctx: PromptContext) {
      return ctx.failedJobs.length > 0;
    },
    render(ctx: PromptContext): SuggestedPrompt {
      const job = ctx.failedJobs[0];
      return { title: 'Retry failed job', message: `Your ${job.type} failed - help me retry it` };
    },
  },
  {
    id: 'failed_job_diagnose',
    category: PromptCategory.JOB_MANAGEMENT,
    subcategory: 'failed',
    basePriority: 800,
    isApplicable(ctx: PromptContext) {
      return ctx.failedJobs.length > 0;
    },
    render(): SuggestedPrompt {
      return { title: 'Why did it fail?', message: 'Explain why my enrichment job failed' };
    },
  },

  // T016: Completed Jobs
  {
    id: 'completed_filter',
    category: PromptCategory.FOLLOW_UP,
    subcategory: 'results',
    basePriority: 500,
    isApplicable(ctx: PromptContext) {
      return ctx.completedJobs.length > 0 && (ctx.completedJobs[0].rowCount || 0) > 10;
    },
    render(ctx: PromptContext): SuggestedPrompt {
      const count = ctx.completedJobs[0].rowCount || 0;
      return { title: 'Filter results', message: `Filter your ${count} enriched companies by criteria` };
    },
  },
  {
    id: 'completed_download',
    category: PromptCategory.FOLLOW_UP,
    subcategory: 'results',
    basePriority: 450,
    isApplicable(ctx: PromptContext) {
      return ctx.completedJobs.length > 0;
    },
    render(): SuggestedPrompt {
      return { title: 'Download results', message: 'Send me a download link for my last enrichment' };
    },
  },
  {
    id: 'completed_summary',
    category: PromptCategory.REPORTING,
    subcategory: 'insights',
    basePriority: 420,
    isApplicable(ctx: PromptContext) {
      return ctx.completedJobs.length > 0;
    },
    render(): SuggestedPrompt {
      return { title: 'Summarize results', message: 'Give me a summary of my last enrichment results' };
    },
  },

  // T017: Power User
  {
    id: 'power_analytics',
    category: PromptCategory.REPORTING,
    subcategory: 'power_user',
    basePriority: 650,
    isApplicable(ctx: PromptContext) {
      return ctx.totalEnrichmentCount >= POWER_USER_JOB_COUNT;
    },
    render(ctx: PromptContext): SuggestedPrompt {
      return { title: 'Usage analytics', message: `Analyze my ${ctx.totalEnrichmentCount} enrichment jobs` };
    },
  },
  {
    id: 'power_compare',
    category: PromptCategory.REPORTING,
    subcategory: 'power_user',
    basePriority: 600,
    isApplicable(ctx: PromptContext) {
      return ctx.completedJobs.length >= 2;
    },
    render(): SuggestedPrompt {
      return { title: 'Compare results', message: 'Compare my last 2 enrichment jobs' };
    },
  },

  // General
  {
    id: 'enrich_new',
    category: PromptCategory.ENRICHMENT,
    subcategory: 'start_new',
    basePriority: 520,
    isApplicable(ctx: PromptContext) {
      return ctx.activeJobs.length === 0;
    },
    render(): SuggestedPrompt {
      return { title: 'New enrichment', message: 'Start a new enrichment job' };
    },
  },

  // Workspace
  {
    id: 'usage_check',
    category: PromptCategory.REPORTING,
    subcategory: 'workspace',
    basePriority: 700,
    isApplicable(ctx: PromptContext) {
      return ctx.workspaceConfig.usagePercentage >= 80;
    },
    render(ctx: PromptContext): SuggestedPrompt {
      const pct = Math.round(ctx.workspaceConfig.usagePercentage);
      return { title: 'Check usage', message: `You've used ${pct}% of your monthly cap` };
    },
  },

  // T032: Channel-specific prompts
  {
    id: 'channel_history',
    category: PromptCategory.CHANNEL_SPECIFIC,
    subcategory: 'history',
    basePriority: 550,
    isApplicable(ctx: PromptContext) {
      return !!ctx.channelEnrichmentHistory && ctx.channelEnrichmentHistory.totalJobs >= 5;
    },
    render(ctx: PromptContext): SuggestedPrompt {
      return { title: 'Channel activity', message: 'Show recent enrichments in this channel' };
    },
  },

  // T033: Document-based prompts
  {
    id: 'doc_enrich',
    category: PromptCategory.CHANNEL_SPECIFIC,
    subcategory: 'document',
    basePriority: 600,
    isApplicable(ctx: PromptContext) {
      return !!ctx.channelDocuments && ctx.channelDocuments.length > 0;
    },
    render(ctx: PromptContext): SuggestedPrompt {
      const doc = ctx.channelDocuments![0];
      return { title: 'Use ICP settings', message: `Enrich using ${doc.slug} configuration` };
    },
  },

  // T034: Preset prompts
  {
    id: 'preset_run',
    category: PromptCategory.CHANNEL_SPECIFIC,
    subcategory: 'preset',
    basePriority: 650,
    isApplicable(ctx: PromptContext) {
      return !!ctx.channelPresets && ctx.channelPresets.length > 0;
    },
    render(ctx: PromptContext): SuggestedPrompt {
      const preset = ctx.channelPresets![0];
      return { title: `Run ${preset.name}`, message: `Start enrichment with ${preset.name} preset` };
    },
  },
];
