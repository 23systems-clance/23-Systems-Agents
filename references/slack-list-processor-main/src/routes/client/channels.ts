/**
 * Client channels routes (T055, T070).
 *
 * Lists registered enrichment channels and analysis channel for the workspace.
 * Admin users can deactivate channels.
 */

import { Router } from 'express';
import { prisma } from '../../models/index.js';
import { listChannels, deactivateChannel } from '../../services/workspace/enrichmentChannelManager.js';
import { requireClientAdmin } from '../../lib/clientAuth.js';
import type { ClientSession } from '../../lib/clientAuth.js';
import logger from '../../lib/logger.js';

export const clientChannelsRouter = Router();

/** GET /api/v1/client/channels — list enrichment channels. */
clientChannelsRouter.get('/', async (req, res) => {
  try {
    const session = (req as unknown as Record<string, unknown>).clientSession as ClientSession;
    const { slackTeamId } = session;

    const [channels, analysisChannel] = await Promise.all([
      listChannels(slackTeamId),
      prisma.analysisChannel.findUnique({
        where: { slackTeamId },
        select: {
          slackChannelId: true,
          slackChannelName: true,
          icpDocumentUrl: true,
          useCasesDocumentUrl: true,
          caseStudiesDocumentUrl: true,
          testimonialsDocumentUrl: true,
          lastDocumentUploadAt: true,
        },
      }),
    ]);

    res.json({
      channels,
      analysisChannel: analysisChannel ? {
        slackChannelId: analysisChannel.slackChannelId,
        slackChannelName: analysisChannel.slackChannelName,
        documents: {
          icp: !!analysisChannel.icpDocumentUrl,
          useCases: !!analysisChannel.useCasesDocumentUrl,
          caseStudies: !!analysisChannel.caseStudiesDocumentUrl,
          testimonials: !!analysisChannel.testimonialsDocumentUrl,
        },
        lastDocumentUploadAt: analysisChannel.lastDocumentUploadAt,
      } : null,
    });
  } catch (error) {
    logger.error('Failed to list client channels', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to list channels' });
  }
});

/** POST /api/v1/client/channels/:channelId/deactivate — admin only. */
clientChannelsRouter.post('/:channelId/deactivate', requireClientAdmin, async (req, res) => {
  try {
    const session = (req as unknown as Record<string, unknown>).clientSession as ClientSession;
    const { slackTeamId } = session;
    const { channelId } = req.params;

    const result = await deactivateChannel(slackTeamId, channelId as string);

    res.json({ success: result });
  } catch (error) {
    logger.error('Failed to deactivate channel', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to deactivate channel' });
  }
});
