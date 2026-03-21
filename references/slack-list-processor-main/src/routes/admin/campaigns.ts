/**
 * Admin campaign management routes.
 *
 * Provides campaign list, detail with funnel, contact listing,
 * BDR activity summary, and EOD report history.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { CampaignStatus, ContactCampaignStatus } from '@prisma/client';
import { prisma } from '../../models/index.js';
import {
  getCampaignStats,
  getStepFunnel,
  getBdrActivitySummary,
  getContactQualityStats,
} from '../../services/campaign/statsAggregator.js';
import {
  listCampaigns,
  getCampaignDetail,
  createCampaign,
  updateCampaign,
  activateCampaign,
  pauseCampaign,
  resumeCampaign,
  validateCampaignForActivation,
  deleteCampaign,
  archiveCampaign,
} from '../../services/campaign/campaignService.js';
import { campaignQueue } from '../../services/queue/queues.js';
import { pushPersonalityToHubSpot } from '../../services/campaign/personalityCrmSync.js';
import { logAudit } from '../../lib/auditLogger.js';
import logger from '../../lib/logger.js';

const router = Router();

/**
 * GET /api/v1/admin/campaigns
 * List all campaigns with status filters.
 * Query: slackTeamId (required), status, campaignType, search, page, limit
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const slackTeamId = req.query.slackTeamId as string;
    if (!slackTeamId) {
      res.status(400).json({ error: 'slackTeamId query parameter is required' });
      return;
    }

    const result = await listCampaigns(slackTeamId, {
      status: req.query.status as CampaignStatus | undefined,
      campaignType: req.query.campaignType as string | undefined as import('@prisma/client').CampaignType | undefined,
      search: req.query.search as string | undefined,
      clientId: req.query.clientId as string | undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });

    res.json(result);
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to list admin campaigns', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/admin/campaigns/:id
 * Campaign detail with full stats and step funnel.
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const campaignId = req.params.id as string;
    const [detail, stats, funnel, contactQuality] = await Promise.all([
      getCampaignDetail(campaignId),
      getCampaignStats(campaignId),
      getStepFunnel(campaignId),
      getContactQualityStats(campaignId),
    ]);

    if (!detail) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    // Include client info
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: {
        client: { select: { id: true, name: true, slug: true, isActive: true } },
      },
    });

    res.json({ data: { ...detail, stats, funnel, contactQuality, client: campaign?.client ?? null } });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to get admin campaign detail', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/admin/campaigns/:id/contacts
 * Contact list with sequence progress for a campaign.
 * Query: status, page, limit
 */
