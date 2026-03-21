/**
 * Dialer Session Routes (T021)
 * POST /sessions — Start a new dialer session
 * GET /sessions — Get active session
 * POST /sessions/:sessionId/pause — Pause session
 * POST /sessions/:sessionId/resume — Resume session
 * POST /sessions/:sessionId/complete — End session
 * GET /sessions/:sessionId/queue — Get queue items
 * POST /sessions/:sessionId/queue/:itemId/skip — Skip queue item
 */

import { Router, type Request, type Response } from 'express';
import { prisma } from '../../models/index.js';
import { getBdrIdentity } from '../../lib/bdrAuth.js';
import * as sessionManager from '../../services/dialer/sessionManager.js';
import { recordHeartbeat } from '../../services/dialer/sessionManager.js';
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

/** POST /sessions — Start a new dialer session. */
router.post('/', async (req: Request, res: Response) => {
  try {
    const bdr = await resolveBdr(req, res);
    if (!bdr) return;

    const session = await sessionManager.startSession(bdr.bdrId, bdr.clientId, req.body);
    res.status(201).json(session);
  } catch (error: any) {
    logger.error('[Sessions] Start session failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

/** GET /sessions — Get active session. */
router.get('/', async (req: Request, res: Response) => {
  try {
    const bdr = await resolveBdr(req, res);
    if (!bdr) return;

    const session = await sessionManager.getActiveSession(bdr.bdrId);
    if (!session) {
      res.status(204).send();
      return;
    }
    res.json(session);
  } catch (error: any) {
    logger.error('[Sessions] Get active session failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/** POST /sessions/:sessionId/pause */
router.post('/:sessionId/pause', async (req: Request, res: Response) => {
  try {
    const bdr = await resolveBdr(req, res);
    if (!bdr) return;

    await sessionManager.pauseSession(req.params.sessionId as string, bdr.bdrId);
    res.json({ success: true });
  } catch (error: any) {
    logger.error('[Sessions] Pause failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

/** POST /sessions/:sessionId/resume */
router.post('/:sessionId/resume', async (req: Request, res: Response) => {
  try {
    const bdr = await resolveBdr(req, res);
    if (!bdr) return;

    await sessionManager.resumeSession(req.params.sessionId as string, bdr.bdrId);
    res.json({ success: true });
  } catch (error: any) {
    logger.error('[Sessions] Resume failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

/** POST /sessions/:sessionId/complete */
router.post('/:sessionId/complete', async (req: Request, res: Response) => {
  try {
    const bdr = await resolveBdr(req, res);
    if (!bdr) return;

    const stats = await sessionManager.completeSession(req.params.sessionId as string, bdr.bdrId);
    res.json(stats);
  } catch (error: any) {
    logger.error('[Sessions] Complete failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

/** GET /sessions/:sessionId/queue — Get queue items. */
router.get('/:sessionId/queue', async (req: Request, res: Response) => {
  try {
    const queueItems = await prisma.dialerQueueItem.findMany({
      where: { dialerSessionId: req.params.sessionId as string },
      orderBy: { position: 'asc' },
    });

    const currentIndex = queueItems.findIndex((q: any) => q.status === 'PENDING');
    const totalRemaining = queueItems.filter((q: any) => q.status === 'PENDING').length;

    res.json({
      items: queueItems.map((q: any) => ({
        id: q.id,
        position: q.position,
        status: q.status,
        contactName: q.contactName,
        contactEmail: q.contactEmail,
        contactPhone: q.contactPhone,
        companyName: q.companyName,
        jobTitle: q.jobTitle,
        hubspotContactId: q.hubspotContactId,
        tcpaEligible: q.tcpaEligible,
        optedOut: q.optedOut,
        lastCalledAt: q.lastCalledAt?.toISOString() ?? null,
      })),
      currentIndex: currentIndex >= 0 ? currentIndex : queueItems.length,
      totalRemaining,
    });
  } catch (error: any) {
    logger.error('[Sessions] Get queue failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/** POST /sessions/:sessionId/heartbeat — Reset inactivity timer (T062). */
router.post('/:sessionId/heartbeat', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId as string;
    await recordHeartbeat(sessionId);
    res.json({ success: true });
  } catch (error: any) {
    logger.error('[Sessions] Heartbeat failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

/** POST /sessions/:sessionId/queue/:itemId/skip — Skip a queue item. */
router.post('/:sessionId/queue/:itemId/skip', async (req: Request, res: Response) => {
  try {
    await prisma.dialerQueueItem.update({
      where: { id: req.params.itemId as string },
      data: { status: 'SKIPPED' },
    });

    res.json({ success: true });
  } catch (error: any) {
    logger.error('[Sessions] Skip queue item failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

export { router as sessionsRouter };
