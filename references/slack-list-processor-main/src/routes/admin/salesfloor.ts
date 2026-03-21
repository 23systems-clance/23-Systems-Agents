/**
 * Salesfloor Admin Route (T100)
 *
 * GET /admin/salesfloor — Returns BDR status cards + team pulse KPIs
 *   Query params: clientId (required), teamId (optional), bdrIds (comma-separated, optional)
 */

import { Router, type Request, type Response } from 'express';
import * as salesfloorService from '../../services/dialer/salesfloorService.js';
import logger from '../../lib/logger.js';

const router = Router();

/**
 * GET / — Salesfloor dashboard data (optimized for 5-second polling).
 *
 * Returns a combined payload of BDR status cards and team pulse KPIs
 * for the given client workspace. Both queries run in parallel.
 *
 * Query params:
 *   - clientId (required) — workspace identifier
 *   - teamId  (optional)  — filter to a specific team
 *   - bdrIds  (optional)  — comma-separated BDR IDs to filter
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const clientId = req.query.clientId as string;
    if (!clientId) {
      res.status(400).json({ error: 'clientId is required' });
      return;
    }

    const teamId = req.query.teamId as string | undefined;
    const bdrIds = req.query.bdrIds
      ? (req.query.bdrIds as string).split(',')
      : undefined;

    const [bdrCards, teamPulse] = await Promise.all([
      salesfloorService.getActiveBdrStatuses(clientId, { teamId, bdrIds }),
      salesfloorService.getTeamPulseKPIs(clientId),
    ]);

    res.json({ bdrCards, teamPulse });
  } catch (error: any) {
    logger.error('[Salesfloor] Failed to fetch dashboard data', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export { router as salesfloorRouter };
