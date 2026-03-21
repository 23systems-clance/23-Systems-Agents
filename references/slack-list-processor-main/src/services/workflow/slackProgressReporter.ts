/**
 * Slack progress reporter for workflow executions.
 *
 * Subscribes to workflow execution progress via Redis pub/sub and
 * posts/updates a progress message in the relevant Slack thread.
 */

import { subscribeToProgress } from './progressTracker.js';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';
import type { NodeProgress } from './types.js';

/** Active reporters keyed by executionId. */
const activeReporters = new Map<string, { unsubscribe: () => Promise<void> }>();

/**
 * Starts a Slack progress reporter for a workflow execution.
 * Posts an initial progress message and updates it as nodes complete.
 *
 * @param executionId - The workflow execution ID.
 * @param slackApp - The Slack Bolt app instance for posting messages.
 */
export async function startSlackProgressReporter(
  executionId: string,
  slackApp: { client: { chat: { postMessage: Function; update: Function } } },
): Promise<void> {
  // Already reporting on this execution
  if (activeReporters.has(executionId)) return;

  const execution = await prisma.workflowExecution.findUnique({
    where: { id: executionId },
    select: {
      slackChannelId: true,
      slackThreadTs: true,
      slackTeamId: true,
    },
  });

  if (!execution || !execution.slackChannelId || execution.slackChannelId === 'webhook') {
    return; // No Slack context (e.g. webhook-triggered)
  }

  let messageTs: string | null = null;
  const progressMap = new Map<string, NodeProgress>();

  const { unsubscribe } = subscribeToProgress(executionId, async (progress) => {
    progressMap.set(progress.nodeId, progress);

    try {
      const text = formatProgressMessage(progressMap);

      if (!messageTs) {
        const result = await slackApp.client.chat.postMessage({
          channel: execution.slackChannelId,
          thread_ts: execution.slackThreadTs || undefined,
          text,
        });
        messageTs = (result as any).ts;
      } else {
        await slackApp.client.chat.update({
          channel: execution.slackChannelId,
          ts: messageTs,
          text,
        });
      }
    } catch (err) {
      logger.warn('Failed to update Slack progress message', {
        executionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Check if all nodes are done
    const allDone = Array.from(progressMap.values()).every(
      (p) => p.status === 'completed' || p.status === 'failed',
    );
    if (allDone) {
      stopSlackProgressReporter(executionId);
    }
  });

  activeReporters.set(executionId, { unsubscribe });
}

/**
 * Stops the Slack progress reporter for an execution.
 */
export async function stopSlackProgressReporter(executionId: string): Promise<void> {
  const reporter = activeReporters.get(executionId);
  if (reporter) {
    await reporter.unsubscribe();
    activeReporters.delete(executionId);
  }
}

/**
 * Formats a progress message from all tracked node progress entries.
 */
function formatProgressMessage(progressMap: Map<string, NodeProgress>): string {
  const lines: string[] = ['*Workflow Progress*\n'];

  for (const [, progress] of progressMap) {
    const statusIcon = progress.status === 'completed'
      ? '\u2705'
      : progress.status === 'failed'
        ? '\u274C'
        : progress.status === 'running'
          ? '\u23F3'
          : '\u23F8\uFE0F';

    const label = progress.label || progress.nodeType;
    const pct = progress.total > 0
      ? Math.round((progress.processed / progress.total) * 100)
      : 0;

    lines.push(
      `${statusIcon} *${label}*: ${progress.processed}/${progress.total} (${pct}%) ` +
      `| OK: ${progress.succeeded} | Failed: ${progress.failed} | Skipped: ${progress.skipped}`,
    );

    if (progress.errorSample && progress.errorSample.length > 0) {
      lines.push(`   _Errors: ${progress.errorSample[0]}_`);
    }
  }

  return lines.join('\n');
}
