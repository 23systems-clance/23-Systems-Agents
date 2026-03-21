/**
 * Dialer Callback Routes (T078)
 *
 * GET    /callbacks       — List BDR's callbacks (optional ?status filter)
 * POST   /callbacks       — Schedule a new callback
 * POST   /callbacks/:id/complete   — Mark callback as completed
 * POST   /callbacks/:id/reschedule — Reschedule callback to new time
 * GET    /callbacks/due   — Get callbacks due now for this BDR
 * POST   /callbacks/:id/queue — Insert callback contact at top of active queue
 */

import { Router, type Request, type Response } from 'express';
import { prisma } from '../../models/index.js';
import { getBdrIdentity } from '../../lib/bdrAuth.js';
import * as callbackService from '../../services/dialer/callbackService.js';
import logger from '../../lib/logger.js';

const router = Router();

/** Helper to resolve BDR record from session identity. */
async function resolveBdr(req: Request, res: Response) {
  const identity = getBdrIdentity(req);
  if (!identity) {
    res.status(401).json({ error: 'BDR identity not found' });
    return null;
  }

  const bdr = await prisma.bdr.findFirst({
    where: { slackUserId: identity.slackUserId, slackTeamId: identity.slackTeamId },
    include: { clients: { include: { client: true }, take: 1 } },
  });

  if (!bdr) {
    res.status(404).json({ error: 'BDR record not found' });
    return null;
  }

  const clientId = bdr.clients[0]?.clientId;
  if (!clientId) {
    res.status(400).json({ error: 'BDR not assigned to any client' });
    return null;
  }

  return { bdrId: bdr.id, clientId };
}

/** GET / — List BDR's callbacks with optional status filter. */
router.get('/', async (req: Request, res: Response) => {
  try {
    const bdr = await resolveBdr(req, res);
    if (!bdr) return;

    const status = req.query.status as string | undefined;
    const callbacks = await callbackService.getCallbacksByBdr(bdr.bdrId, status);
    res.json({ callbacks });
  } catch (error: any) {
    logger.error('[Callbacks] List failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/** GET /due — Get callbacks due now for this BDR. */
router.get('/due', async (req: Request, res: Response) => {
  try {
    const bdr = await resolveBdr(req, res);
    if (!bdr) return;

    const callbacks = await callbackService.getDueCallbacks(bdr.bdrId);
    res.json({ callbacks });
  } catch (error: any) {
    logger.error('[Callbacks] Get due failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/** POST / — Schedule a new callback. */
router.post('/', async (req: Request, res: Response) => {
  try {
    const bdr = await resolveBdr(req, res);
    if (!bdr) return;

    const { callSessionId, scheduledAt, notes } = req.body;
    if (!callSessionId || !scheduledAt) {
      res.status(400).json({ error: 'callSessionId and scheduledAt are required' });
      return;
    }

    const callback = await callbackService.scheduleCallback(
      callSessionId,
      bdr.bdrId,
      new Date(scheduledAt),
      notes,
    );

    res.status(201).json(callback);
  } catch (error: any) {
    logger.error('[Callbacks] Schedule failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

/** POST /:id/complete — Mark a callback as completed. */
router.post('/:id/complete', async (req: Request, res: Response) => {
  try {
    const callbackId = req.params.id as string;
    const { completedCallSessionId } = req.body;

    await callbackService.completeCallback(callbackId, completedCallSessionId);
    res.json({ success: true });
  } catch (error: any) {
    logger.error('[Callbacks] Complete failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

/** POST /:id/reschedule — Reschedule a callback to a new time. */
router.post('/:id/reschedule', async (req: Request, res: Response) => {
  try {
    const callbackId = req.params.id as string;
    const { scheduledAt } = req.body;

    if (!scheduledAt) {
      res.status(400).json({ error: 'scheduledAt is required' });
      return;
    }

    await callbackService.rescheduleCallback(callbackId, new Date(scheduledAt));
    res.json({ success: true });
  } catch (error: any) {
    logger.error('[Callbacks] Reschedule failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

/** POST /:id/queue — Insert callback contact at top of active session queue. */
router.post('/:id/queue', async (req: Request, res: Response) => {
  try {
    const callbackId = req.params.id as string;
    const { sessionId } = req.body;

    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required' });
      return;
    }

    const queueItem = await callbackService.insertCallbackInQueue(callbackId, sessionId);
    res.json(queueItem);
  } catch (error: any) {
    logger.error('[Callbacks] Insert in queue failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

export { router as callbacksRouter };
