/**
 * Deepgram Webhook Router (T052)
 * Handles async transcription callbacks from Deepgram Nova-2.
 *
 * Endpoints:
 * - POST /transcript — Receives completed transcript JSON
 */

import { Router, type Request, type Response } from 'express';
import { handleTranscriptCallback } from '../../services/dialer/transcriptionService.js';
import { generatePermalink } from '../../services/dialer/recordingManager.js';
import { updateCrmWithTranscript } from '../../services/dialer/transcriptionService.js';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

const router = Router();

/**
 * POST /transcript (T052)
 * Receives completed transcript JSON from Deepgram callback.
 * Matches to CallRecording by callRecordingId query param.
 * Stores transcript, updates transcriptionStatus, triggers deferred CRM sync.
 */
router.post('/transcript', async (req: Request, res: Response) => {
  try {
    const callRecordingId = req.query.callRecordingId as string;

    if (!callRecordingId) {
      logger.warn('[Deepgram Webhook] Missing callRecordingId query param');
      res.status(400).json({ error: 'callRecordingId required' });
      return;
    }

    logger.info('[Deepgram Webhook] /transcript received', {
      callRecordingId,
      hasResults: !!req.body?.results,
    });

    // Process the transcript callback
    const formattedTranscript = await handleTranscriptCallback(callRecordingId, req.body);

    // Look up the CallRecording to get callSessionId for CRM sync
    const recording = await prisma.callRecording.findUnique({
      where: { id: callRecordingId },
    });

    if (recording && formattedTranscript) {
      const callSessionId = (recording as any).callSessionId;
      const recordingUrl = generatePermalink(callSessionId);

      // Trigger deferred CRM sync — update HubSpot engagement with recording URL + transcript
      updateCrmWithTranscript(callSessionId, recordingUrl, formattedTranscript).catch((err) => {
        logger.error('[Deepgram Webhook] Failed to enqueue CRM transcript sync', {
          callRecordingId,
          error: err.message,
        });
      });
    }

    res.status(200).json({ ok: true });
  } catch (error: any) {
    logger.error('[Deepgram Webhook] /transcript error', { error: error.message });
    res.status(200).json({ ok: true }); // 200 to prevent Deepgram retries
  }
});

export { router as deepgramWebhookRouter };
