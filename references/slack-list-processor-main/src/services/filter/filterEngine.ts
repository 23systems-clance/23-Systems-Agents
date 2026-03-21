/**
 * Filter engine for applying structured filter criteria to parsed rows.
 *
 * Supports operators: equals, not_equals, contains, not_contains,
 * greater_than, less_than, is_empty, is_not_empty, regex.
 * Filters are applied sequentially (AND logic).
 */

import type { FilterCriterion } from '../state/conversationStore.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FilterResult {
  /** Rows that passed all filter criteria. */
  filtered: Record<string, string>[];
  /** Number of rows removed by filtering. */
  removedCount: number;
  /** Original row count before filtering. */
  originalCount: number;
}

// ---------------------------------------------------------------------------
// Operator implementations
// ---------------------------------------------------------------------------

/**
 * Attempts numeric comparison. Returns null if either value
 * cannot be parsed as a number.
 */
function tryNumericCompare(
  cellValue: string,
  filterValue: string,
): { cell: number; filter: number } | null {
  const cellNum = Number(cellValue.replace(/[,$%]/g, ''));
  const filterNum = Number(filterValue.replace(/[,$%]/g, ''));
  if (Number.isNaN(cellNum) || Number.isNaN(filterNum)) return null;
  return { cell: cellNum, filter: filterNum };
}

/**
 * Evaluates whether a single cell value matches a filter criterion.
 * Returns true if the criterion is satisfied.
 */
function evaluateOperator(
  cellValue: string | undefined,
  operator: FilterCriterion['operator'],
  filterValue: string,
): boolean {
  const cell = (cellValue ?? '').trim();
  const value = filterValue.trim();
  const cellLower = cell.toLowerCase();
  const valueLower = value.toLowerCase();

  switch (operator) {
    case 'equals':
      return cellLower === valueLower;
    case 'not_equals':
      return cellLower !== valueLower;
    case 'contains':
      return cellLower.includes(valueLower);
    case 'not_contains':
      return !cellLower.includes(valueLower);
    case 'greater_than': {
      const nums = tryNumericCompare(cell, value);
      if (nums) return nums.cell > nums.filter;
      return cell.localeCompare(value) > 0;
    }
    case 'less_than': {
      const nums = tryNumericCompare(cell, value);
      if (nums) return nums.cell < nums.filter;
      return cell.localeCompare(value) < 0;
    }
    case 'is_empty':
      return cell === '';
    case 'is_not_empty':
      return cell !== '';
    case 'regex': {
      try {
        const re = new RegExp(value, 'i');
        return re.test(cell);
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Fuzzy column matching
// ---------------------------------------------------------------------------

/**
 * Resolves a filter field name to an actual column header.
 * Tries exact match first, then case-insensitive, then substring.
 */
export function resolveColumnName(
  field: string,
  headers: string[],
): string | null {
  // Exact match
  if (headers.includes(field)) return field;

  // Case-insensitive exact match
  const lower = field.toLowerCase();
  const ciMatch = headers.find((h) => h.toLowerCase() === lower);
  if (ciMatch) return ciMatch;

  // Substring match (e.g. "employees" matches "Employee Count")
  const subMatch = headers.find((h) => h.toLowerCase().includes(lower));
  if (subMatch) return subMatch;

  // Reverse substring (e.g. "employee_count" matches "employees")
  const reverseMatch = headers.find((h) =>
    lower.includes(h.toLowerCase()),
  );
  if (reverseMatch) return reverseMatch;

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Applies an array of filter criteria to rows.
 *
 * - Filters with `action: 'exclude'` remove rows that match.
 * - Filters with `action: 'include'` keep only rows that match.
 * - Multiple filters are combined with AND logic.
 *
 * @param rows - The parsed data rows.
 * @param criteria - Structured filter criteria.
 * @param headers - Column headers for fuzzy field resolution.
 * @returns FilterResult with filtered rows and counts.
 */
export function applyFilters(
  rows: Record<string, string>[],
  criteria: FilterCriterion[],
  headers: string[],
): FilterResult {
  const originalCount = rows.length;

  // Resolve column names upfront
  const resolvedCriteria = criteria.map((c) => ({
    ...c,
    resolvedField: resolveColumnName(c.field, headers),
  }));

  const filtered = rows.filter((row) => {
    // All criteria must pass (AND logic)
    return resolvedCriteria.every((criterion) => {
      // If field couldn't be resolved, skip this criterion (don't filter out)
      if (!criterion.resolvedField) return true;

      const cellValue = row[criterion.resolvedField];
      const matches = evaluateOperator(
        cellValue,
        criterion.operator,
        criterion.value,
      );

      // For 'exclude' action: keep row if it does NOT match
      // For 'include' action: keep row if it DOES match
      return criterion.action === 'exclude' ? !matches : matches;
    });
  });

  return {
    filtered,
    removedCount: originalCount - filtered.length,
    originalCount,
  };
}

/**
 * Runs a dry-run of the filter to show a preview count without
 * actually producing the full filtered dataset.
 */
export function previewFilterCount(
  rows: Record<string, string>[],
  criteria: FilterCriterion[],
  headers: string[],
): { estimatedResultCount: number; removedCount: number } {
  const result = applyFilters(rows, criteria, headers);
  return {
    estimatedResultCount: result.filtered.length,
    removedCount: result.removedCount,
  };
}
