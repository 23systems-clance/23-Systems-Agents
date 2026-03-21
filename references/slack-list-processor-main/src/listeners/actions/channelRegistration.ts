/**
 * Channel registration action listener (T036, T067).
 *
 * When the bot is invited to a private channel, sends a prompt asking
 * if this should be the user's enrichment channel or an analysis channel.
 * Handles the registration actions and ICP document upload detection.
 */

import type { App } from '@slack/bolt';
import { registerChannel } from '../../services/workspace/enrichmentChannelManager.js';
import { isPlatformOwner } from '../../services/workspace/platformOwner.js';
import { prisma } from '../../models/index.js';
import { processIcpDocument, type IcpDocumentType } from '../../services/analyze/icpDocumentProcessor.js';
import { resolveFeatureFlags } from '../../services/featureToggle/featureFlags.js';
import { logAudit } from '../../lib/auditLogger.js';
import logger from '../../lib/logger.js';

/**
 * Registers channel registration event and action handlers.
 *
 * @param app - Slack Bolt app instance.
 */
export function registerChannelRegistrationHandlers(app: App): void {
  // Listen for bot being added to a channel (member_joined_channel for the bot itself)
  app.event('member_joined_channel', async ({ event, client, context }) => {
    const botUserId = context.botUserId;

    // Only react when the BOT is the one joining
    if (event.user !== botUserId) {
      return;
    }

    const channelId = event.channel;
    const teamId = context.teamId ?? '';

    // Skip for platform owner workspaces — they don't need channel registration
    if (await isPlatformOwner(teamId)) {
      return;
    }

    // Check if this is a private channel
    try {
      const channelInfo = await client.conversations.info({ channel: channelId });
      const channel = channelInfo.channel;

      if (!channel?.is_private) {
        // Public channel — no registration prompt needed
        return;
      }

      const channelName = channel.name ?? channelId;

      // Post registration prompt with both enrichment and analysis options
      await client.chat.postMessage({
        channel: channelId,
        blocks: [
          {
            type: 'section' as const,
            text: {
              type: 'mrkdwn' as const,
              text: `I've been added to *#${channelName}*. How would you like to use this channel?`,
            },
          },
          {
            type: 'actions' as const,
            elements: [
              {
                type: 'button' as const,
                text: { type: 'plain_text' as const, text: 'Enrichment Channel' },
                action_id: 'register_enrichment_channel',
                value: JSON.stringify({ channelId, channelName }),
                style: 'primary' as const,
              },
              {
                type: 'button' as const,
                text: { type: 'plain_text' as const, text: 'Analysis / ICP Channel' },
                action_id: 'register_analysis_channel',
                value: JSON.stringify({ channelId, channelName }),
              },
              {
                type: 'button' as const,
                text: { type: 'plain_text' as const, text: 'Skip' },
                action_id: 'skip_channel_registration',
              },
            ],
          },
        ],
        text: `Would you like to register #${channelName} as an enrichment or analysis channel?`,
      });

      logger.info('Channel registration prompt sent', { channelId, teamId });
    } catch (error) {
      logger.error('Failed to check channel or send registration prompt', {
        channelId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Handle "Register as Enrichment Channel" button click
  app.action('register_enrichment_channel', async ({ ack, body, client, context }) => {
    await ack();

    const actionBody = body as unknown as Record<string, unknown>;
    const userId = (actionBody.user as Record<string, string>)?.id ?? '';
    const teamId = context.teamId ?? '';
    const actions = (actionBody.actions as Array<Record<string, string>>) ?? [];
    const actionValue = actions[0]?.value ?? '{}';
    const { channelId, channelName } = JSON.parse(actionValue);

    // Look up user's display name
    let userName = userId;
    try {
      const userInfo = await client.users.info({ user: userId });
      userName = userInfo.user?.real_name ?? userInfo.user?.name ?? userId;
    } catch {
      // Non-fatal — use userId as fallback
    }

    const result = await registerChannel(teamId, channelId, channelName, userId, userName);

    if (result.success) {
      logAudit({
        action: 'ENRICHMENT_CHANNEL_REGISTERED',
        actorUserId: userId,
        actorTeamId: teamId,
        targetType: 'EnrichmentChannel',
        channelId,
        metadata: { channelName },
      });
      await client.chat.postMessage({
        channel: channelId,
        text: `This channel has been registered as <@${userId}>'s enrichment channel. You can now upload company/contact lists here for enrichment.`,
      });
    } else {
      await client.chat.postMessage({
        channel: channelId,
        text: result.error ?? 'Failed to register channel.',
      });
    }
  });

  // Handle "Register as Analysis / ICP Channel" button click (T067, T069)
  app.action('register_analysis_channel', async ({ ack, body, client, context }) => {
    await ack();

    const actionBody = body as unknown as Record<string, unknown>;
    const teamId = context.teamId ?? '';
    const actions = (actionBody.actions as Array<Record<string, string>>) ?? [];
    const actionValue = actions[0]?.value ?? '{}';
    const { channelId, channelName } = JSON.parse(actionValue);

    // Check icpAnalysis feature flag (T069)
    const workspace = await prisma.workspaceInstallation.findUnique({
      where: { slackTeamId: teamId },
      select: { featureFlags: true },
    });
    const flags = resolveFeatureFlags(teamId, workspace?.featureFlags as Record<string, boolean> | null);
    if (!flags.icpAnalysis) {
      await client.chat.postMessage({
        channel: channelId,
        text: 'ICP Analysis is not enabled for your workspace. Contact your administrator to enable this feature.',
      });
      return;
    }

    try {
      // Create or update the AnalysisChannel record
      await prisma.analysisChannel.upsert({
        where: { slackTeamId: teamId },
        create: {
          slackTeamId: teamId,
          slackChannelId: channelId,
          slackChannelName: channelName,
        },
        update: {
          slackChannelId: channelId,
          slackChannelName: channelName,
        },
      });

      const userId = (actionBody.user as Record<string, string>)?.id ?? '';
      logAudit({
        action: 'ANALYSIS_CHANNEL_REGISTERED',
        actorUserId: userId,
        actorTeamId: teamId,
        targetType: 'AnalysisChannel',
        channelId,
        metadata: { channelName },
      });

      await client.chat.postMessage({
        channel: channelId,
        blocks: [
          {
            type: 'section' as const,
            text: {
              type: 'mrkdwn' as const,
              text: `This channel has been registered as your *Analysis / ICP Channel*.\n\nUpload documents here and tag them with their type. I'll process them and use the content for analysis reports.\n\n*Supported document types:*\n- ICP (Ideal Customer Profile)\n- Use Cases\n- Case Studies\n- Testimonials\n\nTo upload, share a file and mention the type, e.g.: \`ICP document\` or \`case study\``,
            },
          },
        ],
        text: `This channel has been registered as your Analysis / ICP channel.`,
      });

      logger.info('Analysis channel registered', { channelId, channelName, teamId });
    } catch (error) {
      logger.error('Failed to register analysis channel', {
        channelId,
        teamId,
        error: error instanceof Error ? error.message : String(error),
      });
      await client.chat.postMessage({
        channel: channelId,
        text: 'Failed to register this channel as an analysis channel. Please try again.',
      });
    }
  });

  // Handle document uploads in analysis channels (T067, T069)
  app.event('file_shared', async ({ event, client, context }) => {
    const channelId = event.channel_id;
    const teamId = context.teamId ?? '';

    // Check if this channel is a registered analysis channel
    const analysisChannel = await prisma.analysisChannel.findFirst({
      where: { slackTeamId: teamId, slackChannelId: channelId },
    });

    if (!analysisChannel) return;

    // Check icpAnalysis feature flag (T069)
    const workspace = await prisma.workspaceInstallation.findUnique({
      where: { slackTeamId: teamId },
      select: { featureFlags: true },
    });
    const flags = resolveFeatureFlags(teamId, workspace?.featureFlags as Record<string, boolean> | null);
    if (!flags.icpAnalysis) return;

    try {
      const fileInfo = await client.files.info({ file: event.file_id });
      const file = fileInfo.file;
      if (!file) return;

      const fileName = (file as Record<string, unknown>).name as string ?? '';
      const mimeType = (file as Record<string, unknown>).mimetype as string ?? '';
      const fileUrl = (file as Record<string, unknown>).url_private as string ?? '';

      // Only process document types (PDF, DOCX, XLSX)
      const supportedTypes = [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ];
      if (!supportedTypes.includes(mimeType)) return;

      // Detect document type from filename or message context
      const lowerName = fileName.toLowerCase();
      let docType: IcpDocumentType = 'icp'; // default

      if (lowerName.includes('use case') || lowerName.includes('usecase')) {
        docType = 'useCases';
      } else if (lowerName.includes('case stud') || lowerName.includes('casestud')) {
        docType = 'caseStudies';
      } else if (lowerName.includes('testimonial')) {
        docType = 'testimonials';
      } else if (lowerName.includes('icp') || lowerName.includes('ideal customer')) {
        docType = 'icp';
      }

      // Post processing status
      const statusMsg = await client.chat.postMessage({
        channel: channelId,
        text: `Processing *${fileName}* as ${docType.replace(/([A-Z])/g, ' $1').toLowerCase()} document...`,
      });

      const success = await processIcpDocument(teamId, docType, fileUrl, fileName, mimeType);

      // Update status message
      const statusTs = statusMsg.ts;
      if (statusTs) {
        await client.chat.update({
          channel: channelId,
          ts: statusTs,
          text: success
            ? `*${fileName}* processed as ${docType.replace(/([A-Z])/g, ' $1').toLowerCase()} document. The content will be used in future analysis reports.`
            : `Failed to process *${fileName}*. Please try uploading again.`,
        });
      }
    } catch (error) {
      logger.error('Failed to process analysis channel file', {
        channelId,
        teamId,
        fileId: event.file_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Handle "Skip" button click
  app.action('skip_channel_registration', async ({ ack, body, client }) => {
    await ack();

    const actionBody = body as unknown as Record<string, unknown>;
    const channelId = (actionBody.channel as Record<string, string>)?.id;

    if (channelId) {
      await client.chat.postMessage({
        channel: channelId,
        text: 'No problem. You can register this channel later by re-inviting the bot or contacting your admin.',
      });
    }
  });
}
