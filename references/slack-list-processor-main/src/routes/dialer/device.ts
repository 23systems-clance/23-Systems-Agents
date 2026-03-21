/**
 * Dialer Device Preferences Routes (T061)
 *
 * POST /device/preferences — Save mic/speaker device IDs per BDR
 * GET  /device/preferences — Load saved preferences
 */

import { Router, type Request, type Response } from 'express';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

const router = Router();

/**
 * GET /device/preferences
 * Load saved mic/speaker preferences for the authenticated BDR.
 */
router.get('/preferences', async (req: Request, res: Response) => {
  try {
    const bdrId = (req as any).bdrId as string;
    if (!bdrId) {
      res.status(401).json({ error: 'BDR authentication required' });
      return;
    }

    // Look up saved preferences from BDR record metadata
    const bdr: any = await prisma.bdr.findUnique({
      where: { id: bdrId },
      select: { metadata: true },
    });

    const metadata = (bdr?.metadata as Record<string, unknown>) ?? {};
    const devicePrefs = metadata.devicePreferences as Record<string, string> | undefined;

    res.json({
      microphoneDeviceId: devicePrefs?.microphoneDeviceId ?? null,
      speakerDeviceId: devicePrefs?.speakerDeviceId ?? null,
    });
  } catch (error: any) {
    logger.error('[Device] Failed to load preferences', { error: error.message });
    res.status(500).json({ error: 'Failed to load device preferences' });
  }
});

/**
 * POST /device/preferences
 * Save mic/speaker device IDs for the authenticated BDR.
 * Body: { microphoneDeviceId: string, speakerDeviceId: string }
 */
router.post('/preferences', async (req: Request, res: Response) => {
  try {
    const bdrId = (req as any).bdrId as string;
    if (!bdrId) {
      res.status(401).json({ error: 'BDR authentication required' });
      return;
    }

    const { microphoneDeviceId, speakerDeviceId } = req.body;

    // Get existing metadata
    const bdr: any = await prisma.bdr.findUniqueOrThrow({
      where: { id: bdrId },
      select: { metadata: true },
    });

    const metadata = (bdr.metadata as Record<string, unknown>) ?? {};

    // Update device preferences in metadata
    await prisma.bdr.update({
      where: { id: bdrId },
      data: {
        metadata: {
          ...metadata,
          devicePreferences: {
            microphoneDeviceId: microphoneDeviceId ?? null,
            speakerDeviceId: speakerDeviceId ?? null,
            updatedAt: new Date().toISOString(),
          },
        },
      },
    });

    logger.info('[Device] Preferences saved', { bdrId });
    res.json({ success: true });
  } catch (error: any) {
    logger.error('[Device] Failed to save preferences', { error: error.message });
    res.status(500).json({ error: 'Failed to save device preferences' });
  }
});

export { router as deviceRouter };
