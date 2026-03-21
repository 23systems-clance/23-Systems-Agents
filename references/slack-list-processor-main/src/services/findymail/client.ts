/**
 * Findymail API client for email verification (US6).
 *
 * POST https://app.findymail.com/api/verify
 * Auth: Authorization: Bearer {API_KEY}
 * Request: { "email": "test@example.com" }
 * Response: { "email": "test@example.com", "verified": true, "provider": "Google" }
 */

import logger from '../../lib/logger.js';

const BASE_URL = 'https://app.findymail.com';

/** Result from a single Findymail verification call. */
export interface FindymailResult {
  email: string;
  verified: boolean;
  provider: string | null;
}

/** Aggregated result from batch verification. */
export interface FindymailBatchResult {
  results: FindymailResult[];
  totalChecked: number;
  totalVerified: number;
  totalFailed: number;
}

/**
 * Verifies a single email address via the Findymail API.
 *
 * @param email - The email address to verify.
 * @param apiKey - Findymail API key (Bearer token).
 * @returns Verification result with verified flag and provider.
 * @throws On network or API errors.
 */
export async function verifyEmail(
  email: string,
  apiKey: string,
): Promise<FindymailResult> {
  const response = await fetch(`${BASE_URL}/api/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Findymail API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    email?: string;
    verified?: boolean;
    provider?: string;
  };

  return {
    email: data.email ?? email,
    verified: data.verified ?? false,
    provider: data.provider ?? null,
  };
}

/**
 * Verifies a batch of emails with controlled concurrency.
 *
 * @param emails - Array of email addresses to verify.
 * @param apiKey - Findymail API key.
 * @param concurrency - Max concurrent requests (default 50, Findymail limit 300).
 * @returns Aggregated batch results.
 */
export async function verifyEmailsBatch(
  emails: string[],
  apiKey: string,
  concurrency = 50,
): Promise<FindymailBatchResult> {
  const results: FindymailResult[] = [];
  let totalVerified = 0;
  let totalFailed = 0;

  // Process in chunks of `concurrency` size
  for (let i = 0; i < emails.length; i += concurrency) {
    const chunk = emails.slice(i, i + concurrency);

    const chunkResults = await Promise.allSettled(
      chunk.map((email) => verifyEmail(email, apiKey)),
    );

    for (let j = 0; j < chunkResults.length; j++) {
      const result = chunkResults[j];
      if (result.status === 'fulfilled') {
        results.push(result.value);
        if (result.value.verified) {
          totalVerified++;
        } else {
          totalFailed++;
        }
      } else {
        // API call failed for this email — treat as unverified
        logger.warn('Findymail verification failed for email', {
          email: chunk[j],
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
        results.push({
          email: chunk[j],
          verified: false,
          provider: null,
        });
        totalFailed++;
      }
    }

    logger.debug('Findymail batch progress', {
      processed: Math.min(i + concurrency, emails.length),
      total: emails.length,
    });
  }

  return {
    results,
    totalChecked: results.length,
    totalVerified,
    totalFailed,
  };
}
