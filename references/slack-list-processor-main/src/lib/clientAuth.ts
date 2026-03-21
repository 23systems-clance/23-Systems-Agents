/**
 * Client dashboard authentication middleware (T050).
 *
 * Validates client sessions using Slack OAuth. Client users authenticate
 * via "Sign in with Slack", which sets a session cookie scoped to their
 * workspace. The is_admin check determines full vs read-only access.
 */

import type { Request, Response, NextFunction } from 'express';
import redis from './redis.js';
import logger from './logger.js';

/** Session data stored in Redis. */
export interface ClientSession {
  slackUserId: string;
  slackTeamId: string;
  displayName: string;
  email: string;
  isAdmin: boolean;
}

const SESSION_PREFIX = 'client:session:';
const SESSION_TTL = 3600; // 1 hour

/**
 * Stores a client session in Redis.
 *
 * @param sessionId - Unique session identifier.
 * @param session   - Session data.
 */
export async function createClientSession(sessionId: string, session: ClientSession): Promise<void> {
  await redis.setex(`${SESSION_PREFIX}${sessionId}`, SESSION_TTL, JSON.stringify(session));
}

/**
 * Retrieves a client session from Redis.
 *
 * @param sessionId - Session identifier from cookie.
 * @returns Session data or null if expired/missing.
 */
export async function getClientSession(sessionId: string): Promise<ClientSession | null> {
  const data = await redis.get(`${SESSION_PREFIX}${sessionId}`);
  if (!data) return null;

  try {
    // Refresh TTL on access
    await redis.expire(`${SESSION_PREFIX}${sessionId}`, SESSION_TTL);
    return JSON.parse(data) as ClientSession;
  } catch {
    return null;
  }
}

/**
 * Destroys a client session.
 *
 * @param sessionId - Session identifier to destroy.
 */
export async function destroyClientSession(sessionId: string): Promise<void> {
  await redis.del(`${SESSION_PREFIX}${sessionId}`);
}

/**
 * Express middleware that validates the client session cookie.
 *
 * Attaches `req.clientSession` if valid. Returns 401 if missing or expired.
 */
export function clientAuth(req: Request, res: Response, next: NextFunction): void {
  const sessionId = req.cookies?.client_session;

  if (!sessionId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  getClientSession(sessionId)
    .then((session) => {
      if (!session) {
        res.status(401).json({ error: 'Session expired' });
        return;
      }

      (req as unknown as Record<string, unknown>).clientSession = session;
      next();
    })
    .catch((err) => {
      logger.error('Client auth error', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: 'Internal server error' });
    });
}

/**
 * Express middleware that requires the client user to be a workspace admin.
 *
 * Must be used after `clientAuth` middleware.
 */
export function requireClientAdmin(req: Request, res: Response, next: NextFunction): void {
  const session = (req as unknown as Record<string, unknown>).clientSession as ClientSession | undefined;

  if (!session?.isAdmin) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }

  next();
}
