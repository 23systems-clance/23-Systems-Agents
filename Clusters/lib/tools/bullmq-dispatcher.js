import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { getDb } from '../db/index.js';
import { jobs } from '../db/schema.js';

const QUEUE_NAME = 'agent-jobs';
let _queue = null;

/**
 * Get or create the BullMQ queue instance.
 */
function getQueue() {
  if (!_queue) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    _queue = new Queue(QUEUE_NAME, { connection });
  }
  return _queue;
}

/**
 * BullMQ job dispatcher.
 * Creates the GitHub branch (same as before), then enqueues to BullMQ
 * and inserts a row into the jobs table.
 *
 * @param {string} jobId - UUID for the job
 * @param {string} branch - Branch name (job/{id})
 * @param {string} title - Job title
 * @param {string} jobDescription - Full job prompt
 * @param {Object} options - Config overrides
 * @returns {Promise<void>}
 */
export async function enqueueBullMQ(jobId, branch, title, jobDescription, options = {}) {
  const db = getDb();
  const now = Date.now();

  // Insert job record into Postgres
  await db.insert(jobs).values({
    id: jobId,
    title,
    prompt: jobDescription,
    status: 'queued',
    branch,
    llmProvider: options.llmProvider || null,
    llmModel: options.llmModel || null,
    agentBackend: options.agentBackend || 'pi',
    createdAt: now,
    updatedAt: now,
  });

  // Enqueue to BullMQ
  const queue = getQueue();
  const bullmqJob = await queue.add('agent-job', {
    jobId,
    title,
    config: {
      job: jobDescription,
      llm_provider: options.llmProvider,
      llm_model: options.llmModel,
      agent_backend: options.agentBackend,
    },
    branch,
  }, {
    jobId,
  });

  // Update with BullMQ job ID
  const { eq } = await import('drizzle-orm');
  await db.update(jobs)
    .set({ bullmqJobId: bullmqJob.id, updatedAt: Date.now() })
    .where(eq(jobs.id, jobId));
}

/**
 * Close the queue connection (for graceful shutdown).
 */
export async function closeQueue() {
  if (_queue) {
    await _queue.close();
    _queue = null;
  }
}
