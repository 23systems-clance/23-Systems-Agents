/**
 * App Home opened event listener (T016).
 *
 * Renders the onboarding wizard or dashboard view when a user opens
 * the app's Home tab. Non-COMPLETE workspaces see the wizard;
 * COMPLETE workspaces see a dashboard with credit balance and quick links.
 */

import type { App } from '@slack/bolt';
import { renderStepView, getOnboardingStep } from '../../services/workspace/onboardingWizard.js';
import { getCreditBalance } from '../../services/billing/creditManager.js';
import { isPlatformOwner } from '../../services/workspace/platformOwner.js';
import { OnboardingStep } from '../../types/licensing.js';
import type { KnownBlock } from '@slack/types';
import logger from '../../lib/logger.js';

/**
 * Registers the app_home_opened event listener.
 *
 * @param app - Slack Bolt app instance.
 */
export function registerAppHomeOpenedListener(app: App): void {
  app.event('app_home_opened', async ({ event, client }) => {
    if (event.tab !== 'home') return;

    const teamId = (event as unknown as Record<string, string>).team ?? '';
    if (!teamId) return;

    try {
      // Platform owner gets a simple dashboard (always onboarded)
      if (isPlatformOwner(teamId)) {
        await client.views.publish({
          user_id: event.user,
          view: {
            type: 'home',
            blocks: buildPlatformOwnerHome(),
          },
        });
        return;
      }

      const step = await getOnboardingStep(teamId);

      if (step === OnboardingStep.COMPLETE) {
        // Show client dashboard view
        const balance = await getCreditBalance(teamId);
        await client.views.publish({
          user_id: event.user,
          view: {
            type: 'home',
            blocks: buildClientDashboardHome(balance),
          },
        });
      } else {
        // Show onboarding wizard
        await client.views.publish({
          user_id: event.user,
          view: {
            type: 'home',
            blocks: renderStepView(step, teamId),
          },
        });
      }
    } catch (error) {
      logger.error('Failed to render App Home', {
        userId: event.user,
        teamId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

/**
 * Builds the platform owner App Home view.
 */
function buildPlatformOwnerHome(): KnownBlock[] {
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'List Enrichment Agent — Platform Owner', emoji: true },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'All features are enabled. Upload a CSV or Excel file to any channel to start enriching.',
      },
    },
  ];
}

/**
 * Builds the client dashboard App Home view (post-onboarding).
 *
 * @param creditBalance - Current credit balance (null if no billing profile).
 */
function buildClientDashboardHome(creditBalance: number | null): KnownBlock[] {
  const balanceText = creditBalance !== null
    ? `*Credit Balance:* ${creditBalance.toLocaleString()} credits`
    : '*Credit Balance:* Not configured';

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'List Enrichment Agent', emoji: true },
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: 'Setup Complete' }],
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: balanceText },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Upload a CSV or Excel file to your enrichment channel to start enriching your lists.',
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Buy Credits', emoji: true },
          action_id: 'credit_pack_purchase_open',
        },
      ],
    },
  ];
}
