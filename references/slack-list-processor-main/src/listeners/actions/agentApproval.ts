/**
 * Suggest-only Slack action handlers for autonomous agents (T028).
 *
 * Handles Approve/Reject button clicks from suggest-only mode notifications.
 * Uses regex-matched action IDs to support per-pendingAction buttons:
 *   - agent_action_approve_<pendingActionId>
 *   - agent_action_reject_<pendingActionId>
 *
 * Follows the existing graduationReview.ts button handler pattern.
 */

import type { App } from '@slack/bolt';
import * as suggestOnlyManager from '../../services/autonomous/suggestOnlyManager.js';
import * as auditRecorder from '../../services/autonomous/auditRecorder.js';
import logger from '../../lib/logger.js';

const log = logger.withContext({ service: 'agentApproval' });

/**
 * Registers agent approval/rejection action handlers on the Bolt app.
 *
 * @param app - The Slack Bolt application instance.
 */
export function registerAgentApprovalHandlers(app: App): void {
  // -----------------------------------------------------------------------
  // Action: approve agent pending action
  // -----------------------------------------------------------------------
  app.action(/^agent_action_approve_/, async ({ action, ack, client, body }) => {
    await ack();

    try {
      if (!('value' in action) || !action.value) {
        log.warn('agent_action_approve: missing action value');
        return;
      }

      const pendingActionId = action.value;
      const slackUserId = body.user?.id ?? 'unknown';

      const updatedAction = await suggestOnlyManager.processApproval(
        pendingActionId,
        slackUserId,
      );

      // Record in audit trail
      await auditRecorder.recordAction({
        agentName: updatedAction.agentName,
        action: updatedAction.action,
        confidence: updatedAction.confidence,
        severity: 'INFO',
        outcome: 'APPROVED',
        metadata: {
          pendingActionId,
          reviewedBy: slackUserId,
        },
        specialtyExecutionId: updatedAction.specialtyExecutionId ?? undefined,
      });

      // Update the original Slack message to show outcome
      const channelId = (body as { channel?: { id: string } }).channel?.id;
      const messageTs = (body as { message?: { ts: string } }).message?.ts;

      if (channelId && messageTs) {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: `Agent action approved: ${updatedAction.action}`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: [
                  `*Agent Action Approved*`,
                  `Agent: \`${updatedAction.agentName}\``,
                  `Action: \`${updatedAction.action}\``,
                  `Confidence: ${(updatedAction.confidence * 100).toFixed(0)}%`,
                  `Approved by: <@${slackUserId}>`,
                ].join('\n'),
              },
            },
          ],
        });
      }

      log.info('Agent action approved via Slack', {
        pendingActionId,
        agentName: updatedAction.agentName,
        slackUserId,
      });
    } catch (err) {
      log.error('agent_action_approve failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // -----------------------------------------------------------------------
  // Action: reject agent pending action
  // -----------------------------------------------------------------------
  app.action(/^agent_action_reject_/, async ({ action, ack, client, body }) => {
    await ack();

    try {
      if (!('value' in action) || !action.value) {
        log.warn('agent_action_reject: missing action value');
        return;
      }

      const pendingActionId = action.value;
      const slackUserId = body.user?.id ?? 'unknown';

      const updatedAction = await suggestOnlyManager.processRejection(
        pendingActionId,
        slackUserId,
        'Rejected via Slack button',
      );

      // Record in audit trail
      await auditRecorder.recordAction({
        agentName: updatedAction.agentName,
        action: updatedAction.action,
        confidence: updatedAction.confidence,
        severity: 'INFO',
        outcome: 'REJECTED',
        metadata: {
          pendingActionId,
          reviewedBy: slackUserId,
          reason: 'Rejected via Slack button',
        },
        specialtyExecutionId: updatedAction.specialtyExecutionId ?? undefined,
      });

      // Update the original Slack message to show outcome
      const channelId = (body as { channel?: { id: string } }).channel?.id;
      const messageTs = (body as { message?: { ts: string } }).message?.ts;

      if (channelId && messageTs) {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: `Agent action rejected: ${updatedAction.action}`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: [
                  `*Agent Action Rejected*`,
                  `Agent: \`${updatedAction.agentName}\``,
                  `Action: \`${updatedAction.action}\``,
                  `Confidence: ${(updatedAction.confidence * 100).toFixed(0)}%`,
                  `Rejected by: <@${slackUserId}>`,
                ].join('\n'),
              },
            },
          ],
        });
      }

      log.info('Agent action rejected via Slack', {
        pendingActionId,
        agentName: updatedAction.agentName,
        slackUserId,
      });
    } catch (err) {
      log.error('agent_action_reject failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
