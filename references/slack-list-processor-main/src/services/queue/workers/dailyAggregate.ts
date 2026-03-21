/**
 * Daily aggregate BullMQ worker.
 *
 * Runs at 00:30 UTC. Aggregates the previous day's ApiUsageLog records
 * into DailyAggregate rows per service per workspace. Uses upsert on the
 * unique constraint (date, service, slackTeamId).
 */

import { Worker } from 'bullmq';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../models/index.js';
import { config } from '../../../config/index.js';
import logger from '../../../lib/logger.js';
import type { DailyAggregateJobData } from '../queues.js';

/**
 * Creates and returns the daily aggregate worker.
 */
export function createDailyAggregateWorker(): Worker<DailyAggregateJobData> {
  const worker = new Worker<DailyAggregateJobData>(
    'admin',
    async (job) => {
      if (job.name !== 'daily-aggregate') return;

      // Determine target date: use job data or yesterday.
      const targetDate = job.data.date
        ? new Date(job.data.date)
        : (() => {
            const d = new Date();
            d.setUTCDate(d.getUTCDate() - 1);
            d.setUTCHours(0, 0, 0, 0);
            return d;
          })();

      const dayStart = new Date(targetDate);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(targetDate);
      dayEnd.setUTCHours(23, 59, 59, 999);

      logger.info('Daily aggregate starting', {
        date: dayStart.toISOString().split('T')[0],
      });

      // Fetch all API usage logs for the target day with job context.
      const logs = await prisma.apiUsageLog.findMany({
        where: {
          createdAt: { gte: dayStart, lte: dayEnd },
        },
        select: {
          service: true,
          requestCount: true,
          estimatedCostUsd: true,
          tokensInput: true,
          tokensOutput: true,
          creditsConsumed: true,
          responseStatus: true,
          durationMs: true,
          job: { select: { slackTeamId: true } },
        },
      });

      // Group by service + slackTeamId.
      const groups = new Map<string, {
        service: 'BUILTWITH' | 'APOLLO' | 'AI_ORCHESTRATOR' | 'QUALITY_GATE';
        slackTeamId: string;
        totalRequests: number;
        totalCostUsd: Prisma.Decimal;
        totalTokensInput: number;
        totalTokensOutput: number;
        totalCreditsConsumed: Prisma.Decimal;
        errorCount: number;
        durationSum: number;
        durationCount: number;
      }>();

      for (const log of logs) {
        const key = `${log.service}:${log.job.slackTeamId}`;
        const entry = groups.get(key) ?? {
          service: log.service,
          slackTeamId: log.job.slackTeamId,
          totalRequests: 0,
          totalCostUsd: new Prisma.Decimal(0),
          totalTokensInput: 0,
          totalTokensOutput: 0,
          totalCreditsConsumed: new Prisma.Decimal(0),
          errorCount: 0,
          durationSum: 0,
          durationCount: 0,
        };
        entry.totalRequests += log.requestCount;
        entry.totalCostUsd = entry.totalCostUsd.add(log.estimatedCostUsd ?? new Prisma.Decimal(0));
        entry.totalTokensInput += log.tokensInput ?? 0;
        entry.totalTokensOutput += log.tokensOutput ?? 0;
        entry.totalCreditsConsumed = entry.totalCreditsConsumed.add(
          log.creditsConsumed ?? new Prisma.Decimal(0),
        );
        if (log.responseStatus && log.responseStatus >= 400) entry.errorCount++;
        if (log.durationMs) {
          entry.durationSum += log.durationMs;
          entry.durationCount++;
        }
        groups.set(key, entry);
      }

      // Upsert each group.
      let upsertCount = 0;
      for (const entry of groups.values()) {
        const avgDurationMs =
          entry.durationCount > 0
            ? Math.round(entry.durationSum / entry.durationCount)
            : null;

        await prisma.dailyAggregate.upsert({
          where: {
            date_service_slackTeamId: {
              date: dayStart,
              service: entry.service,
              slackTeamId: entry.slackTeamId,
            },
          },
          update: {
            totalRequests: entry.totalRequests,
            totalCostUsd: entry.totalCostUsd,
            totalTokensInput: entry.totalTokensInput,
            totalTokensOutput: entry.totalTokensOutput,
            totalCreditsConsumed: entry.totalCreditsConsumed,
            errorCount: entry.errorCount,
            avgDurationMs,
          },
          create: {
            date: dayStart,
            service: entry.service,
            slackTeamId: entry.slackTeamId,
            totalRequests: entry.totalRequests,
            totalCostUsd: entry.totalCostUsd,
            totalTokensInput: entry.totalTokensInput,
            totalTokensOutput: entry.totalTokensOutput,
            totalCreditsConsumed: entry.totalCreditsConsumed,
            errorCount: entry.errorCount,
            avgDurationMs,
          },
        });
        upsertCount++;
      }

      logger.info('Daily aggregate complete', {
        date: dayStart.toISOString().split('T')[0],
        logCount: logs.length,
        aggregateRows: upsertCount,
      });
    },
    {
      connection: { url: config.redis.url },
    },
  );

  worker.on('failed', (job, err) => {
    logger.error('Daily aggregate worker failed', {
      jobId: job?.id,
      error: err.message,
    });
  });

  return worker;
}
