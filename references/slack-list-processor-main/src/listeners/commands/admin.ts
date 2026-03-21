/**
 * Slash command handler for /admin (T030 + T032-T042).
 *
 * Parses subcommands from the text parameter and routes to internal
 * handler functions. All responses are ephemeral. Each subcommand
 * requires at least a VIEWER role (some require EDITOR or ADMIN).
 */

import type { App, RespondFn } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import type { AdminRole, Job } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { authorizeSlackUser } from '../../slack/middleware/adminAuth.js';
import { recordAction } from '../../services/autonomous/auditRecorder.js';
import { prisma } from '../../models/index.js';
import { enrichmentQueue } from '../../services/queue/queues.js';
import redis from '../../lib/redis.js';
import logger from '../../lib/logger.js';

const log = logger.withContext({ service: 'adminCommand' });

// ---------------------------------------------------------------------------
// Role requirements per subcommand
// ---------------------------------------------------------------------------

const SUBCOMMAND_ROLES: Record<string, AdminRole> = {
  jobs: 'VIEWER',
  job: 'VIEWER',
  cancel: 'EDITOR',
  usage: 'VIEWER',
  errors: 'VIEWER',
  workflows: 'VIEWER',
  workers: 'VIEWER',
  cache: 'ADMIN',
  config: 'VIEWER',
  audit: 'VIEWER',
  help: 'VIEWER',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Formats a Date as a short readable string. */
function fmtDate(date: Date | null | undefined): string {
  if (!date) return 'N/A';
  return date.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

/** Builds a simple text-based progress bar. */
function progressBar(current: number, total: number, width = 10): string {
  if (total <= 0) return '`[----------]` 0%';
  const pct = Math.min(current / total, 1);
  const filled = Math.round(pct * width);
  const empty = width - filled;
  return `\`[${'#'.repeat(filled)}${'-'.repeat(empty)}]\` ${Math.round(pct * 100)}%`;
}

/** Maps DB JobStatus to a display-friendly label. */
function statusEmoji(status: string): string {
  const map: Record<string, string> = {
    PENDING: '[PENDING]',
    PROCESSING: '[RUNNING]',
    AWAITING_PHONES: '[AWAITING PHONES]',
    AWAITING_DNC_DECISION: '[AWAITING DNC]',
    AWAITING_EMAIL_VERIFICATION: '[AWAITING EMAIL VERIFY]',
    COMPLETED: '[DONE]',
    FAILED: '[FAILED]',
    CANCELLED: '[CANCELLED]',
  };
  return map[status] ?? `[${status}]`;
}

/**
 * Finds a Job by full or partial UUID prefix.
 * Tries exact match first; falls back to raw SQL LIKE on the text cast.
 */
async function findJobByIdPrefix(
  jobIdPrefix: string,
  select: Record<string, boolean>,
): Promise<Record<string, unknown> | null> {
  // Try exact match first (most common case)
  const exact = await prisma.job.findUnique({
    where: { id: jobIdPrefix },
    select,
  });
  if (exact) return exact as unknown as Record<string, unknown>;

  // Fall back to prefix search via raw SQL to get the ID, then query with select
  const matchingIds = await prisma.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id FROM jobs WHERE CAST(id AS TEXT) LIKE ${jobIdPrefix + '%'} LIMIT 1`,
  );
  if (matchingIds.length === 0) return null;

  const found = await prisma.job.findUnique({
    where: { id: matchingIds[0].id },
    select,
  });
  return found as unknown as Record<string, unknown>;
}

/** Records an audit action for an admin command invocation. */
async function auditCommand(
  action: string,
  adminUserId: string | undefined,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await recordAction({
      agentName: 'admin-command',
      action,
      confidence: 1.0,
      severity: 'INFO',
      outcome: 'AUTO_EXECUTED',
      metadata,
      adminUserId,
    });
  } catch (err) {
    log.warn('Failed to record admin command audit', {
      action,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Subcommand: jobs [status]
// ---------------------------------------------------------------------------

/**
 * Lists enrichment jobs, optionally filtered by status (T032).
 * Paginates to 10 items per response.
 */
async function handleJobs(
  args: string[],
  respond: RespondFn,
  adminUserId: string | undefined,
): Promise<void> {
  const statusFilter = args[0]?.toUpperCase();

  const validStatuses: Record<string, string> = {
    RUNNING: 'PROCESSING',
    PROCESSING: 'PROCESSING',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
    PENDING: 'PENDING',
    CANCELLED: 'CANCELLED',
  };

  const where: Record<string, unknown> = {};
  if (statusFilter && validStatuses[statusFilter]) {
    where.status = validStatuses[statusFilter];
  } else if (statusFilter) {
    await respond({
      response_type: 'ephemeral',
      text: `Unknown status filter: \`${statusFilter}\`. Valid: running, completed, failed, pending, cancelled.`,
    });
    return;
  }

  const jobs = await prisma.job.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      status: true,
      jobType: true,
      sourceFileName: true,
      sourceRowCount: true,
      companiesProcessed: true,
      createdAt: true,
      slackUserId: true,
    },
  });

  if (jobs.length === 0) {
    await respond({
      response_type: 'ephemeral',
      text: statusFilter
        ? `No jobs found with status \`${statusFilter}\`.`
        : 'No jobs found.',
    });
    await auditCommand('jobs_list', adminUserId, { statusFilter, count: 0 });
    return;
  }

  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: statusFilter ? `Jobs (${statusFilter})` : 'Recent Jobs' },
    },
  ];

  for (const job of jobs) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          `*ID*: \`${job.id.slice(0, 8)}\`  ${statusEmoji(job.status)}`,
          `*Type*: ${job.jobType} | *File*: ${job.sourceFileName ?? 'N/A'}`,
          `*Rows*: ${job.sourceRowCount ?? 0} | *Processed*: ${job.companiesProcessed}`,
          `*User*: <@${job.slackUserId}> | *Created*: ${fmtDate(job.createdAt)}`,
        ].join('\n'),
      },
    });
    blocks.push({ type: 'divider' });
  }

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `Showing ${jobs.length} job(s). Use \`/admin job <id>\` for details.` }],
  });

  await respond({ response_type: 'ephemeral', blocks });
  await auditCommand('jobs_list', adminUserId, { statusFilter, count: jobs.length });
}

