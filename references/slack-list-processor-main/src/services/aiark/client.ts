/**
 * AI Ark API client for contact enrichment (Feature 27).
 *
 * Provides phone enrichment via Mobile Phone Finder API,
 * personality analysis, and credit balance checking.
 *
 * API Documentation: https://docs.ai-ark.com/
 */

import logger from '../../lib/logger.js';
import { getAuthHeader } from '../../config/providers.js';
import type {
  PersonalityAnalysisRequest,
  PersonalityAnalysisResponse,
} from '../../types/personality.js';

const AI_ARK_BASE_URL =
  'https://api.ai-ark.com/api/developer-portal/v1';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

export type PhoneType = 'MOBILE' | 'WORK' | 'HOME';

export interface MobilePhoneFinderRequest {
  type: PhoneType;
  linkedin?: string;
  domain?: string;
  name?: string;
}

export interface MobilePhoneFinderResponse {
  phone_number?: string;
  type?: PhoneType;
  confidence_score?: number;
  error?: string;
}

export interface CreditBalance {
  total_credits?: number;
  used_credits?: number;
  remaining_credits?: number;
  export_credits?: number;
  verified_email_credits?: number;
}

export class AIArkRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AIArkRateLimitError';
  }
}

export class AIArkAPIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public response?: any,
  ) {
    super(message);
    this.name = 'AIArkAPIError';
  }
}

/**
 * Find mobile phone number for a contact.
 *
 * @param contact - Contact information (LinkedIn URL or domain + name)
 * @param type - Phone type to find (default: 'mobile')
 * @returns Phone finder response
 */
export async function mobilePhoneFinder(
  contact: Omit<MobilePhoneFinderRequest, 'type'>,
  type: PhoneType = 'MOBILE',
): Promise<MobilePhoneFinderResponse> {
  const authHeader = getAuthHeader('AI_ARK');

  const body: MobilePhoneFinderRequest = {
    type,
    ...contact,
  };

  logger.debug('AI Ark mobilePhoneFinder request', {
    body,
  });

  return await callAIArkWithRetry(`${AI_ARK_BASE_URL}/people/mobile-phone-finder`, {
    method: 'POST',
    headers: {
      [authHeader.name]: authHeader.value,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

/**
 * Fetch current credit balance.
 *
 * @returns Credit balance information
 */
export async function fetchCredits(): Promise<CreditBalance> {
  const authHeader = getAuthHeader('AI_ARK');

  return await callAIArkWithRetry(`${AI_ARK_BASE_URL}/payments/credits`, {
    method: 'GET',
    headers: {
      [authHeader.name]: authHeader.value,
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Run personality analysis for a contact via the AI Ark People Analysis API.
 *
 * @param contact - Contact identification (LinkedIn URL, or name + domain)
 * @returns Personality analysis with DISC, OCEAN, archetype, communication style, etc.
 */
export async function personalityAnalysis(
  contact: PersonalityAnalysisRequest,
): Promise<PersonalityAnalysisResponse> {
  const authHeader = getAuthHeader('AI_ARK');

  logger.debug('AI Ark personalityAnalysis request', { body: contact });

  const result = await callAIArkWithRetry(
    `${AI_ARK_BASE_URL}/people/analysis`,
    {
      method: 'POST',
      headers: {
        [authHeader.name]: authHeader.value,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(contact),
    },
  );

  // Log the raw response shape on first calls to verify our type definitions
  logger.info('AI Ark personalityAnalysis response shape', {
    keys: Object.keys(result),
  });

  return result;
}

/**
 * Call AI Ark API with exponential backoff retry for rate limits.
 */
async function callAIArkWithRetry(
  url: string,
  options: RequestInit,
  attempt: number = 1,
): Promise<any> {
  try {
    const response = await fetch(url, options);

    // Handle rate limiting (429)
    if (response.status === 429) {
      if (attempt >= MAX_RETRIES) {
        throw new AIArkRateLimitError(
          `Rate limit exceeded after ${MAX_RETRIES} retries`,
        );
      }

      const delay = Math.pow(2, attempt - 1) * RETRY_DELAY_MS;
      logger.warn('AI Ark rate limit hit, retrying', { attempt, delayMs: delay });

      await new Promise((resolve) => setTimeout(resolve, delay));
      return await callAIArkWithRetry(url, options, attempt + 1);
    }

    // Handle 404 as "data not found" (valid response, not an error)
    if (response.status === 404) {
      return { error: 'data not found' };
    }

    // Handle other errors
    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      logger.warn('AI Ark API error response', {
        statusCode: response.status,
        statusText: response.statusText,
        errorBody,
        url,
      });
      throw new AIArkAPIError(
        `AI Ark API error: ${response.statusText}`,
        response.status,
        errorBody,
      );
    }

    return await response.json();
  } catch (error) {
    if (error instanceof AIArkRateLimitError || error instanceof AIArkAPIError) {
      throw error;
    }

    // Network or other errors
    throw new Error(
      `AI Ark API request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Verify AI Ark webhook signature.
 *
 * AI Ark uses HMAC-SHA256 signature with timestamp for replay protection.
 *
 * @param signature - The x-webhook-signature header value
 * @param timestamp - The x-webhook-timestamp header value
 * @param payload - The raw webhook payload
 * @returns true if signature is valid
 */
export function verifyWebhookSignature(
  signature: string,
  timestamp: string,
  payload: string,
): boolean {
  const crypto = require('crypto');
  const secret = process.env.AI_ARK_WEBHOOK_SECRET;

  if (!secret) {
    throw new Error('AI_ARK_WEBHOOK_SECRET not configured');
  }

  // Verify timestamp to prevent replay attacks (5-minute window)
  const now = Math.floor(Date.now() / 1000);
  const requestTime = parseInt(timestamp, 10);
  if (Math.abs(now - requestTime) > 300) {
    logger.warn('AI Ark webhook timestamp expired', {
      timestamp: requestTime,
      now,
      diff: Math.abs(now - requestTime),
    });
    return false;
  }

  // Calculate HMAC
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');

  // Constant-time comparison
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature),
  );
}
