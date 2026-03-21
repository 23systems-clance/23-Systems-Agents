/**
 * BullMQ worker for document conversion jobs.
 *
 * Processes jobs from the 'document-processing' queue. Downloads the
 * original file from Slack, converts it to markdown, uploads to S3,
 * classifies the document, and posts classification buttons in the
 * originating Slack thread.
 */

import { Worker, Job } from 'bullmq';
import type { WebClient } from '@slack/web-api';
import type { KnownBlock } from '@slack/types';
import type { DocumentType } from '@prisma/client';
import { config } from '../../../config/index.js';
import { prisma } from '../../../models/index.js';
import { convertToMarkdown } from '../../document/converter.js';
import { classifyByFilename, generateSlug } from '../../document/filenameClassifier.js';
import { classifyDocument } from '../../ai/documentClassifier.js';
import { uploadFile } from '../../../lib/storage.js';
import redis from '../../../lib/redis.js';
import logger from '../../../lib/logger.js';
import type { DocumentConversionJobData } from '../queues.js';

/** Redis key prefix for pending classification state. */
const CLASSIFY_STATE_PREFIX = 'doc-classify';

/** TTL for pending classification state (1 hour). */
const CLASSIFY_STATE_TTL = 3600;

/**
 * Processes a single document conversion job.
 *
 * @param job - BullMQ job with conversion data.
 * @param slackClient - Slack Web API client for posting messages.
 */
async function processDocumentConversion(
  job: Job<DocumentConversionJobData>,
  slackClient: WebClient,
): Promise<void> {
  const { teamId, channelId, threadTs, userId, slackFileId, fileName, mimeType } = job.data;
  const slug = generateSlug(fileName);

  logger.info('Starting document conversion', {
    jobId: job.id,
    fileName,
    mimeType,
    slug,
  });

  // Download file from Slack.
  const fileInfo = await slackClient.files.info({ file: slackFileId });
  const downloadUrl = (fileInfo.file as Record<string, unknown>)?.url_private_download as
    | string
    | undefined;

  if (!downloadUrl) {
    throw new Error(`No download URL available for file ${slackFileId}`);
  }

  const response = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${config.slack.botToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to download file from Slack: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  // Convert to markdown.
  const { markdown, warnings } = await convertToMarkdown(buffer, mimeType, fileName);

  if (warnings.length > 0) {
    logger.warn('Document conversion warnings', { fileName, warnings });
  }

  // Upload converted markdown to S3.
  const s3Key = `docs/${teamId}/${channelId}/${slug}.md`;
  await uploadFile(s3Key, Buffer.from(markdown, 'utf-8'), 'text/markdown');

  // Upload original file to S3 for archival.
  const ext = fileName.split('.').pop() ?? 'bin';
  const originalS3Key = `docs/${teamId}/${channelId}/originals/${slug}-${slackFileId}.${ext}`;
  await uploadFile(originalS3Key, buffer, mimeType);

  // Classify the document.
  let suggestedType = classifyByFilename(fileName);
  let label = slug;
  let summary = '';
  let classificationSource = 'filename';

  if (!suggestedType) {
    classificationSource = 'ai';
    const aiResult = await classifyDocument(markdown, fileName);
    suggestedType = aiResult.classification.documentType as DocumentType;
    label = aiResult.classification.suggestedLabel;
    summary = aiResult.classification.summary;
  } else {
    try {
      const aiResult = await classifyDocument(markdown, fileName);
      summary = aiResult.classification.summary;
      label = aiResult.classification.suggestedLabel || label;
    } catch {
      summary = '';
    }
  }

  const typeLabel = suggestedType ?? 'UNKNOWN';
  const contentSizeBytes = Buffer.byteLength(markdown, 'utf-8');

  // Post classification buttons in thread.
  const blocks: KnownBlock[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `Converted *${fileName}* to markdown (${(contentSizeBytes / 1024).toFixed(1)} KB)\n\n` +
          `Suggested type: *${typeLabel}* (from ${classificationSource})\n\n` +
          'Please confirm or select the correct document type:',
      },
    },
    {
      type: 'actions',
      block_id: `doc_classify_${slackFileId}`,
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'ICP' },
          action_id: 'doc_type_icp',
          ...(typeLabel === 'ICP' ? { style: 'primary' as const } : {}),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Use Case' },
          action_id: 'doc_type_use_case',
          ...(typeLabel === 'USE_CASE' ? { style: 'primary' as const } : {}),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Settings' },
          action_id: 'doc_type_settings',
          ...(typeLabel === 'SETTINGS' ? { style: 'primary' as const } : {}),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'One-Pager' },
          action_id: 'doc_type_one_pager',
          ...(typeLabel === 'ONE_PAGER' ? { style: 'primary' as const } : {}),
        },
      ],
    },
  ];

  const botReply = await slackClient.chat.postMessage({
    channel: channelId,
    thread_ts: threadTs,
    blocks,
    text: `Converted ${fileName}. Please confirm the document type.`,
  });

  // Store pending classification state in Redis.
  const stateKey = `${CLASSIFY_STATE_PREFIX}:${channelId}:${botReply.ts ?? threadTs}`;
  await redis.hset(stateKey, {
    fileId: slackFileId,
    slug,
    channelId,
    teamId,
    userId,
    s3Key,
    originalS3Key,
    suggestedType: typeLabel,
    label,
    summary,
    originalFileName: fileName,
    originalMimeType: mimeType,
    contentSizeBytes: String(contentSizeBytes),
    threadTs,
    messageTs: botReply.ts ?? threadTs,
  });
  await redis.expire(stateKey, CLASSIFY_STATE_TTL);

  logger.info('Document conversion completed', {
    jobId: job.id,
    slug,
    suggestedType: typeLabel,
    contentSizeBytes,
  });
}

