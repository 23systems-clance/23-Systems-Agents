/**
 * Recording Routes (T054)
 * GET /recordings/:callSessionId/audio — Permalink redirect to S3 presigned URL
 */

import { Router, type Request, type Response } from 'express';
import { generatePresignedUrl } from '../../services/dialer/recordingManager.js';
import logger from '../../lib/logger.js';

const router = Router();

/**
 * GET /recordings/:callSessionId/audio
 * Recording permalink — generates a presigned S3 URL and returns 302 redirect.
 * Used by HubSpot CRM and admin dashboard to access recording audio.
 */
router.get('/:callSessionId/audio', async (req: Request, res: Response) => {
  try {
    const callSessionId = req.params.callSessionId as string;
    const url = await generatePresignedUrl(callSessionId);

    if (!url) {
      res.status(404).json({ error: 'Recording not found' });
      return;
    }

    res.redirect(302, url);
  } catch (error: any) {
    logger.error('[Recordings] Failed to generate presigned URL', {
      callSessionId: req.params.callSessionId,
      error: error.message,
    });
    res.status(404).json({ error: 'Recording not found' });
  }
});

export { router as recordingsRouter };
