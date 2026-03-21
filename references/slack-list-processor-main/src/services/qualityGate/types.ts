/**
 * Shared types for the pre-enrichment quality gate.
 *
 * The quality gate filters out low-quality rows (personal emails, missing
 * company data, suppression domains, duplicates) BEFORE any BuiltWith or
 * Apollo API calls are made.
 */

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------

/** A single row that was rejected by a quality gate filter. */
export interface FilteredRow {
  /** The original parsed row data (all columns). */
  row: Record<string, string>;
  /** Original 0-based row index in the uploaded file. */
  rowIndex: number;
  /** Human-readable reason the row was filtered. */
  reason: string;
}

/** Output of an individual filter function. */
export interface FilterResult {
  /** Rows that passed this filter. */
  passed: Record<string, string>[];
  /** Rows rejected by this filter with reasons. */
  filtered: FilteredRow[];
}

// ---------------------------------------------------------------------------
// Quality gate result
// ---------------------------------------------------------------------------

/** Breakdown of filtered rows by reason category. */
export interface FilterBreakdown {
  personalEmail: number;
  missingCompany: number;
  suppressionDomain: number;
  duplicateEmail: number;
}

/** Complete result of running the quality gate on a file. */
export interface QualityGateResult {
  totalRows: number;
  passedRows: number;
  filteredRows: number;
  uniqueDomains: number;
  duplicateDomainRows: number;
  filterBreakdown: FilterBreakdown;
  filteredFileUrl: string | null;
  filteredFileKey: string | null;
  processingTimeMs: number;
}

// ---------------------------------------------------------------------------
// Config snapshot
// ---------------------------------------------------------------------------

/** JSON-serializable snapshot of the effective config stored on Job record. */
export interface QualityGateConfigSnapshot {
  rejectPersonalEmails: boolean;
  rejectMissingCompany: boolean;
  rejectDuplicateEmails: boolean;
  deduplicateDomains: boolean;
  suppressionDomains: string[];
  personalDomainOverrides: string[];
  allowPersonalDomains: string[];
  effectivePersonalDomains: string[];
}

// ---------------------------------------------------------------------------
// Domain grouping (US3)
// ---------------------------------------------------------------------------

/** Result of grouping duplicate domains within a file. */
export interface DomainGroupResult {
  /** Unique normalized domains. */
  uniqueDomains: string[];
  /** Map from normalized domain to array of row indices sharing that domain. */
  groups: Map<string, number[]>;
  /** Number of rows that are duplicates (total rows - unique domains). */
  duplicateRowCount: number;
}
