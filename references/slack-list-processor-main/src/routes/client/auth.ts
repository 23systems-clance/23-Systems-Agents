/**
 * Client dashboard auth routes (T051).
 *
 * Slack OAuth login flow for client dashboard users. Uses the existing
 * bot token to call users.info for admin status check.
 */

import { Router } from 'express';
import crypto from 'crypto';
import { config } from '../../config/index.js';
import {
  createClientSession,
  getClientSession,
  destroyClientSession,
  type ClientSession,
} from '../../lib/clientAuth.js';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

export const clientAuthRouter = Router();

/**
 * GET /api/v1/client/auth/login
 *
 * Redirects to Slack OAuth authorize URL.
 */
clientAuthRouter.get('/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = `${config.licensing.clientDashboardUrl}/api/v1/client/auth/callback`;

  // Store state in a short-lived cookie for CSRF protection
  res.cookie('oauth_state', state, { httpOnly: true, maxAge: 300000, sameSite: 'lax' });

  const url = new URL('https://slack.com/oauth/v2/authorize');
  url.searchParams.set('client_id', config.oauth.clientId);
  url.searchParams.set('user_scope', 'identity.basic,identity.email');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);

  res.redirect(url.toString());
});

/**
 * GET /api/v1/client/auth/callback
 *
 * Handles Slack OAuth callback. Creates a session for the client user.
 */
clientAuthRouter.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    const storedState = req.cookies?.oauth_state;

    if (!code || !state || state !== storedState) {
      res.status(400).json({ error: 'Invalid OAuth callback' });
      return;
    }

    res.clearCookie('oauth_state');

    // Exchange code for user token using Sign In with Slack
    const tokenResponse = await fetch('https://slack.com/api/openid.connect.token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.oauth.clientId,
        client_secret: config.oauth.clientSecret,
        code: code as string,
        redirect_uri: `${config.licensing.clientDashboardUrl}/api/v1/client/auth/callback`,
      }),
    });

    const tokenData = await tokenResponse.json() as Record<string, unknown>;

    if (!tokenData.ok) {
      logger.error('Slack OAuth token exchange failed', { error: tokenData.error });
      res.status(400).json({ error: 'OAuth token exchange failed' });
      return;
    }

    // Use the user info from the token response
    const userInfo = tokenData as {
      ok: boolean;
      sub: string;
      'https://slack.com/team_id': string;
      name: string;
      email: string;
      is_admin?: boolean;
    };

    const slackUserId = userInfo.sub as string;
    const slackTeamId = userInfo['https://slack.com/team_id'] as string;
    const displayName = (userInfo.name as string) ?? slackUserId;
    const email = (userInfo.email as string) ?? '';

    // Verify the workspace is a registered client
    const workspace = await prisma.workspaceInstallation.findUnique({
      where: { slackTeamId },
      select: { onboardingStatus: true },
    });

    if (!workspace) {
      res.status(403).json({ error: 'Workspace not registered' });
      return;
    }

    // Check if user is a Slack workspace admin using the bot token
    let isAdmin = false;
    try {
      const userInfoResponse = await fetch(`https://slack.com/api/users.info?user=${slackUserId}`, {
        headers: { Authorization: `Bearer ${config.slack.botToken}` },
      });
      const userData = await userInfoResponse.json() as Record<string, unknown>;
      const user = userData.user as Record<string, unknown> | undefined;
      isAdmin = (user?.is_admin as boolean) ?? false;
    } catch {
      // Non-fatal — default to non-admin
    }

    // Create session
    const sessionId = crypto.randomBytes(32).toString('hex');
    const session: ClientSession = {
      slackUserId,
      slackTeamId,
      displayName,
      email,
      isAdmin,
    };

    await createClientSession(sessionId, session);

    res.cookie('client_session', sessionId, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 3600000, // 1 hour
    });

    // Redirect to client dashboard
    res.redirect(config.licensing.clientDashboardUrl || '/client');
  } catch (error) {
    logger.error('Client auth callback error', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Authentication failed' });
  }
});

/**
 * GET /api/v1/client/auth/me
 *
 * Returns the authenticated client user info.
 */
clientAuthRouter.get('/me', async (req, res) => {
  const sessionId = req.cookies?.client_session;

  if (!sessionId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const session = await getClientSession(sessionId);

  if (!session) {
    res.status(401).json({ error: 'Session expired' });
    return;
  }

  res.json({
    slackUserId: session.slackUserId,
    slackTeamId: session.slackTeamId,
    displayName: session.displayName,
    email: session.email,
    isAdmin: session.isAdmin,
    role: session.isAdmin ? 'admin' : 'user',
  });
});

/**
 * POST /api/v1/client/auth/logout
 *
 * Destroys the client session.
 */
clientAuthRouter.post('/logout', async (req, res) => {
  const sessionId = req.cookies?.client_session;

  if (sessionId) {
    await destroyClientSession(sessionId);
    res.clearCookie('client_session');
  }

  res.json({ success: true });
});
