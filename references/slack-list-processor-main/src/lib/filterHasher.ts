/**
 * Deterministic SHA-256 hash of Apollo contact filter parameters.
 *
 * Used as the composite cache key alongside normalizedDomain for the
 * ApolloSearchCache table. Ensures that two jobs with the same domain
 * and identical filters produce the same hash regardless of array order.
 */

import { createHash } from 'node:crypto';
import type { ApolloContactFilters } from '../types/enrichmentFilters.js';

/**
 * Computes a deterministic SHA-256 hash from Apollo filter parameters.
 *
 * Algorithm:
 *   1. Sort each filter array alphabetically
 *   2. Join each array with "|"
 *   3. Concatenate groups with "::" delimiter
 *   4. Append perPage
 *   5. SHA-256 hash the result
 *
 * @param filters - Apollo contact search filters.
 * @returns 64-character hex SHA-256 hash string.
 */
export function computeFilterHash(filters: ApolloContactFilters): string {
  const seniorities = [...filters.personSeniorities].sort().join('|');
  const titles = [...filters.personTitles].sort().join('|');
  const departments = [...filters.personDepartments].sort().join('|');
  const functions = [...filters.personFunctions].sort().join('|');

  const combined = `${seniorities}::${titles}::${departments}::${functions}::${filters.perPage}`;

  return createHash('sha256').update(combined).digest('hex');
}
