/**
 * Admin CRUD routes for channel-to-client mappings.
 *
 * Allows admins to link Slack channels to ManagedClient entities
 * so the upload page can display the client name.
 */

import { Router } from 'express';
import { WebClient } from '@slack/web-api';
import { prisma } from '../../models/index.js';
import { config } from '../../config/index.js';
import { resolveChannelName } from './slackChannels.js';
import logger from '../../lib/logger.js';

/** Cached team ID resolved from bot token. */
let cachedBotTeamId: string | null = null;

export const channelMappingsRouter = Router();

/**
 * GET / — List all channel-client mappings.
 * Optional query: ?teamId=T12345
 */
channelMappingsRouter.get('/', async (req, res) => {
  const teamId = req.query.teamId as string | undefined;

  const where = teamId ? { slackTeamId: teamId } : {};
  const mappings = await prisma.channelClientMapping.findMany({
    where,
    include: { client: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  });

  res.json({
    mappings: await Promise.all(mappings.map(async (m) => ({
      id: m.id,
      slackTeamId: m.slackTeamId,
      slackChannelId: m.slackChannelId,
      channelName: await resolveChannelName(m.slackTeamId, m.slackChannelId),
      clientId: m.clientId,
      clientName: m.client.name,
      createdByUserId: m.createdByUserId,
      createdAt: m.createdAt.toISOString(),
    }))),
  });
});

/**
 * POST / — Create a channel-client mapping.
 * Body: { slackTeamId, slackChannelId, clientId }
 */
channelMappingsRouter.post('/', async (req, res) => {
  let { slackTeamId, slackChannelId, clientId } = req.body || {};

  if (!slackChannelId || !clientId) {
    res.status(400).json({ error: 'slackChannelId and clientId are required.' });
    return;
  }

  // Auto-resolve slackTeamId from bot token if not provided.
  if (!slackTeamId) {
    if (!cachedBotTeamId) {
      try {
        const client = new WebClient(config.slack.botToken);
        const authResult = await client.auth.test();
        cachedBotTeamId = authResult.team_id ?? null;
      } catch (err) {
        logger.error('Failed to resolve team ID from bot token', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    slackTeamId = cachedBotTeamId;
  }

  if (!slackTeamId) {
    res.status(400).json({ error: 'Could not resolve slackTeamId.' });
    return;
  }

  // Check if channel already mapped
  const existing = await prisma.channelClientMapping.findUnique({
    where: {
      slackTeamId_slackChannelId: { slackTeamId, slackChannelId },
    },
  });

  if (existing) {
    res.status(409).json({ error: 'Channel already mapped to a client.' });
    return;
  }

  // Verify client exists
  const client = await prisma.managedClient.findUnique({
    where: { id: clientId },
  });
  if (!client) {
    res.status(404).json({ error: 'Client not found.' });
    return;
  }

  const mapping = await prisma.channelClientMapping.create({
    data: {
      slackTeamId,
      slackChannelId,
      clientId,
      createdByUserId: 'admin', // Admin-created mappings
    },
    include: { client: { select: { name: true } } },
  });

  logger.info('Channel-client mapping created', {
    slackTeamId,
    slackChannelId,
    clientId,
  });

  res.status(201).json({
    id: mapping.id,
    slackTeamId: mapping.slackTeamId,
    slackChannelId: mapping.slackChannelId,
    channelName: await resolveChannelName(mapping.slackTeamId, mapping.slackChannelId),
    clientId: mapping.clientId,
    clientName: mapping.client.name,
  });
});

/**
 * DELETE /:id — Remove a channel-client mapping.
 */
channelMappingsRouter.delete('/:id', async (req, res) => {
  try {
    await prisma.channelClientMapping.delete({
      where: { id: req.params.id },
    });
    res.json({ deleted: true });
  } catch {
    res.status(404).json({ error: 'Mapping not found.' });
  }
});
