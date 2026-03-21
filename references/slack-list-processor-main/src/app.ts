/**
 * Main application entry point (T020).
 *
 * Initializes the Slack Bolt app with Socket Mode alongside a parallel
 * Express HTTP server for REST API routes and webhooks. Registers all
 * event listeners and starts both servers.
 */

import { App } from '@slack/bolt';
import type { Server } from 'http';
import { config } from './config/index.js';
import { createHttpServer } from './server.js';
import { registerFileSharedListener } from './listeners/events/fileShared.js';
import { registerMessageListener } from './listeners/events/message.js';
import { registerAppUninstalledListener } from './listeners/events/appUninstalled.js';
import { registerPurposeSelectionHandlers } from './listeners/actions/purposeSelection.js';
import { registerReportFilterHandlers } from './listeners/actions/reportFilters.js';
import { registerCacheDecisionHandlers } from './listeners/actions/cacheDecision.js';
import { registerCosellCheckHandlers } from './listeners/actions/cosellCheck.js';
import { registerCloudProviderHandlers } from './listeners/actions/cloudProvider.js';
import { registerFileSelectionHandlers } from './listeners/actions/fileSelection.js';
import { registerContactChainHandlers } from './listeners/actions/contactChain.js';
import { registerDncScrubHandlers } from './listeners/actions/dncScrub.js';
import { registerEmailVerificationHandlers } from './listeners/actions/emailVerification.js';
import { registerTechReportChainHandlers } from './listeners/actions/techReportChain.js';
import { registerEnrichmentTypeHandlers } from './listeners/actions/enrichmentType.js';
import { registerEnrichmentDataSelectionHandlers } from './listeners/actions/enrichmentDataSelection.js';
import { registerListTypeHandlers } from './listeners/actions/listType.js';
import { registerFilterFlowHandlers } from './listeners/actions/filterFlow.js';
import { registerSplitFlowHandlers } from './listeners/actions/splitFlow.js';
import { registerFileUploadActionHandlers } from './listeners/actions/fileUploadActions.js';
import { registerAnalyzeFlowHandlers } from './listeners/actions/analyzeFlow.js';
// import { registerDocumentTypeConfirmHandlers } from './listeners/actions/documentTypeConfirm.js'; // Disabled
import { registerEnrichmentPresetHandlers } from './listeners/actions/enrichmentPresetSelection.js';
import { registerFileDetectionCancelAction } from './listeners/actions/fileDetectionCancel.js';
import { registerDocumentTypeCancelAction } from './listeners/actions/documentTypeCancel.js';
import { registerOnboardingCheckinHandlers } from './listeners/actions/onboardingCheckin.js';
import { registerOnboardingCompleteHandlers } from './listeners/actions/onboardingComplete.js';
import { registerOnboardingQuizHandlers } from './listeners/actions/onboardingQuiz.js';
import { registerGraduationReviewHandlers } from './listeners/actions/graduationReview.js';
import { registerWorkflowActionHandlers } from './listeners/actions/workflowAction.js';
import { registerEnrichCommand } from './listeners/commands/enrich.js';
import { registerFilterCommand } from './listeners/commands/filter.js';
import { registerSplitCommand } from './listeners/commands/split.js';
import { registerAnalyzeCommand } from './listeners/commands/analyze.js';
import { registerOnboardCommand } from './listeners/commands/onboard.js';
import { registerAssignManagerCommand } from './listeners/commands/assignManager.js';
import { registerUploadCommand } from './listeners/commands/upload.js';
import { registerRenameListCommand } from './listeners/commands/renameList.js';
import { registerHubspotCommand } from './listeners/commands/hubspot.js';
import { registerAdminCommand } from './listeners/commands/admin.js';
import { registerRenameListHandlers } from './listeners/actions/renameList.js';
import { createEnrichmentDispatcher } from './services/queue/workers/enrichmentDispatcher.js';
import { createFileGenerationWorker } from './services/queue/workers/fileGeneration.js';
import { createDncScrubWorker } from './services/queue/workers/dncScrub.js';
import { createEmailVerificationWorker } from './services/queue/workers/emailVerification.js';
import { createPhonesReadyWorker } from './services/queue/workers/phonesReady.js';
import { createAnalysisWorker } from './services/queue/workers/analysisReport.js';
import { createDocumentConversionWorker } from './services/queue/workers/documentConversion.js';
import { createProgressUpdater } from './services/queue/progressUpdater.js';
import { startPhoneLookupTimeoutScheduler } from './services/queue/workers/phoneLookupTimeout.js';
import { initBotUserId } from './services/file/slackFile.js';
import { registerAdminRepeatableJobs, registerCampaignRepeatableJobs, syncOnboardingSchedulers, registerOnboardingRepeatableJobs, registerWorkflowRepeatableJobs, registerBillingRepeatableJobs, registerDialerCallbackRepeatableJobs } from './services/queue/queues.js';
import { createDailyAggregateWorker } from './services/queue/workers/dailyAggregate.js';
import { createScheduledReportWorker } from './services/queue/workers/scheduledReport.js';
import { createRetentionPurgeWorker } from './services/queue/workers/retentionPurge.js';
import { createCampaignDispatcher } from './services/queue/workers/campaignDispatcher.js';
import { createOnboardingWorker } from './services/queue/workers/onboardingWorker.js';
import { createWorkflowWorker } from './services/queue/workers/workflowWorker.js';
import { createBillingCycleResetWorker } from './services/queue/workers/billingCycleReset.js';
import { createHubSpotImportWorker } from './services/queue/workers/hubspotImportWorker.js';
import { createHubSpotActivityWorker } from './services/queue/workers/hubspotActivityWorker.js';
import { createCachePurgeWorker } from './services/queue/workers/cachePurge.js';
import { createRecordingProcessingWorker } from './services/queue/workers/recordingProcessingWorker.js';
import { createDialerInactivityWorker } from './services/queue/workers/dialerInactivityWorker.js';
import { createDialerCallbackWorker } from './services/queue/workers/dialerCallbackWorker.js';
import { createSmartReplyWorker } from './services/queue/workers/smartReplyWorker.js';
import { registerHubspotImportHandlers } from './listeners/actions/hubspotImport.js';
import { registerHubspotActivityHandlers } from './listeners/actions/hubspotActivity.js';
import { registerAppHomeOpenedListener } from './listeners/events/appHomeOpened.js';
import { registerOnboardingWizardHandlers } from './listeners/actions/onboardingWizard.js';
import { registerCreditPreviewHandlers } from './listeners/actions/creditPreview.js';
import { registerCreditPackPurchaseHandlers } from './listeners/actions/creditPackPurchase.js';
import { registerSendCopyToHandlers } from './listeners/actions/sendCopyTo.js';
import { registerChannelRegistrationHandlers } from './listeners/actions/channelRegistration.js';
import { registerChannelLifecycleListeners } from './listeners/events/channelLifecycle.js';
import { registerPersonalityAnalysisHandlers } from './listeners/actions/personalityAnalysis.js';
import { registerCompanyIntelligenceHandlers } from './listeners/actions/companyIntelligence.js';
import { registerAgentApprovalHandlers } from './listeners/actions/agentApproval.js';
import { registerAdminAuditActions } from './listeners/actions/adminAudit.js';
import { createAssistant } from './services/agent/assistant.js';
import { resolveFeatureFlags } from './services/featureToggle/featureFlags.js';
import { prisma } from './models/index.js';
import redis from './lib/redis.js';
import logger from './lib/logger.js';

