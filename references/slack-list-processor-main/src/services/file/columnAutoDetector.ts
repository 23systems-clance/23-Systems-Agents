/**
 * Column Auto-Detection and Normalization
 *
 * This module provides intelligent column detection for CSV/XLSX uploads:
 * 1. Scans ROW 2 data if headers don't match expected format
 * 2. Auto-renames headers to standardized names ("Domain", "Company Name")
 * 3. Normalizes URLs with smart www detection for display
 * 4. Removes legal suffixes from company names
 *
 * Display normalization (https://example.com) is separate from storage
 * normalization (example.com) handled by validator.ts
 */

import type { ParsedFile } from './parser';

// URL pattern: matches domains with or without protocol/www
const URL_PATTERN =
  /^(https?:\/\/)?(www\.)?([a-z0-9-]+\.)+[a-z]{2,}(\/.*)?$/i;

// Email pattern: basic email detection to avoid false positives
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Main orchestrator: Auto-detects columns and normalizes data
 *
 * @param parsed - Parsed file from parser.ts
 * @returns Updated ParsedFile with normalized headers and data
 */
export function autoDetectAndNormalizeColumns(
  parsed: ParsedFile
): ParsedFile {
  const { rows, headers, domainColumn, companyNameColumn } = parsed;

  // Make a copy of headers and rows to avoid mutation
  const updatedHeaders = [...headers];
  const updatedRows = rows.map((row) => ({ ...row }));

  let detectedDomainColumn = domainColumn;
  let detectedCompanyColumn = companyNameColumn;

  // 1. Detect domain column if not already found
  if (!detectedDomainColumn && rows.length > 0) {
    const detected = detectUrlColumn(rows, headers);
    if (detected) {
      detectedDomainColumn = detected;
      // Rename header to standardized "Domain"
      const headerIndex = headers.indexOf(detected);
      if (headerIndex !== -1) {
        updatedHeaders[headerIndex] = 'Domain';
        // Update all row keys to match new header
        updatedRows.forEach((row) => {
          if (detected in row) {
            row['Domain'] = row[detected] ?? '';
            delete row[detected];
          }
        });
        detectedDomainColumn = 'Domain';
      }
    }
  }

  // 2. Detect company name column if not already found
  if (!detectedCompanyColumn && rows.length > 0) {
    const detected = detectCompanyNameColumn(rows, headers);
    if (detected) {
      detectedCompanyColumn = detected;
      // Rename header to standardized "Company Name"
      const headerIndex = headers.indexOf(detected);
      if (headerIndex !== -1) {
        updatedHeaders[headerIndex] = 'Company Name';
        // Update all row keys to match new header
        updatedRows.forEach((row) => {
          if (detected in row) {
            row['Company Name'] = row[detected] ?? '';
            delete row[detected];
          }
        });
        detectedCompanyColumn = 'Company Name';
      }
    }
  }

  // 3. Normalize domain values for display (smart www detection)
  if (detectedDomainColumn) {
    updatedRows.forEach((row) => {
      if (detectedDomainColumn && detectedDomainColumn in row) {
        const normalized = normalizeUrlForDisplay(row[detectedDomainColumn]);
        if (normalized) {
          row[detectedDomainColumn] = normalized;
        }
      }
    });
  }

  // 4. Normalize company names (remove legal suffixes)
  if (detectedCompanyColumn) {
    updatedRows.forEach((row) => {
      if (detectedCompanyColumn && detectedCompanyColumn in row) {
        const normalized = normalizeCompanyNameValue(row[detectedCompanyColumn]);
        if (normalized) {
          row[detectedCompanyColumn] = normalized;
        }
      }
    });
  }

  return {
    ...parsed,
    headers: updatedHeaders,
    rows: updatedRows,
    domainColumn: detectedDomainColumn,
    companyNameColumn: detectedCompanyColumn,
  };
}

/**
 * Detects URL column by scanning ROW 2 (first data row)
 *
 * @param rows - All data rows
 * @param headers - Column headers
 * @returns Header name of detected URL column, or null
 */
export function detectUrlColumn(
  rows: Record<string, string>[],
  headers: string[]
): string | null {
  if (rows.length === 0) return null;

  const firstRow = rows[0];
  if (!firstRow) return null;

  // Scan each column in ROW 2
  for (const header of headers) {
    const value = firstRow[header];
    if (!value || typeof value !== 'string') continue;

    const trimmed = value.trim();

    // Check if value resembles a URL/domain
    if (isUrlLike(trimmed)) {
      return header;
    }
  }

  return null;
}

/**
 * Detects company name column by scanning ROW 2
 *
 * Uses heuristics:
 * - Length: 2-100 characters
 * - Contains letters (not just numbers)
 * - Not an email, not a URL
 * - Returns column with longest average length and most alphabetic content
 *
 * @param rows - All data rows
 * @param headers - Column headers
 * @returns Header name of detected company column, or null
 */
