/**
 * Action handlers for the /analyze interactive flow.
 *
 * Handles:
 * - Job selection (analyze_select_job_*) — toggles job selection
 * - Confirm start (analyze_confirm_start) — enqueues analysis job
 * - Config doc file upload processing (called from fileShared listener)
 */

import type { App } from '@slack/bolt';
import { prisma } from '../../models/index.js';
import {
  getConversation,
  updateConversation,
} from '../../services/state/conversationStore.js';
import { analysisQueue, type AnalysisJobData } from '../../services/queue/queues.js';
import {
  upsertConfigDoc,
} from '../../services/analyze/configDocService.js';
import { DOC_TYPE_LABELS } from '../../services/analyze/configDocService.js';
import { buildConfigDocUploadedBlocks } from '../../services/analyze/reportBlocks.js';
import { downloadSlackFile } from '../../services/file/slackFile.js';
import { config } from '../../config/index.js';
import logger from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Action registration
// ---------------------------------------------------------------------------

/**
 * Registers all /analyze interactive action handlers with the Bolt app.
 */
export function registerAnalyzeFlowHandlers(app: App): void {
  // --- Job selection: toggle individual jobs ---
  app.action(/^analyze_select_job_/, async ({ action, ack, body, client }) => {
    await ack();

    if (action.type !== 'button' || body.type !== 'block_actions') return;

    const channelId = body.channel?.id;
    const threadTs = body.message?.thread_ts ?? body.message?.ts;
    if (!channelId || !threadTs) return;

    const jobId = action.value;
    if (!jobId) return;

    const conversation = await getConversation(channelId, threadTs);
    if (!conversation || conversation.flowType !== 'analyze') return;

    // Toggle job ID in the selected list
    const currentIds = conversation.analysisSourceJobIds ?? [];
    const isSelected = currentIds.includes(jobId);
    const updatedIds = isSelected
      ? currentIds.filter((id) => id !== jobId)
      : [...currentIds, jobId];

    await updateConversation(channelId, threadTs, {
      analysisSourceJobIds: updatedIds,
    });

    // Post confirmation in thread
    const actionLabel = isSelected ? 'deselected' : 'selected';
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: { sourceFileName: true, jobType: true },
    });

    const fileName = job?.sourceFileName ?? jobId.slice(0, 8);
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `Data source ${actionLabel}: *${fileName}* (${job?.jobType ?? 'enrichment'}). ${updatedIds.length} source(s) selected.\n\nClick *Start Analysis* when ready.`,
    });

    logger.info('Analysis source toggled', {
      channelId,
      threadTs,
      jobId,
      action: actionLabel,
      selectedCount: updatedIds.length,
    });
  });

  // --- Confirm start: enqueue analysis job ---
  app.action('analyze_confirm_start', async ({ ack, body, client }) => {
    await ack();

    if (body.type !== 'block_actions') return;

    const channelId = body.channel?.id;
    const threadTs = body.message?.thread_ts ?? body.message?.ts;
    const userId = body.user.id;
    if (!channelId || !threadTs) return;

    const conversation = await getConversation(channelId, threadTs);
    if (!conversation || conversation.flowType !== 'analyze') return;

    const sourceJobIds = conversation.analysisSourceJobIds ?? [];

    // If no jobs selected, select all available
    let finalJobIds = sourceJobIds;
    if (finalJobIds.length === 0) {
      const recentJobs = await prisma.job.findMany({
        where: {
          slackChannelId: channelId,
          status: 'COMPLETED',
          jobType: { in: ['TECHNOGRAPHIC', 'COMBINED'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true },
      });
      finalJobIds = recentJobs.map((j) => j.id);
    }

    if (finalJobIds.length === 0) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: 'No enrichment data found to analyze. Please run an enrichment first with `/enrich`.',
      });
      return;
    }

    // Get source file names for the analysis job record
    const sourceJobs = await prisma.job.findMany({
      where: { id: { in: finalJobIds } },
      select: { sourceFileName: true },
    });
    const sourceFileNames = sourceJobs
      .map((j) => j.sourceFileName)
      .filter(Boolean) as string[];

    // Create AnalysisJob in database
    const analysisJob = await prisma.analysisJob.create({
      data: {
        slackChannelId: channelId,
        slackThreadTs: threadTs,
        slackUserId: userId,
        slackTeamId: conversation.teamId ?? '',
        status: 'PENDING',
        sourceJobIds: finalJobIds,
        sourceFileNames,
      },
    });

    // Enqueue BullMQ job
    const jobData: AnalysisJobData = {
      analysisJobId: analysisJob.id,
      sourceJobIds: finalJobIds,
      channelId,
      threadTs,
      teamId: conversation.teamId ?? '',
    };

    const bullmqJob = await analysisQueue.add('generate-report', jobData);

    // Update with BullMQ job ID
    await prisma.analysisJob.update({
      where: { id: analysisJob.id },
      data: { bullmqJobId: bullmqJob.id },
    });

    // Update conversation status
    await updateConversation(channelId, threadTs, {
      status: 'processing',
    });

    // Post processing message
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `Starting analysis report generation with ${finalJobIds.length} data source(s). This may take 1-2 minutes...`,
    });

    logger.info('Analysis job enqueued', {
      analysisJobId: analysisJob.id,
      bullmqJobId: bullmqJob.id,
      sourceJobIds: finalJobIds,
      channelId,
      threadTs,
    });
  });
}

// ---------------------------------------------------------------------------
// Config doc upload handler (called from fileShared listener)
// ---------------------------------------------------------------------------

/**
 * Handles a file upload in a config doc upload flow.
 * Downloads the file, reads its text content, and upserts it as a
 * ChannelConfigDoc.
 *
 * @param params - File info and conversation context.
 * @param slackClient - Authenticated Slack WebClient.
 */
export async function handleConfigDocUpload(params: {
  fileId: string;
  fileName: string;
  fileUrl: string;
  channelId: string;
  threadTs: string;
  userId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}, slackClient: any): Promise<void> {
  const { fileId, fileName, fileUrl, channelId, threadTs, userId } = params;

  const conversation = await getConversation(channelId, threadTs);
  if (!conversation || conversation.flowType !== 'analyze_config_upload') {
    return;
  }

  const docType = conversation.configDocType;
  if (!docType) {
    logger.warn('Config doc upload: no docType in conversation state', {
      channelId,
      threadTs,
    });
    return;
  }

  const teamId = conversation.teamId ?? '';

  try {
    // Download file content
    const fileBuffer = await downloadSlackFile(fileUrl, config.slack.botToken);
    const content = fileBuffer.toString('utf-8');

    if (!content.trim()) {
      await slackClient.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: 'The uploaded file appears to be empty. Please upload a file with content.',
      });
      return;
    }

    // Upsert config doc
    const doc = await upsertConfigDoc({
      teamId,
      channelId,
      docType,
      content,
      uploadedByUserId: userId,
      originalFileName: fileName,
    });

    // Post confirmation
    await slackClient.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      blocks: buildConfigDocUploadedBlocks(docType, doc.version),
      text: `Stored ${DOC_TYPE_LABELS[docType]} document (v${doc.version}).`,
    });

    logger.info('Config doc uploaded', {
      channelId,
      threadTs,
      docType,
      version: doc.version,
      fileId,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Error processing config doc upload', {
      channelId,
      threadTs,
      docType,
      error: errorMessage,
    });

    await slackClient.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `Failed to process the uploaded file: ${errorMessage}`,
    });
  }
}
