/**
 * HubSpot OAuth 2.0 service.
 *
 * Handles the full OAuth lifecycle: authorization URL generation with
 * signed JWT state, authorization code exchange, token encryption/storage,
 * automatic token refresh, disconnection, and connection status queries.
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Client as HubSpotClient } from '@hubspot/api-client';
import { prisma } from '../../models/index.js';
import { config } from '../../config/index.js';
import { encrypt, decrypt } from '../../lib/tokenEncryption.js';
import { logAudit } from '../../lib/auditLogger.js';
import logger from '../../lib/logger.js';
import redis from '../../lib/redis.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** OAuth scopes required for core functionality. */
const REQUIRED_SCOPES = [
  'crm.objects.contacts.read',
  'crm.objects.contacts.write',
  'crm.schemas.contacts.read',
  'crm.lists.read',
  'crm.lists.write',
];

/** Optional scopes that enhance functionality but aren't required. */
const OPTIONAL_SCOPES = [
  'crm.objects.deals.read',
  'sales-email-read',
  'crm.objects.owners.read',
];

/** Token refresh buffer — refresh if token expires within this window. */
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

/** Nonce TTL in Redis (seconds). */
const NONCE_TTL_SECONDS = 15 * 60; // 15 minutes

// ---------------------------------------------------------------------------
// Service Functions
// ---------------------------------------------------------------------------

/**
 * Generates a HubSpot OAuth authorization URL with a signed JWT state parameter.
 *
 * The state JWT contains `{ clientId, channelId, userId, nonce }` and is signed
 * with `SLACK_STATE_SECRET`. A crypto-random nonce is stored in Redis with a
 * 15-minute TTL to prevent replay attacks.
 *
 * @param clientId - ManagedClient UUID
 * @param channelId - Slack channel ID where `/hubspot connect` was invoked
 * @param userId - Slack user ID who invoked the command
 * @returns The full HubSpot authorization URL
 */
export async function generateAuthUrl(
  clientId: string,
  channelId: string,
  userId: string,
): Promise<string> {
  const nonce = crypto.randomBytes(16).toString('hex');

  // Store nonce in Redis for replay protection
  await redis.set(`hubspot:nonce:${nonce}`, '1', 'EX', NONCE_TTL_SECONDS);

  // Sign state as JWT
  const state = jwt.sign(
    { clientId, channelId, userId, nonce },
    config.oauth.stateSecret,
    { expiresIn: '15m' },
  );

  const params = new URLSearchParams({
    client_id: config.hubspotOAuth.clientId,
    redirect_uri: config.hubspotOAuth.redirectUri,
    scope: REQUIRED_SCOPES.join(' '),
    optional_scope: OPTIONAL_SCOPES.join(' '),
    state,
  });

  return `https://app.hubspot.com/oauth/authorize?${params.toString()}`;
}

/**
 * Handles the OAuth callback: validates the state JWT, checks the nonce,
 * exchanges the authorization code for tokens, and stores an encrypted
 * HubSpotConnection in the database.
 *
 * @param code - Authorization code from HubSpot
 * @param state - Signed JWT state parameter
 * @returns The created HubSpotConnection and decoded state payload
 */
