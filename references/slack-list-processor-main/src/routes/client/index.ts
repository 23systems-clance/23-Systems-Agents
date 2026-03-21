/**
 * Client dashboard API router index (T057).
 *
 * Assembles all client-facing routes under /api/v1/client.
 * Auth routes are public; all others require clientAuth middleware.
 */

import { Router } from 'express';
import cookieParser from 'cookie-parser';
import { clientAuth } from '../../lib/clientAuth.js';
import { clientAuthRouter } from './auth.js';
import { clientOverviewRouter } from './overview.js';
import { clientBillingRouter } from './billing.js';
import { clientEnrichmentsRouter } from './enrichments.js';
import { clientChannelsRouter } from './channels.js';
import { clientSettingsRouter } from './settings.js';
import { clientMcpServerRouter } from './mcpServers.js';
import { clientSkillRouter } from './skills.js';
import { clientPackRouter } from './packs.js';
import { clientPlatformUsageRouter } from './platformUsage.js';

export const clientRouter = Router();

// Cookie parser for session cookies
clientRouter.use(cookieParser());

// Public auth routes (login, callback, logout)
clientRouter.use('/auth', clientAuthRouter);

// All routes below require authenticated client session
clientRouter.use(clientAuth);
clientRouter.use('/overview', clientOverviewRouter);
clientRouter.use('/billing', clientBillingRouter);
clientRouter.use('/enrichments', clientEnrichmentsRouter);
clientRouter.use('/channels', clientChannelsRouter);
clientRouter.use('/settings', clientSettingsRouter);
clientRouter.use('/mcp-servers', clientMcpServerRouter);
clientRouter.use('/skills', clientSkillRouter);
clientRouter.use('/packs', clientPackRouter);
clientRouter.use('/', clientPlatformUsageRouter);
