/**
 * Dialer Call Control Routes (T023)
 * POST /calls/dial — Initiate a call to the next queue item
 * POST /calls/:callSessionId/hangup — End an active call
 * POST /calls/:callSessionId/mute — Toggle mute
 * POST /calls/:callSessionId/hold — Toggle hold
 */

import { Router, type Request, type Response } from 'express';
import { prisma } from '../../models/index.js';
import { getBdrIdentity } from '../../lib/bdrAuth.js';
import * as dialerEngine from '../../services/dialer/dialerEngine.js';
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

/** POST /calls/dial — Initiate a call to a queue item contact. */
router.post('/dial', async (req: Request, res: Response) => {
  try {
    const bdr = await resolveBdr(req, res);
    if (!bdr) return;

    const { sessionId, queueItemId } = req.body;
    if (!sessionId || !queueItemId) {
      res.status(400).json({ error: 'sessionId and queueItemId are required' });
      return;
    }

    const callSession = await dialerEngine.dialContact(
      sessionId,
      queueItemId,
      bdr.bdrId,
      bdr.clientId
    );

    res.status(201).json(callSession);
  } catch (error: any) {
    logger.error('[Calls] Dial failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

/** POST /calls/:callSessionId/hangup — End an active call. */
router.post('/:callSessionId/hangup', async (req: Request, res: Response) => {
  try {
    const bdr = await resolveBdr(req, res);
    if (!bdr) return;

    await dialerEngine.hangupCall(req.params.callSessionId as string);
    res.json({ success: true });
  } catch (error: any) {
    logger.error('[Calls] Hangup failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

/** POST /calls/:callSessionId/mute — Toggle mute on BDR's conference leg. */
router.post('/:callSessionId/mute', async (req: Request, res: Response) => {
  try {
    const bdr = await resolveBdr(req, res);
    if (!bdr) return;

    const { muted } = req.body;
    await dialerEngine.toggleMute(req.params.callSessionId as string, muted ?? true);
    res.json({ success: true, muted: muted ?? true });
  } catch (error: any) {
    logger.error('[Calls] Mute toggle failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

/** POST /calls/:callSessionId/hold — Toggle hold on contact's conference leg. */
router.post('/:callSessionId/hold', async (req: Request, res: Response) => {
  try {
    const bdr = await resolveBdr(req, res);
    if (!bdr) return;

    const { held } = req.body;
    await dialerEngine.toggleHold(req.params.callSessionId as string, held ?? true);
    res.json({ success: true, held: held ?? true });
  } catch (error: any) {
    logger.error('[Calls] Hold toggle failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

export { router as callsRouter };
