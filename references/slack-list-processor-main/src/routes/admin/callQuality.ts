/**
 * Admin Call Quality Routes (T044)
 * GET /call-quality — Quality trends for admin dashboard
 * GET /call-quality/flagged — Calls with poor quality
 * POST /call-quality/collect/:callSessionId — Trigger metrics collection for a call
 */

import { Router, type Request, type Response } from 'express';
import {
  getQualityTrends,
  getFlaggedCalls,
  collectPostCallMetrics,
} from '../../services/dialer/callQualityService.js';
import logger from '../../lib/logger.js';

const router = Router();

/** GET /call-quality — Quality trends (last N days). */
router.get('/', async (req: Request, res: Response) => {
  try {
    const clientId = req.query.clientId as string || '';
    const days = parseInt(req.query.days as string) || 7;
    const trends = await getQualityTrends(clientId, days);
    res.json(trends);
  } catch (error: any) {
    logger.error('[CallQuality] Failed to get trends', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/** GET /call-quality/flagged — Flagged low-quality calls. */
router.get('/flagged', async (req: Request, res: Response) => {
  try {
    const clientId = req.query.clientId as string || '';
    const limit = parseInt(req.query.limit as string) || 50;
    const flagged = await getFlaggedCalls(clientId, limit);
    res.json(flagged);
  } catch (error: any) {
    logger.error('[CallQuality] Failed to get flagged calls', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/** POST /call-quality/collect/:callSessionId — Collect metrics for a specific call. */
router.post('/collect/:callSessionId', async (req: Request, res: Response) => {
  try {
    const callSessionId = req.params.callSessionId as string;
    const metrics = await collectPostCallMetrics(callSessionId);
    res.json(metrics);
  } catch (error: any) {
    logger.error('[CallQuality] Failed to collect metrics', {
      callSessionId: req.params.callSessionId,
      error: error.message,
    });
    res.status(400).json({ error: error.message });
  }
});

export { router as callQualityRouter };
