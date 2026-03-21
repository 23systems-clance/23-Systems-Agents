/**
 * Slack channel sender service for "Send Copy To" (T032).
 *
 * Sends enrichment result files to a Slack channel by downloading
 * from S3 and uploading via Slack's files.uploadV2 API.
 */

import type { WebClient } from '@slack/web-api';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { prisma } from '../../models/index.js';
import { config } from '../../config/index.js';
import logger from '../../lib/logger.js';

const s3 = new S3Client({ region: config.s3.region });

/**
 * Sends an enrichment result file to a Slack channel.
 *
 * @param jobId       - Enrichment job ID for file lookup.
 * @param channelId   - Target Slack channel ID.
 * @param slackTeamId - Workspace team ID.
 * @param client      - Slack Web API client.
 * @returns True if uploaded successfully.
 */
export async function sendResultToChannel(
  jobId: string,
  channelId: string,
  slackTeamId: string,
  client: WebClient,
): Promise<boolean> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      jobType: true,
      sourceRowCount: true,
      resultFileName: true,
      resultFileUrl: true,
      createdAt: true,
      slackTeamId: true,
    },
  });

  if (!job || job.slackTeamId !== slackTeamId) {
    logger.warn('sendResultToChannel: job not found or unauthorized', { jobId, slackTeamId });
    return false;
  }

  if (!job.resultFileUrl) {
    logger.warn('sendResultToChannel: no result file for job', { jobId });
    return false;
  }

  try {
    // Download file from S3
    const s3Response = await s3.send(new GetObjectCommand({
      Bucket: config.s3.bucket,
      Key: job.resultFileUrl,
    }));

    const fileBuffer = Buffer.from(await s3Response.Body!.transformToByteArray());
    const fileName = job.resultFileName || `enrichment-${jobId}.csv`;

    // Upload to Slack channel
    await client.filesUploadV2({
      channel_id: channelId,
      file: fileBuffer,
      filename: fileName,
      title: `Enrichment Results: ${fileName}`,
      initial_comment: `Enrichment results shared from job (${job.jobType}, ${job.sourceRowCount ?? 0} rows, ${job.createdAt.toISOString().split('T')[0]})`,
    });

    logger.info('Enrichment result sent to Slack channel', {
      jobId,
      channelId,
      slackTeamId,
    });

    return true;
  } catch (error) {
    logger.error('Failed to send enrichment result to channel', {
      jobId,
      channelId,
      slackTeamId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