// ---------------------------------------------------------------------------
// Subcommand: job <id>
// ---------------------------------------------------------------------------

/**
 * Shows full details for a single enrichment job (T033).
 */
async function handleJobDetail(
  args: string[],
  respond: RespondFn,
  adminUserId: string | undefined,
): Promise<void> {
  const jobId = args[0];
  if (!jobId) {
    await respond({ response_type: 'ephemeral', text: 'Usage: `/admin job <id>`' });
    return;
  }

  // Support partial ID prefix matching
  const jobSelect = {
    id: true,
    status: true,
    jobType: true,
    sourceFileName: true,
    sourceRowCount: true,
    companiesProcessed: true,
    companiesFailed: true,
    contactsFound: true,
    totalCost: true,
    providersUsed: true,
    enrichmentMode: true,
    errorMessage: true,
    cacheHits: true,
    cacheMisses: true,
    slackUserId: true,
    slackChannelId: true,
    bullmqJobId: true,
    createdAt: true,
    startedAt: true,
    completedAt: true,
  };
  const job = await findJobByIdPrefix(jobId, jobSelect) as {
    id: string; status: string; jobType: string;
    sourceFileName: string | null; sourceRowCount: number | null;
    companiesProcessed: number; companiesFailed: number; contactsFound: number;
    totalCost: number; providersUsed: string[]; enrichmentMode: string | null;
    errorMessage: string | null; cacheHits: number; cacheMisses: number;
    slackUserId: string; slackChannelId: string; bullmqJobId: string | null;
    createdAt: Date; startedAt: Date | null; completedAt: Date | null;
  } | null;

  if (!job) {
    await respond({ response_type: 'ephemeral', text: `Job not found: \`${jobId}\`` });
    return;
  }

  const rowTotal = job.sourceRowCount ?? 0;
  const lines = [
    `*Job ID*: \`${job.id}\``,
    `*Status*: ${statusEmoji(job.status)}`,
    `*Type*: ${job.jobType} | *Mode*: ${job.enrichmentMode ?? 'N/A'}`,
    `*File*: ${job.sourceFileName ?? 'N/A'}`,
    `*Progress*: ${progressBar(job.companiesProcessed, rowTotal)} (${job.companiesProcessed}/${rowTotal})`,
    `*Failed*: ${job.companiesFailed} | *Contacts Found*: ${job.contactsFound}`,
    `*Cache*: ${job.cacheHits} hits / ${job.cacheMisses} misses`,
    `*Cost*: $${job.totalCost.toFixed(4)} | *Providers*: ${job.providersUsed.join(', ') || 'N/A'}`,
    `*User*: <@${job.slackUserId}> | *Channel*: <#${job.slackChannelId}>`,
    `*Created*: ${fmtDate(job.createdAt)}`,
    `*Started*: ${fmtDate(job.startedAt)}`,
    `*Completed*: ${fmtDate(job.completedAt)}`,
    job.errorMessage ? `*Error*: \`${job.errorMessage.slice(0, 200)}\`` : '',
  ].filter(Boolean);

  await respond({
    response_type: 'ephemeral',
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'Job Details' } },
      { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } },
    ],
  });

  await auditCommand('job_detail', adminUserId, { jobId: job.id });
}

