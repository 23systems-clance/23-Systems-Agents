/**
 * Billing notifier service.
 *
 * Posts credit usage summaries and balance warnings to Slack
 * after enrichment jobs complete or when thresholds are crossed.
 */

import { WebClient } from '@slack/web-api';
import { config } from '../../config/index.js';
import logger from '../../lib/logger.js';

const slackClient = new WebClient(config.slack.botToken);

/**
 * Posts credit usage info to Slack after a job completes.
 *
 * @param channelId      - Slack channel to post in.
 * @param threadTs       - Thread timestamp for the enrichment conversation.
 * @param creditsUsed    - Total credits consumed by the job.
 * @param balanceAfter   - Remaining credit balance after deduction.
 * @param overageCredits - Credits that went into overage (optional).
 */
export async function notifyJobCredits(
  channelId: string,
  threadTs: string,
  creditsUsed: number,
  balanceAfter: number,
  overageCredits?: number,
): Promise<void> {
  try {
    const lines: string[] = [
      `*Credits used:* ${creditsUsed.toLocaleString()}`,
      `*Remaining balance:* ${balanceAfter.toLocaleString()} credits`,
    ];

    if (overageCredits && overageCredits > 0) {
      lines.push(`*Overage:* ${overageCredits.toLocaleString()} credits (will be charged to your payment method)`);
    }

    await slackClient.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: lines.join('\n'),
      blocks: [
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: lines.join('  |  '),
            },
          ],
        },
      ],
    });
  } catch (err) {
    logger.warn('Failed to send job credits notification', {
      channelId,
      threadTs,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Posts a low-balance warning when credits fall below 20% of monthly allowance.
 *
 * @param channelId        - Slack channel to post in.
 * @param balance          - Current credit balance.
 * @param monthlyAllowance - Monthly credit allowance for percentage context.
 */
export async function notifyLowBalance(
  channelId: string,
  balance: number,
  monthlyAllowance: number,
): Promise<void> {
  try {
    const pct = monthlyAllowance > 0
      ? Math.round((balance / monthlyAllowance) * 100)
      : 0;

    await slackClient.chat.postMessage({
      channel: channelId,
      text: `Your credit balance is low: ${balance.toLocaleString()} credits remaining (${pct}% of monthly allowance). Contact your admin to top up or wait for your next billing cycle.`,
    });
  } catch (err) {
    logger.warn('Failed to send low-balance notification', {
      channelId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Posts a balance-depleted notification when credits reach zero.
 *
 * @param channelId      - Slack channel to post in.
 * @param overageRateUsd - Overage rate per credit in USD for context.
 */
export async function notifyDepleted(
  channelId: string,
  overageRateUsd: number,
): Promise<void> {
  try {
    await slackClient.chat.postMessage({
      channel: channelId,
      text: `Your credit balance has been depleted. Continued enrichment will be charged at the overage rate of $${overageRateUsd}/credit. Contact your admin for more details.`,
    });
  } catch (err) {
    logger.warn('Failed to send depleted notification', {
      channelId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
