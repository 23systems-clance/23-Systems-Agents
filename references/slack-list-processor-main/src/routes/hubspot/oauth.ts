/**
 * HubSpot OAuth callback routes.
 *
 * Handles the OAuth redirect from HubSpot after user authorization, and
 * serves a simple success page instructing the user to return to Slack.
 *
 * Routes:
 *   GET /api/hubspot/oauth/callback  — OAuth callback (exchanges code, stores tokens)
 *   GET /api/hubspot/oauth/success   — Success HTML page
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { handleCallback, OAuthError } from '../../services/hubspot/hubspotOAuth.js';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

export const hubspotOAuthRouter = Router();

/**
 * GET /callback
 *
 * Receives the authorization code from HubSpot after user approves permissions.
 * Validates state JWT, exchanges code for tokens, stores encrypted connection,
 * posts confirmation to Slack, and redirects to the success page.
 */
hubspotOAuthRouter.get('/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query;

  if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
    res.status(400).json({
      error: 'invalid_request',
      message: 'Missing required query parameters: code and state.',
    });
    return;
  }

  try {
    const result = await handleCallback(code, state);

    // Create or update CrmConnection record for this HubSpot connection
    try {
      await prisma.crmConnection.upsert({
        where: {
          clientId_crmType: {
            clientId: result.clientId,
            crmType: 'HUBSPOT',
          },
        },
        create: {
          clientId: result.clientId,
          crmType: 'HUBSPOT',
          status: 'ACTIVE',
          displayName: result.connection.hubspotPortalName || `HubSpot (${result.connection.hubspotPortalId})`,
          hubspotConnectionId: result.connection.id,
        },
        update: {
          status: 'ACTIVE',
          hubspotConnectionId: result.connection.id,
          displayName: result.connection.hubspotPortalName || `HubSpot (${result.connection.hubspotPortalId})`,
        },
      });
    } catch (crmErr) {
      // Non-fatal — HubSpot connection is stored, CRM record can be created later via migration
      logger.warn('Failed to create CrmConnection during OAuth callback', { error: crmErr });
    }

    // Post confirmation to Slack channel
    try {
      const { WebClient } = await import('@slack/web-api');
      const slackClient = new WebClient(
        (await import('../../config/index.js')).config.slack.botToken,
      );

      const client = await prisma.managedClient.findUnique({
        where: { id: result.clientId },
        select: { name: true },
      });

      const clientName = client?.name || 'Unknown';
      const portalId = result.connection.hubspotPortalId;

      await slackClient.chat.postMessage({
        channel: result.channelId,
        text: `HubSpot connected for ${clientName} (Portal: ${portalId}). Use \`/hubspot import\` to import contacts.`,
      });
    } catch (slackErr) {
      // Non-fatal — connection is stored, user just won't see the Slack message
      logger.warn('Failed to post HubSpot OAuth confirmation to Slack', { error: slackErr });
    }

    // Redirect to success page
    const client = await prisma.managedClient.findUnique({
      where: { id: result.clientId },
      select: { name: true },
    });
    const encodedName = encodeURIComponent(client?.name || '');
    res.redirect(`/api/hubspot/oauth/success?client=${encodedName}`);
  } catch (err) {
    if (err instanceof OAuthError) {
      const statusCode = err.code === 'already_connected' ? 409 : 400;
      res.status(statusCode).json({
        error: err.code,
        message: err.message,
      });
      return;
    }

    logger.error('HubSpot OAuth callback failed', { error: err });
    res.status(500).json({
      error: 'internal_error',
      message: 'An unexpected error occurred during HubSpot authorization.',
    });
  }
});

/**
 * GET /success
 *
 * Simple HTML page shown after successful OAuth completion.
 */
hubspotOAuthRouter.get('/success', (_req: Request, res: Response) => {
  const clientName = typeof _req.query.client === 'string' ? _req.query.client : '';
  const displayName = clientName ? ` for ${clientName}` : '';

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HubSpot Connected</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
    .card { background: white; border-radius: 12px; padding: 48px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.1); max-width: 400px; }
    h1 { color: #1a1a1a; margin-bottom: 8px; }
    p { color: #666; line-height: 1.5; }
    .checkmark { font-size: 48px; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="checkmark">&#10003;</div>
    <h1>HubSpot Connected${displayName ? `${displayName}` : ''}!</h1>
    <p>You can close this window and return to Slack.</p>
  </div>
</body>
</html>`);
});
