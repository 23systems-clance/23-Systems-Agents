/**
 * Campaign-related validation utilities.
 */

/** Pattern matching valid LinkedIn profile URLs. */
const LINKEDIN_PROFILE_PATTERN = /^https?:\/\/(www\.)?linkedin\.com\/in\/[\w-]+\/?$/i;

/**
 * Checks whether a URL is a valid LinkedIn personal profile link.
 *
 * Accepts formats like:
 *   https://linkedin.com/in/john-doe
 *   https://www.linkedin.com/in/john-doe/
 *
 * Rejects company pages, school pages, and other LinkedIn URLs.
 */
export function isValidLinkedInUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return LINKEDIN_PROFILE_PATTERN.test(url.trim());
}
