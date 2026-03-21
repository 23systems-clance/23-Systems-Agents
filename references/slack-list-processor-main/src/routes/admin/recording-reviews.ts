/**
 * Recording Review Admin Routes (T070)
 *
 * POST /recordings/:recordingId/favorite       — Toggle isFavorited
 * POST /recordings/:recordingId/review         — Set reviewStatus
 * POST /recordings/:recordingId/coaching-notes — Add a coaching note
 */

import { Router, type Request, type Response } from 'express';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

const router = Router();

/**
 * POST /recordings/:recordingId/favorite
 * Toggle the isFavorited boolean on a call recording.
 */
router.post('/:recordingId/favorite', async (req: Request, res: Response) => {
  try {
    const { recordingId } = req.params;

    const recording = await (prisma as any).callRecording.findUnique({
      where: { id: recordingId },
      select: { isFavorited: true },
    });

    if (!recording) {
      res.status(404).json({ error: 'Recording not found' });
      return;
    }

    const updated = await (prisma as any).callRecording.update({
      where: { id: recordingId },
      data: { isFavorited: !recording.isFavorited },
      select: { isFavorited: true },
    });

    res.json({ isFavorited: updated.isFavorited });
  } catch (error: any) {
    logger.error('[RecordingReviews] Failed to toggle favorite', {
      recordingId: req.params.recordingId,
      error: error.message,
    });
    res.status(500).json({ error: 'Failed to toggle favorite' });
  }
});

/**
 * POST /recordings/:recordingId/review
 * Set the reviewStatus on a call recording.
 * Body: { status: 'FLAGGED' | 'REVIEWED' | null }
 */
router.post('/:recordingId/review', async (req: Request, res: Response) => {
  try {
    const { recordingId } = req.params;
    const { status } = req.body;

    const validStatuses = ['FLAGGED', 'REVIEWED', null];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ error: 'status must be FLAGGED, REVIEWED, or null' });
      return;
    }

    const recording = await (prisma as any).callRecording.findUnique({
      where: { id: recordingId },
      select: { id: true },
    });

    if (!recording) {
      res.status(404).json({ error: 'Recording not found' });
      return;
    }

    const updated = await (prisma as any).callRecording.update({
      where: { id: recordingId },
      data: {
        reviewStatus: status ?? 'NONE',
        reviewedAt: status ? new Date() : null,
      },
      select: { reviewStatus: true },
    });

    res.json({ reviewStatus: updated.reviewStatus });
  } catch (error: any) {
    logger.error('[RecordingReviews] Failed to set review status', {
      recordingId: req.params.recordingId,
      error: error.message,
    });
    res.status(500).json({ error: 'Failed to set review status' });
  }
});

/**
 * POST /recordings/:recordingId/coaching-notes
 * Add a coaching note linked to a recording.
 * Body: { content: string, timestampSeconds?: number }
 */
router.post('/:recordingId/coaching-notes', async (req: Request, res: Response) => {
  try {
    const { recordingId } = req.params;
    const { content, timestampSeconds } = req.body;
    const adminUser = (req as any).adminUser;

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      res.status(400).json({ error: 'content is required and must be a non-empty string' });
      return;
    }

    const recording = await (prisma as any).callRecording.findUnique({
      where: { id: recordingId },
      select: { id: true },
    });

    if (!recording) {
      res.status(404).json({ error: 'Recording not found' });
      return;
    }

    const note = await (prisma as any).coachingNote.create({
      data: {
        recordingId,
        authorId: adminUser?.id ?? 'unknown',
        authorName: adminUser?.name ?? adminUser?.email ?? 'Admin',
        content: content.trim(),
        timestampSeconds: timestampSeconds != null ? parseInt(String(timestampSeconds)) : null,
      },
    });

    res.status(201).json(note);
  } catch (error: any) {
    logger.error('[RecordingReviews] Failed to add coaching note', {
      recordingId: req.params.recordingId,
      error: error.message,
    });
    res.status(500).json({ error: 'Failed to add coaching note' });
  }
});

export { router as recordingReviewsRouter };
