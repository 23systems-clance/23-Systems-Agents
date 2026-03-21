import type { Request, Response, NextFunction } from 'express';
import { config } from '../config/index.js';
import logger from './logger.js';

/**
 * Express middleware that validates the X-API-Key header.
 * Returns 401 for missing or invalid keys.
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'] as string | undefined;

  if (!apiKey || apiKey !== config.apiKey) {
    logger.warn('API authentication failed', {
      ip: req.ip,
      path: req.path,
      hasKey: !!apiKey,
    });
    res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
    return;
  }

  next();
}
