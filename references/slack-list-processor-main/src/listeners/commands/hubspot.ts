/**
 * Slash command handler for /hubspot.
 *
 * Routes subcommands to the appropriate handler: connect, disconnect, status,
 * import, activity, sync, help. Each subcommand validates preconditions
 * (e.g., client mapping exists, connection active) before proceeding.
 */

import type { App, RespondFn } from '@slack/bolt';
import { requireFeature } from '../../services/featureToggle/featureGate.js';
import { prisma } from '../../models/index.js';
import * as hubspotOAuth from '../../services/hubspot/hubspotOAuth.js';
import { retrySyncs } from '../../services/hubspot/hubspotActivity.js';
import { getWebhookStatus } from '../../services/hubspot/hubspotWebhook.js';
import logger from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

const HELP_TEXT = `*HubSpot Integration Commands*

\`/hubspot connect\`    — Connect your HubSpot account via OAuth
\`/hubspot disconnect\` — Remove the HubSpot connection
\`/hubspot status\`     — Check connection status
\`/hubspot import\`     — Import contacts and create a HubSpot list
\`/hubspot activity\`   — View HubSpot engagement activity
\`/hubspot sync\`       — Re-sync failed activity to HubSpot
\`/hubspot help\`       — Show this help message`;

// ---------------------------------------------------------------------------
// Command Registration
// ---------------------------------------------------------------------------

/**
 * Registers the `/hubspot` slash command handler with the Bolt app.
 *
 * @param app - Slack Bolt application instance
 */
export function registerHubspotCommand(app: App): void {
  app.command('/hubspot', requireFeature('workflows'), async ({ command, ack, respond }) => {
    await ack();

    const subcommand = (command.text || '').trim().split(/\s+/)[0]?.toLowerCase() || 'help';
    const channelId = command.channel_id;
    const userId = command.user_id;
    const teamId = command.team_id;

    try {
      switch (subcommand) {
        case 'connect':
          await handleConnect(channelId, userId, teamId, respond);
          break;
        case 'disconnect':
          await handleDisconnect(channelId, respond);
          break;
        case 'status':
          await handleStatus(channelId, respond);
          break;
        case 'import':
          await handleImport(channelId, teamId, respond);
          break;
        case 'activity':
          await handleActivity(channelId, command.text, respond);
          break;
        case 'sync':
          await handleSync(channelId, respond);
          break;
        case 'help':
        default:
          await respond({ response_type: 'ephemeral', text: HELP_TEXT });
          break;
      }
    } catch (err) {
      logger.error('HubSpot command error', { subcommand, channelId, userId, error: err });
      await respond({ response_type: 'ephemeral', text: 'An unexpected error occurred. Please try again.' });
    }
  });
}

// ---------------------------------------------------------------------------
// Subcommand Handlers
// ---------------------------------------------------------------------------

/**
 * `/hubspot connect` — Initiates OAuth flow.
 *
 * Preconditions:
 * - Channel must have a ChannelClientMapping
 * - Client must NOT already have an active HubSpotConnection
 */
async function handleConnect(
  channelId: string,
  userId: string,
  teamId: string,
  respond: RespondFn,
): Promise<void> {
  const mapping = await prisma.channelClientMapping.findFirst({
    where: { slackChannelId: channelId, slackTeamId: teamId },
    include: { client: true },
  });

  if (!mapping) {
    await respond({ response_type: 'ephemeral', text: 'No client is assigned to this channel. Use `/assign` to assign a client first.' });
    return;
  }

  const existingConnection = await hubspotOAuth.getConnectionStatus(mapping.clientId);
  if (existingConnection && existingConnection.status === 'ACTIVE') {
    await respond({
      response_type: 'ephemeral',
      text: `*${mapping.client.name}* is already connected to HubSpot (Portal: ${existingConnection.hubspotPortalId}). Use \`/hubspot disconnect\` first if you want to reconnect.`,
    });
    return;
  }

  const authUrl = await hubspotOAuth.generateAuthUrl(mapping.clientId, channelId, userId);

  await respond({
    response_type: 'ephemeral',
    text: 'Connect your HubSpot account to enable contact imports and list creation.',
    blocks: [
      {
        type: 'section' as const,
        text: {
          type: 'mrkdwn' as const,
          text: `Connect *${mapping.client.name}*'s HubSpot account to enable contact imports and list creation.`,
        },
      },
      {
        type: 'actions' as const,
        elements: [
          {
            type: 'button' as const,
            text: { type: 'plain_text' as const, text: 'Connect HubSpot' },
            url: authUrl,
            style: 'primary' as const,
            action_id: 'hubspot_oauth_link',
          },
        ],
      },
    ],
  });
}

/**
 * `/hubspot disconnect` — Prompts for confirmation, then disconnects.
 */
