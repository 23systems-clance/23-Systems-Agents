/**
 * Bolt action and view handlers for workflow-driven interactions.
 *
 * Handles:
 * - Button clicks with action_id matching `/^wf:/` — routes to workflowEngine.resumeWithInput
 * - Modal submissions with callback_id matching `/^wf-form:/` — routes form data to resumeWithInput
 */

import type { App } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import { requireFeature } from '../../services/featureToggle/featureGate.js';
import { resumeWithInput } from '../../services/workflow/workflowEngine.js';
import {
  renderNodeToSlackBlocks,
  renderExpiredMessage,
  renderErrorMessage,
} from '../../services/workflow/workflowSlackRenderer.js';
import { renameList } from '../../services/rename/renameService.js';
import logger from '../../lib/logger.js';

/**
 * Processes any pending actions that accumulated during auto-advance
 * through ACTION / ENRICHMENT nodes in the workflow engine.
 *
 * @param pendingActions - Array of action descriptors from the engine
 * @param client - Slack WebClient
 * @param channelId - Target Slack channel ID
 * @param threadTs - Thread timestamp for threading messages
 */
async function processPendingActions(
  pendingActions: Array<Record<string, unknown>>,
  client: WebClient,
  channelId: string,
  threadTs?: string,
): Promise<void> {
  for (const action of pendingActions) {
    try {
      if (action.actionType === 'SEND_MESSAGE' && (action.params as Record<string, unknown>)?.text) {
        const params = action.params as Record<string, unknown>;
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: String(params.text),
        });
      }
      // RENAME_LIST: rename a completed job's result file
      if (action.actionType === 'RENAME_LIST') {
        const params = action.params as Record<string, unknown>;
        const jobIdVar = String(params.jobIdVariable ?? '');
        const jobId = jobIdVar ? String((action as any).context?.[jobIdVar] ?? params.jobId ?? '') : String(params.jobId ?? '');
        const campaignName = String(params.campaignName ?? '');
        const cosellName = params.cosellName ? String(params.cosellName) : null;

        if (jobId && campaignName) {
          // Resolve channel name for client extraction
          let channelName = 'unknown';
          try {
            const channelInfo = await client.conversations.info({ channel: channelId });
            channelName = (channelInfo.channel as any)?.name ?? 'unknown';
          } catch { /* use fallback */ }

          const result = await renameList({
            jobId,
            jobType: (params.jobType as 'enrichment' | 'filter') ?? 'enrichment',
            campaignName,
            cosellName,
            channelName,
            slackClient: client,
            channelId,
            threadTs: threadTs ?? '',
          });

          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: `List renamed: \`${result.oldFileName}\` → \`${result.newFileName}\``,
          });
        }
      }

      // ENRICHMENT and CREATE_JOB are handled by the existing Slack enrichment flow
      // which is triggered when the workflow completes and the user has made all selections
      logger.info('Processed pending workflow action', {
        actionType: action.actionType,
        nodeId: action.nodeId,
      });
    } catch (actionErr) {
      logger.error('Failed to process pending workflow action', {
        actionType: action.actionType,
        nodeId: action.nodeId,
        error: actionErr instanceof Error ? actionErr.message : String(actionErr),
      });
    }
  }
}

/**
 * Parses a workflow button action_id.
 * Format: `wf:{executionId}:{nodeId}:{buttonId}`
 *
 * @param actionId - The Slack action_id string.
 * @returns Parsed components or null if format doesn't match.
 */
function parseWorkflowActionId(actionId: string): {
  executionId: string;
  nodeId: string;
  buttonId: string;
} | null {
  const parts = actionId.split(':');
  if (parts.length < 4 || parts[0] !== 'wf') {
    return null;
  }
  return {
    executionId: parts[1],
    nodeId: parts[2],
    buttonId: parts.slice(3).join(':'),
  };
}

/**
 * Parses a workflow form modal callback_id.
 * Format: `wf-form:{executionId}:{nodeId}`
 *
 * @param callbackId - The Slack callback_id string.
 * @returns Parsed components or null if format doesn't match.
 */
function parseWorkflowFormCallbackId(callbackId: string): {
  executionId: string;
  nodeId: string;
} | null {
  const parts = callbackId.split(':');
  if (parts.length < 3 || parts[0] !== 'wf-form') {
    return null;
  }
  return {
    executionId: parts[1],
    nodeId: parts[2],
  };
}

/**
 * Registers workflow action and view_submission handlers on the Bolt app.
 *
 * @param app - The Slack Bolt application instance.
 */
