/**
 * Domain normalization utility for identity resolution.
 *
 * Strips protocol, www prefix, trailing slashes, common subdomains,
 * and extracts root domain + TLD for consistent matching.
 */

const COMMON_SUBDOMAINS = [
  'blog', 'app', 'mail', 'support', 'help', 'docs', 'api',
  'admin', 'portal', 'login', 'my', 'shop', 'store', 'cdn',
];

/**
 * Normalizes a domain for consistent comparison.
 *
 * @param domain - The raw domain or URL string.
 * @returns The normalized root domain (e.g., "acme.com"), or empty string if input is falsy.
 *
 * @example
 * normalizeDomain("https://www.acme.com/")       // "acme.com"
 * normalizeDomain("blog.acme.com")                // "acme.com"
 * normalizeDomain("HTTP://WWW.ACME.COM/page")     // "acme.com"
 */
export function normalizeDomain(domain: string | null | undefined): string {
  if (!domain || typeof domain !== 'string') return '';

  let normalized = domain.trim().toLowerCase();

  // Remove protocol
  normalized = normalized.replace(/^https?:\/\//i, '');

  // Remove www prefix
  normalized = normalized.replace(/^www\./i, '');

  // Remove path, query string, and fragment
  normalized = normalized.split('/')[0].split('?')[0].split('#')[0];

  // Remove trailing dots
  normalized = normalized.replace(/\.+$/, '');

  // Remove port number
  normalized = normalized.replace(/:\d+$/, '');

  if (!normalized) return '';

  // Remove common subdomains (only if result still has a valid TLD)
  const parts = normalized.split('.');
  if (parts.length > 2) {
    const firstPart = parts[0];
    if (COMMON_SUBDOMAINS.includes(firstPart)) {
      normalized = parts.slice(1).join('.');
    }
  }

  return normalized;
}
