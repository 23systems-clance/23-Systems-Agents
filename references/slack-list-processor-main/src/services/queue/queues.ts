import { Queue } from 'bullmq';
import { config } from '../../config/index.js';
import type { ApolloContactFilters } from '../../types/enrichmentFilters.js';
import logger from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Job data interfaces
// ---------------------------------------------------------------------------

/** Data payload for technographic enrichment jobs. */
export interface TechnographicJobData {
  jobId: string;
  companies: Array<{
    rowIndex: number;
    domain?: string;
    companyName?: string;
  }>;
  /** Pre-computed unique domains from quality gate (US3 domain dedup). */
  uniqueDomains?: string[];
  /** When true, skip persistent cache and make fresh BuiltWith API calls (Feature 17). */
  forceRefresh?: boolean;
}

/** Data payload for contact lookup jobs. */
export interface ContactJobData {
  jobId: string;
  companies: Array<{
    jobCompanyId: string;
    domain: string;
    companyName?: string;
  }>;
  purpose: 'COLD_CALLING' | 'EMAILING' | 'JUST_A_LIST' | 'LINKEDIN' | 'ALL';
  /** Apollo contact search filters (uses global default if omitted). */
  contactFilters?: ApolloContactFilters;
  /** When true, skip publishing parse/validate complete events (already published by caller). */
  skipInitialStages?: boolean;
}

/** Data payload for combined technographic + contact enrichment jobs. */
export interface CombinedJobData {
  jobId: string;
  companies: Array<{
    rowIndex: number;
    domain?: string;
    companyName?: string;
  }>;
  purpose: 'COLD_CALLING' | 'EMAILING' | 'JUST_A_LIST' | 'LINKEDIN' | 'ALL';
  /** Apollo contact search filters (uses global default if omitted). */
  contactFilters?: ApolloContactFilters;
  /** Pre-computed unique domains from quality gate (US3 domain dedup). */
  uniqueDomains?: string[];
  /** When true, skip persistent cache and make fresh BuiltWith API calls (Feature 17). */
  forceRefresh?: boolean;
}

/** Data payload for BuiltWith technology report jobs. */
export interface TechReportJobData {
  jobId: string;
  technology: string;
  filters: {
    country?: string;
    stateRegion?: string;
    companySize?: string;
    trafficLevel?: string;
  };
  requestedCount?: number;
  useCachedResult?: string;
}

/** Data payload triggered when Apollo phone numbers are ready. */
export interface PhonesReadyData {
  jobId: string;
}

/** Data payload for result file generation jobs. */
export interface FileGenerationData {
  jobId: string;
  outputFormat: 'CSV' | 'XLSX';
  channelId: string;
  threadTs: string;
}

/** Data payload for email-only waterfall enrichment jobs (Feature 27). */
export interface EmailEnrichmentData {
  jobId: string;
  channelId: string;
  threadTs: string;
}

/** Data payload for document conversion jobs (PDF/DOCX/XLSX → markdown). */
export interface DocumentConversionJobData {
  /** Slack team ID for multi-tenant isolation. */
  teamId: string;
  /** Channel where the document was uploaded. */
  channelId: string;
  /** Thread timestamp for posting conversion result. */
  threadTs: string;
  /** Slack user ID of the uploader. */
  userId: string;
  /** Slack file ID for downloading the original file. */
  slackFileId: string;
  /** Original filename. */
  fileName: string;
  /** MIME type of the original file. */
  mimeType: string;
  /** User-confirmed document type (if already confirmed before conversion). */
  confirmedDocumentType?: 'ICP' | 'USE_CASE' | 'SETTINGS' | 'ONE_PAGER' | 'UNKNOWN';
}

/** Data payload for /analyze report generation jobs. */
export interface AnalysisJobData {
  analysisJobId: string;
  sourceJobIds: string[];
  channelId: string;
  threadTs: string;
  teamId: string;
}

/** Data payload for DNC scrub jobs. */
export interface DncScrubJobData {
  jobId: string;
  channelId: string;
  threadTs: string;
}

/** Data payload for Findymail email verification jobs (US6). */
export interface EmailVerificationData {
  jobId: string;
  channelId: string;
  threadTs: string;
}

