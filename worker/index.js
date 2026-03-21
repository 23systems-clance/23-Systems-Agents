import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';
import { runBlueprint } from './blueprint.js';
import { closePool } from './db.js';

dotenv.config();

const QUEUE_NAME = 'agent-jobs';
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '2', 10);
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    console.log(`[worker] Processing job ${job.id}: ${job.data.title}`);
    try {
      await runBlueprint(job);
      console.log(`[worker] Completed job ${job.id}`);
    } catch (err) {
      console.error(`[worker] Blueprint failed for job ${job.id}:`, err.message);
      throw err;
    }
  },
  { connection, concurrency: CONCURRENCY }
);

worker.on('failed', (job, err) => {
  console.error(`[worker] Job ${job?.id} failed:`, err.message);
});

worker.on('error', (err) => {
  console.error('[worker] Worker error:', err.message);
});

const shutdown = async (signal) => {
  console.log(`[worker] Received ${signal}, shutting down...`);
  await worker.close();
  await closePool();
  connection.disconnect();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

console.log(`[worker] Started on queue "${QUEUE_NAME}" (concurrency: ${CONCURRENCY})`);