export async function handleCallback(
  code: string,
  state: string,
): Promise<{
  connection: Awaited<ReturnType<typeof prisma.hubSpotConnection.create>>;
  clientId: string;
  channelId: string;
  userId: string;
}> {
  // 1. Verify JWT state
  let payload: { clientId: string; channelId: string; userId: string; nonce: string };
  try {
    payload = jwt.verify(state, config.oauth.stateSecret) as typeof payload;
  } catch {
    throw new OAuthError('invalid_state', 'Invalid or expired authorization state. Please try /hubspot connect again.');
  }

  // 2. Check + delete nonce from Redis (single-use)
  const deleted = await redis.del(`hubspot:nonce:${payload.nonce}`);
  if (deleted === 0) {
    throw new OAuthError('replay_detected', 'This authorization link has already been used. Please try /hubspot connect again.');
  }

  // 3. Check if client already has an active connection
  const existing = await prisma.hubSpotConnection.findUnique({
    where: { clientId: payload.clientId },
  });
  if (existing && existing.status === 'ACTIVE') {
    throw new OAuthError('already_connected', `This client is already connected to HubSpot (Portal: ${existing.hubspotPortalId}).`);
  }

  // 4. Exchange code for tokens
  const hubspotClient = new HubSpotClient();
  let tokenResponse;
  try {
    tokenResponse = await hubspotClient.oauth.tokensApi.create(
      'authorization_code',
      code,
      config.hubspotOAuth.redirectUri,
      config.hubspotOAuth.clientId,
      config.hubspotOAuth.clientSecret,
    );
  } catch (err) {
    logger.error('HubSpot token exchange failed', { error: err });
    throw new OAuthError('token_exchange_failed', 'Failed to exchange authorization code for tokens. Please try again.');
  }

  const accessToken = tokenResponse.accessToken;
  const refreshToken = tokenResponse.refreshToken;
  const expiresIn = tokenResponse.expiresIn; // seconds

  // 5. Fetch portal info using the access token
  const authedClient = new HubSpotClient({ accessToken });
  let portalId = '';
  let portalName: string | null = null;
  let grantedScopes: string[] = [];

  try {
    const tokenInfo = await authedClient.oauth.accessTokensApi.get(accessToken);
    portalId = String(tokenInfo.hubId);
    portalName = tokenInfo.hubDomain || null;
    grantedScopes = tokenInfo.scopes || [];
  } catch (err) {
    logger.warn('Failed to fetch HubSpot portal info', { error: err });
    // Non-fatal — we can still proceed with the connection
  }

  // 6. Encrypt tokens and store connection
  const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

  const connection = existing
    ? await prisma.hubSpotConnection.update({
        where: { clientId: payload.clientId },
        data: {
          accessToken: encrypt(accessToken),
          refreshToken: encrypt(refreshToken),
          tokenExpiresAt,
          hubspotPortalId: portalId,
          hubspotPortalName: portalName,
          grantedScopes,
          status: 'ACTIVE',
          connectedBy: payload.userId,
          connectedAt: new Date(),
          disconnectedAt: null,
          lastRefreshedAt: null,
        },
      })
    : await prisma.hubSpotConnection.create({
        data: {
          clientId: payload.clientId,
          accessToken: encrypt(accessToken),
          refreshToken: encrypt(refreshToken),
          tokenExpiresAt,
          hubspotPortalId: portalId,
          hubspotPortalName: portalName,
          grantedScopes,
          status: 'ACTIVE',
          connectedBy: payload.userId,
        },
      });

  logger.info('HubSpot OAuth connection established', {
    clientId: payload.clientId,
    portalId,
    connectionId: connection.id,
  });

  logAudit({
    action: 'hubspot_connected',
    actorUserId: payload.userId,
    targetType: 'HubSpotConnection',
    targetId: connection.id,
    channelId: payload.channelId,
    metadata: { clientId: payload.clientId, portalId },
  }).catch(() => {});

  return {
    connection,
    clientId: payload.clientId,
    channelId: payload.channelId,
    userId: payload.userId,
  };
}

/**
 * Returns a valid (decrypted) access token for a client, automatically
 * refreshing if the token is within 5 minutes of expiry.
 *
 * @param clientId - ManagedClient UUID
 * @returns Decrypted access token string
 * @throws Error if no active connection exists or refresh fails permanently
 */
export async function getAccessToken(clientId: string): Promise<string> {
  const connection = await prisma.hubSpotConnection.findUnique({
    where: { clientId },
  });

  if (!connection || connection.status === 'DISCONNECTED') {
    throw new Error(`No active HubSpot connection for client ${clientId}`);
  }

  if (connection.status === 'TOKEN_EXPIRED') {
    throw new Error(`HubSpot connection token expired for client ${clientId}. Reconnect via /hubspot connect.`);
  }

  // Check if token needs refresh (within 5-minute buffer)
  const now = Date.now();
  const expiresAt = connection.tokenExpiresAt.getTime();

  if (expiresAt > now + REFRESH_BUFFER_MS) {
    // Token still valid
    return decrypt(connection.accessToken);
  }

  // Token needs refresh
  return refreshAccessToken(connection);
}

