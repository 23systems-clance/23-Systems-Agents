/**
 * Single BullMQ dispatcher worker for the 'enrichment' queue.
 *
 * Routes incoming jobs to the correct processor based on `job.name`.
 * This replaces the previous pattern of 4 individual workers all
 * listening on the same queue, which caused a race condition where
 * the wrong worker would consume a job, return early, and BullMQ
 * would mark it as "completed" before the correct worker saw it.
 *
 * Feature 39: When the `platformSkillRouting` feature flag is enabled
 * for a workspace, enrichment jobs are routed through the platform's
 * skill execution engine instead of calling services directly.
 */

import { Worker, Job } from 'bullmq';
import { config } from '../../../config/index.js';
import { processTechnographicJob } from './technographic.js';
import { processContactJob } from './contact.js';
import { processCombinedEnrichment } from './combined.js';
import { processTechReport } from './techReport.js';
import { logError } from '../../../services/admin/errorLogger.js';
import { publishProgress } from '../../agent/taskVisualizer.js';
import { prisma } from '../../../models/index.js';
import { resolveFeatureFlags, isFeatureEnabled } from '../../featureToggle/featureFlags.js';
import { executeSkill } from '../../platform/skillExecutor.js';
import logger from '../../../lib/logger.js';

const log = logger.withContext({ service: 'enrichmentDispatcher' });

/**
 * Job name to processor mapping (legacy direct routing).
 */
const processors: Record<string, (job: Job) => Promise<void>> = {
  'technographic-enrichment': processTechnographicJob,
  'contact-enrichment': processContactJob,
  'combined-enrichment': processCombinedEnrichment,
  'tech-report': processTechReport,
};

/**
 * Job name → skill slug mapping for platform routing.
 */
const JOB_TO_SKILL: Record<string, string> = {
  'technographic-enrichment': 'file-enrichment',
  'contact-enrichment': 'contact-enrichment',
  'combined-enrichment': 'file-enrichment',
  'tech-report': 'tech-report',
};

/**
 * Checks whether platform skill routing is enabled for the workspace.
 */
async function shouldRouteThroughPlatform(slackTeamId: string): Promise<boolean> {
  try {
    const workspace = await prisma.workspaceInstallation.findUnique({
      where: { slackTeamId },
      select: { featureFlags: true },
    });
    const flags = resolveFeatureFlags(
      slackTeamId,
      workspace?.featureFlags as Record<string, boolean> | null,
    );
    return isFeatureEnabled(flags, 'platformSkillRouting');
  } catch {
    return false;
  }
}

/**
 * Routes an enrichment job through the platform skill execution engine.
 */
async function routeViaPlatform(job: Job): Promise<void> {
  const skillSlug = JOB_TO_SKILL[job.name];
  if (!skillSlug) {
    throw new Error(`No skill mapping for job: ${job.name}`);
  }

  const skill = await prisma.skill.findUnique({
    where: { slug: skillSlug },
    select: { id: true },
  });

  if (!skill) {
    throw new Error(`Skill not found: ${skillSlug}. Run migrateEnrichment.ts first.`);
  }

  const slackTeamId = job.data?.slackTeamId ?? job.data?.teamId ?? 'system';

  // Create execution record first (executeSkill expects an existing one)
  const execution = await prisma.skillExecution.create({
    data: {
      skillId: skill.id,
      slackTeamId,
      triggerType: 'API_CALL',
      triggerSource: 'enrichment-dispatcher',
      input: job.data as any ?? {},
      status: 'QUEUED',
    },
  });

  const result = await executeSkill({
    executionId: execution.id,
    skillId: skill.id,
    slackTeamId,
    input: job.data,
  });

  if (result.status === 'FAILED') {
    throw new Error(`Skill execution failed: ${result.error}`);
  }

  log.info('Enrichment routed through platform skill engine', {
    jobName: job.name,
    skillSlug,
    executionId: result.executionId,
  });
}

/**
 * Creates a single BullMQ Worker on the 'enrichment' queue that
 * dispatches each job to the correct processor based on job.name.
 *
 * @returns A configured BullMQ {@link Worker} instance.
 */
export function createEnrichmentDispatcher(): Worker {
  const worker = new Worker(
    'enrichment',
    async (job: Job) => {
      const processor = processors[job.name];
      if (!processor) {
        logger.error('Unknown job name on enrichment queue', {
          jobName: job.name,
          bullmqJobId: job.id,
        });
        throw new Error(`Unknown enrichment job name: ${job.name}`);
      }

      // Feature 39: Optionally route through platform skill engine
      const slackTeamId = job.data?.slackTeamId ?? job.data?.teamId;
      if (slackTeamId && JOB_TO_SKILL[job.name]) {
        const usePlatform = await shouldRouteThroughPlatform(slackTeamId);
        if (usePlatform) {
          log.info('Routing enrichment through platform', {
            jobName: job.name,
            slackTeamId,
          });
          await routeViaPlatform(job);
          return;
        }
      }

      // Legacy direct routing
      await processor(job);
    },
    {
      connection: { url: config.redis.url },
      concurrency: 1,
    },
  );

  worker.on('completed', (job: Job) => {
    logger.info('Enrichment job completed', {
      bullmqJobId: job.id,
      jobName: job.name,
      jobId: job.data?.jobId,
    });
  });

  worker.on('failed', (job: Job | undefined, err: Error) => {
    logger.error('Enrichment job failed', {
      bullmqJobId: job?.id,
      jobName: job?.name,
      jobId: job?.data?.jobId,
      error: err.message,
    });
    logError({
      category: 'QUEUE_ERROR',
      service: `queue:${job?.name ?? 'enrichment'}`,
      message: err.message,
      stackTrace: err.stack,
      jobId: job?.data?.jobId,
    });
  });

  return worker;
}
