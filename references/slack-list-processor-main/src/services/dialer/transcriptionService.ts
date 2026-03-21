/**
 * Transcription Service (T050)
 *
 * Handles call recording transcription via Deepgram Nova-2:
 * 1. Submitting recordings for async transcription
 * 2. Processing Deepgram callback responses
 * 3. Formatting transcripts for CRM display
 */

import { prisma } from '../../models/index.js';
import { getPresignedUrl } from '../../lib/storage.js';
import { config } from '../../config/index.js';
import logger from '../../lib/logger.js';
import { hubspotActivitySyncQueue } from '../queue/queues.js';

/** Maximum transcript length for CRM fields (HubSpot hs_call_body limit). */
const CRM_TRANSCRIPT_MAX_LENGTH = 60_000;

/** Deepgram pre-recorded audio API endpoint. */
const DEEPGRAM_API_URL = 'https://api.deepgram.com/v1/listen';

// ============================================================
// T050: Submit recording for Deepgram transcription
// ============================================================

/**
 * Submit a call recording to Deepgram Nova-2 for async transcription.
 * Generates a presigned S3 URL and POSTs to the Deepgram pre-recorded API
 * with a callback URL for async delivery.
 *
 * @param callRecordingId - UUID of the CallRecording to transcribe.
 */
export async function submitForTranscription(callRecordingId: string): Promise<void> {
  if (!config.deepgram.apiKey) {
    logger.warn('[Transcription] Deepgram API key not configured — skipping transcription', {
      callRecordingId,
    });
    return;
  }

  const recording: any = await prisma.callRecording.findUnique({
    where: { id: callRecordingId },
  });

  if (!recording) {
    logger.warn('[Transcription] CallRecording not found', { callRecordingId });
    return;
  }

  if (!recording.s3Key) {
    logger.warn('[Transcription] CallRecording has no S3 key — cannot transcribe', {
      callRecordingId,
    });
    return;
  }

  // Generate a 1-hour presigned URL for Deepgram to fetch the audio
  const presignedUrl = await getPresignedUrl(recording.s3Key, 3600);

  // Build callback URL for async transcript delivery
  const callbackUrl = `${config.webhookBaseUrl}/api/webhooks/deepgram/transcript?callRecordingId=${callRecordingId}`;

  // Build Deepgram API URL with query params
  const params = new URLSearchParams({
    model: 'nova-2',
    diarize: 'true',
    utterances: 'true',
    punctuate: 'true',
    callback: callbackUrl,
  });

  const url = `${DEEPGRAM_API_URL}?${params.toString()}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Token ${config.deepgram.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: presignedUrl }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Deepgram API returned ${response.status}: ${body}`);
    }

    const data = await response.json();
    const requestId = data.request_id;

    // Update recording with Deepgram request ID and processing status
    await prisma.callRecording.update({
      where: { id: callRecordingId },
      data: {
        deepgramRequestId: requestId,
        transcriptionStatus: 'PROCESSING',
      },
    });

    logger.info('[Transcription] Recording submitted to Deepgram', {
      callRecordingId,
      deepgramRequestId: requestId,
    });
  } catch (error: any) {
    logger.error('[Transcription] Failed to submit recording to Deepgram', {
      callRecordingId,
      error: error.message,
    });
    throw error;
  }
}

// ============================================================
// T050: Handle Deepgram transcript callback
// ============================================================

/**
 * Process a Deepgram transcript callback response.
 * Extracts the transcript text, stores the full JSON, and formats for CRM.
 *
 * @param callRecordingId - UUID of the CallRecording being transcribed.
 * @param transcriptData - Raw Deepgram callback payload.
 * @returns Formatted transcript string for CRM display.
 */
export async function handleTranscriptCallback(
  callRecordingId: string,
  transcriptData: any,
): Promise<string> {
  // Extract the plain text transcript from Deepgram response
  const plainTranscript =
    transcriptData?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';

  // Format the transcript for CRM display
  const formattedTranscript = formatTranscriptForCRM(transcriptData);

  // Store transcript data and mark as completed
  await prisma.callRecording.update({
    where: { id: callRecordingId },
    data: {
      transcriptJson: transcriptData,
      transcript: plainTranscript,
      transcriptionStatus: 'COMPLETED',
      transcribedAt: new Date(),
    },
  });

  logger.info('[Transcription] Transcript callback processed', {
    callRecordingId,
    transcriptLength: plainTranscript.length,
  });

  return formattedTranscript;
}

