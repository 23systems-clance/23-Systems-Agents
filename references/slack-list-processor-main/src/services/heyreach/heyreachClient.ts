/**
 * HeyReach API client.
 *
 * Handles adding leads to pre-configured LinkedIn campaigns,
 * fetching conversations, and campaign stats.
 * Uses X-API-KEY authentication with rate limiting and circuit breaker.
 */

import { config } from '../../config/index.js';
import { CircuitBreaker } from '../../lib/circuitBreaker.js';
import logger from '../../lib/logger.js';
import type {
  HeyReachListItem,
  HeyReachAddLeadsResponse,
  HeyReachCampaignStats,
  HeyReachConversation,
  HeyReachCampaignListItem,
} from './types.js';

const BASE_URL = 'https://api.heyreach.io/api/public';

const circuitBreaker = new CircuitBreaker({
  name: 'HeyReach',
  failureThreshold: 5,
  resetTimeoutMs: 60_000,
});

/**
 * Simple rate limiter for HeyReach API (300 requests per minute).
 */
class RateWindow {
  private timestamps: number[] = [];
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  /** Waits until a request slot is available. */
  async acquire(): Promise<void> {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);

    if (this.timestamps.length >= this.maxRequests) {
      const oldest = this.timestamps[0];
      const waitMs = this.windowMs - (now - oldest) + 10;
      await sleep(waitMs);
    }

    this.timestamps.push(Date.now());
  }
}

const rateLimiter = new RateWindow(300, 60_000);

/**
 * Makes an authenticated request to the HeyReach API.
 * Handles rate limiting with retry and circuit breaker wrapping.
 */
async function heyreachFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}`;

  return circuitBreaker.execute(async () => {
    await rateLimiter.acquire();

    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      const response = await fetch(url, {
        ...options,
        headers: {
          'X-API-KEY': config.heyreach.apiKey,
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      });

      if (response.status === 429) {
        attempts++;
        const retryAfter = response.headers.get('Retry-After');
        const delay = retryAfter ? Number(retryAfter) * 1000 : 1000 * Math.pow(2, attempts);
        logger.warn('HeyReach rate limited, retrying', { attempts, delay });
        await sleep(delay);
        continue;
      }

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`HeyReach API error ${response.status}: ${body}`);
      }

      return (await response.json()) as T;
    }

    throw new Error('HeyReach API: max retry attempts exceeded');
  });
}

/**
 * Adds leads to a HeyReach campaign by first adding them to a list,
 * then attaching that list to the campaign.
 *
 * HeyReach requires leads to be in a list before they can be added to a campaign.
 *
 * @param campaignId - HeyReach campaign ID
 * @param leads - Array of leads with LinkedIn profile URLs
 * @returns Response indicating success
 */
export async function addLeadsToCampaign(
  campaignId: string,
  leads: HeyReachListItem[],
): Promise<HeyReachAddLeadsResponse> {
  // Step 1: Add leads to the campaign's lead list
  const response = await heyreachFetch<HeyReachAddLeadsResponse>(
    `/campaigns/${campaignId}/leads`,
    {
      method: 'POST',
      body: JSON.stringify({
        leads: leads.map((lead) => ({
          linkedInUrl: lead.linkedInUrl,
          firstName: lead.firstName,
          lastName: lead.lastName,
          companyName: lead.companyName,
        })),
      }),
    },
  );

  logger.info('Leads added to HeyReach campaign', {
    campaignId,
    leadsRequested: leads.length,
    leadsAdded: response.leadsAdded,
  });

  return response;
}

/**
 * Fetches campaign stats from HeyReach.
 *
 * @param campaignId - HeyReach campaign ID
 * @returns Campaign statistics
 */
export async function getCampaignStats(
  campaignId: string,
): Promise<HeyReachCampaignStats> {
  return heyreachFetch<HeyReachCampaignStats>(
    `/campaigns/${campaignId}/stats`,
  );
}

/**
 * Fetches conversations for a campaign from HeyReach.
 *
 * @param campaignId - HeyReach campaign ID
 * @returns Array of conversations with messages
 */
export async function getConversations(
  campaignId: string,
): Promise<HeyReachConversation[]> {
  const response = await heyreachFetch<{ data: HeyReachConversation[] }>(
    `/campaigns/${campaignId}/conversations`,
  );
  return response.data;
}

/**
 * Lists campaigns from HeyReach using a per-client API key.
 *
 * @param apiKey - Client-specific HeyReach API key (decrypted)
 * @returns Array of campaign list items
 */
export async function listCampaigns(
  apiKey: string,
): Promise<HeyReachCampaignListItem[]> {
  const url = `${BASE_URL}/campaigns`;

  const response = await fetch(url, {
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HeyReach API error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as { data?: HeyReachCampaignListItem[] } | HeyReachCampaignListItem[];
  return Array.isArray(data) ? data : (data.data ?? []);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