// ---------------------------------------------------------------------------
// Subcommand: cancel <id>
// ---------------------------------------------------------------------------

/**
 * Shows a confirmation button to cancel a running job (T034).
 * The actual cancellation happens in the action handler below.
 */
async function handleCancel(
  args: string[],
  respond: RespondFn,
  adminUserId: string | undefined,
): Promise<void> {
  const jobId = args[0];
  if (!jobId) {
    await respond({ response_type: 'ephemeral', text: 'Usage: `/admin cancel <id>`' });
    return;
  }

  const job = await findJobByIdPrefix(jobId, {
    id: true, status: true, sourceFileName: true, bullmqJobId: true,
  }) as {
    id: string; status: string; sourceFileName: string | null; bullmqJobId: string | null;
  } | null;

  if (!job) {
    await respond({ response_type: 'ephemeral', text: `Job not found: \`${jobId}\`` });
    return;
  }

  const activeStatuses = ['PENDING', 'PROCESSING', 'AWAITING_PHONES', 'AWAITING_DNC_DECISION', 'AWAITING_EMAIL_VERIFICATION'];
  if (!activeStatuses.includes(job.status)) {
    await respond({
      response_type: 'ephemeral',
      text: `Job \`${job.id.slice(0, 8)}\` is already ${job.status}. Only active jobs can be cancelled.`,
    });
    return;
  }

  await respond({
    response_type: 'ephemeral',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Are you sure you want to cancel job \`${job.id.slice(0, 8)}\` (${job.sourceFileName ?? 'unknown file'})?\nCurrent status: ${statusEmoji(job.status)}`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Confirm Cancel' },
            style: 'danger',
            action_id: `admin_cancel_confirm_${job.id}`,
            value: job.id,
          },
        ],
      },
    ],
  });

  await auditCommand('cancel_requested', adminUserId, { jobId: job.id });
}

// ---------------------------------------------------------------------------
// Subcommand: usage [daily|weekly]
// ---------------------------------------------------------------------------

/**
 * Aggregates API usage by provider over a time window (T035).
 */