// ---------------------------------------------------------------------------
// Shared default job options
// ---------------------------------------------------------------------------

/** Default options applied to every job: 3 attempts with exponential backoff. */
const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 5000,
  },
};

// ---------------------------------------------------------------------------
// Queue definitions
// ---------------------------------------------------------------------------

/**
 * Enrichment queue -- handles technographic, contact, combined, and
 * tech-report jobs.
 */
/** BullMQ connection options using the Redis URL from config. */
const connectionOpts = { url: config.redis.url };

export const enrichmentQueue = new Queue('enrichment', {
  connection: connectionOpts,
  defaultJobOptions: {
    // Enrichment jobs must NOT retry. They are not idempotent: retrying
    // re-processes all companies, creates duplicate contacts/API calls,
    // and loops the Slack progress messages (20%→100% then restart).
    // Per-company errors are already handled inside the worker.
    attempts: 1,
  },
});

/**
 * Phone data queue -- handles phones-ready jobs triggered by Apollo webhooks.
 */
export const phoneDataQueue = new Queue('phone-data', {
  connection: connectionOpts,
  defaultJobOptions,
});

/**
 * File generation queue -- handles generate-result-file jobs that produce
 * CSV / XLSX output and upload to Slack.
 */
export const fileGenerationQueue = new Queue('file-generation', {
  connection: connectionOpts,
  defaultJobOptions,
});

/**
 * Analysis queue -- handles /analyze report generation jobs.
 * Separate queue since analysis is long-running (1-2 min with multiple AI calls).
 */
export const analysisQueue = new Queue('analysis', {
  connection: connectionOpts,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential' as const,
      delay: 10000,
    },
  },
});

/**
 * Email enrichment queue -- handles email-only waterfall enrichment (Feature 27).
 */
export const emailEnrichmentQueue = new Queue('email-enrichment', {
  connection: connectionOpts,
  defaultJobOptions,
});

/**
 * DNC scrub queue -- scrubs enriched phone numbers against the National DNC registry.
 */
export const dncScrubQueue = new Queue<DncScrubJobData>('dnc-scrub', {
  connection: connectionOpts,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential' as const,
      delay: 5000,
    },
  },
});

/**
 * Email verification queue -- verifies enriched emails via Findymail API (US6).
 */
export const emailVerificationQueue = new Queue<EmailVerificationData>(
  'email-verify',
  {
    connection: connectionOpts,
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: 'exponential' as const,
        delay: 5000,
      },
    },
  },
);

/**
 * Document processing queue -- handles PDF/DOCX/XLSX to markdown conversion jobs.
 */
export const documentProcessingQueue = new Queue<DocumentConversionJobData>(
  'document-processing',
  {
    connection: connectionOpts,
    defaultJobOptions,
  },
);

// ---------------------------------------------------------------------------
// Admin Dashboard Queue (Feature 3)
// ---------------------------------------------------------------------------

/** Data payload for daily pre-computation of cost/usage aggregates. */
export interface DailyAggregateJobData {
  /** ISO date to aggregate (yesterday). */
  date: string;
}

/** Data payload for data retention purge jobs. */
export interface RetentionPurgeJobData {
  /** Which data type to purge. */
  dataType: string;
}

/** Data payload for scheduled report generation. */
export interface ScheduledReportJobData {
  /** ScheduledReport ID from the database. */
  reportId: string;
}

/**
 * Admin queue -- handles daily aggregation, retention purge, and
 * scheduled report generation jobs.
 */
export const adminQueue = new Queue('admin', {
  connection: connectionOpts,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential' as const,
      delay: 10000,
    },
  },
});

// ---------------------------------------------------------------------------
// Campaign Queue (Feature 6 - BDR Manager Agent)
// ---------------------------------------------------------------------------

/** Data payload for campaign contact import jobs. */
export interface CampaignImportJobData {
  campaignId: string;
}

/** Data payload for campaign sequence processing jobs. */
export interface CampaignSequenceJobData {
  campaignId: string;
  contactId?: string;
}

/** Data payload for daily BDR DM jobs. */
export interface CampaignDailyDmJobData {
  /** Empty -- processes all active BDRs. */
}

