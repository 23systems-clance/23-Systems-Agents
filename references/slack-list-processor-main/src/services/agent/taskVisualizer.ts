/**
 * Task visualizer for enrichment pipeline progress.
 *
 * Generates task card chunk arrays for Slack streaming task visualization.
 * Subscribes to Redis pub/sub for real-time progress from BullMQ workers.
 *
 * @see streaming-protocol.md contract (ENRICHMENT_PIPELINE_TASKS)
 */

import redis from '../../lib/redis.js';
import logger from '../../lib/logger.js';
import type { StreamSession, TaskChunk } from './streamingHelper.js';

// ---------------------------------------------------------------------------
// Pipeline Task Definitions
// ---------------------------------------------------------------------------

interface PipelineTask {
  id: string;
  title: string;
}

const ENRICHMENT_PIPELINE_TASKS: Record<string, PipelineTask[]> = {
  technographic: [
    { id: 'parse', title: 'Parsing uploaded file' },
    { id: 'validate', title: 'Validating data structure' },
    { id: 'builtwith', title: 'Looking up technology stacks' },
    { id: 'classify', title: 'Classifying tech spend tiers' },
    { id: 'generate', title: 'Generating output file' },
  ],
  contact: [
    { id: 'parse', title: 'Parsing uploaded file' },
    { id: 'validate', title: 'Validating data structure' },
    { id: 'apollo_search', title: 'Searching for contacts' },
    { id: 'persona', title: 'Classifying decision makers' },
    { id: 'generate', title: 'Generating output file' },
  ],
  combined: [
    { id: 'parse', title: 'Parsing uploaded file' },
    { id: 'validate', title: 'Validating data structure' },
    { id: 'builtwith', title: 'Looking up technology stacks' },
    { id: 'classify', title: 'Classifying tech spend tiers' },
    { id: 'apollo_search', title: 'Searching for contacts' },
    { id: 'persona', title: 'Classifying decision makers' },
    { id: 'generate', title: 'Generating output file' },
  ],
  tech_report: [
    { id: 'query', title: 'Querying enrichment data' },
    { id: 'narrative', title: 'Generating output file' },
  ],
  // Tech report chain flows with quality gate visible
  tech_report_technographic: [
    { id: 'quality_gate', title: 'Running quality gate filters' },
    { id: 'parse', title: 'Preparing company list' },
    { id: 'validate', title: 'Validating data structure' },
    { id: 'builtwith', title: 'Looking up technology stacks' },
    { id: 'classify', title: 'Classifying tech spend tiers' },
    { id: 'generate', title: 'Generating output file' },
  ],
  tech_report_contact: [
    { id: 'quality_gate', title: 'Running quality gate filters' },
    { id: 'parse', title: 'Preparing company list' },
    { id: 'validate', title: 'Validating data structure' },
    { id: 'apollo_search', title: 'Searching for contacts' },
    { id: 'persona', title: 'Classifying decision makers' },
    { id: 'generate', title: 'Generating output file' },
  ],
  tech_report_combined: [
    { id: 'quality_gate', title: 'Running quality gate filters' },
    { id: 'parse', title: 'Preparing company list' },
    { id: 'validate', title: 'Validating data structure' },
    { id: 'builtwith', title: 'Looking up technology stacks' },
    { id: 'classify', title: 'Classifying tech spend tiers' },
    { id: 'apollo_search', title: 'Searching for contacts' },
    { id: 'persona', title: 'Classifying decision makers' },
    { id: 'generate', title: 'Generating output file' },
  ],
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Progress event published by workers via Redis pub/sub. */
export interface AgentProgressEvent {
  jobId: string;
  stage: string;
  status: 'in_progress' | 'complete' | 'error';
  detail?: string;
  progress?: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds the initial plan chunks for a given enrichment type.
 * All tasks start as 'pending'.
 */
export function buildInitialPlan(
  enrichmentType: string,
  planTitle?: string,
): TaskChunk[] {
  const tasks = ENRICHMENT_PIPELINE_TASKS[enrichmentType];
  if (!tasks) {
    return [];
  }

  const title = planTitle || formatPlanTitle(enrichmentType);
  const chunks: TaskChunk[] = [
    { type: 'plan_update', title },
  ];

  for (const task of tasks) {
    chunks.push({
      type: 'task_update',
      id: task.id,
      title: task.title,
      status: 'pending',
    });
  }

  return chunks;
}

/**
 * Subscribes to Redis pub/sub for progress events on a specific job,
 * and maps them to task card updates via the streaming session.
 *
 * Returns an unsubscribe function to clean up when the job completes.
 * IMPORTANT: This function is now async and must be awaited to ensure
 * subscription is established before progress events are published.
 */
export async function subscribeToProgress(
  jobId: string,
  enrichmentType: string,
  session: StreamSession,
): Promise<{ unsubscribe: () => Promise<void> }> {
  const channel = `agent:progress:${jobId}`;

  // Create a duplicate Redis connection for pub/sub (subscriber cannot
  // issue other commands while subscribed).
  const subscriber = redis.duplicate();

  let unsubscribed = false;

  // CRITICAL: Await the subscription to ensure it's established before returning
  await new Promise<void>((resolve, reject) => {
    subscriber.subscribe(channel, (err) => {
      if (err) {
        logger.error('Failed to subscribe to agent progress', {
          channel,
          error: err.message,
        });
        reject(err);
      } else {
        logger.debug('Subscribed to agent progress channel', { channel });
        resolve();
      }
    });
  });

  subscriber.on('message', (_ch: string, message: string) => {
    if (unsubscribed) return;
    try {
      const event = JSON.parse(message) as AgentProgressEvent;
      const chunks = mapProgressToChunks(event, enrichmentType);
      if (chunks.length > 0) {
        void session.appendChunks(chunks);
      }

      // Auto-stop stream on final stage completion
      if (isFinalStage(event, enrichmentType)) {
        // Note: task-mode streams don't support markdown_text in stop()
        void session.stop();
        void doUnsubscribe();
      }
    } catch (err) {
      logger.error('Failed to process agent progress event', {
        error: err instanceof Error ? err.message : String(err),
        channel,
      });
    }
  });

  async function doUnsubscribe(): Promise<void> {
    if (unsubscribed) return;
    unsubscribed = true;
    try {
      await subscriber.unsubscribe(channel);
      await subscriber.quit();
    } catch {
      // Ignore cleanup errors
    }
  }

  return { unsubscribe: doUnsubscribe };
}

/**
 * Publishes a progress event to the Redis pub/sub channel for a given job.
 * Called by enrichment workers to notify the agent of pipeline progress.
 */
export async function publishProgress(event: AgentProgressEvent): Promise<void> {
  const channel = `agent:progress:${event.jobId}`;
  try {
    await redis.publish(channel, JSON.stringify(event));
  } catch (err) {
    // Non-fatal — agent may not be subscribed
    logger.debug('Failed to publish agent progress event', {
      channel,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Maps an AgentProgressEvent to task card update chunks.
 */
function mapProgressToChunks(
  event: AgentProgressEvent,
  enrichmentType: string,
): TaskChunk[] {
  const tasks = ENRICHMENT_PIPELINE_TASKS[enrichmentType];
  if (!tasks) return [];

  const task = tasks.find((t) => t.id === event.stage);
  if (!task) return [];

  return [
    {
      type: 'task_update',
      id: task.id,
      title: event.detail ? `${task.title} — ${event.detail}` : task.title,
      status: event.status,
    },
  ];
}

/**
 * Checks if an event represents the final stage of the pipeline completing.
 */
function isFinalStage(
  event: AgentProgressEvent,
  enrichmentType: string,
): boolean {
  const tasks = ENRICHMENT_PIPELINE_TASKS[enrichmentType];
  if (!tasks || tasks.length === 0) return false;
  const lastTask = tasks[tasks.length - 1];
  return event.stage === lastTask.id && event.status === 'complete';
}

/**
 * Formats a human-readable plan title for the enrichment type.
 */
function formatPlanTitle(enrichmentType: string): string {
  const titles: Record<string, string> = {
    technographic: 'Technographic Enrichment',
    contact: 'Contact Finder',
    combined: 'Combined Enrichment',
    tech_report: 'Technology Report',
  };
  return titles[enrichmentType] || 'Enrichment Pipeline';
}
