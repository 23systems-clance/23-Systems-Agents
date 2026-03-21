/**
 * Recording Library Admin Routes (T069)
 *
 * GET  /recordings                    — List recordings with pagination and filters
 * GET  /recordings/:recordingId       — Full recording detail
 * GET  /recordings/:recordingId/audio-url — Generate S3 pre-signed URL
 */

import { Router, type Request, type Response } from 'express';
import { prisma } from '../../models/index.js';
import { generatePresignedUrl } from '../../services/dialer/recordingManager.js';
import logger from '../../lib/logger.js';

const router = Router();

/**
 * GET /recordings
 * List recordings with pagination and filters.
 * Query params: page, limit, bdrId, campaignId, clientId, disposition,
 *   minDuration, maxDuration, dateFrom, dateTo, reviewStatus, favoritesOnly
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const skip = (page - 1) * limit;

    const bdrId = req.query.bdrId as string | undefined;
    const campaignId = req.query.campaignId as string | undefined;
    const clientId = req.query.clientId as string | undefined;
    const disposition = req.query.disposition as string | undefined;
    const minDuration = req.query.minDuration ? parseInt(req.query.minDuration as string) : undefined;
    const maxDuration = req.query.maxDuration ? parseInt(req.query.maxDuration as string) : undefined;
    const dateFrom = req.query.dateFrom as string | undefined;
    const dateTo = req.query.dateTo as string | undefined;
    const reviewStatus = req.query.reviewStatus as string | undefined;
    const favoritesOnly = req.query.favoritesOnly === 'true';

    /* Build Prisma where clause. */
    const where: any = {};

    if (clientId) where.clientId = clientId;
    if (bdrId) where.bdrId = bdrId;
    if (favoritesOnly) where.isFavorited = true;
    if (reviewStatus) where.reviewStatus = reviewStatus;

    if (minDuration !== undefined || maxDuration !== undefined) {
      where.durationSeconds = {};
      if (minDuration !== undefined) where.durationSeconds.gte = minDuration;
      if (maxDuration !== undefined) where.durationSeconds.lte = maxDuration;
    }

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    /* Filter by disposition or campaignId via the related callSession. */
    if (disposition || campaignId) {
      where.callSession = {};
      if (disposition) where.callSession.disposition = disposition;
      if (campaignId) {
        where.callSession.dialerSession = { campaignId };
      }
    }

    const [recordings, total] = await Promise.all([
      (prisma as any).callRecording.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          callSession: {
            include: {
              dialerSession: {
                include: { bdr: { select: { id: true, name: true } } },
              },
            },
          },
        },
      }),
      (prisma as any).callRecording.count({ where }),
    ]);

    const mapped = (recordings as any[]).map((rec: any) => ({
      id: rec.id,
      callSessionId: rec.callSessionId,
      bdrName: rec.callSession?.dialerSession?.bdr?.name ?? null,
      contactName: rec.callSession?.contactName ?? null,
      contactPhone: rec.callSession?.contactPhone ?? null,
      companyName: rec.callSession?.companyName ?? null,
      disposition: rec.callSession?.disposition ?? null,
      durationSeconds: rec.durationSeconds,
      isFavorited: rec.isFavorited,
      reviewStatus: rec.reviewStatus,
      createdAt: rec.createdAt,
      hasTranscript: rec.transcriptJson !== null || rec.transcript !== null,
    }));

    res.json({
      recordings: mapped,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error: any) {
    logger.error('[Recordings] Failed to list recordings', { error: error.message });
    res.status(500).json({ error: 'Failed to list recordings' });
  }
});

/**
 * GET /recordings/:recordingId
 * Full recording detail including call session, transcript, and coaching notes.
 */
router.get('/:recordingId', async (req: Request, res: Response) => {
  try {
    const { recordingId } = req.params;

    const recording = await (prisma as any).callRecording.findUnique({
      where: { id: recordingId },
      include: {
        callSession: {
          include: {
            dialerSession: {
              include: { bdr: { select: { id: true, name: true } } },
            },
          },
        },
        coachingNotes: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!recording) {
      res.status(404).json({ error: 'Recording not found' });
      return;
    }

    /* Parse transcript lines from transcriptJson if available. */
    let transcript: any[] = [];
    if (recording.transcriptJson) {
      try {
        const raw = typeof recording.transcriptJson === 'string'
          ? JSON.parse(recording.transcriptJson)
          : recording.transcriptJson;
        transcript = Array.isArray(raw) ? raw : [];
      } catch {
        transcript = [];
      }
    }

    res.json({
      id: recording.id,
      callSessionId: recording.callSessionId,
      bdrName: recording.callSession?.dialerSession?.bdr?.name ?? null,
      callSession: recording.callSession,
      durationSeconds: recording.durationSeconds,
      fileSizeBytes: recording.fileSizeBytes,
      transcriptionStatus: recording.transcriptionStatus,
      isFavorited: recording.isFavorited,
      reviewStatus: recording.reviewStatus,
      createdAt: recording.createdAt,
      transcript,
      coachingNotes: recording.coachingNotes,
    });
  } catch (error: any) {
    logger.error('[Recordings] Failed to get recording detail', {
      recordingId: req.params.recordingId,
      error: error.message,
    });
    res.status(500).json({ error: 'Failed to get recording detail' });
  }
});

/**
 * GET /recordings/:recordingId/audio-url
 * Generate a pre-signed S3 URL for streaming/downloading the recording audio.
 */
router.get('/:recordingId/audio-url', async (req: Request, res: Response) => {
  try {
    const { recordingId } = req.params;

    const recording = await (prisma as any).callRecording.findUnique({
      where: { id: recordingId },
      select: { callSessionId: true },
    });

    if (!recording) {
      res.status(404).json({ error: 'Recording not found' });
      return;
    }

    const url = await generatePresignedUrl(recording.callSessionId);
    res.json({ url });
  } catch (error: any) {
    logger.error('[Recordings] Failed to generate audio URL', {
      recordingId: req.params.recordingId,
      error: error.message,
    });
    res.status(500).json({ error: 'Failed to generate audio URL' });
  }
});

export { router as recordingsRouter };