/** Data payload for EOD report jobs. */
export interface CampaignEodReportJobData {
  /** Empty -- processes all active BDRs. */
}

/** Data payload for stuck step check jobs. */
export interface CampaignStuckCheckJobData {
  /** Empty -- scans all contacts at WAITING_WEBHOOK status. */
}

/**
 * Campaign queue -- handles contact import, sequence processing,
 * daily DMs, EOD reports, and stuck step detection.
 */
export const campaignQueue = new Queue('campaign', {
  connection: connectionOpts,
  defaultJobOptions,
});

/**
 * Registers repeatable campaign jobs (daily DM, EOD report, stuck step check).
 * Call once at application startup.
 */
export async function registerCampaignRepeatableJobs(): Promise<void> {
  // Daily DM at configured morning hour (weekdays only)
  await campaignQueue.upsertJobScheduler(
    'daily-dm',
    { pattern: `0 ${config.bdrManager.morningDmHour} * * 1-5` },
    {
      name: 'campaign-daily-dm',
      data: {} satisfies CampaignDailyDmJobData,
    },
  );

  // EOD report at configured evening hour (weekdays only)
  await campaignQueue.upsertJobScheduler(
    'eod-report',
    { pattern: `0 ${config.bdrManager.eodReportHour} * * 1-5` },
    {
      name: 'campaign-eod-report',
      data: {} satisfies CampaignEodReportJobData,
    },
  );

  // Stuck step check every 4 hours
  await campaignQueue.upsertJobScheduler(
    'stuck-step-check',
    { pattern: '0 */4 * * *' },
    {
      name: 'campaign-stuck-check',
      data: {} satisfies CampaignStuckCheckJobData,
    },
  );
}

/**
 * Registers repeatable admin jobs (daily-aggregate and retention-purge).
 * Call once at application startup.
 */
export async function registerAdminRepeatableJobs(): Promise<void> {
  // Daily aggregate at 00:30 UTC.
  await adminQueue.upsertJobScheduler(
    'daily-aggregate',
    { pattern: '30 0 * * *' },
    {
      name: 'daily-aggregate',
      data: { date: '' } satisfies DailyAggregateJobData,
    },
  );

  // Retention purge at 01:00 UTC (after daily aggregation).
  await adminQueue.upsertJobScheduler(
    'retention-purge',
    { pattern: '0 1 * * *' },
    {
      name: 'retention-purge',
      data: { dataType: '' } satisfies RetentionPurgeJobData,
    },
  );

  // Cache purge at 02:00 UTC (Feature 17 — purge expired domain cache entries).
  await adminQueue.upsertJobScheduler(
    'cache-purge',
    { pattern: '0 2 * * *' },
    {
      name: 'cache-purge',
      data: {},
    },
  );
}

// ---------------------------------------------------------------------------
// Onboarding Queue (Feature 7 - BDR Onboarding Agent)
// ---------------------------------------------------------------------------

/** Data payload for daily onboarding DM delivery jobs. */
export interface OnboardingDailyDmJobData {
  /** Enrollment ID to deliver today's module for. */
  enrollmentId: string;
}

/** Data payload for intra-day onboarding automation jobs (check-ins, reminders). */
export interface OnboardingAutomationJobData {
  /** Enrollment ID this automation belongs to. */
  enrollmentId: string;
  /** The automation record ID. */
  automationId: string;
  /** Day number in the plan. */
  dayNumber: number;
}

/** Data payload for the daily onboarding check job. */
export interface OnboardingDailyCheckJobData {
  /** Empty — scans all active/supervised enrollments. */
}

/**
 * Onboarding queue — handles daily module delivery, intra-day automations
 * (check-ins, reminders, weekly summaries), and daily overdue checks.
 * Per-enrollment schedulers are created/removed dynamically via upsertJobScheduler.
 */
export const onboardingQueue = new Queue('onboarding', {
  connection: connectionOpts,
  defaultJobOptions,
});

/**
 * Syncs BullMQ job schedulers for all active onboarding enrollments.
 * Ensures schedules survive ECS task restarts.
 * Call once at application startup after queue creation.
 */
