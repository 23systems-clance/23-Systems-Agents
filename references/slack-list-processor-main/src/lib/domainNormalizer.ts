/**
 * Domain normalization utility for the enrichment cache (Feature 17).
 *
 * Produces a consistent cache key from any domain variant:
 *   - Strips protocol, www prefix, trailing slashes/paths/port
 *   - Lowercases
 *   - Returns null for IP addresses and empty strings
 *
 * This is separate from src/services/file/domainUtils.ts which handles
 * CSV cell-level cleanup (HTML stripping, etc.). The cache normalizer
 * focuses on producing a deterministic cache lookup key.
 */

/** Regex to detect bare IPv4 addresses (with optional port). */
const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/;

/**
 * Normalizes a domain string into a consistent cache key.
 *
 * Rules:
 *   1. Remove protocol (http://, https://)
 *   2. Remove www. prefix
 *   3. Lowercase the entire string
 *   4. Remove trailing slashes, path segments, query strings, fragments
 *   5. Remove port numbers
 *   6. Return null for IP addresses, empty strings, or invalid input
 *
 * @param raw - Raw domain string from any source.
 * @returns Normalized domain suitable as a cache key, or null if invalid.
 */
export function normalizeDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let domain = raw.trim();
  if (!domain) return null;

  // Remove protocol.
  domain = domain.replace(/^https?:\/\//i, '');

  // Remove www. prefix.
  domain = domain.replace(/^www\./i, '');

  // Remove path, query, fragment.
  domain = domain.split('/')[0]!;
  domain = domain.split('?')[0]!;
  domain = domain.split('#')[0]!;

  // Remove port number.
  domain = domain.replace(/:\d+$/, '');

  // Lowercase.
  domain = domain.toLowerCase().trim();

  // Reject empty strings.
  if (!domain) return null;

  // Reject IP addresses.
  if (IPV4_RE.test(domain)) return null;

  // Basic validity: must contain at least one dot and no spaces.
  if (!domain.includes('.') || domain.includes(' ')) return null;

  return domain;
}
