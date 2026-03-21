/**
 * MCP Health Check BullMQ worker (Feature 39 - Vertical Pack Platform).
 *
 * Runs every 5 minutes via repeatable job on the admin queue.
 * Checks all registered MCP servers and updates their health status.
 */

import { Worker } from 'bullmq';
import { config } from '../../../config/index.js';
import logger from '../../../lib/logger.js';
import { runAllHealthChecks } from '../../platform/mcpServerRegistry.js';

/**
 * Creates and returns the MCP health check worker.
 * Listens on the 'admin' queue for 'mcp-health-check' jobs.
 */
export function createMcpHealthCheckWorker(): Worker {
  const worker = new Worker(
    'admin',
    async (job) => {
      if (job.name !== 'mcp-health-check') return;

      logger.info('MCP health check cycle starting');
      await runAllHealthChecks();
      logger.info('MCP health check cycle complete');
    },
    {
      connection: { url: config.redis.url },
    },
  );

  worker.on('failed', (job, err) => {
    logger.error('MCP health check worker failed', {
      jobId: job?.id,
      error: err.message,
    });
  });

  return worker;
}
