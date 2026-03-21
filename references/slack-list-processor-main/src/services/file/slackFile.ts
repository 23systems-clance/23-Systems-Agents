// ---------------------------------------------------------------------------
// Slack file download / upload helpers
// ---------------------------------------------------------------------------

import logger from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Bot user ID cache (set once at startup via initBotUserId)
// ---------------------------------------------------------------------------

let cachedBotUserId: string | null = null;

/**
 * Initialises the cached bot user ID by calling auth.test.
 * Call once at app startup. This value is used by the file_shared
 * handler to reliably detect bot uploads without depending on
 * Bolt's context.botUserId (which can be undefined after reinstalls).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function initBotUserId(client: any): Promise<void> {
  try {
    const result = await client.auth.test();
    cachedBotUserId = result.user_id ?? null;
    logger.info('Bot user ID cached', { botUserId: cachedBotUserId });
  } catch (err) {
    logger.error('Failed to cache bot user ID', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Returns the cached bot user ID, or null if not yet initialised. */
export function getBotUserId(): string | null {
  return cachedBotUserId;
}

/**
 * Tracks file IDs uploaded by the bot so the file_shared listener can
 * ignore them. Entries expire after 5 minutes to avoid unbounded growth.
 */
const recentBotUploads = new Set<string>();

/** Registers a file ID as bot-uploaded. Auto-expires after 5 minutes. */
export function trackBotUpload(fileId: string): void {
  recentBotUploads.add(fileId);
  setTimeout(() => recentBotUploads.delete(fileId), 5 * 60 * 1000);
}

/** Returns true if the file ID was recently uploaded by the bot. */
export function isBotUpload(fileId: string): boolean {
  return recentBotUploads.has(fileId);
}

/**
 * Tracks channel+thread combinations where the bot is about to upload a file.
 * This is called BEFORE uploadV2 to avoid the race condition where file_shared
 * fires before uploadV2 resolves (making file ID tracking unreliable).
 */
const pendingBotThreads = new Set<string>();

/** Marks a thread as expecting a bot upload. Auto-expires after 5 minutes. */
export function markThreadForBotUpload(channelId: string, threadTs: string): void {
  const key = `${channelId}:${threadTs}`;
  pendingBotThreads.add(key);
  logger.debug('Marked thread for bot upload', { channelId, threadTs });
  setTimeout(() => pendingBotThreads.delete(key), 5 * 60 * 1000);
}

/** Returns true if a thread is expecting a bot file upload. */
export function isThreadExpectingBotUpload(channelId: string, threadTs: string): boolean {
  return pendingBotThreads.has(`${channelId}:${threadTs}`);
}

/** Clears the bot upload expectation for a thread (call after upload completes). */
export function clearThreadBotUpload(channelId: string, threadTs: string): void {
  pendingBotThreads.delete(`${channelId}:${threadTs}`);
}

/**
 * Downloads a file from Slack's servers using the bot token for auth.
 *
 * @param fileUrl  - The private download URL provided by Slack
 * @param botToken - Bot OAuth token (xoxb-...)
 * @returns The raw file content as a Buffer
 */
export async function downloadSlackFile(
  fileUrl: string,
  botToken: string,
): Promise<Buffer> {
  // Add cache-busting query parameter to prevent CDN/HTTP caching
  const cacheBustUrl = fileUrl.includes('?')
    ? `${fileUrl}&_cb=${Date.now()}`
    : `${fileUrl}?_cb=${Date.now()}`;

  const response = await fetch(cacheBustUrl, {
    headers: {
      Authorization: `Bearer ${botToken}`,
      // Prevent caching at HTTP level as well
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to download Slack file: ${response.status} ${response.statusText}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/** Parameters accepted by uploadSlackFile. */
export interface UploadSlackFileParams {
  /** Authenticated Slack WebClient instance. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any;
  /** Channel to upload the file into. */
  channelId: string;
  /** Thread timestamp so the file appears in the enrichment thread. */
  threadTs: string;
  /** Raw file bytes to upload. */
  fileBuffer: Buffer;
  /** Filename shown in Slack (e.g. "enrichment-results.csv"). */
  filename: string;
  /** Optional human-readable title displayed in the file preview. */
  title?: string;
  /** Optional message posted alongside the file. */
  initialComment?: string;
}

/** Minimal shape returned after a successful upload. */
export interface UploadSlackFileResult {
  fileId: string;
  permalink: string;
}

/**
 * Uploads a file to a Slack channel / thread using the v2 upload API.
 *
 * @param params - Upload parameters including the Slack client, target
 *                 channel, thread, and file content.
 * @returns An object containing the uploaded file's id and permalink.
 */
export async function uploadSlackFile(
  params: UploadSlackFileParams,
): Promise<UploadSlackFileResult> {
  const {
    client,
    channelId,
    threadTs,
    fileBuffer,
    filename,
    title,
    initialComment,
  } = params;

  const result = await client.files.uploadV2({
    channel_id: channelId,
    thread_ts: threadTs,
    file: fileBuffer,
    filename,
    title,
    initial_comment: initialComment,
  });

  const uploadedFile = result?.file ?? result?.files?.[0];
  const fileId = uploadedFile?.id ?? '';

  // Track this file ID so file_shared listener can skip it.
  if (fileId) {
    trackBotUpload(fileId);
  }

  return {
    fileId,
    permalink: uploadedFile?.permalink ?? '',
  };
}
