/**
 * BDR daily stats routes.
 *
 * Provides activity stats from DailyBdrActivity and EOD notes submission.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { CampaignStatus } from '@prisma/client';
import { prisma } from '../../models/index.js';
import { getBdrIdentity } from '../../lib/bdrAuth.js';
import logger from '../../lib/logger.js';

const router = Router();

/**
 * GET /api/v1/bdr/stats
 * Returns daily activity stats for the authenticated BDR.
 * Query params: date (ISO format, defaults to today)
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const identity = getBdrIdentity(req);
    if (!identity) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const dateParam = req.query.date as string | undefined;
    const date = dateParam ? new Date(dateParam) : new Date();
    date.setUTCHours(0, 0, 0, 0);

    const activities = await prisma.dailyBdrActivity.findMany({
      where: {
        slackUserId: identity.slackUserId,
        date,
      },
      include: {
        campaign: { select: { id: true, name: true } },
      },
    });

    // Aggregate totals
    const totals = {
      emailsSent: 0,
      linkedinActionsSent: 0,
      callsCompleted: 0,
      emailRepliesReceived: 0,
      linkedinRepliesReceived: 0,
    };

    const byCampaign = activities.map((a) => {
      totals.emailsSent += a.emailsSent;
      totals.linkedinActionsSent += a.linkedinActionsSent;
      totals.callsCompleted += a.callsCompleted;
      totals.emailRepliesReceived += a.emailRepliesReceived;
      totals.linkedinRepliesReceived += a.linkedinRepliesReceived;

      return {
        campaignId: a.campaign.id,
        campaignName: a.campaign.name,
        emailsSent: a.emailsSent,
        linkedinActionsSent: a.linkedinActionsSent,
        callsCompleted: a.callsCompleted,
        emailRepliesReceived: a.emailRepliesReceived,
        linkedinRepliesReceived: a.linkedinRepliesReceived,
      };
    });

    res.json({
      data: {
        date: date.toISOString(),
        totals,
        byCampaign,
      },
    });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to get BDR stats', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/bdr/eod-notes
 * Submit EOD notes for the day.
 */
router.post('/eod-notes', async (req: Request, res: Response) => {
  try {
    const identity = getBdrIdentity(req);
    if (!identity) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { notes } = req.body;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    // Find or create today's EOD report
    const existing = await prisma.eodReport.findFirst({
      where: {
        slackUserId: identity.slackUserId,
        date: today,
      },
    });

    if (existing) {
      await prisma.eodReport.update({
        where: { id: existing.id },
        data: { bdrNotes: notes },
      });
    } else {
      await prisma.eodReport.create({
        data: {
          slackUserId: identity.slackUserId,
          slackTeamId: identity.slackTeamId,
          date: today,
          stats: {},
          bdrNotes: notes,
        },
      });
    }

    res.json({ message: 'EOD notes saved' });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to save EOD notes', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export { router as statsRouter };