// ============================================================
// T050: Format transcript for CRM display
// ============================================================

/**
 * Format a Deepgram transcript with speaker labels and timestamps for CRM display.
 * Uses utterances (if available) for speaker-diarized format: [M:SS] Speaker N: text
 * Maps speaker 0 to BDR name, speaker 1+ to "Prospect".
 * Truncates at 60,000 characters for HubSpot field limits.
 *
 * @param transcriptData - Raw Deepgram transcript response.
 * @param bdrName - Optional BDR display name for speaker labeling.
 * @returns Formatted transcript string.
 */
export function formatTranscriptForCRM(transcriptData: any, bdrName?: string): string {
  const utterances = transcriptData?.results?.utterances;

  // If no utterances available, fall back to plain transcript
  if (!utterances || utterances.length === 0) {
    const plainText =
      transcriptData?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
    return truncateTranscript(plainText);
  }

  // Build speaker-labeled transcript from utterances
  const lines: string[] = [];

  for (const utterance of utterances) {
    const timestamp = formatTimestamp(utterance.start);
    const speakerLabel =
      utterance.speaker === 0
        ? bdrName ?? 'BDR'
        : 'Prospect';
    const text = utterance.transcript ?? '';

    lines.push(`[${timestamp}] ${speakerLabel}: ${text}`);
  }

  const formatted = lines.join('\n');
  return truncateTranscript(formatted);
}

// ============================================================
// T050: Update CRM with transcript
// ============================================================

/**
 * Enqueue a HubSpot engagement update to attach the recording URL
 * and formatted transcript to the call engagement.
 * Uses eventSource 'power-dialer-transcript' to differentiate from
 * the initial disposition sync.
 *
 * @param callSessionId - UUID of the CallSession.
 * @param recordingUrl - Permalink to the recording for hs_call_recording_url.
 * @param formattedTranscript - Formatted transcript text for hs_call_body.
 */
export async function updateCrmWithTranscript(
  callSessionId: string,
  recordingUrl: string,
  formattedTranscript: string,
): Promise<void> {
  const callSession: any = await prisma.callSession.findUnique({
    where: { id: callSessionId },
  });

  if (!callSession) {
    logger.warn('[Transcription] Call session not found for CRM transcript update', {
      callSessionId,
    });
    return;
  }

  if (!callSession.contactEmail) {
    logger.info('[Transcription] No contact email — skipping CRM transcript update', {
      callSessionId,
    });
    return;
  }

  await hubspotActivitySyncQueue.add(
    'dialer-transcript-sync',
    {
      clientId: callSession.clientId,
      eventType: 'call',
      eventId: callSessionId,
      eventSource: 'power-dialer-transcript',
      payload: {
        callSessionId,
        contactEmail: callSession.contactEmail,
        hs_call_recording_url: recordingUrl,
        hs_call_body: formattedTranscript,
      },
    },
    {
      attempts: 3,
      backoff: {
        type: 'exponential' as const,
        delay: 5000,
      },
      // Unique job ID to prevent duplicate transcript syncs
      jobId: `dialer-transcript-${callSessionId}`,
    },
  );

  logger.info('[Transcription] CRM transcript sync job enqueued', {
    callSessionId,
    clientId: callSession.clientId,
    transcriptLength: formattedTranscript.length,
  });
}

// ============================================================
// Internal helpers
// ============================================================

/**
 * Format seconds into a human-readable timestamp string.
 * Returns M:SS for durations under 1 hour, H:MM:SS for longer.
 *
 * @param seconds - Time in seconds (may be fractional).
 * @returns Formatted timestamp string.
 */
function formatTimestamp(seconds: number): string {
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

/**
 * Truncate transcript text to the CRM maximum length.
 * Appends a continuation marker if truncated.
 *
 * @param text - Raw transcript text.
 * @returns Truncated transcript string.
 */
function truncateTranscript(text: string): string {
  if (text.length <= CRM_TRANSCRIPT_MAX_LENGTH) {
    return text;
  }

  const suffix = '\n\n... [View full transcript]';
  return text.slice(0, CRM_TRANSCRIPT_MAX_LENGTH - suffix.length) + suffix;
}
