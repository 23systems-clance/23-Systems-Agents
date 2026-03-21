/**
 * Client enrichment history routes (T054).
 *
 * Lists enrichment jobs for the client workspace with pagination
 * and optional user filtering (admin only).
 */

import { Router } from 'express';
import { prisma } from '../../models/index.js';
import type { ClientSession } from '../../lib/clientAuth.js';
import logger from '../../lib/logger.js';

export const clientEnrichmentsRouter = Router();

/** GET /api/v1/client/enrichments — enrichment job history. */
clientEnrichmentsRouter.get('/', async (req, res) => {
  try {
    const session = (req as unknown as Record<string, unknown>).clientSession as ClientSession;
    const { slackTeamId } = session;

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 25));
    const userIdFilter = req.query.userId as string | undefined;

    // Non-admin users can only see their own enrichments
    const where: Record<string, unknown> = { slackTeamId };
    if (userIdFilter && session.isAdmin) {
      where.slackUserId = userIdFilter;
    } else if (!session.isAdmin) {
      where.slackUserId = session.slackUserId;
    }

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          jobType: true,
          status: true,
          sourceRowCount: true,
          totalCost: true,
          slackUserId: true,
          slackChannelName: true,
          resultFileUrl: true,
          createdAt: true,
        },
      }),
      prisma.job.count({ where }),
    ]);

    res.json({ jobs, total });
  } catch (error) {
    logger.error('Failed to get client enrichment history', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to get enrichment history' });
  }
});
