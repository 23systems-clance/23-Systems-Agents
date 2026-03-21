/**
 * Suppression domain filter.
 *
 * Rejects rows whose email domain or website domain matches the workspace's
 * suppression list after normalization (lowercase + stripSubdomain).
 */

import { normalizeDomain, stripSubdomain } from '../../file/domainUtils.js';
import type { FilterResult, FilteredRow } from '../types.js';

/**
 * Filters rows matching the workspace suppression domain list.
 *
 * @param rows - Rows to filter.
 * @param emailColumn - Detected email column header, or null.
 * @param domainColumn - Detected domain/website column header, or null.
 * @param suppressionList - Array of suppression root domains (already normalized).
 * @param startIndex - Base row index offset.
 * @returns Passed and filtered rows.
 */
export function filterSuppressionDomains(
  rows: Record<string, string>[],
  emailColumn: string | null,
  domainColumn: string | null,
  suppressionList: string[],
  startIndex = 0,
): FilterResult {
  if (suppressionList.length === 0) {
    return { passed: rows, filtered: [] };
  }

  // Build a set of normalized suppression domains for O(1) lookup
  const suppressionSet = new Set(
    suppressionList.map((d) => stripSubdomain(d.toLowerCase())),
  );

  const passed: Record<string, string>[] = [];
  const filtered: FilteredRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    let matchedDomain: string | null = null;

    // Check email domain
    if (emailColumn) {
      const email = (row[emailColumn] ?? '').trim().toLowerCase();
      const atIndex = email.lastIndexOf('@');
      if (atIndex !== -1) {
        const emailDomain = stripSubdomain(email.slice(atIndex + 1));
        if (suppressionSet.has(emailDomain)) {
          matchedDomain = emailDomain;
        }
      }
    }

    // Check website/domain column (if email didn't match)
    if (!matchedDomain && domainColumn) {
      const rawDomain = row[domainColumn] ?? '';
      const normalized = normalizeDomain(rawDomain);
      if (normalized) {
        const rootDomain = stripSubdomain(normalized);
        if (suppressionSet.has(rootDomain)) {
          matchedDomain = rootDomain;
        }
      }
    }

    if (matchedDomain) {
      filtered.push({
        row,
        rowIndex: startIndex + i,
        reason: `Suppression list match (${matchedDomain})`,
      });
    } else {
      passed.push(row);
    }
  }

  return { passed, filtered };
}
