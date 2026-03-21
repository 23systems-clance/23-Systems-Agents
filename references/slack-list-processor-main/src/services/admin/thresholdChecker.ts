/**
 * Budget threshold checker service.
 *
 * Sums current month spend (overall and per-provider from ApiUsageLog),
 * evaluates active thresholds, sends Slack notification when crossed,
 * and suppresses duplicate alerts within the same calendar month.
 */

import { Prisma } from '@prisma/client';
import { WebClient } from '@slack/web-api';
import { prisma } from '../../models/index.js';
import { config } from '../../config/index.js';
import { logAudit } from '../../lib/auditLogger.js';
import logger from '../../lib/logger.js';

/**
 * Lazily-initialized Slack WebClient for posting threshold alerts.
 */
let slackClient: WebClient | null = null;

function getSlackClient(): WebClient {
  if (!slackClient) {
    slackClient = new WebClient(config.slack.botToken);
  }
  return slackClient;
}

/**
 * Returns the current month key in YYYY-MM format.
 */
function currentMonthKey(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Sums the current calendar month's spend, optionally filtered by provider.
 */
async function getCurrentMonthSpend(providerScope?: string | null): Promise<Prisma.Decimal> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const where: Record<string, unknown> = {
    createdAt: { gte: monthStart },
  };
  if (providerScope) {
    where.service = providerScope;
  }

  const result = await prisma.apiUsageLog.aggregate({
    where,
    _sum: { estimatedCostUsd: true },
  });

  return result._sum.estimatedCostUsd ?? new Prisma.Decimal(0);
}

/**
 * Checks all active thresholds after a cost event. Sends Slack notifications
 * for newly crossed thresholds and suppresses duplicates within the same month.
 *
 * Called fire-and-forget from logApiUsage().
 *
 * @param service - The provider that incurred the cost (e.g. 'BUILTWITH').
 * @param costUsd - The cost amount in USD for context (not used for threshold evaluation).
 */
export async function checkThresholds(service: string, costUsd: number): Promise<void> {
  try {
    const monthKey = currentMonthKey();

    // Fetch active thresholds that either match this provider or have no provider scope.
    const thresholds = await prisma.budgetThreshold.findMany({
      where: {
        isActive: true,
        OR: [
          { providerScope: null },
          { providerScope: service as 'BUILTWITH' | 'APOLLO' | 'AI_ORCHESTRATOR' },
        ],
      },
      include: { creator: { select: { name: true } } },
    });

    if (thresholds.length === 0) return;

    for (const threshold of thresholds) {
      // Skip if already triggered this month.
      if (threshold.lastTriggeredMonth === monthKey) continue;

      const currentSpend = await getCurrentMonthSpend(threshold.providerScope);

      if (currentSpend.greaterThanOrEqualTo(threshold.thresholdAmountUsd)) {
        // Threshold crossed — send notification and mark as triggered.
        const client = getSlackClient();

        const scopeLabel = threshold.providerScope ?? 'All Providers';
        const text =
          `Budget Alert: *${threshold.name}* threshold crossed!\n` +
          `Scope: ${scopeLabel}\n` +
          `Threshold: $${threshold.thresholdAmountUsd.toString()}\n` +
          `Current Month Spend: $${currentSpend.toString()}\n` +
          `Month: ${monthKey}`;

        await client.chat.postMessage({
          channel: threshold.slackChannelId,
          text,
          mrkdwn: true,
        });

        await prisma.budgetThreshold.update({
          where: { id: threshold.id },
          data: {
            lastTriggeredAt: new Date(),
            lastTriggeredMonth: monthKey,
          },
        });

        await logAudit({
          action: 'threshold_triggered',
          actorUserId: 'system',
          actorTeamId: 'system',
          metadata: {
            thresholdId: threshold.id,
            thresholdName: threshold.name,
            thresholdAmountUsd: threshold.thresholdAmountUsd.toString(),
            currentSpendUsd: currentSpend.toString(),
            providerScope: threshold.providerScope,
            month: monthKey,
          },
        });

        logger.info('Budget threshold triggered', {
          thresholdId: threshold.id,
          thresholdName: threshold.name,
          currentSpend: currentSpend.toString(),
          threshold: threshold.thresholdAmountUsd.toString(),
        });
      }
    }
  } catch (error) {
    logger.error('Threshold check failed', {
      error: error instanceof Error ? error.message : String(error),
      service,
      costUsd,
    });
  }
}
