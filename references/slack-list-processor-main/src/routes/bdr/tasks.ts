/**
 * BDR task overview routes.
 *
 * Provides a summary of pending tasks across all campaigns
 * the authenticated BDR is assigned to.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  CampaignStatus,
  StepExecutionStatus,
  StepType,
  ContactCampaignStatus,
} from '@prisma/client';
import { prisma } from '../../models/index.js';
import { getBdrIdentity } from '../../lib/bdrAuth.js';
import logger from '../../lib/logger.js';

const router = Router();

/**
 * GET /api/v1/bdr/tasks
 * Returns task counts per campaign for the authenticated BDR.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const identity = getBdrIdentity(req);
    if (!identity) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    // Get all active campaigns this BDR is assigned to
    const assignments = await prisma.campaignBdr.findMany({
      where: {
        slackUserId: identity.slackUserId,
        campaign: { status: CampaignStatus.ACTIVE },
      },
      include: {
        campaign: {
          select: {
            id: true,
            name: true,
            campaignType: true,
            totalContacts: true,
            activeContacts: true,
            completedContacts: true,
          },
        },
      },
    });

    const tasks = await Promise.all(
      assignments.map(async (assignment) => {
        const campaign = assignment.campaign;

        const [pendingCalls, unreadReplies, activeSequences] = await Promise.all([
          prisma.campaignContactStepExecution.count({
            where: {
              status: StepExecutionStatus.PENDING,
              stepType: StepType.PHONE,
              campaignContact: {
                campaignId: campaign.id,
                status: ContactCampaignStatus.ACTIVE,
              },
            },
          }),
          prisma.uniboxReply.count({
            where: { campaignId: campaign.id, isRead: false },
          }),
          prisma.campaignContactStepExecution.count({
            where: {
              status: StepExecutionStatus.WAITING_WEBHOOK,
              campaignContact: {
                campaignId: campaign.id,
                status: ContactCampaignStatus.ACTIVE,
              },
            },
          }),
        ]);

        return {
          campaignId: campaign.id,
          campaignName: campaign.name,
          campaignType: campaign.campaignType,
          totalContacts: campaign.totalContacts,
          activeContacts: campaign.activeContacts,
          completedContacts: campaign.completedContacts,
          pendingCalls,
          unreadReplies,
          activeSequences,
        };
      }),
    );

    res.json({ data: tasks });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to get BDR tasks', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export { router as tasksRouter };
