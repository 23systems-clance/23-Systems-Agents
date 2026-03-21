/**
 * Conversation Turn Purge Service (T061)
 *
 * Purges conversation turns older than 7 days and creates audit summaries.
 * Implements Phase 11 - Data Retention & Audit requirements.
 *
 * Lifecycle:
 *   1. Find AgentThreads with turns older than 7 days
 *   2. For each thread, create AgentThreadAudit summary
 *   3. Delete the purged ConversationTurn records
 *   4. Update thread status to 'ARCHIVED' if all turns purged
 */

import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

const RETENTION_DAYS = 7;

interface PurgeStats {
  threadsProcessed: number;
  turnsDeleted: number;
  auditsCreated: number;
  errors: number;
}

/**
 * Purges conversation turns older than 7 days and creates audit summaries.
 *
 * For each eligible thread:
 *   - Aggregates turn statistics (count, intents, job IDs, tokens)
 *   - Creates an AgentThreadAudit record with the summary
 *   - Deletes all ConversationTurn records for the thread
 *   - Updates thread status to 'ARCHIVED' if all turns are purged
 *
 * @returns Statistics about the purge operation
 */
export async function purgeExpiredConversations(): Promise<PurgeStats> {
  const stats: PurgeStats = {
    threadsProcessed: 0,
    turnsDeleted: 0,
    auditsCreated: 0,
    errors: 0,
  };

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

  logger.info('Starting conversation purge', {
    cutoffDate: cutoffDate.toISOString(),
    retentionDays: RETENTION_DAYS,
  });

  try {
    // Find threads with turns older than the cutoff date
    const threadsWithOldTurns = await prisma.agentThread.findMany({
      where: {
        turns: {
          some: {
            createdAt: {
              lt: cutoffDate,
            },
          },
        },
      },
      include: {
        turns: {
          where: {
            createdAt: {
              lt: cutoffDate,
            },
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
        threadJobs: {
          select: {
            jobId: true,
          },
        },
        audit: true,
      },
    });

    logger.info('Found threads with expired turns', {
      threadCount: threadsWithOldTurns.length,
    });

    // Process each thread
    for (const thread of threadsWithOldTurns) {
      try {
        // Skip if audit already exists (already purged)
        if (thread.audit) {
          logger.debug('Thread already has audit record, skipping', {
            threadId: thread.id,
          });
          continue;
        }

        // Skip if no turns to purge
        if (thread.turns.length === 0) {
          continue;
        }

        // Aggregate turn statistics
        const turnCount = thread.turns.length;
        const intentsClassified: Record<string, number> = {};
        let totalTokensInput = 0;
        let totalTokensOutput = 0;

        for (const turn of thread.turns) {
          if (turn.intent) {
            intentsClassified[turn.intent] = (intentsClassified[turn.intent] || 0) + 1;
          }
          totalTokensInput += turn.tokensInput || 0;
          totalTokensOutput += turn.tokensOutput || 0;
        }

        // Get unique job IDs from thread jobs
        const jobIds = thread.threadJobs.map((tj) => tj.jobId);

        // Determine first and last message times
        const firstMessageAt = thread.turns[0]?.createdAt || thread.createdAt;
        const lastMessageAt = thread.turns[thread.turns.length - 1]?.createdAt || thread.createdAt;

        // Create audit summary
        await prisma.agentThreadAudit.create({
          data: {
            agentThreadId: thread.id,
            slackTeamId: thread.slackTeamId,
            slackUserId: thread.slackUserId,
            threadTitle: thread.title,
            turnCount,
            intentsClassified,
            jobsCreated: jobIds,
            actionsPerformed: {}, // Empty for now; can be enhanced in the future
            firstMessageAt,
            lastMessageAt,
            totalAiTokensInput: totalTokensInput,
            totalAiTokensOutput: totalTokensOutput,
          },
        });

        stats.auditsCreated++;

        // Delete the purged turns
        const deleteResult = await prisma.conversationTurn.deleteMany({
          where: {
            agentThreadId: thread.id,
            createdAt: {
              lt: cutoffDate,
            },
          },
        });

        stats.turnsDeleted += deleteResult.count;

        // Check if all turns have been purged
        const remainingTurns = await prisma.conversationTurn.count({
          where: { agentThreadId: thread.id },
        });

        // Update thread status if all turns are purged
        if (remainingTurns === 0) {
          await prisma.agentThread.update({
            where: { id: thread.id },
            data: { status: 'PURGED' },
          });
        }

        stats.threadsProcessed++;

        logger.debug('Thread purged successfully', {
          threadId: thread.id,
          turnsDeleted: deleteResult.count,
          remainingTurns,
        });
      } catch (err) {
        stats.errors++;
        logger.error('Failed to purge thread', {
          threadId: thread.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info('Conversation purge completed', {
      threadsProcessed: stats.threadsProcessed,
      turnsDeleted: stats.turnsDeleted,
      auditsCreated: stats.auditsCreated,
      errors: stats.errors,
    });
    return stats;
  } catch (err) {
    logger.error('Conversation purge failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
