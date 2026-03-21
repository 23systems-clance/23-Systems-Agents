/**
 * Bolt action handler for onboarding quiz submissions.
 *
 * Handles:
 * - `onboarding_quiz_submit` — Fires when a BDR selects a radio button answer
 *   in a quiz-type daily module DM. Extracts the selected answer, retrieves
 *   enrollment context from the "Mark Complete" button in the same message,
 *   submits the quiz via progressService, updates the message with feedback,
 *   and alerts the manager if the quiz was failed.
 */

import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';
import { submitQuizAnswers } from '../../services/onboarding/progressService.js';
import { buildAlertDm } from '../../services/onboarding/slackBlocks.js';

/**
 * Registers the onboarding quiz action handler on the Bolt app.
 *
 * @param app - The Slack Bolt application instance.
 */
export function registerOnboardingQuizHandlers(app: App): void {
  app.action('onboarding_quiz_submit', async ({ action, ack, client, body }) => {
    await ack();

    try {
      // Extract the selected answer from the radio button action
      if (!('selected_option' in action) || !action.selected_option) {
        logger.warn('onboarding_quiz_submit: no selected_option in action');
        return;
      }

      const selectedAnswer = action.selected_option.value;

      if (!selectedAnswer) {
        logger.warn('onboarding_quiz_submit: selected_option has no value');
        return;
      }

      logger.debug('onboarding_quiz_submit: radio button selected', {
        selectedAnswer,
      });

      // Cast body to access message and channel properties
      const typedBody = body as {
        channel?: { id: string };
        message?: { ts: string; blocks?: any[] };
      };

      const message = typedBody.message;
      if (!message?.blocks) {
        logger.warn('onboarding_quiz_submit: no message blocks found in body');
        return;
      }

      // Find the Mark Complete button to extract enrollmentId and dayNumber
      const actionsBlock = message.blocks.find((b: any) => b.type === 'actions');
      const markCompleteBtn = actionsBlock?.elements?.find(
        (e: any) => e.action_id === 'onboarding_mark_complete',
      );

      if (!markCompleteBtn?.value) {
        logger.warn('onboarding_quiz_submit: could not find mark complete button value');
        return;
      }

      const { enrollmentId, dayNumber } = JSON.parse(markCompleteBtn.value) as {
        enrollmentId: string;
        dayNumber: number;
      };

      logger.info('onboarding_quiz_submit: submitting quiz answer', {
        enrollmentId,
        dayNumber,
        selectedAnswer,
      });

      // Submit the quiz answer
      const result = await submitQuizAnswers(enrollmentId, dayNumber, [
        { questionIndex: 0, answer: selectedAnswer },
      ]);

      const { quizResult, alertManager } = result;

      // Build feedback blocks
      const feedbackBlocks: KnownBlock[] = [];

      if (quizResult.passed) {
        feedbackBlocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Quiz Passed!* Score: ${quizResult.score}%`,
          },
        });
      } else {
        feedbackBlocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Quiz Not Passed.* Score: ${quizResult.score}% (need ${quizResult.passingThreshold}%)`,
          },
        });
      }

      // Add per-question feedback
      for (const fb of quizResult.feedback) {
        const icon = fb.correct ? 'Correct' : 'Incorrect';
        feedbackBlocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `Q${fb.questionIndex + 1}: ${icon}\nYour answer: ${fb.submittedAnswer}${!fb.correct ? `\nCorrect answer: ${fb.correctAnswer}` : ''}`,
          },
        });
      }

      // Update the original message with quiz feedback
      const channelId = typedBody.channel?.id;
      const messageTs = message.ts;

      if (channelId && messageTs) {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          blocks: feedbackBlocks,
          text: quizResult.passed
            ? `Quiz Passed! Score: ${quizResult.score}%`
            : `Quiz Not Passed. Score: ${quizResult.score}%`,
        });
      }

      // Alert the manager if the quiz was failed
      if (alertManager) {
        const enrollment = await prisma.onboardingEnrollment.findUniqueOrThrow({
          where: { id: enrollmentId },
          select: { managerId: true, bdrName: true },
        });

        const alertMsg = buildAlertDm({
          alertType: 'quiz_failed',
          bdrName: enrollment.bdrName,
          details: `Quiz "${alertManager.quizTopic}" score: ${alertManager.score}%`,
          enrollmentId,
        });

        await client.chat.postMessage({
          channel: enrollment.managerId,
          ...alertMsg,
        });

        logger.info('onboarding_quiz_submit: manager alerted about failed quiz', {
          enrollmentId,
          managerId: enrollment.managerId,
          score: alertManager.score,
        });
      }

      logger.info('onboarding_quiz_submit: quiz processed', {
        enrollmentId,
        dayNumber,
        score: quizResult.score,
        passed: quizResult.passed,
      });
    } catch (error) {
      logger.error('onboarding_quiz_submit: error processing quiz submission', {
        error,
      });
    }
  });
}
