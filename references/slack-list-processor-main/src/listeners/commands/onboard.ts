/**
 * Slash command handler for /onboard.
 *
 * Enrolls a BDR into an onboarding plan via an interactive Slack flow:
 *   /onboard @user → plan selection buttons → enrollment modal → confirm
 */

import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import { prisma } from '../../models/index.js';
import { enrollBdr, getEnrollmentBySlackUser } from '../../services/onboarding/enrollmentService.js';
import { buildWelcomeDm } from '../../services/onboarding/slackBlocks.js';
import { logAudit } from '../../lib/auditLogger.js';
import logger from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generates hour options for the delivery hour select (6 AM – 8 PM). */
function buildHourOptions() {
  const options: Array<{ text: { type: 'plain_text'; text: string }; value: string }> = [];
  for (let h = 6; h <= 20; h++) {
    const label =
      h < 12 ? `${h}:00 AM` : h === 12 ? '12:00 PM' : `${h - 12}:00 PM`;
    options.push({ text: { type: 'plain_text' as const, text: label }, value: String(h) });
  }
  return options;
}

/** Common US timezone options. */
function buildTimezoneOptions() {
  return [
    { text: { type: 'plain_text' as const, text: 'Eastern (New York)' }, value: 'America/New_York' },
    { text: { type: 'plain_text' as const, text: 'Central (Chicago)' }, value: 'America/Chicago' },
    { text: { type: 'plain_text' as const, text: 'Mountain (Denver)' }, value: 'America/Denver' },
    { text: { type: 'plain_text' as const, text: 'Pacific (Los Angeles)' }, value: 'America/Los_Angeles' },
    { text: { type: 'plain_text' as const, text: 'UTC' }, value: 'UTC' },
  ];
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerOnboardCommand(app: App): void {
  // ---- Slash command: /onboard @user ------------------------------------
  app.command('/onboard', async ({ command, ack, respond }) => {
    await ack();

    try {
      const text = command.text.trim();
      const teamId = command.team_id;

      // Parse user mention — Slack sends <@U123ABC|display_name>
      const mentionMatch = text.match(/<@(U[A-Z0-9]+)(?:\|[^>]*)?>/);
      if (!mentionMatch) {
        await respond({
          response_type: 'ephemeral',
          text: 'Usage: `/onboard @user` — Enrolls a BDR into an onboarding plan.',
        });
        return;
      }

      const targetUserId = mentionMatch[1];

      // Look up BDR
      const bdr = await prisma.bdr.findFirst({
        where: { slackUserId: targetUserId, slackTeamId: teamId, isActive: true },
      });
      if (!bdr) {
        await respond({
          response_type: 'ephemeral',
          text: `<@${targetUserId}> is not a registered BDR. Add them via the admin dashboard first.`,
        });
        return;
      }

      // Check for existing active enrollment
      const existing = await getEnrollmentBySlackUser(targetUserId);
      if (existing) {
        await respond({
          response_type: 'ephemeral',
          text: `<@${targetUserId}> already has an active enrollment (plan: *${existing.plan.name}*, status: ${existing.status}). Cancel or graduate the existing enrollment first.`,
        });
        return;
      }

      // Fetch available plans
      const plans = await prisma.onboardingPlan.findMany({
        where: { slackTeamId: teamId, isLatest: true },
        orderBy: { name: 'asc' },
      });
      if (plans.length === 0) {
        await respond({
          response_type: 'ephemeral',
          text: 'No onboarding plans found for this workspace. Create one in the admin dashboard first.',
        });
        return;
      }

      // Build plan selection blocks
      const blocks: KnownBlock[] = [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `Select an onboarding plan for *${bdr.name}* (<@${targetUserId}>):`,
          },
        },
        ...plans.map(
          (plan): KnownBlock => ({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${plan.name}*\n${plan.description ?? 'No description'} — ${plan.durationDays} business days`,
            },
            accessory: {
              type: 'button',
              text: { type: 'plain_text', text: 'Select', emoji: true },
              action_id: 'onboard_select_plan',
              value: JSON.stringify({
                planId: plan.id,
                planName: plan.name,
                durationDays: plan.durationDays,
                bdrSlackUserId: targetUserId,
                bdrName: bdr.name,
                bdrManagerId: bdr.managerId ?? null,
              }),
            },
          }),
        ),
      ];

      await respond({ response_type: 'ephemeral', blocks, text: 'Select an onboarding plan' });
    } catch (error) {
      logger.error('/onboard command failed', { error });
      await respond({
        response_type: 'ephemeral',
        text: 'Something went wrong. Please try again or contact an admin.',
      });
    }
  });

  // ---- Action: plan button clicked -------------------------------------
  app.action('onboard_select_plan', async ({ action, ack, client, body }) => {
    await ack();

    try {
      const triggerId = (body as { trigger_id?: string }).trigger_id;
      if (!triggerId) {
        logger.warn('onboard_select_plan: no trigger_id');
        return;
      }

      const val = JSON.parse((action as { value: string }).value) as {
        planId: string;
        planName: string;
        durationDays: number;
        bdrSlackUserId: string;
        bdrName: string;
        bdrManagerId: string | null;
      };

      const today = new Date().toISOString().split('T')[0];

      await client.views.open({
        trigger_id: triggerId,
        view: {
          type: 'modal',
          callback_id: 'onboard_enrollment_submit',
          private_metadata: JSON.stringify({
            planId: val.planId,
            planName: val.planName,
            durationDays: val.durationDays,
            bdrSlackUserId: val.bdrSlackUserId,
            bdrName: val.bdrName,
            teamId: (body as { user?: { team_id?: string } }).user?.team_id ?? '',
          }),
          title: { type: 'plain_text', text: 'Enroll BDR' },
          submit: { type: 'plain_text', text: 'Enroll' },
          close: { type: 'plain_text', text: 'Cancel' },
          blocks: [
            {
              type: 'section',
              block_id: 'plan_info_block',
              text: {
                type: 'mrkdwn',
                text: `*Plan:* ${val.planName}\n*BDR:* ${val.bdrName} (<@${val.bdrSlackUserId}>)\n*Duration:* ${val.durationDays} business days`,
              },
            },
            { type: 'divider' },
            {
              type: 'input',
              block_id: 'start_date_block',
              element: {
                type: 'datepicker',
                action_id: 'start_date_input',
                initial_date: today,
                placeholder: { type: 'plain_text', text: 'Select start date' },
              },
              label: { type: 'plain_text', text: 'Start Date' },
            },
            {
              type: 'input',
              block_id: 'delivery_hour_block',
              element: {
                type: 'static_select',
                action_id: 'delivery_hour_input',
                initial_option: { text: { type: 'plain_text', text: '9:00 AM' }, value: '9' },
                options: buildHourOptions(),
              },
              label: { type: 'plain_text', text: 'Daily Delivery Hour' },
            },
            {
              type: 'input',
              block_id: 'timezone_block',
              element: {
                type: 'static_select',
                action_id: 'timezone_input',
                initial_option: {
                  text: { type: 'plain_text', text: 'Eastern (New York)' },
                  value: 'America/New_York',
                },
                options: buildTimezoneOptions(),
              },
              label: { type: 'plain_text', text: 'Timezone' },
            },
            {
              type: 'input',
              block_id: 'manager_block',
              element: {
                type: 'users_select',
                action_id: 'manager_input',
                ...(val.bdrManagerId ? { initial_user: val.bdrManagerId } : {}),
                placeholder: { type: 'plain_text', text: 'Select a manager' },
              },
              label: { type: 'plain_text', text: 'Manager' },
            },
          ],
        },
      });
    } catch (error) {
      logger.error('onboard_select_plan action failed', { error });
    }
  });

  // ---- View submission: enrollment form --------------------------------
  app.view('onboard_enrollment_submit', async ({ ack: ackView, view, body, client }) => {
    await ackView();

    try {
      const meta = JSON.parse(view.private_metadata) as {
        planId: string;
        planName: string;
        durationDays: number;
        bdrSlackUserId: string;
        bdrName: string;
        teamId: string;
      };

      const vals = view.state.values;
      const startDate = vals.start_date_block?.start_date_input?.selected_date ?? new Date().toISOString().split('T')[0];
      const deliveryHour = parseInt(
        vals.delivery_hour_block?.delivery_hour_input?.selected_option?.value ?? '9',
        10,
      );
      const timezone = vals.timezone_block?.timezone_input?.selected_option?.value ?? 'America/New_York';
      const managerId = vals.manager_block?.manager_input?.selected_user ?? 'system';
      const invokerId = body.user.id;

      // Race condition guard: re-check for duplicate enrollment
      const existing = await getEnrollmentBySlackUser(meta.bdrSlackUserId);
      if (existing) {
        await client.chat.postMessage({
          channel: invokerId,
          text: `Could not enroll <@${meta.bdrSlackUserId}> — they already have an active enrollment (plan: *${existing.plan.name}*).`,
        });
        return;
      }

      // Create enrollment
      const enrollment = await enrollBdr({
        slackTeamId: meta.teamId,
        slackUserId: meta.bdrSlackUserId,
        bdrName: meta.bdrName,
        planId: meta.planId,
        managerId,
        startDate: new Date(startDate),
        deliveryHour,
        timezone,
      });

      // Send welcome DM to BDR
      try {
        const plan = await prisma.onboardingPlan.findUnique({
          where: { id: meta.planId },
          include: { modules: { orderBy: { dayNumber: 'asc' }, take: 1 } },
        });
        if (plan) {
          const welcomeMessage = buildWelcomeDm({
            planName: plan.name,
            durationDays: plan.durationDays,
            managerName: `<@${managerId}>`,
            deliveryHour,
            timezone,
            firstModuleTitle: plan.modules[0]?.title ?? 'Day 1',
          });
          await client.chat.postMessage({
            channel: meta.bdrSlackUserId,
            text: welcomeMessage.text,
            blocks: welcomeMessage.blocks,
          });
        }
      } catch (dmError) {
        logger.warn('Failed to send onboarding welcome DM', {
          enrollmentId: enrollment.id,
          error: dmError,
        });
      }

      // Confirmation to the person who ran /onboard
      await client.chat.postMessage({
        channel: invokerId,
        text: `Enrolled *${meta.bdrName}* (<@${meta.bdrSlackUserId}>) in *${meta.planName}*.\nStart: ${startDate} | Hour: ${deliveryHour}:00 | TZ: ${timezone} | Manager: <@${managerId}>`,
      });

      logAudit({
        action: 'onboarding_enrollment_via_slack',
        actorUserId: invokerId,
        actorTeamId: meta.teamId,
        targetType: 'OnboardingEnrollment',
        targetId: enrollment.id,
        metadata: {
          bdrName: meta.bdrName,
          planName: meta.planName,
          managerId,
        },
      }).catch(() => {});

      logger.info('/onboard enrollment completed', {
        enrollmentId: enrollment.id,
        bdrSlackUserId: meta.bdrSlackUserId,
        planId: meta.planId,
        invokedBy: invokerId,
      });
    } catch (error) {
      logger.error('onboard_enrollment_submit failed', { error });
      try {
        await client.chat.postMessage({
          channel: body.user.id,
          text: 'Something went wrong while creating the enrollment. Please try again or use the admin dashboard.',
        });
      } catch {
        // Best-effort notification
      }
    }
  });
}