/**
 * Creates and returns a BullMQ worker for the document-processing queue.
 *
 * @param slackClient - Slack Web API client for posting messages.
 * @returns A configured BullMQ Worker instance.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createDocumentConversionWorker(slackClient: any): Worker {
  const worker = new Worker<DocumentConversionJobData>(
    'document-processing',
    async (job: Job<DocumentConversionJobData>) => {
      await processDocumentConversion(job, slackClient);
    },
    {
      connection: { url: config.redis.url },
      concurrency: 2,
    },
  );

  worker.on('completed', (job: Job<DocumentConversionJobData>) => {
    logger.info('Document conversion job completed', {
      bullmqJobId: job.id,
      fileName: job.data.fileName,
    });
  });

  worker.on('failed', (job: Job<DocumentConversionJobData> | undefined, err: Error) => {
    const data = job?.data;
    logger.error('Document conversion job failed', {
      bullmqJobId: job?.id,
      fileName: data?.fileName,
      error: err.message,
    });

    // Update the Slack thread with failure message if we have context.
    if (data) {
      slackClient.chat
        .postMessage({
          channel: data.channelId,
          thread_ts: data.threadTs,
          text: `Failed to convert *${data.fileName}*: ${err.message}`,
        })
        .catch((postErr: Error) => {
          logger.error('Failed to post conversion error to Slack', {
            error: postErr.message,
          });
        });

      // Create a FAILED document record for tracking.
      prisma.clientDocument
        .upsert({
          where: {
            slackTeamId_slackChannelId_slug: {
              slackTeamId: data.teamId,
              slackChannelId: data.channelId,
              slug: generateSlug(data.fileName),
            },
          },
          create: {
            slackTeamId: data.teamId,
            slackChannelId: data.channelId,
            slackUserId: data.userId,
            slackFileId: data.slackFileId,
            slug: generateSlug(data.fileName),
            label: generateSlug(data.fileName),
            documentType: 'UNKNOWN',
            status: 'FAILED',
            s3Key: '',
            originalFileName: data.fileName,
            originalMimeType: data.mimeType,
            errorMessage: err.message,
            slackThreadTs: data.threadTs,
          },
          update: {
            status: 'FAILED',
            errorMessage: err.message,
          },
        })
        .catch((dbErr: Error) => {
          logger.error('Failed to create FAILED document record', {
            error: dbErr.message,
          });
        });
    }
  });

  logger.info('Document conversion worker started');

  return worker;
}
