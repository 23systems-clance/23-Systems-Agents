/**
 * Skill Execution BullMQ Worker (Feature 39 - Vertical Pack Platform).
 *
 * Processes jobs from skill-execution queue, calls skillExecutor.execute(),
 * handles retries per skill retryPolicy config (FR-024).
 */

import { Worker } from 'bullmq';
import { config } from '../../../config/index.js';
import { prisma } from '../../../models/index.js';
import logger from '../../../lib/logger.js';
import { executeSkill } from '../../platform/skillExecutor.js';
import type { SkillExecutionJobData } from '../queues.js';

/**
 * Creates and returns the skill execution worker.
 * Concurrency of 5 to allow parallel skill executions.
 */
export function createSkillExecutionWorker(): Worker<SkillExecutionJobData> {
  const worker = new Worker<SkillExecutionJobData>(
    'skill-execution',
    async (job) => {
      const { executionId, skillId, slackTeamId, slackUserId, input, packSubscriptionId } = job.data;

      // For scheduled skills that don't have a pre-created execution record
      let actualExecutionId = executionId;
      if (!actualExecutionId) {
        const execution = await prisma.skillExecution.create({
          data: {
            skillId,
            slackTeamId,
            slackUserId,
            triggerType: 'SCHEDULED',
            input: input as any ?? {},
            status: 'QUEUED',
          },
        });
        actualExecutionId = execution.id;
      }

      logger.info('Processing skill execution job', {
        executionId: actualExecutionId,
        skillId,
        slackTeamId,
        attempt: job.attemptsMade + 1,
      });

      await executeSkill({
        executionId: actualExecutionId,
        skillId,
        slackTeamId,
        slackUserId,
        input,
        packSubscriptionId,
      });
    },
    {
      connection: { url: config.redis.url },
      concurrency: 5,
    },
  );

  worker.on('completed', (job) => {
    logger.info('Skill execution job completed', {
      jobId: job?.id,
      skillId: job?.data.skillId,
    });
  });

  worker.on('failed', (job, err) => {
    logger.error('Skill execution job failed', {
      jobId: job?.id,
      skillId: job?.data.skillId,
      error: err.message,
      attempt: job?.attemptsMade,
    });
  });

  return worker;
}
