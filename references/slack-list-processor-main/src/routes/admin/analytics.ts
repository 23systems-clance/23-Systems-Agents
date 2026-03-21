/**
 * Dialer Analytics Admin Routes (T087)
 *
 * GET /admin/analytics/kpi                 — KPI summary cards
 * GET /admin/analytics/rep-performance     — Rep performance table
 * GET /admin/analytics/list-performance    — List performance table
 * GET /admin/analytics/account-performance — Account performance table
 * GET /admin/analytics/call-history        — Paginated call log
 * GET /admin/analytics/objections          — Objections breakdown
 * GET /admin/analytics/when-to-call        — Day/hour heatmap data
 */

import { Router, type Request, type Response } from 'express';
import {
  type AnalyticsFilters,
  getKPISummary,
  getRepPerformance,
  getListPerformance,
  getAccountPerformance,
  getCallHistory,
  getObjections,
  getWhenToCall,
} from '../../services/dialer/analyticsService.js';
import logger from '../../lib/logger.js';

const router = Router();

/* ------------------------------------------------------------------ */
/*  Shared filter parser                                               */
/* ------------------------------------------------------------------ */

/**
 * Parse common query-string params into an AnalyticsFilters object.
 * Defaults startDate/endDate to last 30 days when omitted.
 */
function parseFilters(query: Record<string, any>): AnalyticsFilters {
  const clientId = (query.clientId as string) || '';
  if (!clientId) {
    throw new Error('clientId query parameter is required');
  }

  const now = new Date();
  const defaultStart = new Date(now);
  defaultStart.setDate(defaultStart.getDate() - 30);

  const startDate = query.startDate ? new Date(query.startDate as string) : defaultStart;
  const endDate = query.endDate ? new Date(query.endDate as string) : now;

  const filters: AnalyticsFilters = { clientId, startDate, endDate };

  if (query.bdrIds) {
    filters.bdrIds = (query.bdrIds as string).split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (query.campaignIds) {
    filters.campaignIds = (query.campaignIds as string).split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (query.companyNames) {
    filters.companyNames = (query.companyNames as string).split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (query.callTypes) {
    filters.callTypes = (query.callTypes as string).split(',').map((s) => s.trim()).filter(Boolean);
  }

  return filters;
}

/* ------------------------------------------------------------------ */
/*  Endpoints                                                          */
/* ------------------------------------------------------------------ */

/** GET /analytics/kpi — KPI summary cards. */
router.get('/kpi', async (req: Request, res: Response) => {
  try {
    const filters = parseFilters(req.query);
    const summary = await getKPISummary(filters);
    res.json(summary);
  } catch (error: any) {
    logger.error('[Analytics] Failed to get KPI summary', { error: error.message });
    res.status(error.message.includes('required') ? 400 : 500).json({ error: error.message });
  }
});

/** GET /analytics/rep-performance — Rep performance table. */
router.get('/rep-performance', async (req: Request, res: Response) => {
  try {
    const filters = parseFilters(req.query);
    const rows = await getRepPerformance(filters);
    res.json(rows);
  } catch (error: any) {
    logger.error('[Analytics] Failed to get rep performance', { error: error.message });
    res.status(error.message.includes('required') ? 400 : 500).json({ error: error.message });
  }
});

/** GET /analytics/list-performance — List (campaign) performance table. */
router.get('/list-performance', async (req: Request, res: Response) => {
  try {
    const filters = parseFilters(req.query);
    const rows = await getListPerformance(filters);
    res.json(rows);
  } catch (error: any) {
    logger.error('[Analytics] Failed to get list performance', { error: error.message });
    res.status(error.message.includes('required') ? 400 : 500).json({ error: error.message });
  }
});

/** GET /analytics/account-performance — Account (company) performance table. */
router.get('/account-performance', async (req: Request, res: Response) => {
  try {
    const filters = parseFilters(req.query);
    const rows = await getAccountPerformance(filters);
    res.json(rows);
  } catch (error: any) {
    logger.error('[Analytics] Failed to get account performance', { error: error.message });
    res.status(error.message.includes('required') ? 400 : 500).json({ error: error.message });
  }
});

/** GET /analytics/call-history — Paginated call log. */
router.get('/call-history', async (req: Request, res: Response) => {
  try {
    const filters = parseFilters(req.query);
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 50));
    const result = await getCallHistory(filters, page, pageSize);
    res.json({ ...result, page, pageSize });
  } catch (error: any) {
    logger.error('[Analytics] Failed to get call history', { error: error.message });
    res.status(error.message.includes('required') ? 400 : 500).json({ error: error.message });
  }
});

/** GET /analytics/objections — Objections breakdown. */
router.get('/objections', async (req: Request, res: Response) => {
  try {
    const filters = parseFilters(req.query);
    const rows = await getObjections(filters);
    res.json(rows);
  } catch (error: any) {
    logger.error('[Analytics] Failed to get objections', { error: error.message });
    res.status(error.message.includes('required') ? 400 : 500).json({ error: error.message });
  }
});

/** GET /analytics/when-to-call — Day/hour heatmap data. */
router.get('/when-to-call', async (req: Request, res: Response) => {
  try {
    const filters = parseFilters(req.query);
    const cells = await getWhenToCall(filters);
    res.json(cells);
  } catch (error: any) {
    logger.error('[Analytics] Failed to get when-to-call data', { error: error.message });
    res.status(error.message.includes('required') ? 400 : 500).json({ error: error.message });
  }
});

export { router as analyticsRouter };