/**
 * Slack Bolt application configured with Socket Mode.
 *
 * Socket Mode uses a WebSocket connection instead of HTTP, so Slack events
 * are received without exposing a public endpoint. The separate Express
 * HTTP server (below) handles REST API routes and webhook endpoints.
 */
const app = new App({
  token: config.slack.botToken,
  appToken: config.slack.appToken,
  socketMode: true,
  signingSecret: config.slack.signingSecret,
});

/* ---- Global Middleware: Inject feature flags into context ---- */
app.use(async ({ context, next }) => {
  try {
    const teamId = context.teamId as string | undefined;
    if (teamId) {
      const workspace = await prisma.workspaceInstallation.findUnique({
        where: { slackTeamId: teamId },
        select: { featureFlags: true, onboardingStatus: true },
      });
      context.featureFlags = resolveFeatureFlags(
        teamId,
        workspace?.featureFlags as Record<string, unknown> | null,
      );
      context.onboardingStatus = workspace?.onboardingStatus ?? 'PENDING';
    }
  } catch {
    // On failure, allow through with no flags (requireFeature will allow by default)
  }
  await next();
});

/* ---- Register Event Listeners & Commands ---- */

registerFileSharedListener(app);
registerMessageListener(app);
registerAppUninstalledListener(app);
registerEnrichCommand(app);
registerFilterCommand(app);
registerSplitCommand(app);
registerAnalyzeCommand(app);
registerOnboardCommand(app);
registerAssignManagerCommand(app);
registerUploadCommand(app);
registerRenameListCommand(app);
registerHubspotCommand(app);
registerAdminCommand(app);
registerAdminAuditActions(app);
registerPurposeSelectionHandlers(app);
registerReportFilterHandlers(app);
registerCacheDecisionHandlers(app);
registerCosellCheckHandlers(app);
registerCloudProviderHandlers(app);
registerFileSelectionHandlers(app);
registerContactChainHandlers(app);
registerDncScrubHandlers(app);
registerEmailVerificationHandlers(app);
registerTechReportChainHandlers(app);
registerEnrichmentTypeHandlers(app);
registerEnrichmentDataSelectionHandlers(app);
registerListTypeHandlers(app);
registerFilterFlowHandlers(app);
registerSplitFlowHandlers(app);
registerFileUploadActionHandlers(app);
registerAnalyzeFlowHandlers(app);
// registerDocumentTypeConfirmHandlers(app); // Disabled
registerEnrichmentPresetHandlers(app);
registerOnboardingCheckinHandlers(app);
registerOnboardingCompleteHandlers(app);
registerOnboardingQuizHandlers(app);
registerGraduationReviewHandlers(app);
registerWorkflowActionHandlers(app);
registerRenameListHandlers(app);
registerHubspotImportHandlers(app);
registerHubspotActivityHandlers(app);
registerFileDetectionCancelAction(app);
registerDocumentTypeCancelAction(app);

