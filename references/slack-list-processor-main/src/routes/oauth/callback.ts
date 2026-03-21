/**
 * OAuth Callback Route (T054 + T060).
 *
 * Handles the OAuth callback from Slack after user authorizes the app:
 * 1. Validates CSRF state token from Redis
 * 2. Exchanges authorization code for access tokens
 * 3. Stores the installation with encrypted bot token
 * 4. Renders success or error HTML page
 */

import express from 'express';
import { config } from '../../config/index.js';
import redis from '../../lib/redis.js';
import logger from '../../lib/logger.js';
import { storeInstallation, type SlackInstallation } from '../../services/workspace/installationStore.js';
import { sendWelcomeDm } from '../../services/workspace/onboardingWizard.js';
import { ensurePlatformOwnerStatus } from '../../services/workspace/platformOwner.js';
import { prisma } from '../../models/index.js';
import { WebClient } from '@slack/web-api';

const router = express.Router();

/**
 * GET /slack/oauth_redirect
 *
 * Handles the OAuth callback from Slack.
 */
router.get('/', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    // Handle OAuth error (user denied installation)
    if (error) {
      logger.warn('OAuth installation denied by user', { error });
      return res.status(400).send(renderErrorPage('Installation was cancelled. You can close this window.'));
    }

    // Validate required parameters
    if (typeof code !== 'string' || typeof state !== 'string') {
      logger.warn('OAuth callback missing code or state', { code: !!code, state: !!state });
      return res.status(400).send(renderErrorPage('Invalid OAuth callback parameters.'));
    }

    // Validate CSRF state token
    const stateKey = `oauth:state:${state}`;
    const storedState = await redis.get(stateKey);

    if (!storedState) {
      logger.warn('OAuth state token not found or expired', { state });
      return res.status(400).send(renderErrorPage('OAuth state token is invalid or expired. Please try again.'));
    }

    // Delete state token (one-time use)
    await redis.del(stateKey);

    // Exchange authorization code for access tokens
    const tokenResponse = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: config.oauth.clientId,
        client_secret: config.oauth.clientSecret,
        code,
        redirect_uri: config.oauth.redirectUri,
      }),
    });

    const tokenData = await tokenResponse.json() as SlackOAuthResponse;

    if (!tokenData.ok) {
      logger.error('Failed to exchange OAuth code for tokens', {
        error: tokenData.error,
      });
      return res.status(500).send(renderErrorPage('Failed to complete installation. Please try again.'));
    }

    // Build installation object
    const installation: SlackInstallation = {
      team: {
        id: tokenData.team.id,
        name: tokenData.team.name,
      },
      bot: {
        token: tokenData.access_token,
        scopes: tokenData.scope.split(','),
        id: tokenData.bot_user_id,
        userId: tokenData.bot_user_id,
      },
      appId: tokenData.app_id,
      tokenType: 'bot',
      isEnterpriseInstall: false,
    };

    // Store installation with encrypted bot token
    await storeInstallation(installation);

    logger.info('OAuth installation completed', {
      teamId: tokenData.team.id,
      teamName: tokenData.team.name,
    });

    // Multi-tenant onboarding: set initial status and detect platform owner
    await ensurePlatformOwnerStatus(tokenData.team.id);

    // Ensure onboarding status is set for new installs
    await prisma.workspaceInstallation.updateMany({
      where: {
        slackTeamId: tokenData.team.id,
        onboardingStatus: 'PENDING',
      },
      data: { onboardingStatus: 'PENDING' },
    });

    // Send welcome DM to installer (fire-and-forget)
    const botClient = new WebClient(tokenData.access_token);
    sendWelcomeDm(
      botClient,
      tokenData.authed_user.id,
      tokenData.team.name,
    ).catch((err) => {
      logger.warn('Welcome DM failed (non-fatal)', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // Render success page
    res.send(renderSuccessPage(tokenData.team.name));
  } catch (error) {
    logger.error('Error in OAuth callback handler', {
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).send(renderErrorPage('An unexpected error occurred. Please try again.'));
  }
});

/**
 * Slack OAuth v2 access response shape.
 */
interface SlackOAuthResponse {
  ok: boolean;
  error?: string;
  access_token: string;
  token_type: string;
  scope: string;
  bot_user_id: string;
  app_id: string;
  team: {
    id: string;
    name: string;
  };
  enterprise?: {
    id: string;
    name: string;
  };
  authed_user: {
    id: string;
  };
}

/**
 * Renders a success HTML page after successful installation.
 */
function renderSuccessPage(teamName: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Installation Successful</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #fff;
    }
    .container {
      text-align: center;
      padding: 2rem;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
      max-width: 500px;
    }
    h1 {
      margin: 0 0 1rem;
      font-size: 2rem;
    }
    p {
      font-size: 1.1rem;
      line-height: 1.6;
      margin: 0;
    }
    .checkmark {
      font-size: 4rem;
      margin-bottom: 1rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="checkmark">✓</div>
    <h1>Installation Successful!</h1>
    <p>The List Enrichment Agent has been installed to <strong>${escapeHtml(teamName)}</strong>.</p>
    <p style="margin-top: 1.5rem;">You can now return to Slack and start using the agent.</p>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Renders an error HTML page.
 */
function renderErrorPage(message: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Installation Error</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
      color: #fff;
    }
    .container {
      text-align: center;
      padding: 2rem;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
      max-width: 500px;
    }
    h1 {
      margin: 0 0 1rem;
      font-size: 2rem;
    }
    p {
      font-size: 1.1rem;
      line-height: 1.6;
      margin: 0;
    }
    .icon {
      font-size: 4rem;
      margin-bottom: 1rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">✗</div>
    <h1>Installation Error</h1>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Escapes HTML special characters to prevent XSS.
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (char) => map[char] || char);
}

export { router as callbackRouter };