router.get('/:id/contacts', async (req: Request, res: Response) => {
  try {
    const campaignId = req.params.id as string;
    const page = req.query.page ? Number(req.query.page) : 1;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { campaignId };
    if (req.query.status) {
      where.status = req.query.status as ContactCampaignStatus;
    }

    const [contacts, total] = await Promise.all([
      prisma.campaignContact.findMany({
        where,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          companyName: true,
          jobTitle: true,
          status: true,
          currentStepIndex: true,
          canEmail: true,
          canCall: true,
          canLinkedin: true,
          startedAt: true,
          completedAt: true,
          lastActivityAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.campaignContact.count({ where }),
    ]);

    res.json({
      data: contacts,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to list campaign contacts', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/admin/campaigns/:id/contacts
 * Manually add a single contact to a campaign with a PENDING phone step.
 * Body: { firstName, lastName, companyName?, jobTitle?, phone?, email?, linkedinUrl? }
 */
router.post('/:id/contacts', async (req: Request, res: Response) => {
  try {
    const campaignId = req.params.id as string;
    const { firstName, lastName, companyName, jobTitle, phone, email, linkedinUrl } = req.body;

    if (!firstName || !lastName) {
      res.status(400).json({ error: 'firstName and lastName are required' });
      return;
    }

    // Verify campaign exists
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    // Create CampaignContact + PENDING PHONE step execution in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const contact = await tx.campaignContact.create({
        data: {
          campaignId,
          firstName,
          lastName,
          companyName: companyName ?? null,
          jobTitle: jobTitle ?? null,
          mobilePhone: phone ?? null,
          resolvedPhone: phone ?? null,
          email: email ?? null,
          linkedinUrl: linkedinUrl ?? null,
          canCall: !!phone,
          canEmail: !!email,
          canLinkedin: !!linkedinUrl,
          status: ContactCampaignStatus.ACTIVE,
        },
      });

      // Create a PENDING PHONE step execution so it shows in the call list
      const stepExecution = await tx.campaignContactStepExecution.create({
        data: {
          campaignContactId: contact.id,
          stepIndex: 0,
          stepType: 'PHONE' as any,
          status: 'PENDING' as any,
        },
      });

      // Update campaign contact counts
      await tx.campaign.update({
        where: { id: campaignId },
        data: {
          totalContacts: { increment: 1 },
          activeContacts: { increment: 1 },
        },
      });

      return { contact, stepExecution };
    });

    logger.info('[Campaigns] Contact manually added', {
      campaignId,
      contactId: result.contact.id,
      name: `${firstName} ${lastName}`,
    });

    res.status(201).json({
      data: {
        contactId: result.contact.id,
        executionId: result.stepExecution.id,
        name: `${firstName} ${lastName}`,
        phone,
        companyName,
      },
    });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to add contact to campaign', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/admin/campaigns/:id/quality
 * Contact quality breakdown for a campaign.
 */
router.get('/:id/quality', async (req: Request, res: Response) => {
  try {
    const campaignId = req.params.id as string;
    const quality = await getContactQualityStats(campaignId);
    res.json({ data: quality });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to get contact quality stats', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/admin/campaigns
 * Create a new campaign.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const input = req.body;
    if (!input.slackTeamId || !input.name || !input.campaignType) {
      res.status(400).json({ error: 'slackTeamId, name, and campaignType are required' });
      return;
    }
    const campaign = await createCampaign(input);
    res.status(201).json({ data: campaign });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to create campaign', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

/**
 * PATCH /api/v1/admin/campaigns/:id
 * Update a campaign (DRAFT or PAUSED only).
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const campaignId = req.params.id as string;
    const campaign = await updateCampaign(campaignId, req.body);
    logAudit({
      action: 'campaign_updated',
      actorUserId: req.admin?.id ?? 'unknown',
      targetType: 'Campaign',
      targetId: campaignId,
      metadata: { fields: Object.keys(req.body) },
    }).catch(() => {});
    res.json({ data: campaign });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to update campaign', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/v1/admin/campaigns/:id/activate
 * Activate a DRAFT campaign and start contact import.
 */
router.post('/:id/activate', async (req: Request, res: Response) => {
  try {
    const campaignId = req.params.id as string;

    // Pre-validate and return detailed errors
    const validation = await validateCampaignForActivation(campaignId);
    if (!validation.valid) {
      res.status(400).json({
        error: `Campaign cannot be activated: ${validation.errors.join('; ')}`,
        validationErrors: validation.errors,
      });
      return;
    }

    const campaign = await activateCampaign(campaignId);
    await campaignQueue.add('campaign-import', { campaignId });
    logAudit({
      action: 'campaign_activated',
      actorUserId: req.admin?.id ?? 'unknown',
      targetType: 'Campaign',
      targetId: campaignId,
    }).catch(() => {});
    res.json({ data: campaign, message: 'Campaign activated. Contact import started.' });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to activate campaign', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/v1/admin/campaigns/:id/pause
 * Pause an ACTIVE campaign.
 */
router.post('/:id/pause', async (req: Request, res: Response) => {
  try {
    const campaignId = req.params.id as string;
    const campaign = await pauseCampaign(campaignId);
    res.json({ data: campaign, message: 'Campaign paused.' });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to pause campaign', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/v1/admin/campaigns/:id/resume
 * Resume a PAUSED campaign.
 */
router.post('/:id/resume', async (req: Request, res: Response) => {
  try {
    const campaignId = req.params.id as string;
    const campaign = await resumeCampaign(campaignId);
    res.json({ data: campaign, message: 'Campaign resumed.' });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to resume campaign', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

/**
 * DELETE /api/v1/admin/campaigns/:id
 * Delete (DRAFT with 0 contacts) or archive a campaign.
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const campaignId = req.params.id as string;
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { status: true, _count: { select: { contacts: true } } },
    });

    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    // Hard delete for DRAFT campaigns with 0 contacts
    if (campaign.status === 'DRAFT' && campaign._count.contacts === 0) {
      await deleteCampaign(campaignId);
      logAudit({
        action: 'campaign_deleted',
        actorUserId: req.admin?.id ?? 'unknown',
        targetType: 'Campaign',
        targetId: campaignId,
        metadata: { previousStatus: campaign.status },
      }).catch(() => {});
      res.json({ message: 'Campaign permanently deleted' });
      return;
    }

    // Archive for all other cases
    const archived = await archiveCampaign(campaignId);
    logAudit({
      action: 'campaign_archived',
      actorUserId: req.admin?.id ?? 'unknown',
      targetType: 'Campaign',
      targetId: campaignId,
      metadata: { previousStatus: campaign.status },
    }).catch(() => {});
    res.json({ data: archived, message: 'Campaign archived' });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to delete/archive campaign', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/v1/admin/campaigns/:id/personality/push-crm
 * Pushes personality data to HubSpot for campaign contacts.
 */
router.post('/:id/personality/push-crm', async (req: Request, res: Response) => {
  try {
    const campaignId = req.params.id as string;
    const summary = await pushPersonalityToHubSpot(campaignId);
    res.json(summary);
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to push personality to CRM', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/admin/campaigns/:id/personality/export-csv
 * Exports personality data as CSV for campaign contacts.
 */
router.get('/:id/personality/export-csv', async (req: Request, res: Response) => {
  try {
    const campaignId = req.params.id as string;

    const contacts = await prisma.campaignContact.findMany({
      where: { campaignId },
      select: {
        firstName: true,
        lastName: true,
        email: true,
        companyName: true,
        jobTitle: true,
        linkedinUrl: true,
        personalityData: true,
      },
      orderBy: { lastName: 'asc' },
    });

    const CSV_HEADERS = [
      'firstName', 'lastName', 'email', 'companyName', 'jobTitle', 'linkedinUrl',
      'archetype', 'disc_dominance', 'disc_influence', 'disc_steadiness', 'disc_calculativeness',
      'ocean_openness', 'ocean_conscientiousness', 'ocean_extraversion', 'ocean_agreeableness', 'ocean_emotional_stability',
      'communication_types', 'communication_adjectives', 'what_to_say', 'what_to_avoid',
      'key_traits_risk', 'key_traits_decision_drivers', 'email_tone', 'email_length',
    ];

    const escCsv = (val: unknown): string => {
      if (val == null) return '';
      const s = String(val);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const rows = [CSV_HEADERS.join(',')];

    for (const c of contacts) {
      const pd = c.personalityData as Record<string, unknown> | null;
      const archetype = pd?.archetype as Record<string, unknown> | undefined;
      const disc = pd?.disc as Record<string, number> | undefined;
      const ocean = pd?.ocean as Record<string, number> | undefined;
      const comm = pd?.communication as Record<string, unknown> | undefined;
      const keyTraits = pd?.key_traits as Record<string, unknown> | undefined;
      const emailApproach = pd?.email_approach as Record<string, unknown> | undefined;

      rows.push([
        escCsv(c.firstName), escCsv(c.lastName), escCsv(c.email),
        escCsv(c.companyName), escCsv(c.jobTitle), escCsv(c.linkedinUrl),
        escCsv(archetype?.name),
        escCsv(disc?.dominance), escCsv(disc?.influence), escCsv(disc?.steadiness), escCsv(disc?.calculativeness),
        escCsv(ocean?.openness), escCsv(ocean?.conscientiousness), escCsv(ocean?.extraversion), escCsv(ocean?.agreeableness), escCsv(ocean?.emotional_stability),
        escCsv(Array.isArray(comm?.types) ? (comm!.types as string[]).join('; ') : ''),
        escCsv(Array.isArray(comm?.adjectives) ? (comm!.adjectives as string[]).join('; ') : ''),
        escCsv(Array.isArray(comm?.what_to_say) ? (comm!.what_to_say as string[]).join('; ') : ''),
        escCsv(Array.isArray(comm?.what_to_avoid) ? (comm!.what_to_avoid as string[]).join('; ') : ''),
        escCsv(keyTraits?.risk_tolerance),
        escCsv(Array.isArray(keyTraits?.decision_drivers) ? (keyTraits!.decision_drivers as string[]).join('; ') : ''),
        escCsv(emailApproach?.tone), escCsv(emailApproach?.length),
      ].join(','));
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="personality-export-${campaignId}.csv"`);
    res.send(rows.join('\n'));
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to export personality CSV', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/admin/campaigns/:id/smart-reply-metrics
 * Returns draft acceptance/dismissal metrics (SC-002, SC-004).
 */
router.get('/:id/smart-reply-metrics', async (req: Request, res: Response) => {
  try {
    const campaignId = req.params.id as string;

    const [sent, rejected, ready, generating, failed, total] = await Promise.all([
      prisma.uniboxReply.count({ where: { campaignId, draftStatus: 'SENT' } }),
      prisma.uniboxReply.count({ where: { campaignId, draftStatus: 'REJECTED' } }),
      prisma.uniboxReply.count({ where: { campaignId, draftStatus: 'READY' } }),
      prisma.uniboxReply.count({ where: { campaignId, draftStatus: 'GENERATING' } }),
      prisma.uniboxReply.count({ where: { campaignId, draftStatus: 'FAILED' } }),
      prisma.uniboxReply.count({ where: { campaignId, draftStatus: { not: null } } }),
    ]);

    const acceptanceRate = sent + rejected > 0 ? Math.round((sent / (sent + rejected)) * 100) : 0;

    res.json({
      data: {
        sent,
        rejected,
        ready,
        generating,
        failed,
        total,
        acceptanceRate,
      },
    });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to get smart reply metrics', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export { router as campaignAdminRouter };

// ---------------------------------------------------------------------------
// Standalone admin routes (mounted at /api/v1/admin level, NOT under /campaigns)
// ---------------------------------------------------------------------------

const bdrActivityRouter = Router();

/**
 * GET /api/v1/admin/bdr-activity
 * Manager view: all BDRs activity summary.
 * Query: slackTeamId (required), days (default 7)
 */
bdrActivityRouter.get('/', async (req: Request, res: Response) => {
  try {
    const slackTeamId = req.query.slackTeamId as string;
    if (!slackTeamId) {
      res.status(400).json({ error: 'slackTeamId query parameter is required' });
      return;
    }

    const days = req.query.days ? Number(req.query.days) : 7;
    const summary = await getBdrActivitySummary(slackTeamId, days);

    res.json({ data: summary });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to get BDR activity summary', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export { bdrActivityRouter };

const eodReportsAdminRouter = Router();

/**
 * GET /api/v1/admin/eod-reports
 * EOD report history.
 * Query: slackTeamId (required), slackUserId, page, limit
 */
eodReportsAdminRouter.get('/', async (req: Request, res: Response) => {
  try {
    const slackTeamId = req.query.slackTeamId as string;
    if (!slackTeamId) {
      res.status(400).json({ error: 'slackTeamId query parameter is required' });
      return;
    }

    const page = req.query.page ? Number(req.query.page) : 1;
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { slackTeamId };
    if (req.query.slackUserId) {
      where.slackUserId = req.query.slackUserId as string;
    }

    const [reports, total] = await Promise.all([
      prisma.eodReport.findMany({
        where,
        orderBy: { date: 'desc' },
        skip,
        take: limit,
      }),
      prisma.eodReport.count({ where }),
    ]);

    res.json({
      data: reports,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to list EOD reports', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export { eodReportsAdminRouter };
