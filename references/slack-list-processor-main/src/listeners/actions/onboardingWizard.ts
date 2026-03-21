/**
 * Onboarding wizard action listeners (T017).
 *
 * Handles all interactive actions from the onboarding wizard:
 * - License key entry (modal open + submission)
 * - Billing setup (generate Stripe Checkout URL)
 * - Channel assignment (show channel picker)
 * - Completion (finalize onboarding)
 */

import type { App } from '@slack/bolt';
import { validateAndActivate } from '../../services/licensing/keyValidator.js';
import { advanceStep, renderStepView } from '../../services/workspace/onboardingWizard.js';
import { OnboardingStep } from '../../types/licensing.js';
import { config } from '../../config/index.js';
import { prisma } from '../../models/index.js';
import { logAudit } from '../../lib/auditLogger.js';
import logger from '../../lib/logger.js';

/**
 * Registers all onboarding wizard action handlers.
 *
 * @param app - Slack Bolt app instance.
 */
export function registerOnboardingWizardHandlers(app: App): void {
  // -- License Key Entry --
  app.action('onboarding_enter_license_key', async ({ ack, body, client }) => {
    await ack();

    await client.views.open({
      trigger_id: (body as any).trigger_id,
      view: {
        type: 'modal',
        callback_id: 'onboarding_license_submitted',
        title: { type: 'plain_text', text: 'Enter License Key' },
        submit: { type: 'plain_text', text: 'Activate' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: [
          {
            type: 'input',
            block_id: 'license_key_block',
            element: {
              type: 'plain_text_input',
              action_id: 'license_key_input',
              placeholder: { type: 'plain_text', text: 'SLKP-XXXX-XXXX-XXXX-XXXX' },
            },
            label: { type: 'plain_text', text: 'License Key' },
            hint: { type: 'plain_text', text: 'Enter the license key provided by your account manager.' },
          },
        ],
      },
    });
  });

  // -- License Key Submission --
  app.view('onboarding_license_submitted', async ({ ack, view, body, client }) => {
    const keyValue = view.state.values.license_key_block.license_key_input.value ?? '';
    const teamId = view.team_id;
    const userId = body.user.id;

    const result = await validateAndActivate(keyValue, teamId);

    if (!result.valid) {
      const errorMessages: Record<string, string> = {
        NOT_FOUND: 'License key not found. Please check and try again.',
        REVOKED: 'This license key has been revoked. Contact your account manager.',
        EXPIRED: 'This license key has expired. Contact your account manager.',
        ALREADY_USED: 'This license key has already been used.',
      };

      await ack({
        response_action: 'errors',
        errors: {
          license_key_block: errorMessages[result.errorCode ?? 'NOT_FOUND'],
        },
      });
      return;
    }

    await ack();

    // Log audit event
    await prisma.auditLog.create({
      data: {
        action: 'LICENSE_KEY_ACTIVATED',
        actorUserId: userId,
        actorTeamId: teamId,
        targetType: 'LicenseKey',
        metadata: {
          initialCredits: result.initialCredits,
          subscriptionTier: result.subscriptionTier,
        },
      },
    });

    // Refresh App Home to show billing step
    await client.views.publish({
      user_id: userId,
      view: {
        type: 'home',
        blocks: renderStepView(OnboardingStep.BILLING, teamId),
      },
    });

    logger.info('Onboarding: license key activated', { teamId, userId });
  });

  // -- Billing Setup --
  app.action('onboarding_billing_setup', async ({ ack, body, client }) => {
    await ack();
    const teamId = (body as any).team?.id ?? '';
    const userId = (body as any).user?.id ?? '';

    // Generate billing setup URL (links to billing setup route)
    const billingUrl = `${config.billing.appBaseUrl}/api/billing/setup?team=${teamId}&onboarding=true`;

    await client.chat.postMessage({
      channel: userId,
      text: `Click the link below to set up billing for your workspace:\n${billingUrl}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*Set Up Billing*\n\nClick the button below to set up your payment method and subscription.',
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Open Billing Setup', emoji: true },
              style: 'primary',
              url: billingUrl,
              action_id: 'onboarding_billing_link_clicked',
            },
          ],
        },
      ],
    });
  });

  // -- Billing link click (no-op, URL opens externally) --
  app.action('onboarding_billing_link_clicked', async ({ ack }) => {
    await ack();
  });

  // -- Channel Assignment --
  app.action('onboarding_assign_channel', async ({ ack, body, client }) => {
    await ack();
    const teamId = (body as any).team?.id ?? '';
    const userId = (body as any).user?.id ?? '';

    await client.chat.postMessage({
      channel: userId,
      text: 'To set up your enrichment channel:\n1. Create a private channel in Slack\n2. Invite this bot to the channel\n3. The bot will detect it and register it as your enrichment channel',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*Set Up Enrichment Channel*\n\n1. Create a private channel in Slack\n2. Invite this bot to the channel\n3. Upload a CSV or Excel file to start enriching\n\nThe bot will automatically detect when it\'s invited and register the channel.',
          },
        },
      ],
    });
  });

  // -- Skip channel assignment --
  app.action('onboarding_skip_channel', async ({ ack, body, client }) => {
    await ack();
    const teamId = (body as any).team?.id ?? '';
    const userId = (body as any).user?.id ?? '';

    await advanceStep(teamId, OnboardingStep.COMPLETE);

    await client.views.publish({
      user_id: userId,
      view: {
        type: 'home',
        blocks: renderStepView(OnboardingStep.COMPLETE, teamId),
      },
    });

    logAudit({
      action: 'ONBOARDING_COMPLETED',
      actorUserId: userId,
      actorTeamId: teamId,
      targetType: 'WorkspaceInstallation',
      metadata: { channelSkipped: true },
    });
    logger.info('Onboarding: completed (channel skipped)', { teamId, userId });
  });

  // -- Open App Home (from welcome DM) --
  app.action('onboarding_open_app_home', async ({ ack }) => {
    await ack();
    // No-op — the button text guides the user to the App Home tab
  });

  // -- View Dashboard (from complete step) --
  app.action('onboarding_view_dashboard', async ({ ack }) => {
    await ack();
    // No-op — URL button opens dashboard externally
  });
}
