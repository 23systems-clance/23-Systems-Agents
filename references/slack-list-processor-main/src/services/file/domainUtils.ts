/**
 * Domain normalization and HTML detection utilities.
 *
 * Provides reusable functions for cleaning domain values from CSV/XLSX
 * uploads before passing them to BuiltWith or Apollo APIs.
 */

// ---------------------------------------------------------------------------
// HTML detection
// ---------------------------------------------------------------------------

/** Regex to detect HTML tags (e.g. `<a href="...">text</a>`). */
const HTML_TAG_RE = /<[a-zA-Z][\s\S]*?>/;

/**
 * Checks whether a string contains HTML tags.
 *
 * @param value - The raw cell value to check.
 * @returns `true` if HTML tags are detected.
 */
export function containsHtml(value: string): boolean {
  return HTML_TAG_RE.test(value);
}

// ---------------------------------------------------------------------------
// HTML extraction
// ---------------------------------------------------------------------------

/** Regex to strip all HTML tags, leaving only text content. */
const STRIP_TAGS_RE = /<[^>]+>/g;

/**
 * Extracts text content from an HTML string by stripping all tags.
 *
 * @param html - String potentially containing HTML tags.
 * @returns The plain text content with tags removed and whitespace trimmed.
 */
export function stripHtmlTags(html: string): string {
  return html.replace(STRIP_TAGS_RE, '').trim();
}

// ---------------------------------------------------------------------------
// Domain normalization
// ---------------------------------------------------------------------------

/**
 * Normalizes a raw domain string for API consumption.
 *
 * - Strips HTML tags (e.g. Salesforce export `<a href="...">domain</a>`)
 * - Removes protocol prefixes (`http://`, `https://`)
 * - Removes `www.` prefix
 * - Removes trailing slashes and path/query components
 * - Lowercases the result
 * - Returns `null` for empty, whitespace-only, or invalid values
 *
 * @param raw - The raw domain string from a CSV cell.
 * @returns Cleaned domain string, or `null` if empty/invalid.
 */
export function normalizeDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let domain = raw.trim();
  if (!domain) return null;

  // Strip HTML tags if present.
  if (containsHtml(domain)) {
    domain = stripHtmlTags(domain);
  }

  // Remove protocol.
  domain = domain.replace(/^https?:\/\//i, '');

  // Remove www. prefix.
  domain = domain.replace(/^www\./i, '');

  // Remove trailing path, query string, and fragment.
  domain = domain.split('/')[0]!;
  domain = domain.split('?')[0]!;
  domain = domain.split('#')[0]!;

  // Lowercase.
  domain = domain.toLowerCase().trim();

  // Basic validity check: must contain at least one dot and no spaces.
  if (!domain || !domain.includes('.') || domain.includes(' ')) {
    return null;
  }

  return domain;
}

// ---------------------------------------------------------------------------
// Subdomain stripping
// ---------------------------------------------------------------------------

/**
 * Well-known two-part country-code TLDs where the registerable domain
 * contains three segments (e.g. `example.co.uk`).
 */
const TWO_PART_TLDS = new Set([
  'co.uk', 'co.jp', 'co.kr', 'co.nz', 'co.za', 'co.in', 'co.il',
  'com.au', 'com.br', 'com.cn', 'com.mx', 'com.sg', 'com.tw', 'com.ar',
  'org.uk', 'org.au', 'net.au', 'ac.uk', 'gov.uk', 'gov.au',
]);

/**
 * Extracts the root (registerable) domain by stripping subdomains.
 *
 * Examples:
 * - `marketing.competitor.com` → `competitor.com`
 * - `www.acme.co.uk` → `acme.co.uk`
 * - `acme.com` → `acme.com` (unchanged)
 *
 * @param domain - A domain string (no protocol, no paths). Should already be
 *   normalized via {@link normalizeDomain}.
 * @returns The root domain, or the input unchanged if it cannot be simplified.
 */
export function stripSubdomain(domain: string): string {
  const parts = domain.toLowerCase().split('.');
  if (parts.length <= 2) return domain.toLowerCase();

  // Check for two-part TLD (e.g. co.uk)
  const lastTwo = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  if (TWO_PART_TLDS.has(lastTwo)) {
    // Keep last 3 parts: e.g. acme.co.uk
    return parts.slice(-3).join('.');
  }

  // Standard TLD: keep last 2 parts
  return parts.slice(-2).join('.');
}

// ---------------------------------------------------------------------------
// Personal email domain detection
// ---------------------------------------------------------------------------

/** Default list of common free/personal email providers. */
export const DEFAULT_PERSONAL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'aol.com',
  'icloud.com',
  'live.com',
  'msn.com',
  'me.com',
  'protonmail.com',
  'ymail.com',
  'mail.com',
]);

/**
 * Checks whether a domain is a personal/free email provider.
 *
 * @param domain - Normalized domain to check (lowercase, no protocol).
 * @param personalDomains - Set of personal domains to match against.
 *   Defaults to {@link DEFAULT_PERSONAL_DOMAINS}.
 * @returns `true` if the domain matches the personal domain list.
 */
export function isPersonalDomain(
  domain: string,
  personalDomains: ReadonlySet<string> = DEFAULT_PERSONAL_DOMAINS,
): boolean {
  return personalDomains.has(domain.toLowerCase());
}