async function handleDisconnect(
  channelId: string,
  respond: RespondFn,
): Promise<void> {
  const mapping = await prisma.channelClientMapping.findFirst({
    where: { slackChannelId: channelId },
    include: { client: true },
  });

  if (!mapping) {
    await respond({ response_type: 'ephemeral', text: 'No client assigned to this channel.' });
    return;
  }

  const connection = await hubspotOAuth.getConnectionStatus(mapping.clientId);
  if (!connection || connection.status === 'DISCONNECTED') {
    await respond({ response_type: 'ephemeral', text: `*${mapping.client.name}* is not connected to HubSpot.` });
    return;
  }

  await respond({
    response_type: 'ephemeral',
    text: `Are you sure you want to disconnect *${mapping.client.name}* from HubSpot (Portal: ${connection.hubspotPortalId})?`,
    blocks: [
      {
        type: 'section' as const,
        text: {
          type: 'mrkdwn' as const,
          text: `Are you sure you want to disconnect *${mapping.client.name}* from HubSpot (Portal: ${connection.hubspotPortalId})? This will remove the stored OAuth tokens.`,
        },
      },
      {
        type: 'actions' as const,
        elements: [
          {
            type: 'button' as const,
            text: { type: 'plain_text' as const, text: 'Disconnect' },
            style: 'danger' as const,
            action_id: 'hubspot_disconnect_confirm',
            value: mapping.clientId,
          },
          {
            type: 'button' as const,
            text: { type: 'plain_text' as const, text: 'Cancel' },
            action_id: 'hubspot_disconnect_cancel',
          },
        ],
      },
    ],
  });
}

/**
 * `/hubspot status` — Shows connection status for the channel's client.
 */
async function handleStatus(
  channelId: string,
  respond: RespondFn,
): Promise<void> {
  const mapping = await prisma.channelClientMapping.findFirst({
    where: { slackChannelId: channelId },
    include: { client: true },
  });

  if (!mapping) {
    await respond({ response_type: 'ephemeral', text: 'No client assigned to this channel.' });
    return;
  }

  const connection = await hubspotOAuth.getConnectionStatus(mapping.clientId);

  if (!connection) {
    await respond({
      response_type: 'ephemeral',
      text: `*${mapping.client.name}* is not connected to HubSpot. Use \`/hubspot connect\` to set up.`,
    });
    return;
  }

  if (connection.status === 'TOKEN_EXPIRED') {
    await respond({
      response_type: 'ephemeral',
      text: `*${mapping.client.name}*'s HubSpot connection has expired. Use \`/hubspot connect\` to reconnect.`,
    });
    return;
  }

  if (connection.status === 'DISCONNECTED') {
    await respond({
      response_type: 'ephemeral',
      text: `*${mapping.client.name}* was disconnected from HubSpot. Use \`/hubspot connect\` to reconnect.`,
    });
    return;
  }

  const [importCount, webhookStatus] = await Promise.all([
    prisma.hubSpotImportJob.count({
      where: { connectionId: connection.id, status: 'COMPLETED' },
    }),
    getWebhookStatus(),
  ]);

  const connectedDate = connection.connectedAt.toISOString().split('T')[0];
  const webhookLabel = webhookStatus.active ? 'Active' : 'Not configured';

  await respond({
    response_type: 'ephemeral',
    text: `HubSpot connection status for ${mapping.client.name}`,
    blocks: [
      {
        type: 'section' as const,
        text: {
          type: 'mrkdwn' as const,
          text: [
            `*HubSpot Status for ${mapping.client.name}*`,
            '',
            `*Portal*: ${connection.hubspotPortalName || connection.hubspotPortalId} (ID: ${connection.hubspotPortalId})`,
            `*Status*: ${connection.status === 'ACTIVE' ? 'Connected' : connection.status}`,
            `*Connected*: ${connectedDate}`,
            `*Connected by*: <@${connection.connectedBy}>`,
            `*Contacts synced*: ${connection.totalContactsSynced.toLocaleString()}`,
            `*Activities logged*: ${connection.totalActivitiesLogged.toLocaleString()}`,
            `*Completed imports*: ${importCount}`,
            `*Webhooks*: ${webhookLabel}`,
          ].join('\n'),
        },
      },
    ],
  });
}

/**
 * `/hubspot import` — Shows file selection for HubSpot import.
 *
 * Lists recent completed enrichment/filter/split jobs from this channel.
 */
