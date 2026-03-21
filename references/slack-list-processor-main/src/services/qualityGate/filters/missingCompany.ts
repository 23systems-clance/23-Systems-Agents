/**
 * Missing company filter.
 *
 * Rejects rows where both company name AND domain are empty/null. Rows with
 * a valid business domain but no company name pass through (the domain can
 * be used for company resolution during enrichment).
 */

import type { FilterResult, FilteredRow } from '../types.js';

/**
 * Filters rows with no resolvable company identity.
 *
 * @param rows - Rows to filter.
 * @param domainColumn - The detected domain/website column header, or null.
 * @param companyColumn - The detected company name column header, or null.
 * @param startIndex - Base row index offset.
 * @returns Passed and filtered rows.
 */
export function filterMissingCompany(
  rows: Record<string, string>[],
  domainColumn: string | null,
  companyColumn: string | null,
  startIndex = 0,
): FilterResult {
  const passed: Record<string, string>[] = [];
  const filtered: FilteredRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;

    const domain = domainColumn ? (row[domainColumn] ?? '').trim() : '';
    const company = companyColumn ? (row[companyColumn] ?? '').trim() : '';

    // Filter only if BOTH company name AND domain are empty
    if (!company && !domain) {
      filtered.push({
        row,
        rowIndex: startIndex + i,
        reason: 'Missing company name and domain',
      });
    } else {
      passed.push(row);
    }
  }

  return { passed, filtered };
}