/**
 * Refreshes the access token using the stored refresh token.
 *
 * On `BAD_REFRESH_TOKEN` errors, marks the connection as TOKEN_EXPIRED
 * and notifies the client's Slack channel.
 */
async function refreshAccessToken(
  connection: Awaited<ReturnType<typeof prisma.hubSpotConnection.findUnique>> & { id: string },
): Promise<string> {
  const hubspotClient = new HubSpotClient();
  const currentRefreshToken = decrypt(connection!.refreshToken);

  try {
    const tokenResponse = await hubspotClient.oauth.tokensApi.create(
      'refresh_token',
      undefined as unknown as string,
      config.hubspotOAuth.redirectUri,
      config.hubspotOAuth.clientId,
      config.hubspotOAuth.clientSecret,
      currentRefreshToken,
    );

    const newAccessToken = tokenResponse.accessToken;
    const newRefreshToken = tokenResponse.refreshToken;
    const expiresIn = tokenResponse.expiresIn;

    await prisma.hubSpotConnection.update({
      where: { id: connection!.id },
      data: {
        accessToken: encrypt(newAccessToken),
        refreshToken: encrypt(newRefreshToken),
        tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
        lastRefreshedAt: new Date(),
      },
    });

    logger.info('HubSpot access token refreshed', {
      connectionId: connection!.id,
      clientId: connection!.clientId,
    });

    logAudit({
      action: 'hubspot_token_refreshed',
      actorUserId: 'system',
      targetType: 'HubSpotConnection',
      targetId: connection!.id,
      metadata: { clientId: connection!.clientId },
    }).catch(() => {});

    return newAccessToken;
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    // Check for bad refresh token (permanent failure)
    if (errorMessage.includes('BAD_REFRESH_TOKEN') || errorMessage.includes('invalid_grant')) {
      await prisma.hubSpotConnection.update({
        where: { id: connection!.id },
        data: { status: 'TOKEN_EXPIRED' },
      });

      logger.error('HubSpot refresh token invalid — connection marked as TOKEN_EXPIRED', {
        connectionId: connection!.id,
        clientId: connection!.clientId,
      });

      logAudit({
        action: 'hubspot_token_expired',
        actorUserId: 'system',
        targetType: 'HubSpotConnection',
        targetId: connection!.id,
        metadata: { clientId: connection!.clientId, reason: 'bad_refresh_token' },
      }).catch(() => {});

      throw new Error(`HubSpot token expired for client ${connection!.clientId}. Reconnect via /hubspot connect.`);
    }

    // Transient error — rethrow for retry
    logger.error('HubSpot token refresh failed (transient)', {
      connectionId: connection!.id,
      error: errorMessage,
    });
    throw err;
  }
}

/**
 * Disconnects a client's HubSpot connection by deleting the record.
 *
 * @param clientId - ManagedClient UUID
 */
export async function disconnect(clientId: string): Promise<void> {
  const connection = await prisma.hubSpotConnection.findUnique({
    where: { clientId },
  });

  if (!connection) {
    throw new Error(`No HubSpot connection found for client ${clientId}`);
  }

  await prisma.hubSpotConnection.delete({
    where: { id: connection.id },
  });

  logger.info('HubSpot connection disconnected', {
    clientId,
    connectionId: connection.id,
    portalId: connection.hubspotPortalId,
  });

  logAudit({
    action: 'hubspot_disconnected',
    actorUserId: 'system',
    targetType: 'HubSpotConnection',
    targetId: connection.id,
    metadata: { clientId, portalId: connection.hubspotPortalId },
  }).catch(() => {});
}

/**
 * Returns the HubSpot connection status for a client, or null if not connected.
 *
 * @param clientId - ManagedClient UUID
 */
export async function getConnectionStatus(clientId: string) {
  return prisma.hubSpotConnection.findUnique({
    where: { clientId },
  });
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

/**
 * Typed OAuth error with a machine-readable code for the callback route.
 */
export class OAuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'OAuthError';
  }
}
