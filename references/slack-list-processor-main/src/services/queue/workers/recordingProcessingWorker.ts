/**
 * BullMQ worker for recording processing jobs (Feature 22 - Power Dialer Phase 5).
 *
 * Processes jobs from the 'recording-processing' queue:
 *   1. Copy recording WAV from Twilio to S3
 *   2. Delete recording from Twilio (cost savings)
 *   3. Submit to Deepgram Nova-2 for async transcription
 */

import { Worker, Job } from 'bullmq';
import { config } from '../../../config/index.js';
import { copyToS3, deleteFromTwilio } from '../../dialer/recordingManager.js';
import { submitForTranscription } from '../../dialer/transcriptionService.js';
import logger from '../../../lib/logger.js';
import type { RecordingProcessingJobData } from '../queues.js';

// ---------------------------------------------------------------------------
// Worker processor
// ---------------------------------------------------------------------------

/**
 * Processes a single recording processing job.
 *
 * Steps:
 *   1. Copy WAV from Twilio to S3
 *   2. Delete recording from Twilio
 *   3. Submit S3 recording to Deepgram for transcription
 */
async function processRecordingJob(
  job: Job<RecordingProcessingJobData>,
): Promise<void> {
  const { callRecordingId, callSessionId, recordingSid, recordingUrl, clientId, callSid } = job.data;

  logger.info('[RecordingWorker] Processing recording', {
    callRecordingId,
    callSessionId,
    recordingSid,
  });

  // Step 1: Copy recording from Twilio to S3
  await copyToS3(callRecordingId, recordingSid, recordingUrl, clientId, callSid);

  // Step 2: Delete from Twilio to save storage costs
  try {
    await deleteFromTwilio(recordingSid);
  } catch (error) {
    // Non-fatal — log and continue to transcription
    logger.warn('[RecordingWorker] Failed to delete recording from Twilio (non-fatal)', {
      recordingSid,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Step 3: Submit to Deepgram for transcription (async — Deepgram calls back)
  await submitForTranscription(callRecordingId);

  logger.info('[RecordingWorker] Recording processing complete', {
    callRecordingId,
    callSessionId,
  });
}

// ---------------------------------------------------------------------------
// Worker factory
// ---------------------------------------------------------------------------

/**
 * Creates and returns the recording processing BullMQ worker.
 */
export function createRecordingProcessingWorker(): Worker {
  const worker = new Worker<RecordingProcessingJobData>(
    'recording-processing',
    async (job: Job<RecordingProcessingJobData>) => {
      await processRecordingJob(job);
    },
    {
      connection: { url: config.redis.url },
      concurrency: 2,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error('[RecordingWorker] Job failed', {
      jobId: job?.id,
      error: err.message,
      callRecordingId: job?.data.callRecordingId,
      callSessionId: job?.data.callSessionId,
      attempt: job?.attemptsMade,
    });
  });

  return worker;
}
