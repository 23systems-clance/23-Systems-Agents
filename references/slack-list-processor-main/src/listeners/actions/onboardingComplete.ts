/**
 * Bolt action and view handlers for onboarding module completion,
 * practice task submission, and manager review (approve/reject).
 *
 * Handles:
 * - `onboarding_mark_complete` (T034) — Marks a module as complete and updates
 *   the original message with progress info.
 * - `onboarding_practice_submit` (T036) — Opens a modal for BDR to submit a
 *   practice task response.
 * - `onboarding_practice_submission` (view) — Saves the practice task and
 *   notifies the manager with approve/reject buttons.
 * - `onboarding_practice_approve` (T037) — Manager approves a practice task.
 * - `onboarding_practice_reject` (T037) — Manager rejects a practice task.
 */

import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';
import * as progressService from '../../services/onboarding/progressService.js';
import { triggerGraduationReview } from '../../services/onboarding/graduationService.js';

/**
 * Registers onboarding completion, practice task, and manager review
 * handlers on the Bolt app.
 *
 * @param app - The Slack Bolt application instance.
 */
export function registerOnboardingCompleteHandlers(app: App): void {
  // -----------------------------------------------------------------------
  // Action: mark a module as complete (T034)
  // -----------------------------------------------------------------------
  app.action('onboarding_mark_complete', async ({ action, ack, client, body }) => {
    await ack();

    try {
      if (!('value' in action) || !action.value) {
        logger.warn('onboarding_mark_complete: missing action value');
        return;
      }

      const { enrollmentId, dayNumber } = JSON.parse(action.value) as {
        enrollmentId: string;
        dayNumber: number;
      };

      const result = await progressService.markModuleComplete(enrollmentId, dayNumber);
      const { overallProgress, allComplete } = result;

      const channelId = (body as { channel?: { id: string } }).channel?.id;
      const messageTs = (body as { message?: { ts: string } }).message?.ts;

      if (channelId && messageTs) {
        const blocks: KnownBlock[] = [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ *Day ${dayNumber} — Completed!*\n\nProgress: ${overallProgress.completed}/${overallProgress.total} modules (${overallProgress.percentage}%)`,
            },
          },
        ];

        if (allComplete) {
          blocks.push({
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: '🎓 All modules complete! Your manager will review your progress.',
              },
            ],
          });
        }

        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: `Day ${dayNumber} completed — ${overallProgress.completed}/${overallProgress.total} modules`,
          blocks,
        });
      }

      // T051: Trigger graduation review when all modules are complete
      if (allComplete) {
        try {
          await triggerGraduationReview(enrollmentId, client);
        } catch (gradError) {
          logger.error('Failed to trigger graduation review', {
            enrollmentId,
            error: gradError instanceof Error ? gradError.message : String(gradError),
          });
        }
      }

      logger.info('Module marked complete', { enrollmentId, dayNumber, overallProgress });
    } catch (err) {
      logger.error('onboarding_mark_complete failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // -----------------------------------------------------------------------
  // Action: open practice task submission modal (T036)
  // -----------------------------------------------------------------------
  app.action('onboarding_practice_submit', async ({ action, ack, client, body }) => {
    await ack();

    try {
      if (!('value' in action) || !action.value) {
        logger.warn('onboarding_practice_submit: missing action value');
        return;
      }

      const { enrollmentId, dayNumber } = JSON.parse(action.value) as {
        enrollmentId: string;
        dayNumber: number;
      };

      const triggerId = (body as { trigger_id?: string }).trigger_id;
      if (!triggerId) {
        logger.warn('onboarding_practice_submit: no trigger_id in body');
        return;
      }

      await client.views.open({
        trigger_id: triggerId,
        view: {
          type: 'modal',
          callback_id: 'onboarding_practice_submission',
          private_metadata: JSON.stringify({ enrollmentId, dayNumber }),
          title: { type: 'plain_text', text: 'Submit Practice Task' },
          submit: { type: 'plain_text', text: 'Submit' },
          close: { type: 'plain_text', text: 'Cancel' },
          blocks: [
            {
              type: 'input',
              block_id: 'practice_block',
              element: {
                type: 'plain_text_input',
                action_id: 'practice_input',
                multiline: true,
                placeholder: {
                  type: 'plain_text',
                  text: 'Describe what you did and share your results...',
                },
              },
              label: {
                type: 'plain_text',
                text: 'Your Submission',
              },
            },
          ],
        },
      });

      logger.info('Opened practice task submission modal', { enrollmentId, dayNumber });
    } catch (err) {
      logger.error('onboarding_practice_submit failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // -----------------------------------------------------------------------
  // View submission: save practice task and notify manager
  // -----------------------------------------------------------------------
  app.view('onboarding_practice_submission', async ({ ack, view, body, client }) => {
    await ack();

    try {
      const { enrollmentId, dayNumber } = JSON.parse(view.private_metadata) as {
        enrollmentId: string;
        dayNumber: number;
      };

      const submission =
        view.state.values.practice_block?.practice_input?.value ?? '';

      await progressService.submitPracticeTask(enrollmentId, dayNumber, submission);

      const enrollment = await prisma.onboardingEnrollment.findUniqueOrThrow({
        where: { id: enrollmentId },
        select: { managerId: true, bdrName: true },
      });

      const { managerId, bdrName } = enrollment;

      await client.chat.postMessage({
        channel: managerId,
        text: `Practice task submission from ${bdrName} (Day ${dayNumber})`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Practice Task Submission*\n*BDR:* ${bdrName}\n*Day:* ${dayNumber}\n\n${submission}`,
            },
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: 'Approve' },
                action_id: 'onboarding_practice_approve',
                value: JSON.stringify({ enrollmentId, dayNumber }),
                style: 'primary',
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: 'Reject' },
                action_id: 'onboarding_practice_reject',
                value: JSON.stringify({ enrollmentId, dayNumber }),
                style: 'danger',
              },
            ],
          },
        ],
      });

      logger.info('Practice task submitted and manager notified', {
        enrollmentId,
        dayNumber,
        managerId,
        slackUserId: body.user.id,
      });
    } catch (err) {
      logger.error('onboarding_practice_submission failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // -----------------------------------------------------------------------
  // Action: manager approves practice task (T037)
  // -----------------------------------------------------------------------
  app.action('onboarding_practice_approve', async ({ action, ack, client, body }) => {
    await ack();

    try {
      if (!('value' in action) || !action.value) {
        logger.warn('onboarding_practice_approve: missing action value');
        return;
      }

      const { enrollmentId, dayNumber } = JSON.parse(action.value) as {
        enrollmentId: string;
        dayNumber: number;
      };

      const { overallProgress } = await progressService.approvePracticeTask(
        enrollmentId,
        dayNumber,
      );

      const enrollment = await prisma.onboardingEnrollment.findUniqueOrThrow({
        where: { id: enrollmentId },
        select: { slackUserId: true, bdrName: true },
      });

      const channelId = (body as { channel?: { id: string } }).channel?.id;
      const messageTs = (body as { message?: { ts: string } }).message?.ts;

      if (channelId && messageTs) {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: `Practice task approved — ${enrollment.bdrName}, Day ${dayNumber}`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `✅ *Practice task approved* — ${enrollment.bdrName}, Day ${dayNumber}\n\nProgress: ${overallProgress.completed}/${overallProgress.total} (${overallProgress.percentage}%)`,
              },
            },
          ],
        });
      }

      await client.chat.postMessage({
        channel: enrollment.slackUserId,
        text: `Your Day ${dayNumber} practice task has been approved! Great work.`,
      });

      // Trigger graduation review if all modules are now complete
      if (overallProgress.completed === overallProgress.total) {
        try {
          await triggerGraduationReview(enrollmentId, client);
        } catch (gradError) {
          logger.error('Failed to trigger graduation review after practice approval', {
            enrollmentId,
            error: gradError instanceof Error ? gradError.message : String(gradError),
          });
        }
      }

      logger.info('Practice task approved', { enrollmentId, dayNumber });
    } catch (err) {
      logger.error('onboarding_practice_approve failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // -----------------------------------------------------------------------
  // Action: manager rejects practice task (T037)
  // -----------------------------------------------------------------------
  app.action('onboarding_practice_reject', async ({ action, ack, client, body }) => {
    await ack();

    try {
      if (!('value' in action) || !action.value) {
        logger.warn('onboarding_practice_reject: missing action value');
        return;
      }

      const { enrollmentId, dayNumber } = JSON.parse(action.value) as {
        enrollmentId: string;
        dayNumber: number;
      };

      await progressService.rejectPracticeTask(enrollmentId, dayNumber);

      const enrollment = await prisma.onboardingEnrollment.findUniqueOrThrow({
        where: { id: enrollmentId },
        select: { slackUserId: true, bdrName: true },
      });

      const channelId = (body as { channel?: { id: string } }).channel?.id;
      const messageTs = (body as { message?: { ts: string } }).message?.ts;

      if (channelId && messageTs) {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: `Practice task rejected — ${enrollment.bdrName}, Day ${dayNumber}`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `❌ *Practice task rejected* — ${enrollment.bdrName}, Day ${dayNumber}\n\nThe BDR has been notified to resubmit.`,
              },
            },
          ],
        });
      }

      await client.chat.postMessage({
        channel: enrollment.slackUserId,
        text: `Your Day ${dayNumber} practice task needs revision. Please review the feedback and resubmit.`,
      });

      logger.info('Practice task rejected', { enrollmentId, dayNumber });
    } catch (err) {
      logger.error('onboarding_practice_reject failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