async function handleUsage(
  args: string[],
  respond: RespondFn,
  adminUserId: string | undefined,
): Promise<void> {
  const period = (args[0] ?? 'daily').toLowerCase();
  const hours = period === 'weekly' ? 168 : 24;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  // Aggregate API usage by service
  const apiUsage = await prisma.apiUsageLog.groupBy({
    by: ['service'],
    where: { createdAt: { gte: since } },
    _sum: { requestCount: true, creditsConsumed: true, estimatedCostUsd: true },
    _count: true,
  });

  // Aggregate Claude/AI invocation costs
  const aiCosts = await prisma.agentInvocation.aggregate({
    where: { createdAt: { gte: since } },
    _sum: { costUsd: true, tokensInput: true, tokensOutput: true },
    _count: true,
  });

  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `API Usage (${period === 'weekly' ? 'Last 7 Days' : 'Last 24 Hours'})` },
    },
  ];

  if (apiUsage.length === 0 && (aiCosts._count ?? 0) === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: 'No API usage recorded in this period.' },
    });
  } else {
    // Max requests for bar scaling
    const maxReqs = Math.max(...apiUsage.map((u) => u._count), 1);

    for (const usage of apiUsage) {
      const barWidth = 10;
      const filled = Math.round((usage._count / maxReqs) * barWidth);
      const bar = `\`${'#'.repeat(filled)}${'-'.repeat(barWidth - filled)}\``;
      const cost = Number(usage._sum.estimatedCostUsd ?? 0).toFixed(4);
      const credits = Number(usage._sum.creditsConsumed ?? 0).toFixed(1);

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${usage.service}*\n${bar} ${usage._count} requests | Credits: ${credits} | Cost: $${cost}`,
        },
      });
    }

    if ((aiCosts._count ?? 0) > 0) {
      blocks.push({ type: 'divider' });
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            '*Claude AI Invocations*',
            `Invocations: ${aiCosts._count}`,
            `Tokens: ${Number(aiCosts._sum.tokensInput ?? 0).toLocaleString()} in / ${Number(aiCosts._sum.tokensOutput ?? 0).toLocaleString()} out`,
            `Cost: $${Number(aiCosts._sum.costUsd ?? 0).toFixed(4)}`,
          ].join('\n'),
        },
      });
    }
  }

  await respond({ response_type: 'ephemeral', blocks });
  await auditCommand('usage_report', adminUserId, { period, hours });
}

// ---------------------------------------------------------------------------
// Subcommand: errors [count]
// ---------------------------------------------------------------------------

/**
 * Shows recent errors grouped by category (T036).
 */
async function handleErrors(
  args: string[],
  respond: RespondFn,
  adminUserId: string | undefined,
): Promise<void> {
  const limit = Math.min(parseInt(args[0] ?? '10', 10) || 10, 25);

  const errors = await prisma.errorLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      category: true,
      service: true,
      message: true,
      lifecycleState: true,
      jobId: true,
      createdAt: true,
    },
  });

  if (errors.length === 0) {
    await respond({ response_type: 'ephemeral', text: 'No error records found.' });
    await auditCommand('errors_list', adminUserId, { count: 0 });
    return;
  }

  // Group by category for summary
  const byCategory: Record<string, number> = {};
  for (const err of errors) {
    byCategory[err.category] = (byCategory[err.category] ?? 0) + 1;
  }

  const summaryLines = Object.entries(byCategory)
    .map(([cat, count]) => `  ${cat}: ${count}`)
    .join('\n');

  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `Recent Errors (${errors.length})` },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*By category:*\n\`\`\`\n${summaryLines}\n\`\`\`` },
    },
    { type: 'divider' },
  ];

  for (const err of errors.slice(0, 5)) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          `*${err.category}* | ${err.service} | \`${err.lifecycleState}\``,
          `\`${err.message.slice(0, 150)}\``,
          `Job: ${err.jobId ? `\`${err.jobId.slice(0, 8)}\`` : 'N/A'} | ${fmtDate(err.createdAt)}`,
        ].join('\n'),
      },
    });
  }

  if (errors.length > 5) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Showing 5 of ${errors.length}. Use \`/admin errors ${limit}\` to see more.` }],
    });
  }

  await respond({ response_type: 'ephemeral', blocks });
  await auditCommand('errors_list', adminUserId, { count: errors.length });
}

// ---------------------------------------------------------------------------
// Subcommand: workflows
// ---------------------------------------------------------------------------

/**
 * Shows active jobs with step-level progress (T037).
 */
async function handleWorkflows(
  respond: RespondFn,
  adminUserId: string | undefined,
): Promise<void> {
  const activeJobs = await prisma.job.findMany({
    where: { status: { in: ['PROCESSING', 'PENDING', 'AWAITING_PHONES', 'AWAITING_DNC_DECISION', 'AWAITING_EMAIL_VERIFICATION'] } },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      status: true,
      jobType: true,
      sourceFileName: true,
      sourceRowCount: true,
      companiesProcessed: true,
      contactsFound: true,
      createdAt: true,
      slackUserId: true,
    },
  });

  if (activeJobs.length === 0) {
    await respond({ response_type: 'ephemeral', text: 'No active workflows.' });
    await auditCommand('workflows_list', adminUserId, { count: 0 });
    return;
  }

  const blocks: KnownBlock[] = [
    { type: 'header', text: { type: 'plain_text', text: 'Active Workflows' } },
  ];

  for (const job of activeJobs) {
    const rowTotal = job.sourceRowCount ?? 0;
    const stage = job.status === 'PROCESSING'
      ? (job.contactsFound > 0 ? 'contact_enrichment' : 'builtwith_lookup')
      : job.status.toLowerCase().replace(/_/g, ' ');

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          `*\`${job.id.slice(0, 8)}\`* | ${job.jobType} | <@${job.slackUserId}>`,
          `File: ${job.sourceFileName ?? 'N/A'}`,
          `Stage: *${stage}*`,
          `Progress: ${progressBar(job.companiesProcessed, rowTotal)} (${job.companiesProcessed}/${rowTotal})`,
        ].join('\n'),
      },
    });
    blocks.push({ type: 'divider' });
  }

  await respond({ response_type: 'ephemeral', blocks });
  await auditCommand('workflows_list', adminUserId, { count: activeJobs.length });
}

