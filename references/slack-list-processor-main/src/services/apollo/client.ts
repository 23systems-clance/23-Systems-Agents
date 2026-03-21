/**
 * Apollo.io API base client with retry logic, rate-limit awareness,
 * and credit-usage tracking.
 *
 * Uses native fetch (Node 18+). Every public method returns an
 * `ApolloApiResult<T>` envelope so callers can persist usage data
 * to ApiUsageLog.
 */

import { config } from '../../config/index.js';
import logger from '../../lib/logger.js';
import { ApiError } from '../../lib/errors.js';
import { logError } from '../admin/errorLogger.js';

// ---------------------------------------------------------------------------
// Result envelope
// ---------------------------------------------------------------------------

/** Wrapper returned by the client so callers can track credit consumption. */
export interface ApolloApiResult<T> {
  /** Parsed response payload. */
  data: T;
  /** Apollo credits consumed by this call (from X-Credits-Used header). */
  creditsUsed: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = 'https://api.apollo.io';
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Pauses execution for a given number of milliseconds.
 *
 * @param ms - Milliseconds to sleep.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reads the `X-Credits-Used` header (case-insensitive) from the response.
 * Returns 0 when the header is absent or non-numeric.
 *
 * @param headers - Response headers object.
 * @returns Number of credits consumed.
 */
function parseCreditsUsed(headers: Headers): number {
  const raw = headers.get('X-Credits-Used') ?? headers.get('x-credits-used');
  if (raw === null) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

// ---------------------------------------------------------------------------
// Public client
// ---------------------------------------------------------------------------

/**
 * Sends a POST request to the Apollo.io API with automatic retry,
 * exponential backoff, and rate-limit (429) awareness.
 *
 * @typeParam T - Expected shape of the JSON response body.
 * @param endpoint - API path (e.g. `/v1/mixed_people/search`).
 * @param body - JSON-serialisable request body.
 * @returns Parsed response wrapped in an `ApolloApiResult<T>`.
 * @throws {ApiError} When all retry attempts are exhausted or a non-retryable error occurs.
 */
export async function post<T>(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<ApolloApiResult<T>> {
  const url = `${BASE_URL}${endpoint}`;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': config.apollo.apiKey,
        },
        body: JSON.stringify(body),
      });

      // ----- Rate-limited: honour Retry-After then retry -----
      if (response.status === 429) {
        const retryAfterRaw = response.headers.get('Retry-After');
        const retryAfterMs = retryAfterRaw
          ? Number(retryAfterRaw) * 1000
          : INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);

        logger.warn('Apollo rate limited (429), backing off', {
          endpoint,
          attempt,
          retryAfterMs,
        });

        if (attempt < MAX_RETRIES) {
          await sleep(retryAfterMs);
          continue;
        }

        throw new ApiError(
          `Apollo ${endpoint} rate limited after ${MAX_RETRIES} attempts`,
          'Apollo',
          429,
        );
      }

      // ----- Server errors (5xx): retryable -----
      if (response.status >= 500) {
        throw new ApiError(
          `Apollo ${endpoint} returned HTTP ${response.status}: ${response.statusText}`,
          'Apollo',
          response.status,
        );
      }

      // ----- Client errors (4xx, non-429): NOT retryable -----
      if (response.status >= 400) {
        const errorBody = await response.text().catch(() => '');
        throw new ApiError(
          `Apollo ${endpoint} returned HTTP ${response.status}: ${errorBody || response.statusText}`,
          'Apollo',
          response.status,
        );
      }

      // ----- Success -----
      const creditsUsed = parseCreditsUsed(response.headers);
      const data = (await response.json()) as T;

      logger.debug('Apollo API call succeeded', {
        endpoint,
        attempt,
        creditsUsed,
      });

      return { data, creditsUsed };
    } catch (err) {
      lastError = err;

      // Non-retryable client errors bubble immediately
      if (err instanceof ApiError && err.statusCode >= 400 && err.statusCode < 500) {
        throw err;
      }

      if (attempt < MAX_RETRIES) {
        const delayMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        logger.warn(`Apollo ${endpoint} attempt ${attempt} failed, retrying in ${delayMs}ms`, {
          attempt,
          delayMs,
          error: err instanceof Error ? err.message : String(err),
        });
        await sleep(delayMs);
      }
    }
  }

  // All retries exhausted
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  logError({
    category: 'API_ERROR',
    service: 'apollo',
    message: `Apollo ${endpoint} failed after ${MAX_RETRIES} attempts: ${message}`,
    stackTrace: lastError instanceof Error ? lastError.stack : undefined,
    metadata: { endpoint },
  });
  throw new ApiError(
    `Apollo ${endpoint} failed after ${MAX_RETRIES} attempts: ${message}`,
    'Apollo',
    502,
  );
}
