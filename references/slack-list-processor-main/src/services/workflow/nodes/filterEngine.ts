/**
 * Filter criteria evaluator for the Parser node.
 *
 * Evaluates an array of filter rules against data rows, supporting
 * all EdgeCondition operators plus: in, not_in, starts_with, ends_with.
 * Supports AND/OR logic between filters.
 */

/** A single filter criterion. */
export interface FilterCriterion {
  field: string;
  operator: string;
  value?: string | number | boolean | string[];
  /** Logic for combining with next filter. Default 'AND'. */
  logic?: 'AND' | 'OR';
}

/**
 * Filters an array of data rows against the given criteria.
 *
 * @param rows - Array of row objects to filter.
 * @param filters - Array of filter criteria.
 * @returns Rows that match all criteria (AND logic by default).
 */
export function filterRows(
  rows: Record<string, unknown>[],
  filters: FilterCriterion[]
): Record<string, unknown>[] {
  if (!filters || filters.length === 0) return rows;
  if (!rows || rows.length === 0) return [];

  return rows.filter((row) => evaluateFilters(row, filters));
}

/**
 * Evaluates all filter criteria against a single row.
 * Groups are split by OR logic boundaries. Within a group, all filters
 * must pass (AND). Between groups, any can pass (OR).
 */
function evaluateFilters(row: Record<string, unknown>, filters: FilterCriterion[]): boolean {
  // Split into AND groups separated by OR
  const groups: FilterCriterion[][] = [[]];
  for (const filter of filters) {
    groups[groups.length - 1].push(filter);
    if (filter.logic === 'OR') {
      groups.push([]);
    }
  }

  // Remove empty trailing group
  if (groups[groups.length - 1].length === 0) {
    groups.pop();
  }

  // OR between groups: any group fully matching means the row passes
  return groups.some((group) => group.every((f) => evaluateSingle(row, f)));
}

/**
 * Evaluates a single filter criterion against a row.
 */
function evaluateSingle(row: Record<string, unknown>, filter: FilterCriterion): boolean {
  const rawValue = row[filter.field];
  const value = rawValue;

  switch (filter.operator) {
    case 'equals':
      return String(value) === String(filter.value);

    case 'not_equals':
      return String(value) !== String(filter.value);

    case 'contains':
      return String(value ?? '').toLowerCase().includes(String(filter.value ?? '').toLowerCase());

    case 'greater_than':
      return Number(value) > Number(filter.value);

    case 'less_than':
      return Number(value) < Number(filter.value);

    case 'is_empty':
      return value === null || value === undefined || value === '';

    case 'is_not_empty':
      return value !== null && value !== undefined && value !== '';

    case 'regex': {
      try {
        return new RegExp(String(filter.value)).test(String(value ?? ''));
      } catch {
        return false;
      }
    }

    case 'in': {
      const list = Array.isArray(filter.value) ? filter.value : String(filter.value ?? '').split(',').map((s) => s.trim());
      return list.includes(String(value));
    }

    case 'not_in': {
      const list = Array.isArray(filter.value) ? filter.value : String(filter.value ?? '').split(',').map((s) => s.trim());
      return !list.includes(String(value));
    }

    case 'starts_with':
      return String(value ?? '').toLowerCase().startsWith(String(filter.value ?? '').toLowerCase());

    case 'ends_with':
      return String(value ?? '').toLowerCase().endsWith(String(filter.value ?? '').toLowerCase());

    case 'default':
      return true;

    default:
      return false;
  }
}