export function registerWorkflowActionHandlers(app: App): void {
  // -----------------------------------------------------------------------
  // Button click handler — matches action_id starting with "wf:"
  // -----------------------------------------------------------------------

  app.action(/^wf:/, requireFeature('workflows'), async ({ action, body, client, ack }) => {
    await ack();

    const actionId = (action as { action_id: string }).action_id;
    const parsed = parseWorkflowActionId(actionId);

    if (!parsed) {
      logger.warn('Invalid workflow action_id format', { actionId });
      return;
    }

    const { executionId, nodeId, buttonId } = parsed;
    const channelId = (body as { channel?: { id: string } }).channel?.id;
    const threadTs = (body as { message?: { thread_ts?: string; ts?: string } }).message?.thread_ts
      ?? (body as { message?: { ts?: string } }).message?.ts;

    logger.info('Workflow button click received', {
      executionId,
      nodeId,
      buttonId,
      channelId,
    });

    try {
      // Extract the button value from the action
      const buttonValue = (action as { value?: string }).value ?? buttonId;

      // Resume execution with the button selection
      const result = await resumeWithInput(
        executionId,
        { [buttonId]: buttonValue, selectedButton: buttonId, selectedValue: buttonValue },
        buttonId,
      );

      if (!channelId) {
        logger.warn('No channel ID in workflow action body', { executionId });
        return;
      }

      // Process any pending actions from auto-advanced ACTION/ENRICHMENT nodes
      if (result.pendingActions && result.pendingActions.length > 0) {
        await processPendingActions(result.pendingActions, client, channelId, threadTs);
      }

      if (result.completed) {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: 'Workflow completed successfully.',
        });
        return;
      }

      // Render the next node if there is one
      if (result.nextNode) {
        const context = await getExecutionContext(executionId);
        const slackPayload = renderNodeToSlackBlocks(
          result.nextNode,
          executionId,
          context,
        );

        if (slackPayload) {
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            ...slackPayload,
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Error handling workflow button click', {
        executionId,
        nodeId,
        buttonId,
        error: message,
      });

      if (channelId) {
        if (message.includes('expired')) {
          const expired = renderExpiredMessage();
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            ...expired,
          });
        } else {
          const errorPayload = renderErrorMessage(message);
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            ...errorPayload,
          });
        }
      }
    }
  });

  // -----------------------------------------------------------------------
  // Modal submission handler — matches callback_id starting with "wf-form:"
  // -----------------------------------------------------------------------

  app.view(/^wf-form:/, async ({ view, ack, body, client }) => {
    const parsed = parseWorkflowFormCallbackId(view.callback_id);

    if (!parsed) {
      await ack();
      logger.warn('Invalid workflow form callback_id format', {
        callbackId: view.callback_id,
      });
      return;
    }

    const { executionId } = parsed;

    try {
      // Extract form values from the view state
      const formValues: Record<string, unknown> = {};
      const stateValues = view.state?.values ?? {};

      for (const blockId of Object.keys(stateValues)) {
        const block = stateValues[blockId];
        for (const actionId of Object.keys(block)) {
          const input = block[actionId];
          // Extract value based on input type
          if (input.type === 'plain_text_input' || input.type === 'email_text_input') {
            formValues[actionId] = input.value;
          } else if (input.type === 'number_input') {
            formValues[actionId] = input.value ? Number(input.value) : null;
          } else if (input.type === 'static_select') {
            formValues[actionId] = input.selected_option?.value;
          } else if (input.type === 'multi_static_select') {
            formValues[actionId] = input.selected_options?.map(
              (o: { value: string }) => o.value,
            );
          } else if (input.type === 'checkboxes') {
            formValues[actionId] = input.selected_options?.map(
              (o: { value: string }) => o.value,
            );
          }
        }
      }

      // Resume execution with form data
      const result = await resumeWithInput(executionId, formValues);

      await ack();

      // Post the next node to the user's channel
      const userId = body.user.id;

      // Process any pending actions from auto-advanced ACTION/ENRICHMENT nodes
      if (result.pendingActions && result.pendingActions.length > 0) {
        const execCtx = await getExecutionContext(executionId);
        const actionChannelId = (execCtx as Record<string, unknown>).slackChannelId as string;
        const actionThreadTs = (execCtx as Record<string, unknown>).slackThreadTs as string;
        if (actionChannelId) {
          await processPendingActions(result.pendingActions, client, actionChannelId, actionThreadTs);
        }
      }

      if (result.completed) {
        // Send completion message via DM or original channel
        const context = await getExecutionContext(executionId);
        const channelId = (context as Record<string, unknown>).slackChannelId as string;
        const threadTs = (context as Record<string, unknown>).slackThreadTs as string;

        if (channelId) {
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: 'Workflow completed successfully.',
          });
        }
        return;
      }

      if (result.nextNode) {
        const context = await getExecutionContext(executionId);
        const channelId = (context as Record<string, unknown>).slackChannelId as string;
        const threadTs = (context as Record<string, unknown>).slackThreadTs as string;
        const slackPayload = renderNodeToSlackBlocks(
          result.nextNode,
          executionId,
          context,
        );

        if (slackPayload && channelId) {
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            ...slackPayload,
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Error handling workflow form submission', {
        executionId,
        error: message,
      });

      if (message.includes('expired')) {
        await ack({
          response_action: 'errors',
          errors: { _: 'This workflow has expired. Please start a new one.' },
        } as any);
      } else {
        await ack({
          response_action: 'errors',
          errors: { _: 'Something went wrong. Please try again.' },
        } as any);
      }
    }
  });
}

/**
 * Retrieves the execution context (including channel/thread info) from the database.
 *
 * @param executionId - The workflow execution ID.
 * @returns The execution context merged with Slack metadata.
 */
async function getExecutionContext(executionId: string): Promise<Record<string, unknown>> {
  const { prisma } = await import('../../models/index.js');

  const execution = await prisma.workflowExecution.findUnique({
    where: { id: executionId },
    select: {
      context: true,
      slackChannelId: true,
      slackThreadTs: true,
      slackUserId: true,
      slackTeamId: true,
    },
  });

  if (!execution) {
    return {};
  }

  return {
    ...(execution.context as Record<string, unknown> ?? {}),
    slackChannelId: execution.slackChannelId,
    slackThreadTs: execution.slackThreadTs,
    slackUserId: execution.slackUserId,
    slackTeamId: execution.slackTeamId,
  };
}
