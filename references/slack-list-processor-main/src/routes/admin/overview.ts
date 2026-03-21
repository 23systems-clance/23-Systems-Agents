/**
 * GET /api/v1/admin/overview
 *
 * Returns dashboard summary metrics: total cost, API calls, tokens,
 * job counts, cost breakdowns by provider and workspace, open errors,
 * and error rate for the given date range.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { getOverview } from '../../services/admin/aggregation.js';

export const overviewRouter = Router();

overviewRouter.get('/', async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const endDate = req.query.end_date
      ? new Date(req.query.end_date as string)
      : now;
    const startDate = req.query.start_date
      ? new Date(req.query.start_date as string)
      : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Set endDate to end of day.
    endDate.setHours(23, 59, 59, 999);

    const result = await getOverview({ startDate, endDate });
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: 'internal_error',
      message: 'An unexpected error occurred',
    });
  }
});
