/**
 * Enrichment channel management service (T038).
 *
 * Manages per-user private enrichment channels for client workspaces.
 * Each user gets one active enrichment channel. Platform owner workspaces
 * bypass channel registration entirely.
 */

import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

/**
 * Registers a private channel as a user's enrichment channel.
 *
 * Enforces one active channel per user per workspace. If the user already
 * has an active channel, returns an error instead of silently replacing it.
 *
 * @param slackTeamId    - Workspace team ID.
 * @param slackChannelId - Slack channel ID to register.
 * @param channelName    - Display name of the channel.
 * @param slackUserId    - User who owns the channel.
 * @param userName       - Display name of the user.
 * @returns The created EnrichmentChannel record, or null if user already has one.
 */
export async function registerChannel(
  slackTeamId: string,
  slackChannelId: string,
  channelName: string,
  slackUserId: string,
  userName: string,
): Promise<{ success: boolean; channelId?: string; error?: string }> {
  // Check if user already has an active channel
  const existing = await prisma.enrichmentChannel.findFirst({
    where: { slackTeamId, assignedUserId: slackUserId, status: 'ACTIVE' },
  });

  if (existing) {
    return {
      success: false,
      error: `You already have an active enrichment channel: <#${existing.slackChannelId}>. Deactivate it first to register a new one.`,
    };
  }

  // Check if this channel is already registered
  const existingChannel = await prisma.enrichmentChannel.findUnique({
    where: { slackTeamId_slackChannelId: { slackTeamId, slackChannelId } },
  });

  if (existingChannel && existingChannel.status === 'ACTIVE') {
    return {
      success: false,
      error: `This channel is already registered as an enrichment channel for <@${existingChannel.assignedUserId}>.`,
    };
  }

  // Upsert: reactivate if previously deactivated, or create new
  const channel = await prisma.enrichmentChannel.upsert({
    where: { slackTeamId_slackChannelId: { slackTeamId, slackChannelId } },
    update: {
      assignedUserId: slackUserId,
      assignedUserName: userName,
      slackChannelName: channelName,
      status: 'ACTIVE',
      deactivatedAt: null,
    },
    create: {
      slackTeamId,
      slackChannelId,
      slackChannelName: channelName,
      assignedUserId: slackUserId,
      assignedUserName: userName,
      status: 'ACTIVE',
    },
  });

  logger.info('Enrichment channel registered', {
    channelId: channel.id,
    slackTeamId,
    slackChannelId,
    slackUserId,
  });

  return { success: true, channelId: channel.id };
}

/**
 * Deactivates an enrichment channel.
 *
 * @param slackTeamId    - Workspace team ID.
 * @param slackChannelId - Slack channel ID to deactivate.
 * @returns True if deactivated, false if not found or already inactive.
 */
export async function deactivateChannel(
  slackTeamId: string,
  slackChannelId: string,
): Promise<boolean> {
  const channel = await prisma.enrichmentChannel.findUnique({
    where: { slackTeamId_slackChannelId: { slackTeamId, slackChannelId } },
  });

  if (!channel || channel.status === 'INACTIVE') {
    return false;
  }

  await prisma.enrichmentChannel.update({
    where: { id: channel.id },
    data: { status: 'INACTIVE', deactivatedAt: new Date() },
  });

  logger.info('Enrichment channel deactivated', {
    channelId: channel.id,
    slackTeamId,
    slackChannelId,
  });

  return true;
}

/**
 * Lists all enrichment channels for a workspace.
 *
 * @param slackTeamId - Workspace team ID.
 * @param statusFilter - Optional status filter (default: all).
 * @returns Array of enrichment channel records.
 */
export async function listChannels(
  slackTeamId: string,
  statusFilter?: 'ACTIVE' | 'INACTIVE',
) {
  return prisma.enrichmentChannel.findMany({
    where: {
      slackTeamId,
      ...(statusFilter ? { status: statusFilter } : {}),
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Gets the active enrichment channel for a specific user.
 *
 * @param slackTeamId - Workspace team ID.
 * @param slackUserId - User to look up.
 * @returns The active enrichment channel, or null if none.
 */
export async function getChannelForUser(
  slackTeamId: string,
  slackUserId: string,
) {
  return prisma.enrichmentChannel.findFirst({
    where: { slackTeamId, assignedUserId: slackUserId, status: 'ACTIVE' },
  });
}

/**
 * Checks if a channel is a registered enrichment channel and verifies
 * the uploader is the assigned user.
 *
 * @param slackTeamId    - Workspace team ID.
 * @param slackChannelId - Channel where file was uploaded.
 * @param slackUserId    - User who uploaded the file.
 * @returns Object with authorization result.
 */
export async function verifyChannelAccess(
  slackTeamId: string,
  slackChannelId: string,
  slackUserId: string,
): Promise<{ authorized: boolean; isRegisteredChannel: boolean; assignedUserId?: string }> {
  const channel = await prisma.enrichmentChannel.findUnique({
    where: { slackTeamId_slackChannelId: { slackTeamId, slackChannelId } },
  });

  if (!channel || channel.status !== 'ACTIVE') {
    return { authorized: false, isRegisteredChannel: false };
  }

  return {
    authorized: channel.assignedUserId === slackUserId,
    isRegisteredChannel: true,
    assignedUserId: channel.assignedUserId,
  };
}
