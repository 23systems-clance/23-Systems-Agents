/**
 * Conflict Rules Utility (T089).
 *
 * Exports default feature weights for CRM conflict resolution confidence
 * scoring, along with normalization and string similarity helpers.
 *
 * The CRM Conflict Resolver agent uses these weights as initial defaults.
 * As admin feedback accumulates, the learning loop persists updated weights
 * to the Agent metadata field in the database.
 */

// ---------------------------------------------------------------------------
// Default Feature Weights
// ---------------------------------------------------------------------------

/**
 * Default feature weights for CRM conflict confidence scoring.
 *
 * Each weight represents the relative importance of a field match when
 * determining whether two CRM records refer to the same entity.
 */
export interface FeatureWeights {
  /** Weight for email similarity (default 0.30). */
  email: number;
  /** Weight for company name similarity (default 0.25). */
  companyName: number;
  /** Weight for domain match (default 0.20). */
  domain: number;
  /** Weight for phone match (default 0.15). */
  phone: number;
  /** Weight for title similarity (default 0.10). */
  title: number;
}

/** Default feature weights per spec T089. */
export const DEFAULT_FEATURE_WEIGHTS: FeatureWeights = {
  email: 0.30,
  companyName: 0.25,
  domain: 0.20,
  phone: 0.15,
  title: 0.10,
};

// ---------------------------------------------------------------------------
// Company Name Normalization
// ---------------------------------------------------------------------------

/**
 * Suffixes stripped during company name normalization.
 * Order matters: longer suffixes are checked first to avoid partial matches.
 */
const COMPANY_SUFFIXES = [
  'incorporated',
  'corporation',
  'limited',
  'company',
  'inc.',
  'inc',
  'llc',
  'corp.',
  'corp',
  'ltd.',
  'ltd',
  'co.',
  'co',
];

/**
 * Normalizes a company name for comparison.
 *
 * Strips common corporate suffixes (Inc, LLC, Corp, Ltd, Co.), trailing
 * periods, converts to lowercase, and trims whitespace.
 *
 * @param name - The raw company name.
 * @returns The normalized company name.
 */
export function normalizeCompanyName(name: string): string {
  let normalized = name.toLowerCase().trim();

  // Strip known suffixes (case-insensitive, already lowered)
  for (const suffix of COMPANY_SUFFIXES) {
    const pattern = new RegExp(`\\s*,?\\s*${escapeRegex(suffix)}\\s*\\.?\\s*$`, 'i');
    normalized = normalized.replace(pattern, '');
  }

  // Remove trailing periods and extra whitespace
  normalized = normalized.replace(/\.+$/, '').trim();

  // Collapse multiple spaces
  normalized = normalized.replace(/\s+/g, ' ');

  return normalized;
}

// ---------------------------------------------------------------------------
// String Similarity
// ---------------------------------------------------------------------------

/**
 * Computes a simple normalized string similarity score between two strings.
 *
 * Uses a character bigram overlap approach (Dice coefficient) which provides
 * a reasonable balance between precision and recall without external
 * dependencies.
 *
 * @param a - First string to compare.
 * @param b - Second string to compare.
 * @returns A similarity score between 0 (no similarity) and 1 (identical).
 */
export function stringSimilarity(a: string, b: string): number {
  const s1 = a.toLowerCase().trim();
  const s2 = b.toLowerCase().trim();

  // Exact match fast path
  if (s1 === s2) return 1.0;

  // Either string empty
  if (s1.length === 0 || s2.length === 0) return 0.0;

  // Single character strings — compare directly
  if (s1.length === 1 || s2.length === 1) {
    return s1 === s2 ? 1.0 : 0.0;
  }

  // Build bigram sets
  const bigrams1 = getBigrams(s1);
  const bigrams2 = getBigrams(s2);

  // Calculate Dice coefficient: 2 * |intersection| / (|set1| + |set2|)
  let intersectionSize = 0;
  const bigrams2Copy = new Map(bigrams2);

  for (const [bigram, count] of bigrams1) {
    const count2 = bigrams2Copy.get(bigram) ?? 0;
    if (count2 > 0) {
      const overlap = Math.min(count, count2);
      intersectionSize += overlap;
      bigrams2Copy.set(bigram, count2 - overlap);
    }
  }

  const totalBigrams = sumValues(bigrams1) + sumValues(bigrams2);

  return totalBigrams === 0 ? 0.0 : (2 * intersectionSize) / totalBigrams;
}

// ---------------------------------------------------------------------------
// Domain Normalization
// ---------------------------------------------------------------------------

/**
 * Normalizes a domain for comparison.
 *
 * Strips protocol, www prefix, trailing slashes, and converts to lowercase.
 *
 * @param domain - The raw domain string.
 * @returns The normalized domain.
 */
export function normalizeDomain(domain: string): string {
  let normalized = domain.toLowerCase().trim();

  // Strip protocol
  normalized = normalized.replace(/^https?:\/\//, '');

  // Strip www prefix
  normalized = normalized.replace(/^www\./, '');

  // Strip trailing slash
  normalized = normalized.replace(/\/+$/, '');

  return normalized;
}

/**
 * Normalizes a phone number for comparison by stripping all non-digit characters.
 *
 * @param phone - The raw phone number string.
 * @returns Digits-only phone string.
 */
export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts character bigrams from a string into a frequency map.
 *
 * @param str - Input string.
 * @returns Map of bigram to occurrence count.
 */
function getBigrams(str: string): Map<string, number> {
  const bigrams = new Map<string, number>();

  for (let i = 0; i < str.length - 1; i++) {
    const bigram = str.substring(i, i + 2);
    bigrams.set(bigram, (bigrams.get(bigram) ?? 0) + 1);
  }

  return bigrams;
}

/**
 * Sums all values in a Map<string, number>.
 *
 * @param map - Map to sum.
 * @returns Total sum of values.
 */
function sumValues(map: Map<string, number>): number {
  let sum = 0;
  for (const v of map.values()) {
    sum += v;
  }
  return sum;
}

/**
 * Escapes special regex characters in a string.
 *
 * @param str - Input string.
 * @returns Regex-safe string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
