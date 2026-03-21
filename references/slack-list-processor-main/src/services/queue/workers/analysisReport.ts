/**
 * BullMQ worker for analysis report generation jobs.
 *
 * Processes jobs from the 'analysis' queue with the name 'generate-report'.
 * Loads enriched data, runs opportunity scoring, generates AI narratives,
 * produces a PDF report, uploads it to S3 and Slack, and posts a summary.
 */

import { Worker, Job } from 'bullmq';
import { config } from '../../../config/index.js';
import { prisma } from '../../../models/index.js';
import { generateReport } from '../../analyze/reportGenerator.js';
import { generateReportPdfAsync } from '../../analyze/pdfGenerator.js';
import { buildReportSummaryBlocks } from '../../analyze/reportBlocks.js';
import { uploadFile } from '../../../lib/storage.js';
import { uploadSlackFile, markThreadForBotUpload } from '../../file/slackFile.js';
import type { ConfigDocType } from '@prisma/client';
import logger from '../../../lib/logger.js';
import type { AnalysisJobData } from '../queues.js';
import { promptContextCache } from '../../cache/promptCache.js';

// ---------------------------------------------------------------------------
// Worker processor
// ---------------------------------------------------------------------------

/**
 * Processes a single analysis report generation job.
 *
 * Steps:
 *   1. Mark job as PROCESSING in the database.
 *   2. Generate report data (scoring + AI narratives).
 *   3. Generate PDF from report data.
 *   4. Upload PDF to S3.
 *   5. Upload PDF to Slack thread.
 *   6. Post Block Kit summary alongside the PDF.
 *   7. Mark job as COMPLETED with results.
 */