// ---------------------------------------------------------------------------
// Subcommand: workers
// ---------------------------------------------------------------------------

/**
 * Shows BullMQ queue stats and worker config (T038).
 */
async function handleWorkers(
  respond: RespondFn,
  adminUserId: string | undefined,
): Promise<void> {
  // Get enrichment queue counts
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    enrichmentQueue.getWaitingCount(),
    enrichmentQueue.getActiveCount(),
    enrichmentQueue.getCompletedCount(),
    enrichmentQueue.getFailedCount(),
    enrichmentQueue.getDelayedCount(),
  ]);

  // Get worker configs from DB
  const workerConfigs = await prisma.workerConfig.findMany({
    orderBy: { workerName: 'asc' },
  });

  const blocks: KnownBlock[] = [
    { type: 'header', text: { type: 'plain_text', text: 'Worker Status' } },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          '*Enrichment Queue*',
          `\`\`\``,
          `Waiting:   ${waiting}`,
          `Active:    ${active}`,
          `Delayed:   ${delayed}`,
          `Completed: ${completed}`,
          `Failed:    ${failed}`,
          `\`\`\``,
        ].join('\n'),
      },
    },
  ];

  if (workerConfigs.length > 0) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Worker Concurrency Configs*',
      },
    });

    for (const wc of workerConfigs) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${wc.workerName}*: concurrency=${wc.concurrency} | Updated by: ${wc.updatedBy} | ${fmtDate(wc.updatedAt)}`,
        },
      });
    }
  }

  await respond({ response_type: 'ephemeral', blocks });
  await auditCommand('workers_status', adminUserId, { waiting, active, completed, failed });
}

// ---------------------------------------------------------------------------
// Subcommand: cache purge [scope]
// ---------------------------------------------------------------------------

/**
 * Shows a confirmation button to purge Redis cache (T039).
 * Requires ADMIN role.
 */
async function handleCachePurge(
  args: string[],
  respond: RespondFn,
  adminUserId: string | undefined,
): Promise<void> {
  const scope = args[1] ?? 'all'; // args[0] is 'purge'

  const validScopes = ['all', 'enrichment', 'apollo', 'domain'];
  if (!validScopes.includes(scope)) {
    await respond({
      response_type: 'ephemeral',
      text: `Invalid cache scope: \`${scope}\`. Valid: ${validScopes.join(', ')}`,
    });
    return;
  }

  await respond({
    response_type: 'ephemeral',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Are you sure you want to purge the *${scope}* cache? This action cannot be undone.`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Confirm Purge' },
            style: 'danger',
            action_id: 'admin_cache_purge_confirm',
            value: scope,
          },
        ],
      },
    ],
  });

  await auditCommand('cache_purge_requested', adminUserId, { scope });
}

// ---------------------------------------------------------------------------
// Subcommand: config [section]
// ---------------------------------------------------------------------------

/**
 * Displays current system configuration values (T040).
 * VIEWER+ can read; ADMIN required for writes (future modals).
 */
async function handleConfig(
  args: string[],
  respond: RespondFn,
  adminUserId: string | undefined,
): Promise<void> {
  const section = (args[0] ?? 'overview').toLowerCase();

  const blocks: KnownBlock[] = [
    { type: 'header', text: { type: 'plain_text', text: 'System Configuration' } },
  ];

  if (section === 'cache' || section === 'overview') {
    const cacheConfig = await prisma.cacheConfig.findFirst();
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          '*Cache Settings*',
          `Enabled: ${cacheConfig?.enabled ?? true}`,
          `Domain TTL: ${cacheConfig?.ttlDays ?? 60} days`,
          `Apollo Search TTL: ${cacheConfig?.apolloSearchTtlDays ?? 14} days`,
          `Apollo Contact TTL: ${cacheConfig?.apolloContactTtlDays ?? 30} days`,
        ].join('\n'),
      },
    });
  }

  if (section === 'retention' || section === 'overview') {
    const retentionConfigs = await prisma.retentionConfig.findMany({
      orderBy: { dataType: 'asc' },
    });

    if (retentionConfigs.length > 0) {
      blocks.push({ type: 'divider' });
      const retLines = retentionConfigs.map(
        (rc) => `  ${rc.dataType}: ${rc.retentionDays} days (last purged: ${fmtDate(rc.lastPurgedAt)})`,
      );
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Retention Policies*\n\`\`\`\n${retLines.join('\n')}\n\`\`\``,
        },
      });
    }
  }

  if (section === 'workers' || section === 'overview') {
    const workerConfigs = await prisma.workerConfig.findMany({
      orderBy: { workerName: 'asc' },
    });

    if (workerConfigs.length > 0) {
      blocks.push({ type: 'divider' });
      const wcLines = workerConfigs.map(
        (wc) => `  ${wc.workerName}: concurrency=${wc.concurrency}`,
      );
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Worker Configs*\n\`\`\`\n${wcLines.join('\n')}\n\`\`\``,
        },
      });
    }
  }

  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: 'Sections: `overview`, `cache`, `retention`, `workers`. Writes require ADMIN role.',
    }],
  });

  await respond({ response_type: 'ephemeral', blocks });
  await auditCommand('config_view', adminUserId, { section });
}

