/**
 * Personal email domain filter.
 *
 * Rejects rows where the email column domain matches the effective personal
 * domain list (gmail.com, yahoo.com, etc.).
 */

import type { FilterResult, FilteredRow } from '../types.js';

/**
 * Filters rows with personal email domains.
 *
 * @param rows - Rows to filter (already passed previous filters).
 * @param emailColumn - The detected email column header, or null.
 * @param personalDomains - Set of personal domains to match against.
 * @param startIndex - Base row index offset (for accurate FilteredRow.rowIndex).
 * @returns Passed and filtered rows.
 */
export function filterPersonalEmails(
  rows: Record<string, string>[],
  emailColumn: string | null,
  personalDomains: ReadonlySet<string>,
  startIndex = 0,
): FilterResult {
  // Skip gracefully if no email column detected
  if (!emailColumn) {
    return { passed: rows, filtered: [] };
  }

  const passed: Record<string, string>[] = [];
  const filtered: FilteredRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const email = (row[emailColumn] ?? '').trim().toLowerCase();

    if (!email) {
      // No email value — pass through (don't filter on missing data here)
      passed.push(row);
      continue;
    }

    const atIndex = email.lastIndexOf('@');
    if (atIndex === -1) {
      // Not a valid email format — pass through
      passed.push(row);
      continue;
    }

    const domain = email.slice(atIndex + 1);
    if (personalDomains.has(domain)) {
      filtered.push({
        row,
        rowIndex: startIndex + i,
        reason: `Personal email domain (${domain})`,
      });
    } else {
      passed.push(row);
    }
  }

  return { passed, filtered };
}
