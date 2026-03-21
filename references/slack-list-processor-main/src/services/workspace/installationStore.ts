/**
 * Prisma-backed InstallationStore for multi-workspace OAuth installations.
 *
 * Stores OAuth installation data in WorkspaceInstallation model with
 * encrypted bot tokens. Provides storeInstallation, fetchInstallation,
 * and deleteInstallation per the oauth-install.md contract.
 */

import { prisma } from '../../models/index.js';
import { encrypt, decrypt } from '../../lib/tokenEncryption.js';
import redis from '../../lib/redis.js';
import logger from '../../lib/logger.js';

/** Installation data shape from Slack OAuth v2 callback. */
export interface SlackInstallation {
  team: {
    id: string;
    name: string;
  };
  enterprise?: {
    id: string;
    name: string;
  };
  bot: {
    token: string;
    scopes: string[];
    id: string;
    userId: string;
  };
  appId: string;
  tokenType: 'bot';
  isEnterpriseInstall: boolean;
}

/** Result returned by fetchInstallation and the authorize function. */
export interface AuthResult {
  botToken: string;
  botId: string;
  botUserId: string;
}

/** Redis cache TTL for installation auth data (1 hour). */
const CACHE_TTL_SECONDS = 3600;

/**
 * Builds the Redis cache key for a workspace installation.
 */
function cacheKey(teamId: string): string {
  return `install:${teamId}`;
}

/**
 * Stores or updates a workspace installation from OAuth callback data.
 * Encrypts the bot token before persisting to the database.
 */
export async function storeInstallation(installation: SlackInstallation): Promise<void> {
  const encryptedToken = encrypt(installation.bot.token);

  await prisma.workspaceInstallation.upsert({
    where: { slackTeamId: installation.team.id },
    create: {
      slackTeamId: installation.team.id,
      slackTeamName: installation.team.name,
      botToken: encryptedToken,
      botId: installation.bot.id,
      botUserId: installation.bot.userId,
      appId: installation.appId,
      installedByUserId: '', // Set by caller after user info lookup
      scopes: installation.bot.scopes.join(','),
      status: 'ACTIVE',
    },
    update: {
      slackTeamName: installation.team.name,
      botToken: encryptedToken,
      botId: installation.bot.id,
      botUserId: installation.bot.userId,
      appId: installation.appId,
      scopes: installation.bot.scopes.join(','),
      status: 'ACTIVE',
      uninstalledAt: null,
      purgeAfter: null,
    },
  });

  // Cache the auth result for fast authorize lookups
  const authResult: AuthResult = {
    botToken: installation.bot.token,
    botId: installation.bot.id,
    botUserId: installation.bot.userId,
  };
  await redis.setex(cacheKey(installation.team.id), CACHE_TTL_SECONDS, JSON.stringify(authResult));

  logger.info('Workspace installation stored', {
    teamId: installation.team.id,
    teamName: installation.team.name,
  });
}

/**
 * Fetches installation data for a workspace.
 * Returns the original SlackInstallation shape with decrypted bot token.
 *
 * @throws Error if no active installation found for the given team ID.
 */
export async function fetchInstallation(query: { teamId: string }): Promise<SlackInstallation> {
  const install = await prisma.workspaceInstallation.findUnique({
    where: { slackTeamId: query.teamId },
  });

  if (!install || install.status !== 'ACTIVE') {
    throw new Error(`No active installation for team ${query.teamId}`);
  }

  return {
    team: {
      id: install.slackTeamId,
      name: install.slackTeamName,
    },
    bot: {
      token: decrypt(install.botToken),
      scopes: install.scopes.split(','),
      id: install.botId,
      userId: install.botUserId,
    },
    appId: install.appId,
    tokenType: 'bot',
    isEnterpriseInstall: false,
  };
}

/**
 * Fetches the auth result (botToken, botId, botUserId) for authorize function.
 * Checks Redis cache first, falls back to DB with decryption.
 */
export async function fetchAuthResult(teamId: string): Promise<AuthResult> {
  // 1. Check Redis cache
  const cached = await redis.get(cacheKey(teamId));
  if (cached) {
    return JSON.parse(cached) as AuthResult;
  }

  // 2. Fallback to DB
  const install = await prisma.workspaceInstallation.findUnique({
    where: { slackTeamId: teamId },
  });

  if (!install || install.status !== 'ACTIVE') {
    throw new Error(`No active installation for team ${teamId}`);
  }

  const authResult: AuthResult = {
    botToken: decrypt(install.botToken),
    botId: install.botId,
    botUserId: install.botUserId,
  };

  // 3. Cache for 1 hour
  await redis.setex(cacheKey(teamId), CACHE_TTL_SECONDS, JSON.stringify(authResult));

  return authResult;
}

/**
 * Marks a workspace installation as uninstalled and schedules data disposal.
 * Sets status to UNINSTALLED and purgeAfter to 90 days from now.
 * Invalidates the Redis cache.
 */
export async function deleteInstallation(query: { teamId: string }): Promise<void> {
  const purgeAfter = new Date();
  purgeAfter.setDate(purgeAfter.getDate() + 90);

  await prisma.workspaceInstallation.update({
    where: { slackTeamId: query.teamId },
    data: {
      status: 'UNINSTALLED',
      uninstalledAt: new Date(),
      purgeAfter,
    },
  });

  // Invalidate Redis cache
  await redis.del(cacheKey(query.teamId));

  logger.info('Workspace installation marked as uninstalled', {
    teamId: query.teamId,
    purgeAfter: purgeAfter.toISOString(),
  });
}

/**
 * Invalidates the cached auth data for a workspace.
 * Call when bot token is rotated or installation status changes.
 */
export async function invalidateCache(teamId: string): Promise<void> {
  await redis.del(cacheKey(teamId));
}
