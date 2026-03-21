import { Router } from 'express';
import type { Request, Response } from 'express';
import redis from '../lib/redis.js';
import { prisma } from '../models/index.js';
import logger from '../lib/logger.js';

const router = Router();

/**
 * GET /api/v1/health
 * Returns system health status with connectivity checks.
 */
router.get('/', async (_req: Request, res: Response) => {
  const startTime = process.uptime();

  // Check Redis connectivity
  let redisConnected = false;
  try {
    await redis.ping();
    redisConnected = true;
  } catch {
    // Redis is down
  }

  // Check Database connectivity
  let databaseConnected = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseConnected = true;
  } catch {
    // Database is down
  }

  const status = redisConnected && databaseConnected ? 'healthy' : 'degraded';

  // Always return 200 to prevent ALB/ECS restart loops on fresh deployments
  // when DB or Redis is not yet reachable. Status field indicates actual health.
  res.status(200).json({
    status,
    version: process.env.APP_VERSION ?? '1.0.0',
    uptime: Math.floor(startTime),
    redis_connected: redisConnected,
    database_connected: databaseConnected,
    timestamp: new Date().toISOString(),
  });
});

export { router as healthRouter };