// ---------------------------------------------------------------------------
// Subcommand: audit [hours] (T058)
// ---------------------------------------------------------------------------

/**
 * Helper to format a Date as a readable UTC string for audit display.
 */
function fmtAuditDate(date: Date | null | undefined): string {
  if (!date) return 'N/A';
  return date.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

/**
 * Displays the autonomous agent audit trail for the past N hours (T058).
 *
 * Accepts an optional hours argument (default 24). The alias "today" queries
 * from midnight UTC. Shows the first 20 results with a "Load More" button
 * if additional entries exist.
 *
 * @param args - Subcommand arguments (first element is hours or "today")
 * @param respond - Slack respond function
 * @param adminUserId - ID of the invoking admin user
 */
async function handleAudit(
  args: string[],
  respond: RespondFn,
  adminUserId: string | undefined,
): Promise<void> {
  const PAGE_SIZE = 20;
  let hours = 24;
  const rawArg = args[0]?.toLowerCase();

  let since: Date;
  if (rawArg === 'today') {
    // "today" means since midnight UTC
    const now = new Date();
    since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    hours = (Date.now() - since.getTime()) / (60 * 60 * 1000);
  } else if (rawArg && !isNaN(Number(rawArg))) {
    hours = Math.max(1, Math.min(Number(rawArg), 720)); // cap at 30 days
    since = new Date(Date.now() - hours * 60 * 60 * 1000);
  } else {
    since = new Date(Date.now() - hours * 60 * 60 * 1000);
  }

  const actions = await prisma.auditAction.findMany({
    where: { timestamp: { gte: since } },
    orderBy: { timestamp: 'desc' },
    take: PAGE_SIZE + 1, // fetch one extra to detect overflow
  });

  const hasMore = actions.length > PAGE_SIZE;
  const pageActions = hasMore ? actions.slice(0, PAGE_SIZE) : actions;

  if (pageActions.length === 0) {
    const label = rawArg === 'today' ? 'today' : `the past ${Math.round(hours)} hours`;
    await respond({
      response_type: 'ephemeral',
      text: `No autonomous agent actions in ${label}.`,
    });
    await auditCommand('audit_view', adminUserId, { hours, count: 0 });
    return;
  }

  const label = rawArg === 'today' ? 'Today' : `Past ${Math.round(hours)}h`;
  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `Audit Trail — ${label} (${pageActions.length}${hasMore ? '+' : ''} actions)` },
    },
  ];

  for (const a of pageActions) {
    const severityTag = a.severity ? `[${a.severity}]` : '';
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          `*${a.agentName}* ${severityTag}`,
          `Action: \`${a.action}\` | Confidence: ${((a.confidence ?? 0) * 100).toFixed(0)}%`,
          `Outcome: *${a.outcome}* | ${fmtAuditDate(a.timestamp)}`,
        ].join('\n'),
      },
    });
    blocks.push({ type: 'divider' });
  }

  if (hasMore) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Load More' },
          action_id: 'admin_audit_load_more',
          value: JSON.stringify({ offset: PAGE_SIZE, hours: Math.round(hours) }),
        },
      ],
    });
  } else {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Showing ${pageActions.length} action(s). End of results.` }],
    });
  }

  await respond({ response_type: 'ephemeral', blocks });
  await auditCommand('audit_view', adminUserId, { hours, count: pageActions.length });
}

// ---------------------------------------------------------------------------
// Subcommand: help
// ---------------------------------------------------------------------------

/**
 * Lists all /admin subcommands with descriptions and role requirements (T041).
 */
async function handleHelp(respond: RespondFn): Promise<void> {
  const helpText = [
    '*`/admin` — Admin Command Center*',
    '',
    '*Available subcommands:*',
    '',
    '`/admin jobs [status]` — List enrichment jobs (VIEWER)',
    '  Status filters: running, completed, failed, pending, cancelled',
    '',
    '`/admin job <id>` — View full job details (VIEWER)',
    '  Supports partial ID prefix matching',
    '',
    '`/admin cancel <id>` — Cancel a running job (EDITOR)',
    '  Shows confirmation before cancelling',
    '',
    '`/admin usage [daily|weekly]` — API usage summary (VIEWER)',
    '  Aggregates by provider with cost breakdown',
    '',
    '`/admin errors [count]` — Recent errors (VIEWER)',
    '  Default: 10, max: 25',
    '',
    '`/admin workflows` — Active job workflows (VIEWER)',
    '  Shows step-level progress for running jobs',
    '',
    '`/admin workers` — Queue and worker status (VIEWER)',
    '  BullMQ queue counts and concurrency config',
    '',
    '`/admin cache purge [scope]` — Purge Redis cache (ADMIN)',
    '  Scopes: all, enrichment, apollo, domain',
    '',
    '`/admin config [section]` — System configuration (VIEWER read / ADMIN write)',
    '  Sections: overview, cache, retention, workers',
    '',
    '`/admin audit [hours]` — Autonomous agent audit trail (VIEWER)',
    '  Default: 24 hours. Use "today" for since midnight.',
    '',
    '`/admin help` — This help message (VIEWER)',
  ].join('\n');

  await respond({
    response_type: 'ephemeral',
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: helpText } },
    ],
  });
}

// ---------------------------------------------------------------------------
// Main command registration
// ---------------------------------------------------------------------------

/**
 * Registers the /admin slash command and associated action handlers.
 *
 * @param app - The Slack Bolt application instance.
 */
export function registerAdminCommand(app: App): void {
  app.command('/admin', async ({ command, ack, respond }) => {
    await ack();

    const rawText = (command.text ?? '').trim();
    const parts = rawText.split(/\s+/).filter(Boolean);
    const subcommand = (parts[0] ?? 'help').toLowerCase();
    const subArgs = parts.slice(1);

    log.info('Admin command received', {
      userId: command.user_id,
      subcommand,
      args: subArgs,
    });

    // Resolve role requirement
    const requiredRole = SUBCOMMAND_ROLES[subcommand];
    if (!requiredRole) {
      await respond({
        response_type: 'ephemeral',
        text: `Unknown subcommand: \`${subcommand}\`. Use \`/admin help\` for available commands.`,
      });
      return;
    }

    // Authorize
    const authResult = await authorizeSlackUser(command.user_id, requiredRole);
    if (!authResult.authorized) {
      await respond({
        response_type: 'ephemeral',
        text: authResult.error ?? 'Unauthorized.',
      });
      return;
    }

    const adminUserId = authResult.adminUser?.id;

    try {
      switch (subcommand) {
        case 'jobs':
          await handleJobs(subArgs, respond, adminUserId);
          break;
        case 'job':
          await handleJobDetail(subArgs, respond, adminUserId);
          break;
        case 'cancel':
          await handleCancel(subArgs, respond, adminUserId);
          break;
        case 'usage':
          await handleUsage(subArgs, respond, adminUserId);
          break;
        case 'errors':
          await handleErrors(subArgs, respond, adminUserId);
          break;
        case 'workflows':
          await handleWorkflows(respond, adminUserId);
          break;
        case 'workers':
          await handleWorkers(respond, adminUserId);
          break;
        case 'cache':
          if (subArgs[0] === 'purge') {
            await handleCachePurge(subArgs, respond, adminUserId);
          } else {
            await respond({
              response_type: 'ephemeral',
              text: 'Usage: `/admin cache purge [scope]`. Scopes: all, enrichment, apollo, domain.',
            });
          }
          break;
        case 'config':
          await handleConfig(subArgs, respond, adminUserId);
          break;
        case 'audit':
          await handleAudit(subArgs, respond, adminUserId);
          break;
        case 'help':
          await handleHelp(respond);
          break;
        default:
          await respond({
            response_type: 'ephemeral',
            text: `Unknown subcommand: \`${subcommand}\`. Use \`/admin help\` for available commands.`,
          });
      }
    } catch (error) {
      log.error('Admin command handler error', {
        subcommand,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      await respond({
        response_type: 'ephemeral',
        text: `An error occurred while executing \`/admin ${subcommand}\`. Please try again or contact support.`,
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Action: Cancel confirmation (T034)
  // ---------------------------------------------------------------------------

  app.action(/^admin_cancel_confirm_/, async ({ action, ack, respond }) => {
    await ack();

    const jobId = 'value' in action ? (action.value ?? '') : '';
    if (!jobId) {
      await respond({ response_type: 'ephemeral', text: 'Missing job ID.' });
      return;
    }

    try {
      // Update job status in DB
      const job = await prisma.job.update({
        where: { id: jobId },
        data: { status: 'CANCELLED', completedAt: new Date() },
        select: { id: true, bullmqJobId: true, sourceFileName: true },
      });

      // Attempt to remove from BullMQ
      if (job.bullmqJobId) {
        try {
          const bullJob = await enrichmentQueue.getJob(job.bullmqJobId);
          if (bullJob) {
            const state = await bullJob.getState();
            if (state === 'waiting' || state === 'delayed') {
              await bullJob.remove();
            } else if (state === 'active') {
              await bullJob.moveToFailed(new Error('Cancelled by admin'), '', true);
            }
          }
        } catch (queueErr) {
          log.warn('Failed to remove BullMQ job during cancel', {
            jobId: job.id,
            bullmqJobId: job.bullmqJobId,
            error: queueErr instanceof Error ? queueErr.message : String(queueErr),
          });
        }
      }

      await respond({
        response_type: 'ephemeral',
        text: `Job \`${job.id.slice(0, 8)}\` (${job.sourceFileName ?? 'unknown'}) has been cancelled.`,
      });

      await auditCommand('job_cancelled', undefined, { jobId: job.id });
    } catch (error) {
      log.error('Failed to cancel job', {
        jobId,
        error: error instanceof Error ? error.message : String(error),
      });
      await respond({
        response_type: 'ephemeral',
        text: `Failed to cancel job \`${jobId.slice(0, 8)}\`: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Action: Cache purge confirmation (T039)
  // ---------------------------------------------------------------------------

  app.action('admin_cache_purge_confirm', async ({ action, ack, respond }) => {
    await ack();

    const scope = 'value' in action ? (action.value ?? 'all') : 'all';

    try {
      let deletedCount = 0;

      const scopePatterns: Record<string, string[]> = {
        all: ['bull:*', 'cache:*', 'enrichment:*', 'apollo:*', 'domain:*'],
        enrichment: ['enrichment:*', 'cache:enrichment:*'],
        apollo: ['apollo:*', 'cache:apollo:*'],
        domain: ['domain:*', 'cache:domain:*'],
      };

      const patterns = scopePatterns[scope] ?? scopePatterns['all'];

      for (const pattern of patterns) {
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
          await redis.del(...keys);
          deletedCount += keys.length;
        }
      }

      await respond({
        response_type: 'ephemeral',
        text: `Cache purge complete (scope: *${scope}*). Deleted ${deletedCount} key(s).`,
      });

      await auditCommand('cache_purged', undefined, { scope, deletedCount });
    } catch (error) {
      log.error('Cache purge failed', {
        scope,
        error: error instanceof Error ? error.message : String(error),
      });
      await respond({
        response_type: 'ephemeral',
        text: `Cache purge failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  });

  log.info('Registered /admin command handler');
}
