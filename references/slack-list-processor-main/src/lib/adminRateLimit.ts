/**
 * Per-admin Redis sliding-window rate limiter middleware.
 *
 * Uses INCR + EXPIRE on `ratelimit:admin:{adminId}:{minuteBucket}` keys.
 * Returns 429 with retry_after when limit is exceeded.
 */

import type { Request, Response, NextFunction } from 'express';
import redis from './redis.js';
import { config } from '../config/index.js';

/**
 * Express middleware that enforces per-admin rate limiting.
 * Must be applied after adminAuth (requires `req.admin`).
 */
export async function adminRateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const admin = req.admin;
  if (!admin) {
    res.status(401).json({
      error: 'unauthorized',
      message: 'Invalid or missing admin API key',
    });
    return;
  }

  const maxRpm = config.admin.rateLimitRpm;
  const now = Math.floor(Date.now() / 60000);
  const key = `ratelimit:admin:${admin.id}:${now}`;

  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, 60);
    }

    if (count > maxRpm) {
      const retryAfter = 60 - (Math.floor(Date.now() / 1000) % 60);
      res.status(429).json({
        error: 'rate_limited',
        message: `Rate limit exceeded. Try again in ${retryAfter}s`,
        retry_after: retryAfter,
      });
      return;
    }

    next();
  } catch {
    // If Redis is down, allow the request through (fail-open).
    next();
  }
}
