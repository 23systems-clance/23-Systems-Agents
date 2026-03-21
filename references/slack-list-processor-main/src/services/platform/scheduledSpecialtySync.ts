/**
 * Scheduled specialty sync at startup (T026).
 *
 * Queries all PUBLISHED Skills with triggerType=SCHEDULED and registers
 * BullMQ repeatable jobs via upsertJobScheduler for each.
 *
 * Called at app startup alongside existing registerRepeatableJobs.
 * Also provides removeScheduler to stop jobs when a specialty is deprecated.
 */

import { prisma } from '../../models/index.js';
import { skillExecutionQueue } from '../queue/queues.js';
import logger from '../../lib/logger.js';

const log = logger.withContext({ service: 'scheduledSpecialtySync' });

/**
 * Syncs all PUBLISHED SCHEDULED specialties to BullMQ repeatable jobs.
 *
 * For each specialty with triggerType=SCHEDULED:
 * 1. Reads cronPattern from triggerConfig.
 * 2. Registers a BullMQ repeatable job via upsertJobScheduler.
 *
 * Safe to call multiple times — upsertJobScheduler is idempotent.
 */
export async function syncScheduledSpecialties(): Promise<void> {
  // Kill switch check
  if (process.env.AUTONOMOUS_AGENTS_ENABLED === 'false') {
    log.info('Autonomous agents disabled — skipping scheduled specialty sync');
    return;
  }

  try {
    const scheduledSpecialties = await prisma.skill.findMany({
      where: {
        status: 'PUBLISHED',
        triggerType: 'SCHEDULED',
      },
      include: {
        agent: { select: { name: true, slug: true } },
      },
    });

    if (scheduledSpecialties.length === 0) {
      log.info('No PUBLISHED SCHEDULED specialties found');
      return;
    }

    log.info('Syncing scheduled specialties', {
      count: scheduledSpecialties.length,
    });

    for (const specialty of scheduledSpecialties) {
      const triggerConfig = specialty.triggerConfig as Record<string, unknown> | null;
      const cronPattern = triggerConfig?.cronPattern as string | undefined;

      if (!cronPattern) {
        log.warn('Scheduled specialty missing cronPattern in triggerConfig', {
          skillId: specialty.id,
          agentName: specialty.agent?.name,
        });
        continue;
      }

      const schedulerId = `scheduled-specialty-${specialty.id}`;
      const timezone = (triggerConfig?.timezone as string) ?? 'UTC';

      try {
        await skillExecutionQueue.upsertJobScheduler(
          schedulerId,
          { pattern: cronPattern, tz: timezone },
          {
            name: 'skill-execution',
            data: {
              skillId: specialty.id,
              slackTeamId: process.env.SLACK_TEAM_ID ?? 'default',
              input: {
                triggerType: 'SCHEDULED',
                triggeredBy: 'scheduler',
              },
            },
          },
        );

        log.info('Registered scheduled specialty', {
          schedulerId,
          skillId: specialty.id,
          agentName: specialty.agent?.name,
          cronPattern,
          timezone,
        });
      } catch (error) {
        log.error('Failed to register scheduled specialty', {
          schedulerId,
          skillId: specialty.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    log.info('Scheduled specialty sync complete', {
      registered: scheduledSpecialties.length,
    });
  } catch (error) {
    log.error('Failed to sync scheduled specialties', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Removes a BullMQ repeatable job for a deprecated specialty.
 *
 * @param specialtyId - The skill/specialty ID to remove from the scheduler.
 */
export async function removeScheduler(specialtyId: string): Promise<void> {
  const schedulerId = `scheduled-specialty-${specialtyId}`;
  try {
    await skillExecutionQueue.removeJobScheduler(schedulerId);
    log.info('Removed scheduled specialty', { schedulerId, specialtyId });
  } catch (error) {
    log.error('Failed to remove scheduled specialty', {
      schedulerId,
      specialtyId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