export function detectCompanyNameColumn(
  rows: Record<string, string>[],
  headers: string[]
): string | null {
  if (rows.length === 0) return null;

  const firstRow = rows[0];
  if (!firstRow) return null;

  const candidates: Array<{ header: string; score: number }> = [];

  // Scan each column in ROW 2
  for (const header of headers) {
    const value = firstRow[header];
    if (!value || typeof value !== 'string') continue;

    const trimmed = value.trim();

    // Exclude URLs and emails
    if (isUrlLike(trimmed) || EMAIL_PATTERN.test(trimmed)) continue;

    // Check if resembles a company name
    if (isCompanyNameLike(trimmed)) {
      const score = calculateCompanyNameScore(trimmed);
      candidates.push({ header, score });
    }
  }

  // Return header with highest score
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.header ?? null;
}

/**
 * Normalizes URL for display with smart www detection
 *
 * Rules:
 * - Adds `https://` if no protocol present
 * - Preserves `www.` if already present
 * - Doesn't add `www.` if missing
 * - Upgrades `http://` to `https://`
 *
 * Examples:
 * - google.com → https://google.com
 * - www.salesforce.com → https://www.salesforce.com
 * - http://example.org → https://example.org
 *
 * @param url - Raw URL value
 * @returns Normalized URL for display, or null
 */
export function normalizeUrlForDisplay(
  url: string | null | undefined
): string | null {
  if (!url) return null;

  let trimmed = url.trim();
  if (!trimmed) return null;

  // Check if protocol exists
  const hasProtocol = /^https?:\/\//i.test(trimmed);

  if (hasProtocol) {
    // Extract domain without path/query/fragment
    // For URLs like "https://example.com/path", extract the domain part
    const match = trimmed.match(/^(https?:\/\/[^/?#]+)/i);
    if (match) {
      // Upgrade http:// to https://
      return match[1].replace(/^http:\/\//i, 'https://');
    }
    // Fallback: just upgrade protocol
    return trimmed.replace(/^http:\/\//i, 'https://');
  }

  // No protocol - need to add https://
  // First, strip any path/query/fragment
  const domainOnly = trimmed.split('/')[0]?.split('?')[0]?.split('#')[0] ?? trimmed;

  return `https://${domainOnly}`;
}

// Legal suffixes to remove (same as HubSpot normalizer but case-preserving)
const LEGAL_SUFFIXES_DISPLAY = [
  'incorporated', 'inc', 'llc', 'ltd', 'limited', 'corp', 'corporation',
  'co', 'company', 'group', 'holdings', 'international', 'intl',
  'enterprises', 'plc', 'gmbh', 'ag', 'sa', 'srl', 'bv', 'nv',
  'pty', 'pvt', 'llp', 'lp',
];

const SUFFIX_REGEX_DISPLAY = new RegExp(
  `\\b(${LEGAL_SUFFIXES_DISPLAY.join('|')})\\b\\.?`,
  'gi'
);

/**
 * Normalizes company name by removing legal suffixes (case-preserving)
 *
 * Unlike the HubSpot normalizer, this version preserves the original case
 * for better display purposes. Only removes legal suffixes and cleans up
 * trailing punctuation/whitespace.
 *
 * @param name - Raw company name
 * @returns Normalized company name, or null
 */
export function normalizeCompanyNameValue(
  name: string | null | undefined
): string | null {
  if (!name || typeof name !== 'string') return null;

  let normalized = name;

  // Remove legal suffixes (case-insensitive)
  normalized = normalized.replace(SUFFIX_REGEX_DISPLAY, '');

  // Remove trailing commas, periods, and whitespace
  normalized = normalized.replace(/[,.\s]+$/, '').trim();

  return normalized || null;
}

/**
 * Checks if value resembles a URL/domain
 */
function isUrlLike(value: string): boolean {
  return URL_PATTERN.test(value);
}

/**
 * Checks if value resembles a company name
 */
function isCompanyNameLike(value: string): boolean {
  // Length check: 2-100 characters
  if (value.length < 2 || value.length > 100) return false;

  // Must contain at least one letter
  if (!/[a-zA-Z]/.test(value)) return false;

  // Shouldn't be just numbers
  if (/^\d+$/.test(value)) return false;

  return true;
}

/**
 * Calculates heuristic score for company name detection
 * Higher score = more likely to be a company name
 */
function calculateCompanyNameScore(value: string): number {
  let score = 0;

  // Prefer longer names (but not too long)
  const length = value.length;
  if (length >= 10 && length <= 50) score += 2;
  else if (length >= 5 && length <= 100) score += 1;

  // Prefer names with spaces (e.g., "Acme Corporation")
  if (/\s/.test(value)) score += 2;

  // Prefer names with capital letters (title case)
  if (/[A-Z]/.test(value)) score += 1;

  // Prefer names with common business words
  const businessWords = ['corp', 'inc', 'llc', 'ltd', 'company', 'group'];
  const lowerValue = value.toLowerCase();
  if (businessWords.some((word) => lowerValue.includes(word))) score += 3;

  return score;
}
