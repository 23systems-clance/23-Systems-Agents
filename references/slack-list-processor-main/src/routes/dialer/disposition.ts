/**
 * Dialer Disposition Routes (T024)
 * POST /calls/:callSessionId/disposition — Submit a call disposition
 */

import { Router, type Request, type Response } from 'express';
import { getBdrIdentity } from '../../lib/bdrAuth.js';
import { submitDisposition } from '../../services/dialer/dispositionService.js';
import logger from '../../lib/logger.js';

const router = Router();

/** POST /calls/:callSessionId/disposition — Submit disposition for a completed call. */
router.post('/:callSessionId/disposition', async (req: Request, res: Response) => {
  try {
    const identity = getBdrIdentity(req);
    if (!identity) {
      res.status(401).json({ error: 'BDR identity not found' });
      return;
    }

    const callSessionId = req.params.callSessionId as string;
    const { disposition, notes } = req.body;

    if (!disposition) {
      res.status(400).json({ error: 'disposition is required' });
      return;
    }

    const result = await submitDisposition(callSessionId, disposition, notes);
    res.json(result);
  } catch (error: any) {
    logger.error('[Disposition] Submit failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

export { router as dispositionRouter };
