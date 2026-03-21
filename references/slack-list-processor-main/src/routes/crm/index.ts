/**
 * CRM route index.
 *
 * Composes all CRM-related route modules under a single router.
 * Mounted at /api/crm/* in server.ts.
 */

import { Router } from 'express';
import { crmConnectionsRouter } from './connections.js';
import { crmFieldMappingsRouter } from './fieldMappings.js';
import { crmImportRouter } from './import.js';

export const crmRouter = Router();

// Connection CRUD + properties
crmRouter.use('/connections', crmConnectionsRouter);

// Field mapping CRUD + auto-map (nested under connections)
crmRouter.use('/connections', crmFieldMappingsRouter);

// Import trigger (nested under connections)
crmRouter.use('/connections', crmImportRouter);
