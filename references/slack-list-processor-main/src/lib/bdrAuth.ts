/**
 * BDR authentication middleware using signed magic links from Slack DMs.
 *
 * Flow:
 * 1. Daily DM includes a magic link with signed JWT token
 * 2. First visit validates JWT, creates express session
 * 3. Subsequent requests use session cookie
 */

import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import logger from './logger.js';

/** Payload stored in the BDR JWT and session. */
export interface BdrIdentity {
  slackUserId: string;
  slackTeamId: string;
}

/** Extend Express session with BDR identity. */
declare module 'express-session' {
  interface SessionData {
    bdr?: BdrIdentity;
  }
}

/** JWT signing secret — reuses session secret. */
const JWT_SECRET = config.session.secret;

/** Token expiry: 24 hours. */
const TOKEN_EXPIRY = '24h';

/**
 * Generates a signed magic link token for a BDR.
 *
 * @param slackUserId - BDR's Slack user ID
 * @param slackTeamId - BDR's Slack team ID
 * @returns Signed JWT token string
 */
export function generateBdrToken(slackUserId: string, slackTeamId: string): string {
  return jwt.sign(
    { slackUserId, slackTeamId } satisfies BdrIdentity,
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY },
  );
}

/**
 * Express middleware that authenticates BDR requests.
 *
 * Authentication methods (checked in order):
 * 1. Existing session with `bdr` data
 * 2. `token` query parameter with a valid JWT
 *
 * On successful JWT validation, creates a session so subsequent
 * requests don't need the token.
 */
export function bdrAuth(req: Request, res: Response, next: NextFunction): void {
  // Check existing session
  if (req.session?.bdr) {
    next();
    return;
  }

  // Check for token in query params
  const token = req.query.token as string | undefined;
  if (!token) {
    res.status(401).json({ error: 'Authentication required. Use the link from your Slack DM.' });
    return;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as BdrIdentity;

    // Create session
    req.session.bdr = {
      slackUserId: payload.slackUserId,
      slackTeamId: payload.slackTeamId,
    };

    logger.info('BDR authenticated via magic link', {
      slackUserId: payload.slackUserId,
    });

    next();
  } catch {
    logger.warn('BDR auth: invalid or expired token');
    res.status(401).json({ error: 'Invalid or expired token. Request a new link from Slack.' });
  }
}

/**
 * Helper to get the authenticated BDR identity from the request.
 */
export function getBdrIdentity(req: Request): BdrIdentity | null {
  return req.session?.bdr ?? null;
}
