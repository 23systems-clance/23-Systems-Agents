/**
 * BullMQ dispatcher worker for the 'workflow' queue.
 *
 * Routes incoming jobs to the correct processor based on `job.name`.
 * Handles:
 *   - workflow-delay   — resumes execution after a DELAY node timer expires
 *   - workflow-expiry-scan — periodic scan that expires stale executions
 */

import { Worker, Job } from 'bullmq';
import { config } from '../../../config/index.js';
import { logError } from '../../../services/admin/errorLogger.js';
import { resumeWithInput, expireStaleExecutions } from '../../workflow/workflowEngine.js';
import { prisma } from '../../../models/index.js';
import logger from '../../../lib/logger.js';

/** Terminal execution statuses that should be skipped. */
const TERMINAL_STATUSES = ['COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED'] as const;

/**
 * Creates a BullMQ Worker on the 'workflow' queue that dispatches
 * each job to the correct processor based on job.name.
 *
 * @param slackClient - Slack Web API client for posting expiry notifications
 * @returns A configured BullMQ Worker instance with a `.close()` method.
 */
export function createWorkflowWorker(slackClient: any): Worker {
  /**
   * Processes a workflow-delay job. When a DELAY node's timer expires,
   * this handler resumes the execution past the delay node.
   *
   * @param job - BullMQ job containing `{ executionId, nodeId }`
   */
  async function processWorkflowDelay(job: Job): Promise<void> {
    const { executionId, nodeId } = job.data;
    logger.info('Processing workflow-delay job', {
      executionId,
      nodeId,
      bullmqJobId: job.id,
    });

    // Look up the execution to check current state
    const execution = await prisma.workflowExecution.findUnique({
      where: { id: executionId },
    });

    if (!execution) {
      logger.warn('Workflow execution not found for delay job, skipping', {
        executionId,
        bullmqJobId: job.id,
      });
      return;
    }

    // Skip if execution is already in a terminal state
    if (TERMINAL_STATUSES.includes(execution.status as (typeof TERMINAL_STATUSES)[number])) {
      logger.info('Workflow execution already in terminal state, skipping delay resume', {
        executionId,
        status: execution.status,
        bullmqJobId: job.id,
      });
      return;
    }

    // Only resume if execution is WAITING_DELAY and currentNodeId matches the delay node
    if (execution.status !== 'WAITING_DELAY' || execution.currentNodeId !== nodeId) {
      logger.info('Workflow execution state does not match delay job, skipping', {
        executionId,
        expectedStatus: 'WAITING_DELAY',
        actualStatus: execution.status,
        expectedNodeId: nodeId,
        actualNodeId: execution.currentNodeId,
        bullmqJobId: job.id,
      });
      return;
    }

    // Transition to WAITING_INPUT so resumeWithInput accepts it
    await prisma.workflowExecution.update({
      where: { id: executionId },
      data: { status: 'WAITING_INPUT' },
    });

    // Resume execution past the delay node
    const result = await resumeWithInput(executionId, {}, undefined);

    logger.info('Workflow delay resume completed', {
      executionId,
      completed: result.completed,
      nextNodeId: result.nextNode?.id ?? null,
      nodesProcessed: result.nodesProcessed.length,
      bullmqJobId: job.id,
    });
  }

  /**
   * Processes a workflow-expiry-scan job. Runs every 5 minutes to
   * expire stale executions and optionally notify users via Slack.
   *
   * @param job - BullMQ repeatable job (no meaningful data payload)
   */
  async function processExpiryScan(job: Job): Promise<void> {
    logger.info('Processing workflow-expiry-scan job', { bullmqJobId: job.id });

    const expiredExecutions = await expireStaleExecutions();

    logger.info('Workflow expiry scan completed', {
      expiredCount: expiredExecutions.length,
      bullmqJobId: job.id,
    });

    // Notify users of expired workflows via Slack
    for (const execution of expiredExecutions) {
      try {
        if (execution.slackChannelId) {
          await slackClient.chat.postMessage({
            channel: execution.slackChannelId,
            thread_ts: execution.slackThreadTs || undefined,
            text: 'This workflow has expired due to inactivity.',
          });
          logger.info('Sent workflow expiry notification', {
            executionId: execution.id,
            channelId: execution.slackChannelId,
          });
        }
      } catch (notifyErr) {
        logger.error('Failed to send workflow expiry notification', {
          executionId: execution.id,
          channelId: execution.slackChannelId,
          error: (notifyErr as Error).message,
        });
      }
    }
  }

  /** Map of job names to their processor functions. */
  const processors: Record<string, (job: Job) => Promise<void>> = {
    'workflow-delay': processWorkflowDelay,
    'workflow-expiry-scan': processExpiryScan,
  };

  const worker = new Worker(
    'workflow',
    async (job: Job) => {
      const processor = processors[job.name];
      if (!processor) {
        logger.error('Unknown job name on workflow queue', {
          jobName: job.name,
          bullmqJobId: job.id,
        });
        throw new Error(`Unknown workflow job name: ${job.name}`);
      }

      await processor(job);
    },
    {
      connection: { url: config.redis.url },
      concurrency: 1,
    },
  );

  worker.on('completed', (job: Job) => {
    logger.info('Workflow job completed', {
      bullmqJobId: job.id,
      jobName: job.name,
    });
  });

  worker.on('failed', (job: Job | undefined, err: Error) => {
    logger.error('Workflow job failed', {
      bullmqJobId: job?.id,
      jobName: job?.name,
      error: err.message,
    });
    logError({
      category: 'QUEUE_ERROR',
      service: `queue:${job?.name ?? 'workflow'}`,
      message: err.message,
      stackTrace: err.stack,
    });
  });

  return worker;
}
