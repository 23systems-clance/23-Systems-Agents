/**
 * Recording Manager - Power Dialer Phase 5 (Feature 22)
 *
 * Manages the lifecycle of call recordings:
 * - Starting conference recordings via Twilio
 * - Downloading recordings from Twilio and uploading to S3
 * - Generating presigned URLs (24h dashboard, 30-day CRM)
 * - Generating stable permalink URLs
 * - Deleting recordings from Twilio after S3 copy
 */

import { prisma } from '../../models/index.js';
import { twilioRestClient } from './twilioClient.js';
import { uploadFile, getPresignedUrl } from '../../lib/storage.js';
import { config } from '../../config/index.js';
import logger from '../../lib/logger.js';
import { recordingProcessingQueue } from '../queue/queues.js';
import type { RecordingProcessingJobData } from '../queue/queues.js';

/** Default presigned URL expiry: 24 hours (for dashboard playback). */
const DEFAULT_PRESIGNED_EXPIRY_SECONDS = 86400;

/** CRM presigned URL expiry: 30 days. */
export const CRM_PRESIGNED_EXPIRY_SECONDS = 30 * 24 * 60 * 60;

/**
 * Start recording a conference call.
 *
 * Looks up the CallSession to find the conference friendly name (stored in
 * twilioConferenceSid), resolves the actual Twilio conference SID, then
 * starts a recording via the Conference Recordings API.
 *
 * @param callSessionId - UUID of the CallSession to record
 * @returns The Twilio recording SID
 */
export async function startRecording(callSessionId: string): Promise<string> {
  const callSession: any = await prisma.callSession.findUniqueOrThrow({
    where: { id: callSessionId },
  });

  const callSid = callSession.twilioCallSid;
  if (!callSid) {
    throw new Error(`CallSession ${callSessionId} has no Twilio call SID`);
  }

  // Start recording on the call via Twilio Calls Recording API
  const recording = await twilioRestClient
    .calls(callSid)
    .recordings.create({
      recordingStatusCallback: `${config.webhookBaseUrl}/api/webhooks/twilio/recording`,
      recordingStatusCallbackEvent: ['completed', 'absent'],
      recordingChannels: 'dual',
    });

  // Update CallSession with recording start timestamp
  await prisma.callSession.update({
    where: { id: callSessionId },
    data: { recordingStartedAt: new Date() },
  });

  logger.info('[RecordingManager] Call recording started', {
    callSessionId,
    callSid,
    recordingSid: recording.sid,
  });

  return recording.sid;
}

/**
 * Handle a recording-ready callback from Twilio.
 *
 * Creates a CallRecording database record and enqueues an async BullMQ job
 * to copy the recording to S3 and submit it for Deepgram transcription.
 *
 * @param recordingSid - Twilio recording SID
 * @param recordingUrl - Twilio recording URL (without file extension)
 * @param callSid - Twilio call SID associated with this recording
 */
export async function handleRecordingReady(
  recordingSid: string,
  recordingUrl: string,
  callSid: string,
): Promise<void> {
  // Look up the CallSession by twilio call SID
  const callSession: any = await prisma.callSession.findFirst({
    where: { twilioCallSid: callSid },
  });

  if (!callSession) {
    logger.warn('[RecordingManager] Recording ready for unknown call', {
      recordingSid,
      callSid,
    });
    return;
  }

  // Create CallRecording record
  const callRecording: any = await prisma.callRecording.create({
    data: {
      callSessionId: callSession.id,
      clientId: callSession.clientId,
      bdrId: callSession.bdrId,
      twilioRecordingSid: recordingSid,
      twilioRecordingUrl: recordingUrl,
      s3CopyStatus: 'PENDING',
    },
  });

  logger.info('[RecordingManager] CallRecording created', {
    callRecordingId: callRecording.id,
    callSessionId: callSession.id,
    recordingSid,
  });

  // Enqueue async processing job (S3 copy + Deepgram)
  const jobData: RecordingProcessingJobData = {
    callRecordingId: callRecording.id,
    callSessionId: callSession.id,
    recordingSid,
    recordingUrl,
    clientId: callSession.clientId,
    callSid,
  };

  await recordingProcessingQueue.add(
    'recording-processing',
    jobData,
    { jobId: `rec-${callRecording.id}` },
  );

  logger.info('[RecordingManager] Recording processing job enqueued', {
    callRecordingId: callRecording.id,
    callSessionId: callSession.id,
  });
}