export async function syncOnboardingSchedulers(): Promise<void> {
  const { prisma } = await import('../../models/index.js');

  const activeEnrollments = await prisma.onboardingEnrollment.findMany({
    where: { status: { in: ['ACTIVE', 'SUPERVISED'] } },
    select: { id: true, deliveryHour: true, timezone: true },
  });

  for (const enrollment of activeEnrollments) {
    await onboardingQueue.upsertJobScheduler(
      `onboarding-dm-${enrollment.id}`,
      {
        pattern: `0 ${enrollment.deliveryHour} * * 1-5`,
        tz: enrollment.timezone,
      },
      {
        name: 'onboarding-daily-dm',
        data: { enrollmentId: enrollment.id } satisfies OnboardingDailyDmJobData,
      },
    );
  }

  logger.info('Synced onboarding job schedulers', { count: activeEnrollments.length });
}

/**
 * Registers the repeatable daily onboarding check job.
 * Runs at 6 PM UTC on weekdays to check for overdue/behind-schedule BDRs.
 */
export async function registerOnboardingRepeatableJobs(): Promise<void> {
  await onboardingQueue.upsertJobScheduler(
    'onboarding-daily-check',
    { pattern: '0 18 * * 1-5' },
    {
      name: 'onboarding-daily-check',
      data: {} satisfies OnboardingDailyCheckJobData,
    },
  );
}

// ---------------------------------------------------------------------------
// Retention Queue (Phase 11 - Data Retention & Audit)
// ---------------------------------------------------------------------------

/** Data payload for conversation purge jobs. */
export interface ConversationPurgeJobData {
  /** Empty -- scans all threads with expired turns. */
}

/** Data payload for workspace disposal jobs. */
export interface WorkspaceDisposalJobData {
  /** Empty -- scans all expired workspaces. */
}

/**
 * Retention queue -- handles conversation purge and workspace disposal jobs.
 * Separate queue for data retention operations.
 */
export const retentionQueue = new Queue('retention', {
  connection: connectionOpts,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential' as const,
      delay: 10000,
    },
  },
});

/**
 * Registers repeatable retention jobs (conversation-purge and workspace-disposal).
 * Call once at application startup.
 */
export async function registerRetentionRepeatableJobs(): Promise<void> {
  // Conversation purge at 02:00 UTC daily
  await retentionQueue.upsertJobScheduler(
    'conversation-purge',
    { pattern: '0 2 * * *' },
    {
      name: 'conversation-purge',
      data: {} satisfies ConversationPurgeJobData,
    },
  );

  // Workspace disposal at 03:00 UTC daily
  await retentionQueue.upsertJobScheduler(
    'workspace-disposal',
    { pattern: '0 3 * * *' },
    {
      name: 'workspace-disposal',
      data: {} satisfies WorkspaceDisposalJobData,
    },
  );
}

// ---------------------------------------------------------------------------
// HubSpot Sync Queue (Platform V2 - spec 9)
// ---------------------------------------------------------------------------

/** Data payload for HubSpot batch sync jobs. */
export interface HubSpotSyncJobData {
  executionId: string;
  nodeId: string;
  contacts: Record<string, unknown>[];
  config: Record<string, unknown>;
}

/**
 * HubSpot queue — handles large batch sync operations (>100 contacts)
 * offloaded from the workflow engine to avoid blocking.
 */
export const hubspotQueue = new Queue<HubSpotSyncJobData>('hubspot-sync', {
  connection: connectionOpts,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential' as const,
      delay: 10000,
    },
  },
});

// ---------------------------------------------------------------------------
// Workflow Builder Queue (Feature 7-workflow-builder)
// ---------------------------------------------------------------------------

/** Data payload for workflow delay completion jobs. */
export interface WorkflowDelayJobData {
  executionId: string;
  nodeId: string;
}

/** Data payload for workflow expiry scanning jobs. */
export interface WorkflowExpiryJobData {
  /** Empty — scans all expired executions. */
}

/**
 * Workflow queue — handles delay completion and execution expiry scanning.
 * Delay jobs use BullMQ's built-in delay feature.
 * Expiry scanning runs every 5 minutes via repeatable job.
 */
export const workflowQueue = new Queue('workflow', {
  connection: connectionOpts,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential' as const,
      delay: 5000,
    },
  },
});

