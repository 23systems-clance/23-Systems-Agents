/**
 * Instantly.ai API v2 client.
 *
 * Handles lead management, UniBox replies, and campaign analytics.
 * Uses Bearer token authentication with rate limiting and circuit breaker.
 */

import { config } from '../../config/index.js';
import { CircuitBreaker } from '../../lib/circuitBreaker.js';
import logger from '../../lib/logger.js';
import type {
  InstantlyLeadInput,
  InstantlyAddLeadsResponse,
  InstantlyReplyResponse,
  InstantlyCampaignAnalytics,
  InstantlyCampaignListItem,
} from './types.js';

const BASE_URL = 'https://api.instantly.ai/api/v2';

const circuitBreaker = new CircuitBreaker({
  name: 'Instantly',
  failureThreshold: 5,
  resetTimeoutMs: 60_000,
});

/**
 * Token bucket rate limiter for Instantly API (100 requests per 10 seconds).
 */
class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillIntervalMs: number;

  constructor(maxTokens: number, refillIntervalMs: number) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
    this.refillIntervalMs = refillIntervalMs;
  }

  /** Waits until a token is available, then consumes it. */
  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens > 0) {
      this.tokens--;
      return;
    }
    // Wait for next refill cycle
    const waitMs = this.refillIntervalMs - (Date.now() - this.lastRefill);
    await sleep(Math.max(waitMs, 100));
    this.refill();
    this.tokens--;
  }

  private refill(): void {
    const now = Date.now();
    if (now - this.lastRefill >= this.refillIntervalMs) {
      this.tokens = this.maxTokens;
      this.lastRefill = now;
    }
  }
}

const rateLimiter = new TokenBucket(100, 10_000);

/**
 * Makes an authenticated request to the Instantly API.
 * Handles 429 rate limiting with retry and circuit breaker wrapping.
 */
async function instantlyFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}`;

  return circuitBreaker.execute(async () => {
    await rateLimiter.acquire();

    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      const response = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${config.instantly.apiKey}`,
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      });

      if (response.status === 429) {
        attempts++;
        const retryAfter = response.headers.get('Retry-After');
        const delay = retryAfter ? Number(retryAfter) * 1000 : 1000 * Math.pow(2, attempts);
        logger.warn('Instantly rate limited, retrying', { attempts, delay });
        await sleep(delay);
        continue;
      }

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Instantly API error ${response.status}: ${body}`);
      }

      return (await response.json()) as T;
    }

    throw new Error('Instantly API: max retry attempts exceeded');
  });
}

/**
 * Adds leads to an Instantly campaign in batches of 1000.
 *
 * @param campaignId - Instantly campaign ID
 * @param leads - Array of leads to add
 * @returns Aggregated response with total leads added
 */
export async function addLeadsToCampaign(
  campaignId: string,
  leads: InstantlyLeadInput[],
): Promise<InstantlyAddLeadsResponse> {
  const batchSize = 1000;
  let totalAdded = 0;

  for (let i = 0; i < leads.length; i += batchSize) {
    const batch = leads.slice(i, i + batchSize);

    const response = await instantlyFetch<InstantlyAddLeadsResponse>(
      '/leads',
      {
        method: 'POST',
        body: JSON.stringify({
          campaign_id: campaignId,
          leads: batch,
        }),
      },
    );

    totalAdded += response.total_leads_added ?? 0;

    logger.debug('Instantly lead batch added', {
      campaignId,
      batchIndex: Math.floor(i / batchSize) + 1,
      batchSize: batch.length,
      added: response.total_leads_added,
    });
  }

  return { status: 'ok', total_leads_added: totalAdded };
}

/**
 * Replies to an email in the Instantly UniBox.
 *
 * @param emailId - The email ID to reply to
 * @param body - Reply body text
 * @returns Reply response with message ID
 */
export async function replyToEmail(
  emailId: string,
  body: string,
): Promise<InstantlyReplyResponse> {
  return instantlyFetch<InstantlyReplyResponse>(
    `/emails/${emailId}/reply`,
    {
      method: 'POST',
      body: JSON.stringify({ body }),
    },
  );
}

/**
 * Fetches campaign analytics from Instantly.
 *
 * @param campaignId - Instantly campaign ID
 * @returns Campaign analytics data
 */
export async function getCampaignAnalytics(
  campaignId: string,
): Promise<InstantlyCampaignAnalytics> {
  return instantlyFetch<InstantlyCampaignAnalytics>(
    `/campaigns/${campaignId}/analytics`,
  );
}

/**
 * Lists campaigns from Instantly using a per-client API key.
 *
 * @param apiKey - Client-specific Instantly API key (decrypted)
 * @returns Array of campaign list items
 */
export async function listCampaigns(
  apiKey: string,
): Promise<InstantlyCampaignListItem[]> {
  const url = `${BASE_URL}/campaigns`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Instantly API error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as { data?: InstantlyCampaignListItem[] } | InstantlyCampaignListItem[];
  return Array.isArray(data) ? data : (data.data ?? []);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
