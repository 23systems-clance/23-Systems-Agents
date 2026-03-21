/**
 * OAuth Install Route (T053).
 *
 * Initiates the Slack OAuth install flow by:
 * 1. Generating a random CSRF state token
 * 2. Storing the state in Redis with 10min TTL
 * 3. Redirecting the user to Slack's OAuth authorize URL
 */

import express from 'express';
import crypto from 'crypto';
import { config } from '../../config/index.js';
import redis from '../../lib/redis.js';
import logger from '../../lib/logger.js';

const router = express.Router();

/** Redis key for CSRF state tokens (10 minute TTL). */
const STATE_TTL_SECONDS = 600;

/** Required scopes for the bot installation. */
const REQUIRED_SCOPES = [
  'assistant:write',
  'channels:read',
  'chat:write',
  'files:read',
  'files:write',
  'groups:read',
  'im:write',
  'users:read',
  'users:read.email',
].join(',');

/**
 * GET /slack/install
 *
 * Generates a CSRF state token, stores it in Redis, and redirects
 * to Slack's OAuth authorize URL.
 */
router.get('/', async (req, res) => {
  try {
    // Generate random CSRF state token
    const state = crypto.randomBytes(32).toString('hex');

    // Store state in Redis with 10min TTL
    await redis.setex(`oauth:state:${state}`, STATE_TTL_SECONDS, '1');

    // Build Slack OAuth authorize URL
    const authorizeUrl = new URL('https://slack.com/oauth/v2/authorize');
    authorizeUrl.searchParams.set('client_id', config.oauth.clientId);
    authorizeUrl.searchParams.set('scope', REQUIRED_SCOPES);
    authorizeUrl.searchParams.set('redirect_uri', config.oauth.redirectUri);
    authorizeUrl.searchParams.set('state', state);

    logger.info('OAuth install flow initiated', { state });

    // Redirect user to Slack OAuth page
    res.redirect(authorizeUrl.toString());
  } catch (error) {
    logger.error('Error initiating OAuth install flow', {
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).send('<h1>OAuth Install Error</h1><p>Failed to initiate OAuth flow. Please try again.</p>');
  }
});

export { router as installRouter };
