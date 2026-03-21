/**
 * Campaign REST API routes (Feature 6).
 *
 * Provides CRUD and lifecycle management for outreach campaigns.
 * Auth: X-API-Key header (same as existing apiKeyAuth).
 */

import { Router, type Request, type Response } from 'express';
import {
  createCampaign,
  updateCampaign,
  getCampaignDetail,
  listCampaigns,
  activateCampaign,
  pauseCampaign,
  resumeCampaign,
  validateCampaignForActivation,
} from '../services/campaign/campaignService.js';
import { campaignQueue } from '../services/queue/queues.js';
import logger from '../lib/logger.js';

const router = Router();

/**
 * POST /api/v1/campaigns
 * Create a new campaign. Optionally auto-activate with `autoActivate: true`.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const campaign = await createCampaign(req.body);

    // If autoActivate is requested, validate and activate
    if (req.body.autoActivate) {
      const validation = await validateCampaignForActivation(campaign.id);
      if (!validation.valid) {
        res.status(400).json({
          error: 'Campaign created but auto-activation failed',
          campaignId: campaign.id,
          validationErrors: validation.errors,
        });
        return;
      }

      const activated = await activateCampaign(campaign.id);

      // Enqueue contact import
      await campaignQueue.add('campaign-import', { campaignId: campaign.id });

      res.status(201).json({ data: activated, activated: true });
      return;
    }

    res.status(201).json({ data: campaign });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to create campaign', { error: error.message });
    const statusCode = 'statusCode' in error ? (error as { statusCode: number }).statusCode : 500;
    res.status(statusCode).json({ error: error.message });
  }
});

/**
 * GET /api/v1/campaigns
 * List campaigns for a workspace (paginated).
 * Query params: slackTeamId (required), status, campaignType, search, page, limit
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const slackTeamId = req.query.slackTeamId as string;
    if (!slackTeamId) {
      res.status(400).json({ error: 'slackTeamId query parameter is required' });
      return;
    }

    const result = await listCampaigns(slackTeamId, {
      status: req.query.status as string | undefined as import('@prisma/client').CampaignStatus | undefined,
      campaignType: req.query.campaignType as string | undefined as import('@prisma/client').CampaignType | undefined,
      search: req.query.search as string | undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });

    res.json(result);
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to list campaigns', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/campaigns/:id
 * Get campaign detail with sequence steps and BDR assignments.
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const campaign = await getCampaignDetail(req.params.id as string);
    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }
    res.json({ data: campaign });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to get campaign', { error: error.message, campaignId: req.params.id as string });
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/v1/campaigns/:id
 * Update campaign fields. Only allowed in DRAFT or PAUSED status.
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const campaign = await updateCampaign(req.params.id as string, req.body);
    res.json({ data: campaign });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to update campaign', { error: error.message, campaignId: req.params.id as string });
    const statusCode = 'statusCode' in error ? (error as { statusCode: number }).statusCode : 500;
    res.status(statusCode).json({ error: error.message });
  }
});

/**
 * POST /api/v1/campaigns/:id/activate
 * Validate and activate a DRAFT campaign. Enqueues contact import.
 */
router.post('/:id/activate', async (req: Request, res: Response) => {
  try {
    const campaign = await activateCampaign(req.params.id as string);

    // Enqueue contact import job
    await campaignQueue.add('campaign-import', { campaignId: req.params.id as string });

    res.json({ data: campaign, message: 'Campaign activated. Contact import started.' });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to activate campaign', { error: error.message, campaignId: req.params.id as string });
    const statusCode = 'statusCode' in error ? (error as { statusCode: number }).statusCode : 500;
    res.status(statusCode).json({ error: error.message });
  }
});

/**
 * POST /api/v1/campaigns/:id/pause
 * Pause an ACTIVE campaign.
 */
router.post('/:id/pause', async (req: Request, res: Response) => {
  try {
    const campaign = await pauseCampaign(req.params.id as string);
    res.json({ data: campaign, message: 'Campaign paused.' });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to pause campaign', { error: error.message, campaignId: req.params.id as string });
    const statusCode = 'statusCode' in error ? (error as { statusCode: number }).statusCode : 500;
    res.status(statusCode).json({ error: error.message });
  }
});

/**
 * POST /api/v1/campaigns/:id/resume
 * Resume a PAUSED campaign.
 */
router.post('/:id/resume', async (req: Request, res: Response) => {
  try {
    const campaign = await resumeCampaign(req.params.id as string);
    res.json({ data: campaign, message: 'Campaign resumed.' });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to resume campaign', { error: error.message, campaignId: req.params.id as string });
    const statusCode = 'statusCode' in error ? (error as { statusCode: number }).statusCode : 500;
    res.status(statusCode).json({ error: error.message });
  }
});

export { router as campaignRouter };
