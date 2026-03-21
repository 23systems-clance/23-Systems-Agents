/**
 * Duplicate domain grouping for the quality gate.
 *
 * Groups rows by their normalized root domain so that technographic
 * enrichment (BuiltWith) only runs once per unique domain. All contacts
 * still receive individual Apollo enrichment.
 */

import { normalizeDomain, stripSubdomain } from '../../file/domainUtils.js';
import type { DomainGroupResult } from '../types.js';

/**
 * Groups rows by normalized root domain.
 *
 * - Normalizes each domain (lowercase, strip protocol/www/subdomains)
 * - Treats variants like `acme.com`, `www.acme.com`, `ACME.COM` as the same
 * - Builds a Map<normalizedDomain, rowIndices[]>
 *
 * @param rows - Passed rows from the quality gate.
 * @param domainColumn - Column name containing the domain/website.
 * @returns Grouping result with unique domains, groups map, and duplicate count.
 */
export function groupDuplicateDomains(
  rows: Record<string, string>[],
  domainColumn: string | null,
): DomainGroupResult {
  const groups = new Map<string, number[]>();

  if (!domainColumn) {
    // No domain column — treat every row as unique
    return {
      uniqueDomains: [],
      groups,
      duplicateRowCount: 0,
    };
  }

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i]![domainColumn];
    if (!raw) continue;

    const normalized = normalizeDomain(raw);
    if (!normalized) continue;

    const root = stripSubdomain(normalized);

    const existing = groups.get(root);
    if (existing) {
      existing.push(i);
    } else {
      groups.set(root, [i]);
    }
  }

  const uniqueDomains = [...groups.keys()].sort();
  const totalRowsWithDomains = [...groups.values()].reduce((sum, arr) => sum + arr.length, 0);
  const duplicateRowCount = totalRowsWithDomains - uniqueDomains.length;

  return {
    uniqueDomains,
    groups,
    duplicateRowCount,
  };
}
