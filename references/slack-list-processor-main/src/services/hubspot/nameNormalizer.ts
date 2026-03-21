/**
 * Company and contact name normalization utility.
 *
 * Normalizes company names by removing legal suffixes, punctuation,
 * and whitespace for consistent fuzzy matching. Also provides
 * properCase() for contact name formatting.
 */

const LEGAL_SUFFIXES = [
  'incorporated', 'inc', 'llc', 'ltd', 'limited', 'corp', 'corporation',
  'co', 'company', 'group', 'holdings', 'international', 'intl',
  'enterprises', 'plc', 'gmbh', 'ag', 'sa', 'srl', 'bv', 'nv',
  'pty', 'pvt', 'llp', 'lp',
];

/** Regex matching legal suffixes (word boundary, case insensitive). */
const SUFFIX_REGEX = new RegExp(
  `\\b(${LEGAL_SUFFIXES.join('|')})\\b\\.?`,
  'gi'
);

/**
 * Normalizes a company name for matching purposes.
 *
 * Pipeline: lowercase -> remove legal suffixes -> remove punctuation ->
 * collapse whitespace -> trim.
 *
 * @param name - The raw company name.
 * @returns The normalized name (e.g., "acme"), or empty string if input is falsy.
 *
 * @example
 * normalizeCompanyName("Acme, Inc.")        // "acme"
 * normalizeCompanyName("ACME Inc")          // "acme"
 * normalizeCompanyName("Acme Incorporated") // "acme"
 */
export function normalizeCompanyName(name: string | null | undefined): string {
  if (!name || typeof name !== 'string') return '';

  let normalized = name.toLowerCase();

  // Remove legal suffixes
  normalized = normalized.replace(SUFFIX_REGEX, '');

  // Remove punctuation (commas, periods, dashes, etc.)
  normalized = normalized.replace(/[.,\-–—_/\\()[\]{}'"!@#$%^&*+=|~`<>:;?]/g, ' ');

  // Collapse whitespace and trim
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

/**
 * Converts a string to proper case (first letter of each word capitalized).
 *
 * @param name - The raw name string.
 * @returns Properly-cased name, or empty string if input is falsy.
 *
 * @example
 * properCase("JANE DOE")   // "Jane Doe"
 * properCase("john smith") // "John Smith"
 */
export function properCase(name: string | null | undefined): string {
  if (!name || typeof name !== 'string') return '';

  return name
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}