async function processAnalysisJob(
  job: Job<AnalysisJobData>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  slackClient: any,
): Promise<void> {
  const { analysisJobId, sourceJobIds, channelId, threadTs, teamId } = job.data;
  const jobLogger = logger.withContext({ analysisJobId, channelId });

  jobLogger.info('Analysis report generation started', {
    sourceJobIds,
  });

  // --- Step 1: Mark PROCESSING ---
  await prisma.analysisJob.update({
    where: { id: analysisJobId },
    data: { status: 'PROCESSING', startedAt: new Date() },
  });

  // --- Step 2: Generate report data ---
  const report = await generateReport({
    sourceJobIds,
    teamId,
    channelId,
  });

  jobLogger.info('Report data generated', {
    totalAccounts: report.totalAccounts,
    topOpportunities: report.topOpportunities.length,
  });

  // --- Step 3: Generate PDF ---
  const pdfBuffer = await generateReportPdfAsync(report);

  jobLogger.info('PDF generated', { sizeBytes: pdfBuffer.length });

  // --- Step 4: Upload to S3 ---
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const pdfFileName = `${mm}${dd} Account Analysis Report.pdf`;
  const s3Key = `analysis/${analysisJobId}/report.pdf`;

  await uploadFile(s3Key, pdfBuffer, 'application/pdf');
  jobLogger.info('PDF uploaded to S3', { s3Key });

  // --- Step 5: Upload PDF to Slack ---
  markThreadForBotUpload(channelId, threadTs);

  await uploadSlackFile({
    client: slackClient,
    channelId,
    threadTs,
    fileBuffer: pdfBuffer,
    filename: pdfFileName,
    title: 'Account Analysis Report',
  });

  jobLogger.info('PDF uploaded to Slack');

  // --- Step 6: Post summary blocks ---
  const allTypes: Array<ConfigDocType> = [
    'ICP', 'USE_CASES', 'CAMPAIGNS', 'SETTINGS',
  ];
  const existingDocTypes = new Set<string>();
  if (report.missingDocs) {
    const missingSet = new Set(report.missingDocs.map((d) => d.docType));
    allTypes.forEach((t) => {
      if (!missingSet.has(t)) existingDocTypes.add(t);
    });
  }

  const missingDocTypes = report.missingDocs?.map((d) => d.docType as ConfigDocType) ?? [];

  const summaryBlocks = buildReportSummaryBlocks({
    summary: report.scoringSummary,
    totalContacts: report.keyMetrics.enrichedContacts,
    topCompanies: report.topOpportunities,
    cloudDistribution: report.cloudDistribution,
    missingDocs: missingDocTypes,
  });

  await slackClient.chat.postMessage({
    channel: channelId,
    thread_ts: threadTs,
    blocks: summaryBlocks,
    text: 'Account Analysis Report generated.',
  });

  // --- Step 7: Update job as COMPLETED ---
  const updatedAnalysisJob = await prisma.analysisJob.update({
    where: { id: analysisJobId },
    data: {
      status: 'COMPLETED',
      companyCount: report.totalAccounts,
      contactCount: report.keyMetrics.enrichedContacts,
      topOpportunityCount: report.topOpportunities.length,
      hasIcp: existingDocTypes.has('ICP'),
      hasUseCases: existingDocTypes.has('USE_CASES'),
      hasCampaigns: existingDocTypes.has('CAMPAIGNS'),
      hasSettings: existingDocTypes.has('SETTINGS'),
      resultPdfUrl: s3Key,
      resultPdfFileName: pdfFileName,
      summaryJson: {
        totalAccounts: report.totalAccounts,
        totalContacts: report.keyMetrics.enrichedContacts,
        migrationTargets: report.keyMetrics.migrationTargets,
        aiEnabled: report.keyMetrics.aiEnabled,
        highOpportunity: report.keyMetrics.highOpportunity,
      },
      completedAt: new Date(),
    },
  });

  // T027: Invalidate prompt context cache on analysis report completion
  await promptContextCache.invalidate(updatedAnalysisJob.slackTeamId, updatedAnalysisJob.slackUserId);

  // --- Log AI usage ---
  if (report.totalUsage) {
    await prisma.analysisApiUsageLog.create({
      data: {
        analysisJobId,
        endpoint: 'report-narratives',
        tokensInput: report.totalUsage.inputTokens,
        tokensOutput: report.totalUsage.outputTokens,
        estimatedCostUsd: report.totalUsage.estimatedCostUsd,
      },
    });
  }

  jobLogger.info('Analysis report generation complete', {
    s3Key,
    pdfFileName,
  });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates and returns a BullMQ Worker that listens on the 'analysis'
 * queue for jobs named 'generate-report'.
 *
 * @param slackClient - Authenticated Slack WebClient instance.
 * @returns A configured BullMQ Worker instance.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAnalysisWorker(slackClient: any): Worker {
  const worker = new Worker<AnalysisJobData>(
    'analysis',
    async (job: Job<AnalysisJobData>) => {
      if (job.name !== 'generate-report') {
        logger.debug('Skipping non-analysis job', { jobName: job.name });
        return;
      }

      await processAnalysisJob(job, slackClient);
    },
    {
      connection: { url: config.redis.url },
      concurrency: 1,
    },
  );

  worker.on('completed', (job: Job<AnalysisJobData>) => {
    logger.info('Analysis job completed', {
      bullmqJobId: job.id,
      analysisJobId: job.data.analysisJobId,
    });
  });

  worker.on('failed', (job: Job<AnalysisJobData> | undefined, err: Error) => {
    logger.error('Analysis job failed', {
      bullmqJobId: job?.id,
      analysisJobId: job?.data.analysisJobId,
      error: err.message,
    });

    if (job?.data.analysisJobId) {
      prisma.analysisJob
        .update({
          where: { id: job.data.analysisJobId },
          data: {
            status: 'FAILED',
            errorMessage: `Report generation failed: ${err.message}`,
            completedAt: new Date(),
          },
        })
        .then(updatedJob => {
          // T027: Invalidate prompt context cache on analysis report failure
          return promptContextCache.invalidate(updatedJob.slackTeamId, updatedJob.slackUserId);
        })
        .catch((updateErr: unknown) => {
          logger.error('Failed to update analysis job status after failure', {
            analysisJobId: job.data.analysisJobId,
            error: updateErr instanceof Error ? updateErr.message : String(updateErr),
          });
        });

      slackClient.chat
        .postMessage({
          channel: job.data.channelId,
          thread_ts: job.data.threadTs,
          text: `Failed to generate analysis report: ${err.message}. Please try again or contact support.`,
        })
        .catch((slackErr: unknown) => {
          logger.error('Failed to post analysis error to Slack', {
            analysisJobId: job.data.analysisJobId,
            error: slackErr instanceof Error ? slackErr.message : String(slackErr),
          });
        });
    }
  });

  return worker;
}
