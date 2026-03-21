/**
 * Express middleware for upload page token authentication.
 *
 * Extracts JWT from the `?token=` query parameter, validates it,
 * and attaches the upload context to the request object.
 */

import type { Request, Response, NextFunction } from 'express';
import { validateUploadToken, type UploadTokenPayload } from '../services/upload/tokenService.js';
import logger from './logger.js';

/** Extends Express Request with upload context. */
export interface UploadRequest extends Request {
  uploadContext: UploadTokenPayload;
}

/**
 * Extracts the upload context attached by uploadAuth middleware.
 * Only call this on routes that use uploadAuth middleware.
 */
export function getUploadContext(req: Request): UploadTokenPayload {
  return (req as unknown as UploadRequest).uploadContext;
}

/**
 * Middleware that validates the upload JWT from query params.
 * On success, attaches `req.uploadContext` with { teamId, channelId, userId }.
 * On failure, returns 401 with JSON error.
 */
export function uploadAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.query.token as string | undefined;

  if (!token) {
    res.status(401).json({ valid: false, error: 'Upload token required.' });
    return;
  }

  const payload = validateUploadToken(token);
  if (!payload) {
    logger.warn('Upload auth: invalid or expired token');
    res.status(401).json({ valid: false, error: 'Token expired. Please run /upload again in Slack.' });
    return;
  }

  (req as UploadRequest).uploadContext = payload;
  next();
}
