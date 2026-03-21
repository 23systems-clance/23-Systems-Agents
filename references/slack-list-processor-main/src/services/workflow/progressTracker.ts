/**
 * Workflow execution progress tracker.
 *
 * Manages per-node progress in the WorkflowExecution.nodeProgress JSONB field
 * and publishes updates via Redis pub/sub for real-time SSE streaming.
 */

import { prisma } from '../../models/index.js';
import { config } from '../../config/index.js';
import Redis from 'ioredis';
import logger from '../../lib/logger.js';
import type { NodeProgress } from './types.js';

const PROGRESS_CHANNEL_PREFIX = 'workflow:progress:';

let publisher: Redis | null = null;

/**
 * Gets or creates the Redis publisher for progress events.
 */
function getPublisher(): Redis {
  if (!publisher) {
    publisher = new Redis(config.redis.url);
  }
  return publisher;
}

/**
 * Initializes progress tracking for a node within an execution.
 *
 * @param executionId - The workflow execution ID.
 * @param nodeId - The node being tracked.
 * @param nodeType - The node type string.
 * @param total - Total items to process.
 * @param label - Optional display label.
 */
export async function initNodeProgress(
  executionId: string,
  nodeId: string,
  nodeType: string,
  total: number,
  label?: string,
): Promise<void> {
  const progress: NodeProgress = {
    nodeId,
    nodeType,
    label,
    status: 'running',
    total,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
  };

  await updateNodeProgressInDb(executionId, nodeId, progress);
  await publishProgress(executionId, progress);
}

/**
 * Updates progress for a node within an execution.
 *
 * @param executionId - The workflow execution ID.
 * @param nodeId - The node being tracked.
 * @param update - Partial progress fields to merge.
 */
export async function updateNodeProgress(
  executionId: string,
  nodeId: string,
  update: Partial<Pick<NodeProgress, 'processed' | 'succeeded' | 'failed' | 'skipped' | 'errorSample'>>,
): Promise<void> {
  const execution = await prisma.workflowExecution.findUnique({
    where: { id: executionId },
    select: { nodeProgress: true },
  });

  if (!execution) return;

  const allProgress = (execution.nodeProgress as NodeProgress[] | null) || [];
  const existing = allProgress.find((p) => p.nodeId === nodeId);

  if (!existing) return;

  // Merge update
  if (update.processed !== undefined) existing.processed = update.processed;
  if (update.succeeded !== undefined) existing.succeeded = update.succeeded;
  if (update.failed !== undefined) existing.failed = update.failed;
  if (update.skipped !== undefined) existing.skipped = update.skipped;
  if (update.errorSample) {
    existing.errorSample = (existing.errorSample || []).concat(update.errorSample).slice(0, 5);
  }
  existing.lastUpdatedAt = new Date().toISOString();

  // Check completion
  if (existing.processed >= existing.total) {
    existing.status = existing.failed > 0 && existing.succeeded === 0 ? 'failed' : 'completed';
    existing.completedAt = new Date().toISOString();
  }

  await updateNodeProgressInDb(executionId, nodeId, existing);
  await publishProgress(executionId, existing);
}

/**
 * Marks a node's progress as completed.
 */
export async function completeNodeProgress(
  executionId: string,
  nodeId: string,
): Promise<void> {
  const execution = await prisma.workflowExecution.findUnique({
    where: { id: executionId },
    select: { nodeProgress: true },
  });

  if (!execution) return;

  const allProgress = (execution.nodeProgress as NodeProgress[] | null) || [];
  const existing = allProgress.find((p) => p.nodeId === nodeId);

  if (!existing) return;

  existing.status = existing.failed > 0 && existing.succeeded === 0 ? 'failed' : 'completed';
  existing.completedAt = new Date().toISOString();
  existing.lastUpdatedAt = new Date().toISOString();

  await updateNodeProgressInDb(executionId, nodeId, existing);
  await publishProgress(executionId, existing);
}

/**
 * Gets all node progress entries for an execution.
 */
export async function getExecutionProgress(executionId: string): Promise<NodeProgress[]> {
  const execution = await prisma.workflowExecution.findUnique({
    where: { id: executionId },
    select: { nodeProgress: true },
  });

  return (execution?.nodeProgress as NodeProgress[] | null) || [];
}

/**
 * Updates a single node's progress entry in the nodeProgress JSONB array.
 */
async function updateNodeProgressInDb(
  executionId: string,
  nodeId: string,
  progress: NodeProgress,
): Promise<void> {
  const execution = await prisma.workflowExecution.findUnique({
    where: { id: executionId },
    select: { nodeProgress: true },
  });

  if (!execution) return;

  const allProgress = (execution.nodeProgress as NodeProgress[] | null) || [];
  const index = allProgress.findIndex((p) => p.nodeId === nodeId);

  if (index >= 0) {
    allProgress[index] = progress;
  } else {
    allProgress.push(progress);
  }

  await prisma.workflowExecution.update({
    where: { id: executionId },
    data: { nodeProgress: allProgress as any },
  });
}

/**
 * Publishes a progress update via Redis pub/sub for SSE consumers.
 */
async function publishProgress(executionId: string, progress: NodeProgress): Promise<void> {
  try {
    const pub = getPublisher();
    await pub.publish(
      `${PROGRESS_CHANNEL_PREFIX}${executionId}`,
      JSON.stringify(progress),
    );
  } catch (err) {
    logger.warn('Failed to publish progress update', {
      executionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Creates a Redis subscriber for progress events on a specific execution.
 * Returns a cleanup function.
 */
export function subscribeToProgress(
  executionId: string,
  onMessage: (progress: NodeProgress) => void,
): { unsubscribe: () => Promise<void> } {
  const subscriber = new Redis(config.redis.url);
  const channel = `${PROGRESS_CHANNEL_PREFIX}${executionId}`;

  subscriber.subscribe(channel);
  subscriber.on('message', (_ch, message) => {
    try {
      const progress = JSON.parse(message) as NodeProgress;
      onMessage(progress);
    } catch {
      // Ignore malformed messages
    }
  });

  return {
    unsubscribe: async () => {
      await subscriber.unsubscribe(channel);
      await subscriber.quit();
    },
  };
}