async function handleImport(
  channelId: string,
  teamId: string,
  respond: RespondFn,
): Promise<void> {
  const mapping = await prisma.channelClientMapping.findFirst({
    where: { slackChannelId: channelId, slackTeamId: teamId },
    include: { client: true },
  });

  if (!mapping) {
    await respond({ response_type: 'ephemeral', text: 'No client assigned to this channel.' });
    return;
  }

  const connection = await hubspotOAuth.getConnectionStatus(mapping.clientId);
  if (!connection || connection.status !== 'ACTIVE') {
    await respond({
      response_type: 'ephemeral',
      text: 'No active HubSpot connection. Use `/hubspot connect` first.',
    });
    return;
  }

  // Query recent completed jobs with result files
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const recentJobs = await prisma.job.findMany({
    where: {
      slackChannelId: channelId,
      status: 'COMPLETED',
      resultFileUrl: { not: null },
      createdAt: { gte: thirtyDaysAgo },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      sourceFileName: true,
      resultFileName: true,
      contactsFound: true,
      sourceRowCount: true,
      jobType: true,
      createdAt: true,
    },
  });

  if (recentJobs.length === 0) {
    await respond({
      response_type: 'ephemeral',
      text: 'No recent completed jobs with result files found in this channel. Run an enrichment first.',
    });
    return;
  }

  const options = recentJobs.map((job) => {
    const date = job.createdAt.toISOString().split('T')[0];
    const count = job.contactsFound || job.sourceRowCount || 0;
    const name = job.resultFileName || job.sourceFileName || 'Unknown file';
    return {
      text: { type: 'plain_text' as const, text: `${name} (${count} contacts, ${date})`.slice(0, 75) },
      value: job.id,
    };
  });

  await respond({
    response_type: 'ephemeral',
    text: 'Select a file to import to HubSpot:',
    blocks: [
      {
        type: 'section' as const,
        text: { type: 'mrkdwn' as const, text: 'Select a file to import to HubSpot:' },
      },
      {
        type: 'actions' as const,
        block_id: 'hubspot_file_select',
        elements: [
          {
            type: 'static_select' as const,
            placeholder: { type: 'plain_text' as const, text: 'Choose a file...' },
            action_id: 'hubspot_file_selected',
            options,
          },
        ],
      },
    ],
  });
}

/**
 * `/hubspot activity [email]` — Shows date range preset buttons for activity query.
 */
async function handleActivity(
  channelId: string,
  commandText: string,
  respond: RespondFn,
): Promise<void> {
  const mapping = await prisma.channelClientMapping.findFirst({
    where: { slackChannelId: channelId },
    include: { client: true },
  });

  if (!mapping) {
    await respond({ response_type: 'ephemeral', text: 'No client assigned to this channel.' });
    return;
  }

  const connection = await hubspotOAuth.getConnectionStatus(mapping.clientId);
  if (!connection || connection.status !== 'ACTIVE') {
    await respond({ response_type: 'ephemeral', text: 'No active HubSpot connection. Use `/hubspot connect` first.' });
    return;
  }

  // Parse optional email from command text (e.g., "activity user@example.com")
  const parts = commandText.trim().split(/\s+/);
  const email = parts.length > 1 ? parts[1] : null;
  const valueJson = JSON.stringify({ email });

  await respond({
    response_type: 'ephemeral',
    text: 'Select a date range for HubSpot activity:',
    blocks: [
      {
        type: 'section' as const,
        text: {
          type: 'mrkdwn' as const,
          text: email
            ? `Select a date range for HubSpot activity for *${email}*:`
            : 'Select a date range for HubSpot activity across all synced contacts:',
        },
      },
      {
        type: 'actions' as const,
        block_id: 'hubspot_activity_date_range',
        elements: [
          {
            type: 'button' as const,
            text: { type: 'plain_text' as const, text: 'Today' },
            action_id: 'hubspot_activity_today',
            value: valueJson,
          },
          {
            type: 'button' as const,
            text: { type: 'plain_text' as const, text: 'Last 7 Days' },
            action_id: 'hubspot_activity_7days',
            value: valueJson,
          },
          {
            type: 'button' as const,
            text: { type: 'plain_text' as const, text: 'Custom' },
            action_id: 'hubspot_activity_custom',
            value: valueJson,
          },
        ],
      },
    ],
  });
}

/**
 * `/hubspot sync` — Re-queues failed activity syncs.
 */
async function handleSync(
  channelId: string,
  respond: RespondFn,
): Promise<void> {
  const mapping = await prisma.channelClientMapping.findFirst({
    where: { slackChannelId: channelId },
    include: { client: true },
  });

  if (!mapping) {
    await respond({ response_type: 'ephemeral', text: 'No client assigned to this channel.' });
    return;
  }

  const connection = await hubspotOAuth.getConnectionStatus(mapping.clientId);
  if (!connection || connection.status !== 'ACTIVE') {
    await respond({ response_type: 'ephemeral', text: 'No active HubSpot connection. Use `/hubspot connect` first.' });
    return;
  }

  const { queued } = await retrySyncs(mapping.clientId);

  if (queued === 0) {
    await respond({ response_type: 'ephemeral', text: 'No pending activity events to sync.' });
  } else {
    await respond({
      response_type: 'ephemeral',
      text: `Syncing activity to HubSpot... Found ${queued} pending events. You'll be notified when complete.`,
    });
  }
}
