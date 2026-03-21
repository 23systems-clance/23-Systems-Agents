/**
 * Wiza.co API client for contact enrichment (Feature 27).
 *
 * Provides email and phone enrichment via Wiza's Individual Reveal API.
 * Supports both polling and webhook-based result delivery.
 *
 * API Documentation: https://docs.wiza.co/
 */

import logger from '../../lib/logger.js';
import { getAuthHeader } from '../../config/providers.js';

const WIZA_BASE_URL = 'https://wiza.co/api';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

export type EnrichmentLevel = 'none' | 'partial' | 'phone' | 'full';

export interface WizaContact {
  full_name?: string;
  company?: string;
  domain?: string;
  profile_url?: string;
  email?: string;
}

export interface IndividualRevealRequest {
  individual_reveal: WizaContact;
  enrichment_level: EnrichmentLevel;
  email_options?: {
    accept_work?: boolean;
    accept_personal?: boolean;
  };
  callback_url?: string;
}

export interface WizaRevealResponse {
  status: {
    code: number;
    message: string;
  };
  type: 'individual_reveal';
  data: {
    id: number;
    status: 'queued' | 'resolving' | 'finished' | 'failed';
    is_complete: boolean;
    name?: string;
    title?: string;
    email?: string;
    email_status?: 'valid' | 'risky' | 'unfound' | null;
    mobile_phone?: string;
    phone_status?: 'found' | 'unfound' | null;
    phones?: Array<{
      number: string;
      pretty_number: string;
      type: 'mobile' | 'work' | 'home';
    }>;
    company?: string;
    company_domain?: string;
    fail_error?: string;
  };
  credits?: {
    email_credits?: number;
    phone_credits?: number;
    total?: number;
  };
}

export class WizaRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WizaRateLimitError';
  }
}

export class WizaAPIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public response?: any,
  ) {
    super(message);
    this.name = 'WizaAPIError';
  }
}

/**
 * Start an individual reveal enrichment request.
 *
 * @param contact - Contact information (name + domain, email, or LinkedIn URL)
 * @param enrichmentLevel - Level of enrichment ('partial' for email, 'phone' for phone, 'full' for both)
 * @param callbackUrl - Optional webhook URL for async results
 * @returns Reveal response with reveal ID and initial status
 */
export async function individualReveal(
  contact: WizaContact,
  enrichmentLevel: EnrichmentLevel,
  callbackUrl?: string,
): Promise<WizaRevealResponse> {
  const authHeader = getAuthHeader('WIZA');

  const body: IndividualRevealRequest = {
    individual_reveal: contact,
    enrichment_level: enrichmentLevel,
  };

  if (enrichmentLevel === 'partial') {
    body.email_options = {
      accept_work: true,
      accept_personal: false,
    };
  }

  if (callbackUrl) {
    body.callback_url = callbackUrl;
  }

  return await callWizaWithRetry(`${WIZA_BASE_URL}/individual_reveals`, {
    method: 'POST',
    headers: {
      [authHeader.name]: authHeader.value,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

/**
 * Get the status and results of an individual reveal.
 *
 * @param revealId - The reveal ID returned from individualReveal
 * @returns Reveal response with current status and results (if complete)
 */
export async function getReveal(
  revealId: number,
): Promise<WizaRevealResponse> {
  const authHeader = getAuthHeader('WIZA');

  const response = await fetch(`${WIZA_BASE_URL}/individual_reveals/${revealId}`, {
    method: 'GET',
    headers: {
      [authHeader.name]: authHeader.value,
    },
  });

  if (!response.ok) {
    throw new WizaAPIError(
      `Failed to get reveal: ${response.statusText}`,
      response.status,
      await response.json().catch(() => null),
    );
  }

  return await response.json();
}

/**
 * Poll for reveal completion with timeout.
 *
 * @param revealId - The reveal ID to poll
 * @param maxWaitMs - Maximum time to wait (default 60 seconds)
 * @param pollIntervalMs - Polling interval (default 2 seconds)
 * @returns Completed reveal response
 */
export async function waitForReveal(
  revealId: number,
  maxWaitMs: number = 60000,
  pollIntervalMs: number = 2000,
): Promise<WizaRevealResponse> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const result = await getReveal(revealId);

    if (result.data.is_complete) {
      return result;
    }

    // Wait before polling again
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Reveal ${revealId} did not complete within ${maxWaitMs}ms`);
}

/**
 * Call Wiza API with exponential backoff retry for rate limits.
 */
async function callWizaWithRetry(
  url: string,
  options: RequestInit,
  attempt: number = 1,
): Promise<any> {
  try {
    const response = await fetch(url, options);

    // Handle rate limiting
    if (response.status === 429) {
      if (attempt >= MAX_RETRIES) {
        throw new WizaRateLimitError(
          `Rate limit exceeded after ${MAX_RETRIES} retries`,
        );
      }

      const delay = Math.pow(2, attempt - 1) * RETRY_DELAY_MS;
      logger.warn('Wiza rate limit hit, retrying', { attempt, delayMs: delay });

      await new Promise((resolve) => setTimeout(resolve, delay));
      return await callWizaWithRetry(url, options, attempt + 1);
    }

    // Handle other errors
    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new WizaAPIError(
        `Wiza API error: ${response.statusText}`,
        response.status,
        errorBody,
      );
    }

    return await response.json();
  } catch (error) {
    if (error instanceof WizaRateLimitError || error instanceof WizaAPIError) {
      throw error;
    }

    // Network or other errors
    throw new Error(`Wiza API request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Verify Wiza webhook signature.
 *
 * Wiza uses SHA256 hash of API key for webhook authentication.
 *
 * @param xAuthKey - The x-auth-key header value from webhook
 * @returns true if signature is valid
 */
export function verifyWebhookSignature(xAuthKey: string): boolean {
  const crypto = require('crypto');
  const apiKey = process.env.WIZA_API_KEY;

  if (!apiKey) {
    throw new Error('WIZA_API_KEY not configured');
  }

  const expectedHash = crypto.createHash('sha256').update(apiKey).digest('hex');

  // Constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(xAuthKey),
    Buffer.from(expectedHash),
  );
}
