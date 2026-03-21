/**
 * Core service for renaming enrichment / filter result lists.
 *
 * Handles:
 *   1. Building the new filename via the shared naming utility
 *   2. Updating the database record (Job or FilterJob)
 *   3. Downloading the file from S3
 *   4. Re-uploading to Slack with the new filename
 */

import { prisma } from '../../models/index.js';
import { downloadFile } from '../../lib/storage.js';
import {
  uploadSlackFile,
  markThreadForBotUpload,
} from '../file/slackFile.js';
import { buildListFilename } from '../file/listNaming.js';
import logger from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RenameListParams {
  /** Job ID (either a Job or FilterJob). */
  jobId: string;
  /** Whether this is an enrichment job or a filter job. */
  jobType: 'enrichment' | 'filter';
  /** User-provided campaign / target list name. */
  campaignName: string;
  /** Optional co-sell partner name. */
  cosellName?: string | null;
  /** Slack channel name (for client extraction). */
  channelName: string;
  /** Authenticated Slack WebClient instance. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  slackClient: any;
  /** Slack channel ID where the result should be posted. */
  channelId: string;
  /** Thread timestamp for threading the re-uploaded file. */
  threadTs: string;
}

export interface RenameListResult {
  oldFileName: string;
  newFileName: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Renames a list file: updates DB, downloads from S3, and re-uploads to Slack.
 *
 * @param params - Rename parameters
 * @returns Old and new filenames for confirmation messaging
 * @throws If the job is not found or has no result file
 */
export async function renameList(params: RenameListParams): Promise<RenameListResult> {
  const {
    jobId,
    jobType,
    campaignName,
    cosellName,
    channelName,
    slackClient,
    channelId,
    threadTs,
  } = params;

  // Load the job record
  const isFilter = jobType === 'filter';
  const record = isFilter
    ? await prisma.filterJob.findUnique({ where: { id: jobId } })
    : await prisma.job.findUnique({ where: { id: jobId } });

  if (!record) {
    throw new Error(`Job not found: ${jobId} (type=${jobType})`);
  }
  if (!record.resultFileUrl) {
    throw new Error(`Job ${jobId} has no result file to rename`);
  }

  const oldFileName = record.resultFileName ?? 'unknown';

  // Determine extension from existing filename or S3 key
  const extension =
    oldFileName.match(/\.(csv|xlsx)$/i)?.[1]?.toLowerCase() ??
    record.resultFileUrl.match(/\.(csv|xlsx)$/i)?.[1]?.toLowerCase() ??
    'csv';

  // Build the new filename
  const newFileName = buildListFilename({
    channelName,
    campaignName,
    cosellName,
    extension,
    jobType: isFilter ? undefined : (record as any).jobType,
  });

  // Update DB record
  if (isFilter) {
    await prisma.filterJob.update({
      where: { id: jobId },
      data: { resultFileName: newFileName },
    });
  } else {
    await prisma.job.update({
      where: { id: jobId },
      data: {
        resultFileName: newFileName,
        campaignName,
        cosellProvider: cosellName || undefined,
      },
    });
  }

  logger.info('List renamed in database', {
    jobId,
    jobType,
    oldFileName,
    newFileName,
  });

  // Download from S3 and re-upload to Slack with new name
  try {
    const fileBuffer = await downloadFile(record.resultFileUrl);

    markThreadForBotUpload(channelId, threadTs);

    await uploadSlackFile({
      client: slackClient,
      channelId,
      threadTs,
      fileBuffer,
      filename: newFileName,
      title: newFileName,
      initialComment: `Renamed: \`${oldFileName}\` → \`${newFileName}\``,
    });

    logger.info('Renamed file re-uploaded to Slack', {
      jobId,
      newFileName,
      channelId,
    });
  } catch (err) {
    logger.error('Failed to re-upload renamed file to Slack', {
      jobId,
      error: err instanceof Error ? err.message : String(err),
    });
    // DB update already succeeded — warn but don't throw
  }

  return { oldFileName, newFileName };
}
