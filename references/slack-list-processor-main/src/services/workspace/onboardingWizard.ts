/**
 * Client onboarding wizard state machine (T015, T019).
 *
 * Manages the 5-step onboarding flow for new client workspace installations:
 * PENDING → LICENSE_KEY → BILLING → CHANNELS → COMPLETE
 *
 * Each step renders a Block Kit view in the App Home tab. The wizard is
 * persistent and revisitable — users can always return to App Home to
 * resume onboarding from where they left off.
 */

import type { WebClient } from '@slack/web-api';
import type { KnownBlock } from '@slack/types';
import { prisma } from '../../models/index.js';
import { config } from '../../config/index.js';
import { OnboardingStep } from '../../types/licensing.js';
import logger from '../../lib/logger.js';

/**
 * Returns the current onboarding step for a workspace.
 *
 * @param slackTeamId - Workspace team ID.
 * @returns Current OnboardingStep.
 */
export async function getOnboardingStep(slackTeamId: string): Promise<OnboardingStep> {
  const workspace = await prisma.workspaceInstallation.findUnique({
    where: { slackTeamId },
    select: { onboardingStatus: true },
  });
  return (workspace?.onboardingStatus as OnboardingStep) ?? OnboardingStep.PENDING;
}

/**
 * Advances the onboarding to the specified step.
 *
 * @param slackTeamId - Workspace team ID.
 * @param step        - Target OnboardingStep.
 */
export async function advanceStep(slackTeamId: string, step: OnboardingStep): Promise<void> {
  await prisma.workspaceInstallation.update({
    where: { slackTeamId },
    data: { onboardingStatus: step },
  });

  logger.info('Onboarding step advanced', { slackTeamId, step });
}

/**
 * Renders the onboarding step view as Block Kit blocks for App Home.
 *
 * @param step        - Current onboarding step.
 * @param slackTeamId - Workspace team ID (for context lookups).
 * @returns Block Kit blocks for views.publish.
 */
export function renderStepView(step: OnboardingStep, slackTeamId: string): KnownBlock[] {
  const stepLabels = ['License Key', 'Billing', 'Channels', 'Complete'];
  const stepIndex = [OnboardingStep.LICENSE_KEY, OnboardingStep.BILLING, OnboardingStep.CHANNELS, OnboardingStep.COMPLETE].indexOf(step);
  const currentStepNum = stepIndex === -1 ? 1 : stepIndex + 1;

  const progressText = step === OnboardingStep.COMPLETE
    ? 'Setup Complete'
    : `Step ${currentStepNum} of 4`;

  const headerBlocks: KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Welcome to List Enrichment Agent', emoji: true },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: progressText }],
    },
    { type: 'divider' },
  ];

  switch (step) {
    case OnboardingStep.PENDING:
    case OnboardingStep.LICENSE_KEY:
      return [
        ...headerBlocks,
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*Step 1: Enter Your License Key*\n\nTo get started, enter the license key provided by your account manager. This activates your workspace and configures your plan.',
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Enter License Key', emoji: true },
              style: 'primary',
              action_id: 'onboarding_enter_license_key',
            },
          ],
        },
      ];

    case OnboardingStep.BILLING:
      return [
        ...headerBlocks,
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*Step 2: Set Up Billing*\n\nSet up your payment method and select a subscription plan to enable enrichment credits.',
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Set Up Billing', emoji: true },
              style: 'primary',
              action_id: 'onboarding_billing_setup',
            },
          ],
        },
      ];

    case OnboardingStep.CHANNELS:
      return [
        ...headerBlocks,
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*Step 3: Assign Enrichment Channel*\n\nCreate a private channel and invite the bot to set up your enrichment workspace. Files uploaded to this channel will trigger enrichment.',
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Assign Channel', emoji: true },
              style: 'primary',
              action_id: 'onboarding_assign_channel',
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Skip for Now', emoji: true },
              action_id: 'onboarding_skip_channel',
            },
          ],
        },
      ];

    case OnboardingStep.COMPLETE:
      return [
        ...headerBlocks,
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*Setup Complete!*\n\nYour workspace is ready. Upload a CSV or Excel file to an enrichment channel to start enriching your lists.',
          },
        },
        { type: 'divider' },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*Quick Actions*',
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'View Dashboard', emoji: true },
              url: config.licensing.clientDashboardUrl || config.dashboardUrl,
              action_id: 'onboarding_view_dashboard',
            },
          ],
        },
      ];

    default:
      return headerBlocks;
  }
}

/**
 * Sends a welcome DM to the installer after OAuth callback.
 *
 * @param client      - Slack Web API client with the workspace's bot token.
 * @param slackUserId - Installer's Slack user ID.
 * @param teamName    - Workspace team name for display.
 */
export async function sendWelcomeDm(
  client: WebClient,
  slackUserId: string,
  teamName: string,
): Promise<void> {
  try {
    await client.chat.postMessage({
      channel: slackUserId,
      text: `Welcome to List Enrichment Agent! Your workspace "${teamName}" has been set up. Visit the *App Home* tab to complete onboarding and start enriching.`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Welcome to List Enrichment Agent!*\n\nYour workspace *${teamName}* has been set up. To get started:\n\n1. Open the *App Home* tab in this app\n2. Enter your license key\n3. Set up billing\n4. Assign an enrichment channel\n\nThen you're ready to start enriching your lists!`,
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Open App Home', emoji: true },
              style: 'primary',
              action_id: 'onboarding_open_app_home',
            },
          ],
        },
      ],
    });

    logger.info('Welcome DM sent', { slackUserId, teamName });
  } catch (error) {
    logger.error('Failed to send welcome DM', {
      slackUserId,
      teamName,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
