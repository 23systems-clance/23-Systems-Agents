/**
 * CRM import API routes.
 *
 * Routes:
 *   POST /:connectionId/import  — Trigger a CRM import for an enrichment job
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { executeImport } from '../../services/crm/crmImportService.js';
import logger from '../../lib/logger.js';

export const crmImportRouter = Router();

/**
 * POST /:connectionId/import
 * Trigger a CRM import for a given enrichment job.
 *
 * Request body:
 *   - enrichmentJobId (required): Job UUID to import results from
 *   - listName (optional): Name for CRM list to create and populate
 *   - incrementalOnly (optional): Only push records not previously pushed
 */
crmImportRouter.post('/:connectionId/import', async (req: Request, res: Response) => {
  try {
    const connectionId = req.params.connectionId as string;
    const { enrichmentJobId, listName, incrementalOnly } = req.body;

    if (!enrichmentJobId) {
      return res.status(400).json({ error: 'enrichmentJobId is required' });
    }

    const result = await executeImport(connectionId, enrichmentJobId, {
      listName,
      incrementalOnly: incrementalOnly ?? false,
    });

    logger.info('CRM import triggered via API', {
      connectionId,
      enrichmentJobId,
      succeeded: result.upsertResult.succeeded,
      failed: result.upsertResult.failed,
    });

    res.status(202).json({ result });
  } catch (err) {
    logger.error('CRM import failed', {
      connectionId: req.params.connectionId,
      error: err instanceof Error ? err.message : String(err),
    });

    const statusCode = (err as any).message?.includes('not found') ? 404
      : (err as any).message?.includes('not active') ? 400
      : 500;

    res.status(statusCode).json({
      error: err instanceof Error ? err.message : 'CRM import failed',
    });
  }
});