/**
 * Registers repeatable workflow jobs (expiry scanning).
 * Call once at application startup.
 */
export async function registerWorkflowRepeatableJobs(): Promise<void> {
  await workflowQueue.upsertJobScheduler(
    'workflow-expiry-scan',
    { pattern: '*/5 * * * *' },
    {
      name: 'workflow-expiry-scan',
      data: {} satisfies WorkflowExpiryJobData,
    },
  );
}

// ---------------------------------------------------------------------------
// HubSpot OAuth Import Queue (Feature 14)
// ---------------------------------------------------------------------------

/** Data payload for HubSpot contact import jobs. */
export interface HubSpotImportJobData {
  /** HubSpotImportJob UUID from the database. */
  importJobId: string;
  /** ManagedClient UUID. */
  clientId: string;
  /** Slack channel ID for progress updates. */
  channelId: string;
  /** Slack thread timestamp for progress updates. */
  threadTs?: string;
}

/**
 * HubSpot import queue — handles async contact upsert and list creation
 * jobs triggered by `/hubspot import` or enrichment completion.
 */
export const hubspotImportQueue = new Queue<HubSpotImportJobData>(
  'hubspot-import',
  {
    connection: connectionOpts,
    defaultJobOptions,
  },
);

/** Data payload for HubSpot activity sync jobs. */
export interface HubSpotActivitySyncJobData {
  /** ManagedClient UUID. */
  clientId: string;
  /** Type of activity event. */
  eventType: 'call' | 'email' | 'meeting';
  /** Internal event ID for deduplication. */
  eventId: string;
  /** Source system: "campaign", "instantly", "heyreach". */
  eventSource: string;
  /** Event payload to push to HubSpot. */
  payload: Record<string, unknown>;
}

/**
 * HubSpot activity sync queue — handles async activity push to HubSpot
 * triggered by campaign webhook receivers.
 */
export const hubspotActivitySyncQueue = new Queue<HubSpotActivitySyncJobData>(
  'hubspot-activity-sync',
  {
    connection: connectionOpts,
    defaultJobOptions,
  },
);

// ---------------------------------------------------------------------------
// Recording Processing Queue (Feature 22 - Power Dialer Phase 5)
// ---------------------------------------------------------------------------

/** Data payload for recording processing jobs (S3 copy + Deepgram transcription). */
export interface RecordingProcessingJobData {
  /** CallRecording UUID. */
  callRecordingId: string;
  /** CallSession UUID. */
  callSessionId: string;
  /** Twilio recording SID. */
  recordingSid: string;
  /** Twilio recording URL (without .wav extension). */
  recordingUrl: string;
  /** ManagedClient UUID for S3 path. */
  clientId: string;
  /** Twilio call SID. */
  callSid: string;
}

/**
 * Recording processing queue — handles S3 copy + Deepgram submission
 * for completed call recordings from the power dialer.
 */
export const recordingProcessingQueue = new Queue<RecordingProcessingJobData>(
  'recording-processing',
  {
    connection: connectionOpts,
    defaultJobOptions,
  },
);

// ---------------------------------------------------------------------------
// Billing Queue
// ---------------------------------------------------------------------------

/**
 * Billing queue — handles monthly credit cycle resets.
 * Runs daily at 00:05 UTC via repeatable job.
 */
export const billingQueue = new Queue('billing', {
  connection: connectionOpts,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential' as const,
      delay: 30000,
    },
  },
});

// ---------------------------------------------------------------------------
// Dialer Inactivity Queue
// ---------------------------------------------------------------------------

/**
 * Dialer inactivity queue — tracks BDR session idle time.
 * When a heartbeat is received, the previous delayed job is removed and a new
 * 30-minute delayed job is enqueued. If the job fires, the session is
 * auto-completed. A second job at 25 minutes fires a warning event.
 */
export const dialerInactivityQueue = new Queue('dialer-inactivity', {
  connection: connectionOpts,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: true,
    removeOnFail: 100,
  },
});

// ---------------------------------------------------------------------------
// Dialer Callback Queue (T077 - Scheduled Callbacks)
// ---------------------------------------------------------------------------

