/**
 * Admin router index.
 *
 * Auth routes (login/logout/me) are mounted BEFORE adminAuth middleware
 * so they're accessible without authentication. All other admin endpoints
 * require either a session cookie or X-Admin-Key header.
 */

import { Router } from 'express';
import { adminAuth } from '../../lib/adminAuth.js';
import { adminRateLimit } from '../../lib/adminRateLimit.js';
import { authRouter } from './auth.js';
import { overviewRouter } from './overview.js';
import { usageRouter } from './usage.js';
import { errorsRouter } from './errors.js';
import { clientsRouter } from './clients.js';
import { clientManagementRouter } from './clientManagement.js';
import { bdrManagementRouter } from './bdrManagement.js';
import { thresholdsRouter } from './thresholds.js';
import { reportsRouter } from './reports.js';
import { retentionRouter } from './retention.js';
import { usersRouter } from './users.js';
import { jobsRouter } from './jobs.js';
import { campaignAdminRouter, bdrActivityRouter, eodReportsAdminRouter } from './campaigns.js';
import { enrichmentPresetsRouter } from './enrichmentPresets.js';
import { workspaceSettingsRouter } from './workspaceSettings.js';
import { onboardingPlansRouter } from './onboardingPlans.js';
import { onboardingEnrollmentsRouter } from './onboardingEnrollments.js';
import { onboardingProgressRouter } from './onboardingProgress.js';
import { contentLibraryRouter } from './contentLibrary.js';
import { workflowsRouter } from './workflows.js';
import { channelMappingsRouter } from './channelMappings.js';
import { billingRouter } from './billing.js';
import { creditRatesRouter } from './creditRates.js';
import { slackUsersRouter } from './slackUsers.js';
import { slackChannelsRouter } from './slackChannels.js';
import { qualityGateConfigRouter } from './qualityGateConfig.js';
import { apolloCacheRouter } from './apolloCache.js';
import { cacheRouter } from './cache.js';
import { crmRouter } from '../crm/index.js';
import { promptsRouter } from './prompts.js';
import { providerCostsRouter } from './providerCosts.js';
import { callQualityRouter } from './callQuality.js';
import { activeCallsRouter } from './activeCalls.js';
import { recordingsRouter } from './recordings.js';
import { recordingReviewsRouter } from './recording-reviews.js';
import { analyticsRouter } from './analytics.js';
import { savedViewsRouter } from './savedViews.js';
import { salesfloorRouter } from './salesfloor.js';
import { dialerConfigRouter } from './dialer-config.js';
import { uncallableAdminRouter } from './uncallable.js';
import { contactsAdminRouter } from './contacts.js';
import { creditPackRouter } from './creditPacks.js';
import { licensingRouter } from './licensing.js';
import { workspaceManagementRouter } from './workspaceManagement.js';
import { agentAdminRouter } from './agents.js';
import { mcpServerAdminRouter } from './mcpServers.js';
import { skillAdminRouter } from './skills.js';
import { packAdminRouter } from './packs.js';
import { executionAdminRouter } from './executions.js';
import { adminCommandsRouter } from './commands.js';
import { autonomousRouter } from './autonomous.js';
import { teamsRouter } from './teams.js';
import { platformAuditMiddleware } from '../../lib/platformAudit.js';

export const adminRouter = Router();

// Auth routes — no auth required (login, logout, me).
adminRouter.use('/auth', authRouter);

// Apply auth and rate limiting to all other admin routes.
adminRouter.use(adminAuth);
adminRouter.use(adminRateLimit);

// Child route modules.
adminRouter.use('/overview', overviewRouter);
adminRouter.use('/usage', usageRouter);
adminRouter.use('/errors', errorsRouter);
adminRouter.use('/workspaces', clientsRouter);
adminRouter.use('/clients', clientManagementRouter);
adminRouter.use('/bdrs', bdrManagementRouter);
adminRouter.use('/thresholds', thresholdsRouter);
adminRouter.use('/reports', reportsRouter);
adminRouter.use('/retention', retentionRouter);
adminRouter.use('/users', usersRouter);
adminRouter.use('/jobs', jobsRouter);
adminRouter.use('/campaigns', campaignAdminRouter);
adminRouter.use('/bdr-activity', bdrActivityRouter);
adminRouter.use('/eod-reports', eodReportsAdminRouter);
adminRouter.use('/enrichment-presets', enrichmentPresetsRouter);
adminRouter.use('/workspace-settings', workspaceSettingsRouter);
adminRouter.use('/onboarding-plans', onboardingPlansRouter);
adminRouter.use('/onboarding-enrollments', onboardingEnrollmentsRouter);
adminRouter.use('/onboarding-progress', onboardingProgressRouter);
adminRouter.use('/content-library', contentLibraryRouter);
adminRouter.use('/workflows', workflowsRouter);
adminRouter.use('/channel-mappings', channelMappingsRouter);
adminRouter.use('/billing', billingRouter);
adminRouter.use('/credit-rates', creditRatesRouter);
adminRouter.use('/slack', slackUsersRouter);
adminRouter.use('/slack', slackChannelsRouter);
adminRouter.use('/quality-gate-config', qualityGateConfigRouter);
adminRouter.use('/cache/apollo', apolloCacheRouter);
adminRouter.use('/cache', cacheRouter);
adminRouter.use('/crm', crmRouter);
adminRouter.use('/prompts', promptsRouter);
adminRouter.use('/provider-costs', providerCostsRouter);
adminRouter.use('/call-quality', callQualityRouter);
adminRouter.use('/active-calls', activeCallsRouter);
adminRouter.use('/recordings', recordingsRouter);
adminRouter.use('/recordings', recordingReviewsRouter);
adminRouter.use('/analytics', analyticsRouter);
adminRouter.use('/saved-views', savedViewsRouter);
adminRouter.use('/salesfloor', salesfloorRouter);
adminRouter.use('/dialer-config', dialerConfigRouter);
adminRouter.use('/uncallable', uncallableAdminRouter);
adminRouter.use('/contacts', contactsAdminRouter);
adminRouter.use('/credit-packs', creditPackRouter);
adminRouter.use('/licenses', licensingRouter);
adminRouter.use('/workspace-management', workspaceManagementRouter);

// Admin commands API (Feature 31 — mirrors Slack /admin subcommands as REST).
adminRouter.use('/commands', adminCommandsRouter);

// Autonomous agent management routes (Feature 31).
adminRouter.use('/autonomous', autonomousRouter);
adminRouter.use('/autonomous/teams', teamsRouter);

// Platform routes (Feature 39 - Vertical Pack Platform)
// Audit logging for all platform entity mutations (T072).
adminRouter.use('/agents', platformAuditMiddleware, agentAdminRouter);
adminRouter.use('/mcp-servers', platformAuditMiddleware, mcpServerAdminRouter);
adminRouter.use('/skills', platformAuditMiddleware, skillAdminRouter);
adminRouter.use('/packs', platformAuditMiddleware, packAdminRouter);
adminRouter.use('/', executionAdminRouter);
