/**
 * DNCScrub API client.
 *
 * Scrubs phone numbers against the National Do Not Call Registry
 * via the DNCScrub.com RPC endpoint.
 *
 * Auth: `loginId` header with API key (same pattern as TrustCall Premier).
 */

import logger from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCRUB_URL = 'https://www.dncscrub.com/app/main/rpc/scrub';
const MAX_BATCH_SIZE = 500;
const REQUEST_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single phone result from the DNCScrub API. */
export interface DncPhoneResult {
  /** The 10-digit phone number that was checked. */
  phone: string;
  /** Whether the phone is on a DNC list. */
  isOnDnc: boolean;
  /** Raw status string from the API response. */
  rawStatus: string;
}

/** Aggregated results from a DNC scrub batch. */
export interface DncScrubResponse {
  results: DncPhoneResult[];
  totalChecked: number;
  totalFlagged: number;
}

// ---------------------------------------------------------------------------
// Phone normalisation
// ---------------------------------------------------------------------------

/**
 * Strips a phone number to its 10-digit "Significant" form.
 * Removes +1 country code, dashes, spaces, parentheses.
 *
 * @param phone - Raw phone number string.
 * @returns 10-digit string or null if invalid.
 */
export function toSignificant(phone: string): string | null {
  // Remove all non-digit characters
  let digits = phone.replace(/\D/g, '');

  // Strip leading country code
  if (digits.length === 11 && digits.startsWith('1')) {
    digits = digits.slice(1);
  }

  if (digits.length !== 10) {
    return null;
  }

  return digits;
}

// ---------------------------------------------------------------------------
// API call
// ---------------------------------------------------------------------------

/**
 * Scrubs a batch of phone numbers against the DNCScrub API.
 *
 * Automatically chunks into batches of 500 if needed.
 *
 * @param phones - Array of phone numbers to check (any format).
 * @param apiKey - The DNCSCRUB_API_KEY (loginId).
 * @returns Aggregated DNC scrub results.
 */
export async function scrubPhoneNumbers(
  phones: string[],
  apiKey: string,
): Promise<DncScrubResponse> {
  const allResults: DncPhoneResult[] = [];
  let totalFlagged = 0;

  // Normalise and filter valid phone numbers
  const phoneMap = new Map<string, string>(); // significant -> original
  for (const phone of phones) {
    const sig = toSignificant(phone);
    if (sig) {
      phoneMap.set(sig, phone);
    } else {
      logger.warn('DNCScrub: skipping invalid phone number', { phone });
    }
  }

  const significantNumbers = Array.from(phoneMap.keys());

  if (significantNumbers.length === 0) {
    return { results: [], totalChecked: 0, totalFlagged: 0 };
  }

  // Process in batches
  for (let i = 0; i < significantNumbers.length; i += MAX_BATCH_SIZE) {
    const batch = significantNumbers.slice(i, i + MAX_BATCH_SIZE);
    const batchResults = await scrubBatch(batch, apiKey);

    for (const result of batchResults) {
      allResults.push(result);
      if (result.isOnDnc) totalFlagged++;
    }
  }

  const response: DncScrubResponse = {
    results: allResults,
    totalChecked: allResults.length,
    totalFlagged,
  };

  logger.info('DNCScrub completed', {
    totalChecked: response.totalChecked,
    totalFlagged: response.totalFlagged,
  });

  return response;
}

/**
 * Sends a single batch of phone numbers to the DNCScrub API.
 *
 * @param significantNumbers - Array of 10-digit phone number strings.
 * @param apiKey - The DNCScrub loginId.
 * @returns Per-number DNC results.
 */
async function scrubBatch(
  significantNumbers: string[],
  apiKey: string,
): Promise<DncPhoneResult[]> {
  const body = {
    PhoneList: significantNumbers.map((n) => ({ Significant: n })),
    output: 'json',
    version: 5,
  };

  logger.info('DNCScrub API request', {
    phoneCount: significantNumbers.length,
    url: SCRUB_URL,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(SCRUB_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        loginId: apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`DNCScrub API error: ${response.status} ${response.statusText} - ${text}`);
    }

    const data = await response.json();

    logger.debug('DNCScrub API response', {
      phoneCount: significantNumbers.length,
      responseType: typeof data,
    });

    return parseResponse(data, significantNumbers);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Parses the DNCScrub API response into structured results.
 *
 * The API response format may vary. This function handles:
 * - Array of objects with phone-level results
 * - Object with a results/data array
 * - Each entry may have `DNC`, `dnc`, `status`, or `result` fields
 *
 * @param data - Raw API response.
 * @param requestedPhones - The phones we sent (for fallback mapping).
 * @returns Parsed DNC results per phone.
 */
function parseResponse(
  data: unknown,
  requestedPhones: string[],
): DncPhoneResult[] {
  const results: DncPhoneResult[] = [];

  // Normalise response to array
  let entries: unknown[];
  if (Array.isArray(data)) {
    entries = data;
  } else if (data && typeof data === 'object' && 'results' in data && Array.isArray((data as Record<string, unknown>).results)) {
    entries = (data as Record<string, unknown>).results as unknown[];
  } else if (data && typeof data === 'object' && 'data' in data && Array.isArray((data as Record<string, unknown>).data)) {
    entries = (data as Record<string, unknown>).data as unknown[];
  } else {
    // Unexpected format - log and treat all as unknown/clean
    logger.warn('DNCScrub: unexpected response format, treating all as clean', {
      responseType: typeof data,
      response: JSON.stringify(data).slice(0, 500),
    });

    return requestedPhones.map((phone) => ({
      phone,
      isOnDnc: false,
      rawStatus: 'UNKNOWN_RESPONSE_FORMAT',
    }));
  }

  // Parse each entry
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;

    const record = entry as Record<string, unknown>;

    // Extract phone number from response
    const phone =
      (record.Significant as string) ??
      (record.Phone as string) ??
      (record.phone as string) ??
      (record.number as string) ??
      '';

    const sig = phone.replace(/\D/g, '').slice(-10);

    // Determine DNC status from response
    // Common field names for DNC status in scrub APIs
    const statusField =
      (record.DNC as string) ??
      (record.dnc as string) ??
      (record.Status as string) ??
      (record.status as string) ??
      (record.result as string) ??
      (record.Result as string) ??
      '';

    const statusStr = String(statusField).toUpperCase();
    const isOnDnc =
      statusStr.includes('DNC') ||
      statusStr.includes('DO NOT CALL') ||
      statusStr === 'Y' ||
      statusStr === 'YES' ||
      statusStr === 'TRUE' ||
      statusStr === '1' ||
      statusStr.includes('BLOCKED') ||
      statusStr.includes('REGISTERED');

    results.push({
      phone: sig || phone,
      isOnDnc,
      rawStatus: String(statusField),
    });
  }

  return results;
}