/**
 * Dialer callback queue — handles missed callback detection via repeatable job.
 * Scans every 5 minutes for callbacks that are 30+ minutes overdue and marks
 * them as MISSED.
 */
export const dialerCallbackQueue = new Queue('dialer-callback', {
  connection: connectionOpts,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: true,
    removeOnFail: 100,
  },
});

/**
 * Registers the repeatable missed callback check job.
 * Runs every 5 minutes to detect overdue callbacks.
 * Call once at application startup.
 */
export async function registerDialerCallbackRepeatableJobs(): Promise<void> {
  await dialerCallbackQueue.upsertJobScheduler(
    'missed-callback-check',
    { pattern: '*/5 * * * *' }, // Every 5 minutes
    {
      name: 'missed-callback-check',
      data: {},
    },
  );
}

/**
 * Registers repeatable billing jobs (monthly credit reset).
 * Call once at application startup.
 */
export async function registerBillingRepeatableJobs(): Promise<void> {
  await billingQueue.upsertJobScheduler(
    'billing-cycle-reset',
    { pattern: '5 0 * * *' }, // 00:05 UTC daily
    {
      name: 'billing-cycle-reset',
      data: {},
    },
  );
}

// ---------------------------------------------------------------------------
// Smart Reply Queue (Feature 29)
// ---------------------------------------------------------------------------

/** Data payload for smart reply generation jobs. */
export interface SmartReplyJobData {
  replyId: string;
  tone?: 'professional' | 'casual' | 'assertive' | 'empathetic';
}

/**
 * Smart reply queue -- handles AI draft generation + intent classification
 * for inbound prospect replies. Concurrency of 3 allows parallel draft
 * generation without overwhelming the Claude API.
 */
export const smartReplyQueue = new Queue<SmartReplyJobData>('smart-reply', {
  connection: connectionOpts,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 500 },
  },
});

// ---------------------------------------------------------------------------
// Skill Execution Queue (Feature 39 - Vertical Pack Platform)
// ---------------------------------------------------------------------------

/** Data payload for skill execution jobs. */
export interface SkillExecutionJobData {
  /** SkillExecution record ID (optional for SCHEDULED jobs; created by worker). */
  executionId?: string;
  /** Skill ID to execute. */
  skillId: string;
  /** Workspace initiating the execution. */
  slackTeamId: string;
  /** User who triggered (if applicable). */
  slackUserId?: string;
  /** Input data for the skill. */
  input?: Record<string, unknown>;
  /** Pack subscription to debit credits from. */
  packSubscriptionId?: string;
}

/** Data payload for daily spend reset jobs. */
export interface DailySpendResetJobData {
  /** Empty -- resets all workspaces. */
}

/** Data payload for daily agent actions counter reset jobs (T099). */
export interface DailyAgentActionsResetJobData {
  /** Empty -- resets actionsToday for all agents. */
}

/**
 * Skill execution queue -- handles async skill invocations.
 * Concurrency of 5 allows parallel skill executions.
 */
export const skillExecutionQueue = new Queue<SkillExecutionJobData>(
  'skill-execution',
  {
    connection: connectionOpts,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'exponential' as const, delay: 5000 },
      removeOnComplete: { count: 2000 },
      removeOnFail: { count: 1000 },
    },
  },
);

/**
 * Daily spend reset queue -- resets per-workspace daily spend counters.
 * Uses the admin queue for the repeatable job, defined separately for clarity.
 */
export async function registerPlatformRepeatableJobs(): Promise<void> {
  await adminQueue.upsertJobScheduler(
    'daily-spend-reset',
    { pattern: '0 0 * * *' }, // Midnight UTC daily
    {
      name: 'daily-spend-reset',
      data: {} satisfies DailySpendResetJobData,
    },
  );

  // T099: Reset actionsToday counter for all autonomous agents at midnight UTC.
  await adminQueue.upsertJobScheduler(
    'daily-agent-actions-reset',
    { pattern: '0 0 * * *' }, // Midnight UTC daily
    {
      name: 'daily-agent-actions-reset',
      data: {} satisfies DailyAgentActionsResetJobData,
    },
  );

  logger.info('Platform repeatable jobs registered (daily-spend-reset, daily-agent-actions-reset)');
}