/**
 * Download a recording from Twilio and upload it to S3.
 *
 * Uses Basic auth to fetch the WAV file from Twilio, uploads to S3 with a
 * structured key path, and updates the CallRecording record with the S3 key.
 *
 * @param callRecordingId - UUID of the CallRecording record
 * @param recordingSid - Twilio recording SID
 * @param recordingUrl - Twilio recording URL (without file extension)
 * @param clientId - ManagedClient UUID for S3 path partitioning
 * @param callSid - Twilio call SID for the S3 filename
 */
export async function copyToS3(
  callRecordingId: string,
  recordingSid: string,
  recordingUrl: string,
  clientId: string,
  callSid: string,
): Promise<string> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error('Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN for recording download');
  }

  // Download the WAV recording from Twilio
  const wavUrl = `${recordingUrl}.wav`;
  const authHeader = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;

  const response = await fetch(wavUrl, {
    headers: { Authorization: authHeader },
  });

  if (!response.ok) {
    // Update status to FAILED and rethrow
    await prisma.callRecording.update({
      where: { id: callRecordingId },
      data: { s3CopyStatus: 'FAILED' },
    });
    throw new Error(
      `Failed to download recording from Twilio: ${response.status} ${response.statusText}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Build S3 key: recordings/{clientId}/{year}/{month}/{day}/call-{callSid}.wav
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const s3Key = `recordings/${clientId}/${year}/${month}/${day}/call-${callSid}.wav`;

  // Upload to S3
  await uploadFile(s3Key, buffer, 'audio/wav');

  // Update CallRecording with S3 key and mark as completed
  await prisma.callRecording.update({
    where: { id: callRecordingId },
    data: {
      s3Key,
      s3CopyStatus: 'COMPLETED',
    },
  });

  logger.info('[RecordingManager] Recording copied to S3', {
    callRecordingId,
    recordingSid,
    s3Key,
    sizeBytes: buffer.length,
  });

  return s3Key;
}

/**
 * Generate a presigned S3 URL for playing back a call recording.
 *
 * Looks up the CallRecording by callSessionId, retrieves its S3 key, and
 * generates a time-limited presigned URL. Default expiry is 24 hours
 * (suitable for dashboard playback).
 *
 * @param callSessionId - UUID of the CallSession
 * @param expirySeconds - URL expiry in seconds (default: 86400 = 24h)
 * @returns Presigned S3 URL for the recording
 */
export async function generatePresignedUrl(
  callSessionId: string,
  expirySeconds: number = DEFAULT_PRESIGNED_EXPIRY_SECONDS,
): Promise<string> {
  const callRecording: any = await prisma.callRecording.findFirst({
    where: { callSessionId },
    orderBy: { createdAt: 'desc' },
  });

  if (!callRecording) {
    throw new Error(`No recording found for CallSession ${callSessionId}`);
  }

  if (!callRecording.s3Key) {
    throw new Error(
      `Recording ${callRecording.id} has not been copied to S3 yet (status: ${callRecording.s3CopyStatus})`,
    );
  }

  const url = await getPresignedUrl(callRecording.s3Key, expirySeconds);

  logger.debug('[RecordingManager] Presigned URL generated', {
    callSessionId,
    callRecordingId: callRecording.id,
    expirySeconds,
  });

  return url;
}

/**
 * Generate a stable permalink URL for a call recording.
 *
 * Returns a permanent URL routed through the application server. The server
 * endpoint resolves to a fresh presigned S3 URL on each request, so the
 * permalink never expires.
 *
 * @param callSessionId - UUID of the CallSession
 * @returns Stable permalink URL
 */
export function generatePermalink(callSessionId: string): string {
  return `${config.webhookBaseUrl}/api/v1/recordings/${callSessionId}/audio`;
}

/**
 * Delete a recording from Twilio after it has been successfully copied to S3.
 *
 * Frees storage on Twilio's side to reduce costs. Should only be called
 * after confirming the S3 copy completed successfully.
 *
 * @param recordingSid - Twilio recording SID to delete
 */
export async function deleteFromTwilio(recordingSid: string): Promise<void> {
  try {
    await twilioRestClient.recordings(recordingSid).remove();

    logger.info('[RecordingManager] Recording deleted from Twilio', { recordingSid });
  } catch (error) {
    logger.error('[RecordingManager] Failed to delete recording from Twilio', {
      recordingSid,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
