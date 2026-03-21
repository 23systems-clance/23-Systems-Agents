/**
 * JWT token service for config document upload links.
 *
 * Generates and validates tokens that grant access to the upload page
 * for a specific Slack channel. Follows the same pattern as BDR magic links.
 */

import jwt from 'jsonwebtoken';
import { config } from '../../config/index.js';

/** Payload encoded in the upload JWT. */
export interface UploadTokenPayload {
  teamId: string;
  channelId: string;
  userId: string;
  purpose: 'config-upload';
}

/** JWT signing secret — reuses session secret. */
const JWT_SECRET = config.session.secret;

/** Token expiry: 24 hours. */
const TOKEN_EXPIRY = '24h';

/**
 * Generates a signed JWT for the upload page.
 *
 * @param teamId - Slack team ID
 * @param channelId - Slack channel ID
 * @param userId - Slack user ID who invoked /upload
 * @returns Signed JWT token string
 */
export function generateUploadToken(teamId: string, channelId: string, userId: string): string {
  return jwt.sign(
    { teamId, channelId, userId, purpose: 'config-upload' } satisfies UploadTokenPayload,
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY },
  );
}

/**
 * Validates an upload JWT and returns the payload if valid.
 *
 * @param token - JWT token string
 * @returns Decoded payload or null if invalid/expired
 */
export function validateUploadToken(token: string): UploadTokenPayload | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as UploadTokenPayload;
    if (payload.purpose !== 'config-upload') return null;
    return payload;
  } catch {
    return null;
  }
}
