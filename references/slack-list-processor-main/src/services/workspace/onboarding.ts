/**
 * Workspace Onboarding Service (T056).
 *
 * Handles first-time onboarding for newly installed workspaces.
 * Sends a welcome message explaining bot capabilities and marks
 * onboarding as complete.
 */

import type { WebClient } from '@slack/web-api';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

/**
 * Runs the onboarding flow for a newly installed workspace.
 *
 * Sends a welcome message in the assistant thread and marks
 * onboarding as complete in the database.
 *
 * @param client - Slack Web API client
 * @param teamId - Slack team ID
 * @param channelId - Channel ID where the onboarding message should be sent
 * @param threadTs - Thread timestamp for the assistant conversation
 * @returns True if onboarding was triggered, false if already completed
 */
export async function runOnboarding(
  client: WebClient,
  teamId: string,
  channelId: string,
  threadTs: string,
): Promise<boolean> {
  try {
    // Check if onboarding is already complete
    const workspace = await prisma.workspaceInstallation.findUnique({
      where: { slackTeamId: teamId },
      select: { onboardingComplete: true },
    });

    if (!workspace) {
      logger.warn('Workspace not found for onboarding', { teamId });
      return false;
    }

    if (workspace.onboardingComplete) {
      logger.debug('Onboarding already complete', { teamId });
      return false;
    }

    // Send welcome message
    const welcomeMessage = buildWelcomeMessage();

    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: welcomeMessage,
      mrkdwn: true,
    });

    // Mark onboarding as complete
    await prisma.workspaceInstallation.update({
      where: { slackTeamId: teamId },
      data: { onboardingComplete: true },
    });

    logger.info('Onboarding completed', { teamId });

    return true;
  } catch (error) {
    logger.error('Error running onboarding', {
      teamId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Builds the welcome message explaining bot capabilities.
 */
function buildWelcomeMessage(): string {
  return `
Welcome to the **List Enrichment Agent**! :wave:

I can help you with:

:technologist: **Technographic Enrichment**
• Get detailed tech stack data for companies on your list
• Filter by technologies, cloud providers, and spending tiers
• Export enriched lists to CSV

:bust_in_silhouette: **Contact Discovery**
• Find decision makers at target companies
• Filter by persona types (IT Leader, CEO, etc.)
• Get direct dials and email addresses

:bar_chart: **Technology Reports**
• Analyze companies using specific technologies
• Apply advanced filters (country, employee count, spend tier)
• Get comprehensive reports with actionable insights

:file_folder: **File Management**
• Upload CSV/XLSX files for enrichment
• Download enriched results
• Track all jobs and their status

:rocket: **Getting Started**
1. Upload a company list (CSV/XLSX with domains or company names)
2. Tell me what kind of enrichment you need
3. I'll guide you through the process and deliver results right here

Have a list ready? Upload it and let's get started!
  `.trim();
}
