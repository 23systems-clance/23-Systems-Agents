/**
 * Dialer Queue Routes (T022 + T060)
 *
 * GET  /sessions/:sessionId/queue              — Get ordered queue items
 * POST /sessions/:sessionId/queue/:itemId/skip — Skip a queue item
 * GET  /sessions/:sessionId/queue/uncallable   — Get uncallable contacts
 * POST /sessions/:sessionId/queue/:itemId/re-add — Re-add a removed prospect
 */

import { Router, type Request, type Response } from 'express';
import { prisma } from '../../models/index.js';
import { getSessionUncallables, reAddProspect } from '../../services/dialer/uncallableManager.js';
import logger from '../../lib/logger.js';

const router = Router();

/**
 * GET /sessions/:sessionId/queue
 * Return ordered queue items with currentIndex and totalRemaining.
 */
router.get('/sessions/:sessionId/queue', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId as string;

    const items: any[] = await prisma.dialerQueueItem.findMany({
      where: { dialerSessionId: sessionId },
      orderBy: { position: 'asc' },
    });

    const currentIndex = items.findIndex((q: any) => q.status === 'PENDING');
    const totalRemaining = items.filter((q: any) => q.status === 'PENDING').length;

    res.json({
      items: items.map((q: any) => ({
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
      currentIndex: currentIndex >= 0 ? currentIndex : items.length,
      totalRemaining,
    });
  } catch (error: any) {
    logger.error('[Queue] Failed to get queue', { error: error.message });
    res.status(500).json({ error: 'Failed to get queue' });
  }
});

/**
 * POST /sessions/:sessionId/queue/:itemId/skip
 * Move item to end of queue or mark as SKIPPED.
 */
router.post('/sessions/:sessionId/queue/:itemId/skip', async (req: Request, res: Response) => {
  try {
    const itemId = req.params.itemId as string;
    const sessionId = req.params.sessionId as string;

    // Get the max position in the queue
    const maxItem: any = await prisma.dialerQueueItem.findFirst({
      where: { dialerSessionId: sessionId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    const newPosition = (maxItem?.position ?? 0) + 1;

    await prisma.dialerQueueItem.update({
      where: { id: itemId },
      data: {
        status: 'SKIPPED',
        position: newPosition,
      },
    });

    res.json({ success: true });
  } catch (error: any) {
    logger.error('[Queue] Failed to skip item', { error: error.message });
    res.status(500).json({ error: 'Failed to skip queue item' });
  }
});

/**
 * GET /sessions/:sessionId/queue/uncallable (T060)
 * Return uncallable contacts with reasons for the session.
 */
router.get('/sessions/:sessionId/queue/uncallable', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId as string;
    const uncallables = await getSessionUncallables(sessionId);
    res.json({ uncallables });
  } catch (error: any) {
    logger.error('[Queue] Failed to get uncallables', { error: error.message });
    res.status(500).json({ error: 'Failed to get uncallable contacts' });
  }
});

/**
 * POST /sessions/:sessionId/queue/:itemId/re-add (T060)
 * Re-add a removed prospect back to the queue.
 */
router.post('/sessions/:sessionId/queue/:itemId/re-add', async (req: Request, res: Response) => {
  try {
    const itemId = req.params.itemId as string;
    const bdrId = (req as any).bdrId || 'unknown';

    // Find the queue item to get its phone number
    const queueItem: any = await prisma.dialerQueueItem.findUniqueOrThrow({
      where: { id: itemId },
    });

    // Find the uncallable record
    const uncallable: any = await prisma.uncallableContact.findFirst({
      where: {
        contactPhone: queueItem.contactPhone,
        reAddedAt: null,
      },
    });

    if (!uncallable) {
      res.status(404).json({ error: 'Uncallable record not found' });
      return;
    }

    // Re-add the prospect
    await reAddProspect(uncallable.id, bdrId);

    // Update queue item back to PENDING
    await prisma.dialerQueueItem.update({
      where: { id: itemId },
      data: { status: 'PENDING' },
    });

    res.json({ success: true });
  } catch (error: any) {
    logger.error('[Queue] Failed to re-add prospect', { error: error.message });
    res.status(400).json({ error: error.message || 'Failed to re-add prospect' });
  }
});

/**
 * POST /sessions/:sessionId/queue/refresh-hubspot (T110)
 * Stub endpoint for refreshing HubSpot contact data for pending queue items.
 * Returns the list of items that would be refreshed.
 */
router.post('/sessions/:sessionId/queue/refresh-hubspot', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId as string;

    // Get pending queue items that have a hubspotContactId
    const pendingItems: any[] = await prisma.dialerQueueItem.findMany({
      where: {
        dialerSessionId: sessionId,
        status: 'PENDING',
        hubspotContactId: { not: null },
      },
      select: {
        id: true,
        hubspotContactId: true,
        contactName: true,
      },
    });

    // TODO: Integrate with HubSpot API to refresh contact data for each item.
    // For now, return the IDs that would be refreshed.

    logger.info('[Queue] HubSpot refresh requested', {
      sessionId,
      itemCount: pendingItems.length,
    });

    res.json({
      refreshed: pendingItems.length,
      itemIds: pendingItems.map((i: any) => i.id),
    });
  } catch (error: any) {
    logger.error('[Queue] Failed to refresh HubSpot data', { error: error.message });
    res.status(500).json({ error: 'Failed to refresh HubSpot data' });
  }
});

export { router as queueRouter };
