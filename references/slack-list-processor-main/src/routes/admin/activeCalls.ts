/**
 * Active Calls Admin Route (T056 - US4 Manager Call Monitoring)
 *
 * GET  /active-calls              — List all active calls for a client
 * POST /active-calls/:id/listen   — Join call in coach (listen-only) mode
 * POST /active-calls/:id/barge    — Escalate from coach to barge-in mode
 */

import { Router, type Request, type Response } from 'express';
import { getActiveCalls, addCoachParticipant, bargeIn } from '../../services/dialer/conferenceManager.js';
import logger from '../../lib/logger.js';

const router = Router();

/**
 * GET /active-calls
 * List all active calls (RINGING or CONNECTED) for a client.
 * Query params: clientId (required)
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const clientId = req.query.clientId as string;
    if (!clientId) {
      res.status(400).json({ error: 'clientId query parameter is required' });
      return;
    }

    const activeCalls = await getActiveCalls(clientId);
    res.json({ activeCalls });
  } catch (error: any) {
    logger.error('[ActiveCalls] Failed to list active calls', { error: error.message });
    res.status(500).json({ error: 'Failed to list active calls' });
  }
});

/**
 * POST /active-calls/:callSessionId/listen
 * Generate a Twilio token for the manager and join as coach (listen-only).
 * Body: { managerId: string }
 */
router.post('/:callSessionId/listen', async (req: Request, res: Response) => {
  try {
    const callSessionId = req.params.callSessionId as string;
    const managerId = req.body.managerId as string;

    if (!managerId) {
      res.status(400).json({ error: 'managerId is required' });
      return;
    }

    const result = await addCoachParticipant(callSessionId, managerId);
    res.json(result);
  } catch (error: any) {
    logger.error('[ActiveCalls] Failed to start listen mode', {
      callSessionId: req.params.callSessionId,
      error: error.message,
    });
    res.status(500).json({ error: 'Failed to start listen mode' });
  }
});

/**
 * POST /active-calls/:callSessionId/barge
 * Escalate manager from coach (listen-only) to barge-in (two-way audio).
 * Body: { managerId: string }
 */
router.post('/:callSessionId/barge', async (req: Request, res: Response) => {
  try {
    const callSessionId = req.params.callSessionId as string;
    const managerId = req.body.managerId as string;

    if (!managerId) {
      res.status(400).json({ error: 'managerId is required' });
      return;
    }

    await bargeIn(callSessionId, managerId);
    res.json({ success: true });
  } catch (error: any) {
    logger.error('[ActiveCalls] Failed to barge in', {
      callSessionId: req.params.callSessionId,
      error: error.message,
    });
    res.status(500).json({ error: 'Failed to barge in' });
  }
});

export { router as activeCallsRouter };
