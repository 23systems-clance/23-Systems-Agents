/**
 * Slack notifications for enrichment results (Feature 27).
 * Formats provider breakdown messages per US1 Acceptance Scenario 2.
 */

import { WebClient } from '@slack/web-api';
import { config } from '../../config/index.js';
import { getCostBreakdown, formatCostBreakdown } from '../enrichment/costCalculator.js';
import logger from '../../lib/logger.js';

const slackClient = new WebClient(config.slack.botToken);

export async function sendProviderBreakdownNotification(
  jobId: string,
  channelId: string,
  threadTs: string,
  dataType: 'EMAIL' | 'PHONE' | 'BOTH',
): Promise<void> {
  try {
    const costSummary = await getCostBreakdown(jobId);
    const breakdownText = formatCostBreakdown(costSummary);

    let message = '';
    if (dataType === 'EMAIL') {
      const emailCount = costSummary.breakdowns
        .filter((b) => b.dataType === 'EMAIL')
        .reduce((sum, b) => sum + b.count, 0);
      message = `:white_check_mark: Email enrichment complete! Found ${emailCount} emails.\n\n💰 ${breakdownText}`;
    } else if (dataType === 'PHONE') {
      const phoneCount = costSummary.breakdowns
        .filter((b) => b.dataType === 'PHONE')
        .reduce((sum, b) => sum + b.count, 0);
      message = `:phone: Phone enrichment complete! Found ${phoneCount} phones.\n\n💰 ${breakdownText}`;
    } else {
      message = `:white_check_mark: Enrichment complete!\n\n💰 ${breakdownText}`;
    }

    await slackClient.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: message,
    });

    logger.info('Provider breakdown notification sent', {
      jobId,
      dataType,
    });
  } catch (error) {
    logger.error('Failed to send provider breakdown notification', {
      jobId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