/* ---- Multi-Tenant Onboarding & Credit Management (Feature 35) ---- */
registerAppHomeOpenedListener(app);
registerOnboardingWizardHandlers(app);
registerCreditPreviewHandlers(app);
registerCreditPackPurchaseHandlers(app);
registerSendCopyToHandlers(app);
registerChannelRegistrationHandlers(app);
registerChannelLifecycleListeners(app);
registerPersonalityAnalysisHandlers(app);
registerCompanyIntelligenceHandlers(app);
registerAgentApprovalHandlers(app);

/* ---- Register Agent Assistant ---- */
const assistant = createAssistant();
app.assistant(assistant);

/* ---- Main Startup ---- */

/** Closeable resources collected during startup for graceful shutdown. */
interface AppResources {
  httpServer: Server;
  workers: Array<{ close: () => Promise<void> }>;
}

let resources: AppResources | null = null;
let isShuttingDown = false;

/**
 * Graceful shutdown handler.
 *
 * Shutdown sequence:
 * 1. Close BullMQ workers (stop accepting new jobs, finish in-flight)
 * 2. Close HTTP server (stop accepting new connections)
 * 3. Disconnect Prisma (close database pool)
 * 4. Disconnect Redis (close cache connection)
 */
async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`${signal} received — starting graceful shutdown`);

  try {
    // 1. Close BullMQ workers
    if (resources?.workers.length) {
      logger.info(`Closing ${resources.workers.length} BullMQ workers`);
      await Promise.allSettled(resources.workers.map((w) => w.close()));
      logger.info('BullMQ workers closed');
    }

    // 2. Close HTTP server
    if (resources?.httpServer) {
      await new Promise<void>((resolve, reject) => {
        resources!.httpServer.close((err) => (err ? reject(err) : resolve()));
      });
      logger.info('HTTP server closed');
    }

    // 3. Disconnect Prisma
    await prisma.$disconnect();
    logger.info('Prisma disconnected');

    // 4. Disconnect Redis
    await redis.quit();
    logger.info('Redis disconnected');
  } catch (err) {
    logger.error('Error during shutdown', { error: err });
  }

  logger.info('Graceful shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

/**
 * Seed provider pricing if the ProviderCost table is empty (Feature 27).
 *
 * Runs once at startup to ensure waterfall enrichment has pricing data.
 * Uses upsert so it's safe to run repeatedly.
 */
async function seedProviderPricingIfNeeded(): Promise<void> {
  try {
    const effectiveDate = new Date('2026-03-14T00:00:00Z');
    const pricing = [
      { provider: 'APOLLO' as const, dataType: 'EMAIL' as const, costPerUnit: 0.05, notes: 'Apollo email: 1 credit @ $0.05' },
      { provider: 'APOLLO' as const, dataType: 'PHONE' as const, costPerUnit: 0.05, notes: 'Apollo phone: 1 credit @ $0.05 (via people/match reveal)' },
      { provider: 'WIZA' as const, dataType: 'EMAIL' as const, costPerUnit: 0.05, creditsPerUnit: 2, notes: 'Wiza email: 2 credits @ $0.025' },
      { provider: 'WIZA' as const, dataType: 'PHONE' as const, costPerUnit: 0.125, creditsPerUnit: 5, notes: 'Wiza phone: 5 credits @ $0.025' },
      { provider: 'AI_ARK' as const, dataType: 'EMAIL' as const, costPerUnit: 0.14, notes: 'AI Ark email estimate' },
      { provider: 'AI_ARK' as const, dataType: 'PHONE' as const, costPerUnit: 0.27, notes: 'AI Ark phone estimate' },
      { provider: 'FINDYMAIL' as const, dataType: 'EMAIL' as const, costPerUnit: 0.01, notes: 'Findymail email verification' },
    ];

    for (const p of pricing) {
      await prisma.providerCost.upsert({
        where: { provider_dataType_effectiveDate: { provider: p.provider, dataType: p.dataType, effectiveDate } },
        create: { provider: p.provider, dataType: p.dataType, costPerUnit: p.costPerUnit, creditsPerUnit: p.creditsPerUnit ?? null, effectiveDate, notes: p.notes },
        update: {},
      });
    }

    logger.info('Provider pricing seeded at startup', { count: pricing.length });
  } catch (error) {
    // Non-fatal: pricing seed failure shouldn't block app startup
    logger.warn('Failed to seed provider pricing (table may not exist yet)', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Starts the Bolt Socket Mode connection and the Express HTTP server.
 */
async function main(): Promise<void> {
  // Seed provider pricing if table is empty (Feature 27: Waterfall enrichment).
  await seedProviderPricingIfNeeded();

  // Start the Bolt app (Socket Mode WebSocket connection).
  await app.start();
  logger.info('Slack Bolt app started in Socket Mode');

  // Cache bot user ID for reliable bot-upload detection.
  await initBotUserId(app.client);

  // Create and start the Express HTTP server for REST routes and webhooks.
  const httpApp = createHttpServer();

  const httpServer = httpApp.listen(config.httpPort, () => {
    logger.info(`HTTP server listening on port ${config.httpPort}`);
  });

  // Start BullMQ workers for background job processing.
  const slackClient = app.client;
  const workers: Array<{ close: () => Promise<void> }> = [];

  workers.push(createEnrichmentDispatcher());
  workers.push(createFileGenerationWorker(slackClient));
  workers.push(createDncScrubWorker(slackClient));
  workers.push(createEmailVerificationWorker(slackClient));
  workers.push(createPhonesReadyWorker());
  workers.push(createAnalysisWorker(slackClient));
  workers.push(createDocumentConversionWorker(slackClient));
  workers.push(createProgressUpdater(slackClient));

  // Start scheduled phone lookup timeout checker (T066).
  await startPhoneLookupTimeoutScheduler();

  // Register admin dashboard repeatable jobs (daily aggregate, retention purge).
  await registerAdminRepeatableJobs();
  workers.push(createDailyAggregateWorker());
  workers.push(createScheduledReportWorker());
  workers.push(createRetentionPurgeWorker());
  workers.push(createCachePurgeWorker());

  // Start campaign dispatcher and register repeatable campaign jobs.
  workers.push(createCampaignDispatcher(slackClient));
  await registerCampaignRepeatableJobs();

  // Start onboarding worker and register repeatable/per-enrollment jobs.
  workers.push(createOnboardingWorker(slackClient));
  await registerOnboardingRepeatableJobs();
  await syncOnboardingSchedulers();

  // Start workflow worker and register repeatable workflow jobs (expiry scanning).
  workers.push(createWorkflowWorker(slackClient));
  await registerWorkflowRepeatableJobs();

  // Start billing cycle reset worker and register daily reset job.
  workers.push(createBillingCycleResetWorker());
  await registerBillingRepeatableJobs();

  // Start HubSpot import and activity sync workers.
  workers.push(createHubSpotImportWorker(slackClient));
  workers.push(createHubSpotActivityWorker());

  // Start recording processing worker (Feature 22 - Power Dialer).
  workers.push(createRecordingProcessingWorker());

  // Start dialer inactivity worker (T062 - session timeout).
  workers.push(createDialerInactivityWorker());

  // Start dialer callback worker and register repeatable missed callback check (T077).
  workers.push(createDialerCallbackWorker());
  await registerDialerCallbackRepeatableJobs();

  // Start smart reply draft generation worker (Feature 29 - Smart Reply Assistant).
  workers.push(createSmartReplyWorker());

  // Store references for graceful shutdown.
  resources = { httpServer, workers };

  logger.info('BullMQ workers started');

  logger.info('Slack List Processor is running', {
    nodeEnv: config.nodeEnv,
    httpPort: config.httpPort,
  });
}

main().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});

export { app };
