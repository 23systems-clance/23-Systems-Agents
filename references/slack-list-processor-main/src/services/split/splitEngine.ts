/**
 * Core splitting logic for the /split command.
 *
 * Supports four split modes:
 * - half: 2 equal parts
 * - quarters: 4 equal parts
 * - by_column: group by unique values in a selected column
 * - custom: N equal parts (user-specified N)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single output part from a split operation. */
export interface SplitPart {
  /** Label for this part (e.g., "Part 1", "IT Leader"). */
  label: string;
  /** Rows belonging to this part. */
  rows: Record<string, string>[];
}

/** Result of a split operation. */
export interface SplitResult {
  /** All output parts. */
  parts: SplitPart[];
  /** Total row count of the input. */
  totalRows: number;
}

/** Column value group used for by-column preview. */
export interface ColumnGroup {
  value: string;
  count: number;
}

// ---------------------------------------------------------------------------
// Equal split (half, quarters, custom N-way)
// ---------------------------------------------------------------------------

/**
 * Splits rows into N roughly equal parts.
 *
 * Algorithm:
 * - Base size = floor(totalRows / N)
 * - Remainder = totalRows % N
 * - First `remainder` parts get (baseSize + 1) rows
 * - Remaining parts get baseSize rows
 *
 * This ensures the difference between any two parts is at most 1 row.
 *
 * @param rows - Input data rows
 * @param n - Number of parts to split into (capped at rows.length)
 * @returns SplitResult with labeled parts
 */
export function splitEqual(
  rows: Record<string, string>[],
  n: number,
): SplitResult {
  if (n < 2) throw new Error('Split count must be at least 2');

  const totalRows = rows.length;
  const effectiveN = Math.min(n, totalRows);
  const baseSize = Math.floor(totalRows / effectiveN);
  const remainder = totalRows % effectiveN;

  const parts: SplitPart[] = [];
  let offset = 0;

  for (let i = 0; i < effectiveN; i++) {
    const partSize = baseSize + (i < remainder ? 1 : 0);
    parts.push({
      label: `Part ${i + 1}`,
      rows: rows.slice(offset, offset + partSize),
    });
    offset += partSize;
  }

  return { parts, totalRows };
}

// ---------------------------------------------------------------------------
// By-column split
// ---------------------------------------------------------------------------

/**
 * Analyzes unique values in a column and returns groups with counts.
 * Used for the preview step before confirming a by-column split.
 *
 * @param rows - Input data rows
 * @param columnName - Column to group by
 * @returns Array of groups sorted by count descending
 */
export function analyzeColumnGroups(
  rows: Record<string, string>[],
  columnName: string,
): ColumnGroup[] {
  const groups = new Map<string, number>();

  for (const row of rows) {
    const value = (row[columnName] ?? '').trim();
    groups.set(value, (groups.get(value) ?? 0) + 1);
  }

  return Array.from(groups.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Splits rows by unique values in a column.
 *
 * Each unique value becomes a separate part. Labels are sanitized
 * versions of the column values (safe for filenames).
 *
 * @param rows - Input data rows
 * @param columnName - Column to group by
 * @returns SplitResult with one part per unique value
 */
export function splitByColumn(
  rows: Record<string, string>[],
  columnName: string,
): SplitResult {
  const groupMap = new Map<string, Record<string, string>[]>();

  for (const row of rows) {
    const value = (row[columnName] ?? '').trim();
    if (!groupMap.has(value)) {
      groupMap.set(value, []);
    }
    groupMap.get(value)!.push(row);
  }

  // Sort groups by size descending for consistent output
  const entries = Array.from(groupMap.entries())
    .sort((a, b) => b[1].length - a[1].length);

  // Track used labels to handle duplicate sanitized values
  const usedLabels = new Map<string, number>();
  const parts: SplitPart[] = entries.map(([value, partRows]) => {
    let label = sanitizeLabel(value || 'EMPTY');
    const count = usedLabels.get(label) ?? 0;
    if (count > 0) {
      label = `${label}_${count + 1}`;
    }
    usedLabels.set(label.replace(/_\d+$/, ''), count + 1);
    return { label, rows: partRows };
  });

  return { parts, totalRows: rows.length };
}

// ---------------------------------------------------------------------------
// Filename helpers
// ---------------------------------------------------------------------------

/**
 * Sanitizes a string for use in filenames.
 * Replaces spaces with underscores, removes special characters,
 * and truncates to 40 characters.
 */
export function sanitizeLabel(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9_\-\s]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 40)
    .replace(/_+$/, '');
}

/**
 * Builds the output filename for a split part.
 *
 * Format: `MMDD [CLIENT] Campaign Name - Part Label.ext`
 *
 * @param clientName - Client name (e.g., "Acme Corp")
 * @param campaignName - Campaign or target list name
 * @param partLabel - Part identifier (e.g., "Part 1", "IT Leader")
 * @param fileType - Output file extension
 * @returns Formatted filename
 */
export function buildSplitFileName(
  clientName: string,
  campaignName: string,
  partLabel: string,
  fileType: 'csv' | 'xlsx',
): string {
  const now = new Date();
  const mmdd = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `${mmdd} [${clientName}] ${campaignName} - ${partLabel}.${fileType}`;
}

/**
 * Extracts a campaign name from a source file name by stripping
 * common prefixes like date tags, "CONTACTS -", "FILTERED -", etc.
 */
export function detectCampaignName(sourceFileName: string): string {
  let name = sourceFileName;

  // Strip file extension
  name = name.replace(/\.(csv|xlsx)$/i, '');

  // Strip date prefix patterns: [MMDD], [MM/DD], MMDD
  name = name.replace(/^\[?\d{2,4}[/-]?\d{2}\]?\s*/, '');

  // Strip common prefixes
  name = name.replace(/^(CONTACTS|FILTERED|SPLIT|ENRICHED)\s*-\s*/i, '');

  return name.trim() || 'Target List';
}
