/**
 * Duplicate email filter.
 *
 * Detects exact email duplicates (case-insensitive), keeps the first
 * occurrence, and filters subsequent duplicates.
 */

import type { FilterResult, FilteredRow } from '../types.js';

/**
 * Filters duplicate email rows, keeping the first occurrence.
 *
 * @param rows - Rows to filter.
 * @param emailColumn - Detected email column header, or null.
 * @param startIndex - Base row index offset.
 * @returns Passed and filtered rows.
 */
export function filterDuplicateEmails(
  rows: Record<string, string>[],
  emailColumn: string | null,
  startIndex = 0,
): FilterResult {
  if (!emailColumn) {
    return { passed: rows, filtered: [] };
  }

  const passed: Record<string, string>[] = [];
  const filtered: FilteredRow[] = [];
  // Map email → first occurrence row index (for the reason message)
  const seen = new Map<string, number>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const email = (row[emailColumn] ?? '').trim().toLowerCase();

    if (!email) {
      // No email — pass through
      passed.push(row);
      continue;
    }

    const firstIndex = seen.get(email);
    if (firstIndex !== undefined) {
      filtered.push({
        row,
        rowIndex: startIndex + i,
        reason: `Duplicate email (row ${firstIndex + 1})`,
      });
    } else {
      seen.set(email, startIndex + i);
      passed.push(row);
    }
  }

  return { passed, filtered };
}
