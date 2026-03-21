/**
 * BDR call list routes.
 *
 * Provides phone call task management for campaigns
 * the authenticated BDR is assigned to.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  StepExecutionStatus,
  StepType,
  ContactCampaignStatus,
} from '@prisma/client';
import { prisma } from '../../models/index.js';
import { getBdrIdentity } from '../../lib/bdrAuth.js';
import { advanceContact } from '../../services/campaign/sequenceEngine.js';
import { trackActivity } from '../../services/campaign/activityTracker.js';
import { buildHubSpotContactLink } from '../../services/hubspot/hubspotClient.js';
import logger from '../../lib/logger.js';

const router = Router();

/**
 * GET /api/v1/bdr/calls/:campaignId
 * Returns the call list for a specific campaign.
 */
router.get('/:campaignId', async (req: Request, res: Response) => {
  try {
    const identity = getBdrIdentity(req);
    if (!identity) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const campaignId = req.params.campaignId as string;

    // Verify BDR is assigned to this campaign
    const assignment = await prisma.campaignBdr.findFirst({
      where: { campaignId, slackUserId: identity.slackUserId },
    });
    if (!assignment) {
      res.status(403).json({ error: 'Not assigned to this campaign' });
      return;
    }

    // Get contacts with pending phone steps
    const pendingCalls = await prisma.campaignContactStepExecution.findMany({
      where: {
        status: StepExecutionStatus.PENDING,
        stepType: StepType.PHONE,
        campaignContact: {
          campaignId,
          status: ContactCampaignStatus.ACTIVE,
        },
      },
      include: {
        campaignContact: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            companyName: true,
            jobTitle: true,
            resolvedPhone: true,
            hubspotContactId: true,
            email: true,
            linkedinUrl: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Get campaign call script and client's HubSpot portal ID
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: {
        callScript: true,
        meetingLink: true,
        client: { select: { hubspotPortalId: true } },
      },
    });

    const clientPortalId = campaign?.client?.hubspotPortalId ?? undefined;

    const calls = pendingCalls.map((exec) => ({
      executionId: exec.id,
      contactId: exec.campaignContact.id,
      firstName: exec.campaignContact.firstName,
      lastName: exec.campaignContact.lastName,
      companyName: exec.campaignContact.companyName,
      jobTitle: exec.campaignContact.jobTitle,
      phone: exec.campaignContact.resolvedPhone,
      email: exec.campaignContact.email,
      linkedinUrl: exec.campaignContact.linkedinUrl,
      hubspotLink: exec.campaignContact.hubspotContactId
        ? buildHubSpotContactLink(exec.campaignContact.hubspotContactId, clientPortalId)
        : null,
    }));

    res.json({
      data: calls,
      callScript: campaign?.callScript ?? null,
      meetingLink: campaign?.meetingLink ?? null,
    });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to get BDR call list', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/bdr/calls/:contactId/complete
 * Marks a phone call as complete and advances the contact sequence.
 */
router.post('/:contactId/complete', async (req: Request, res: Response) => {
  try {
    const identity = getBdrIdentity(req);
    if (!identity) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const contactId = req.params.contactId as string;
    const { result, notes } = req.body;

    // Find the pending phone execution for this contact
    const execution = await prisma.campaignContactStepExecution.findFirst({
      where: {
        campaignContact: { id: contactId },
        status: StepExecutionStatus.PENDING,
        stepType: StepType.PHONE,
      },
      include: {
        campaignContact: { select: { campaignId: true } },
      },
    });

    if (!execution) {
      res.status(404).json({ error: 'No pending phone call found for this contact' });
      return;
    }

    // Mark execution as completed
    await prisma.campaignContactStepExecution.update({
      where: { id: execution.id },
      data: {
        status: StepExecutionStatus.COMPLETED,
        result: result ?? 'completed',
        completedAt: new Date(),
      },
    });

    // Track activity
    await trackActivity(
      execution.campaignContact.campaignId,
      identity.slackUserId,
      'callsCompleted',
    );

    // Advance to next step
    await advanceContact(contactId);

    res.json({ message: 'Call completed, contact advanced to next step' });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to complete BDR call', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export { router as callsRouter };
