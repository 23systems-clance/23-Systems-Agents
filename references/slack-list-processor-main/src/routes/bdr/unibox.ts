/**
 * BDR UniBox routes.
 *
 * Provides unified inbox access for email and LinkedIn replies
 * across the BDR's assigned campaigns.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import { CampaignStatus, ReplyChannel, SmartReplyDraftStatus } from '@prisma/client';
import { prisma } from '../../models/index.js';
import { getBdrIdentity } from '../../lib/bdrAuth.js';
import {
  getUniboxReplies,
  markReplyAsRead,
  replyToUniboxEmail,
} from '../../services/campaign/unibox.js';
import { smartReplyQueue } from '../../services/queue/queues.js';
import logger from '../../lib/logger.js';

/** Multer config: memory storage, max 5 files, 10MB each. */
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'image/gif',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
  },
});

const VALID_TONES = ['professional', 'casual', 'assertive', 'empathetic'] as const;

const router = Router();

/**
 * GET /api/v1/bdr/unibox
 * Lists UniBox replies for the BDR's campaigns.
 * Query params: campaignId, channel, isRead, page, limit
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const identity = getBdrIdentity(req);
    if (!identity) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    // Get campaign IDs this BDR is assigned to
    const assignments = await prisma.campaignBdr.findMany({
      where: {
        slackUserId: identity.slackUserId,
        campaign: { status: { in: [CampaignStatus.ACTIVE, CampaignStatus.PAUSED] } },
      },
      select: { campaignId: true },
    });

    const campaignIds = assignments.map((a) => a.campaignId);

    if (campaignIds.length === 0) {
      res.json({ data: [], total: 0 });
      return;
    }

    const result = await getUniboxReplies(campaignIds, {
      campaignId: req.query.campaignId as string | undefined,
      channel: req.query.channel as ReplyChannel | undefined,
      isRead: req.query.isRead !== undefined ? req.query.isRead === 'true' : undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });

    res.json(result);
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to get UniBox replies', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/bdr/unibox/:replyId/respond
 * Replies to an email via Instantly API. Supports multipart/form-data with file attachments.
 */
router.post('/:replyId/respond', upload.array('attachments', 5), async (req: Request, res: Response) => {
  try {
    const identity = getBdrIdentity(req);
    if (!identity) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const replyId = req.params.replyId as string;
    const { body } = req.body;

    if (!body?.trim()) {
      res.status(400).json({ error: 'Reply body is required' });
      return;
    }

    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length > 0) {
      logger.info('Reply includes file attachments', {
        replyId,
        fileCount: files.length,
        fileNames: files.map((f) => f.originalname),
      });
    }

    await replyToUniboxEmail(replyId, body);

    res.json({ message: 'Reply sent successfully' });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to send UniBox reply', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/v1/bdr/unibox/:replyId/read
 * Marks a reply as read.
 */
router.patch('/:replyId/read', async (req: Request, res: Response) => {
  try {
    const replyId = req.params.replyId as string;
    await markReplyAsRead(replyId);
    res.json({ message: 'Marked as read' });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to mark reply as read', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/v1/bdr/unibox/:replyId/draft/accept
 * Accepts a smart reply draft and sends it (optionally with edited body).
 * Supports multipart/form-data with file attachments.
 */
router.patch('/:replyId/draft/accept', upload.array('attachments', 5), async (req: Request, res: Response) => {
  try {
    const identity = getBdrIdentity(req);
    if (!identity) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const replyId = req.params.replyId as string;
    const { body } = req.body;

    const reply = await prisma.uniboxReply.findUnique({
      where: { id: replyId },
    });

    if (!reply) {
      res.status(404).json({ error: 'Reply not found' });
      return;
    }

    if (reply.draftStatus !== SmartReplyDraftStatus.READY) {
      res.status(400).json({ error: 'Draft is not ready for acceptance' });
      return;
    }

    const sendBody = body?.trim() || reply.draftBody;
    if (!sendBody) {
      res.status(400).json({ error: 'No draft body available to send' });
      return;
    }

    // Send via existing Instantly reply mechanism
    await replyToUniboxEmail(replyId, sendBody);

    // Update draft status to SENT
    await prisma.uniboxReply.update({
      where: { id: replyId },
      data: {
        draftStatus: SmartReplyDraftStatus.SENT,
        draftBody: sendBody,
      },
    });

    logger.info('Smart reply draft accepted and sent', {
      replyId,
      bdr: identity.slackUserId,
      edited: !!body?.trim(),
    });

    res.json({ message: 'Draft accepted and sent' });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to accept draft', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/v1/bdr/unibox/:replyId/draft/dismiss
 * Dismisses a smart reply draft (marks as REJECTED).
 */
router.patch('/:replyId/draft/dismiss', async (req: Request, res: Response) => {
  try {
    const identity = getBdrIdentity(req);
    if (!identity) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const replyId = req.params.replyId as string;

    const reply = await prisma.uniboxReply.findUnique({
      where: { id: replyId },
    });

    if (!reply) {
      res.status(404).json({ error: 'Reply not found' });
      return;
    }

    await prisma.uniboxReply.update({
      where: { id: replyId },
      data: { draftStatus: SmartReplyDraftStatus.REJECTED },
    });

    logger.info('Smart reply draft dismissed', {
      replyId,
      bdr: identity.slackUserId,
    });

    res.json({ message: 'Draft dismissed' });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to dismiss draft', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/bdr/unibox/:replyId/draft/regenerate
 * Regenerates a smart reply draft with a specified tone.
 */
router.post('/:replyId/draft/regenerate', async (req: Request, res: Response) => {
  try {
    const identity = getBdrIdentity(req);
    if (!identity) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const replyId = req.params.replyId as string;
    const { tone } = req.body;

    if (!tone || !VALID_TONES.includes(tone)) {
      res.status(400).json({ error: `Invalid tone. Must be one of: ${VALID_TONES.join(', ')}` });
      return;
    }

    const reply = await prisma.uniboxReply.findUnique({
      where: { id: replyId },
    });

    if (!reply) {
      res.status(404).json({ error: 'Reply not found' });
      return;
    }

    // Set status to GENERATING and clear previous draft error
    await prisma.uniboxReply.update({
      where: { id: replyId },
      data: {
        draftStatus: SmartReplyDraftStatus.GENERATING,
        draftError: null,
      },
    });

    // Enqueue regeneration job with tone
    const job = await smartReplyQueue.add('regenerate-draft', { replyId, tone });

    logger.info('Smart reply draft regeneration requested', {
      replyId,
      tone,
      jobId: job.id,
      bdr: identity.slackUserId,
    });

    res.json({ success: true, jobId: job.id });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to regenerate draft', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export { router as uniboxRouter };
