import * as XLSX from 'xlsx';
import { parse } from 'csv-parse/sync';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of parsing a CSV or XLSX file. */
export interface ParsedFile {
  rows: Record<string, string>[];
  headers: string[];
  domainColumn: string | null;
  companyNameColumn: string | null;
  emailColumn: string | null;
  rowCount: number;
  fileType: 'csv' | 'xlsx';
}

/** Validation result returned by validateRowCount. */
export interface RowCountValidation {
  valid: boolean;
  tier: 'standard' | 'rejected';
  message?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** MIME types recognised as XLSX / XLS. */
const XLSX_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

/**
 * Detects the most likely delimiter in a CSV blob by counting occurrences of
 * common delimiters across the first 5 lines.
 */
function detectDelimiter(text: string): string {
  const candidates = [',', ';', '\t'];
  const lines = text.split('\n').slice(0, 5);

  let bestDelimiter = ',';
  let bestCount = 0;

  for (const delimiter of candidates) {
    const count = lines.reduce(
      (sum, line) => sum + line.split(delimiter).length - 1,
      0,
    );
    if (count > bestCount) {
      bestCount = count;
      bestDelimiter = delimiter;
    }
  }

  return bestDelimiter;
}

/**
 * Decodes a Buffer to a string, handling BOM for UTF-8 and falling back to
 * Latin-1 when the buffer contains non-UTF-8 bytes.
 */
function decodeBuffer(buffer: Buffer): string {
  // Check for UTF-8 BOM
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString('utf-8');
  }

  // Try UTF-8 first; fall back to Latin-1 if decoding produces replacement chars
  const utf8 = buffer.toString('utf-8');
  if (utf8.includes('\uFFFD')) {
    return buffer.toString('latin1');
  }
  return utf8;
}

/**
 * Searches headers for a column whose name matches one of the given keywords
 * (case-insensitive substring match). Returns the original header string or null.
 */
function findColumn(headers: string[], keywords: string[]): string | null {
  const lower = headers.map((h) => h.toLowerCase());
  for (const keyword of keywords) {
    const index = lower.findIndex((h) => h.includes(keyword));
    if (index !== -1) {
      return headers[index] ?? null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parses a CSV or XLSX buffer into a structured ParsedFile. Automatically
 * detects the domain and company-name columns by header keywords.
 *
 * @param buffer   - Raw file bytes
 * @param mimeType - MIME type reported by Slack (e.g. 'text/csv')
 */
export function parseFile(buffer: Buffer, mimeType: string): ParsedFile {
  let rows: Record<string, string>[];
  let headers: string[];
  let fileType: 'csv' | 'xlsx';

  if (mimeType === 'text/csv') {
    // ---- CSV path ----
    fileType = 'csv';
    const text = decodeBuffer(buffer);
    const delimiter = detectDelimiter(text);

    rows = parse(text, {
      columns: true,
      skip_empty_lines: true,
      delimiter,
      trim: true,
      relax_column_count: true,
    }) as Record<string, string>[];

    headers =
      rows.length > 0 ? Object.keys(rows[0] as Record<string, string>) : [];
  } else if (XLSX_MIMES.has(mimeType)) {
    // ---- XLSX / XLS path ----
    fileType = 'xlsx';
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      return {
        rows: [],
        headers: [],
        domainColumn: null,
        companyNameColumn: null,
        emailColumn: null,
        rowCount: 0,
        fileType: 'xlsx',
      };
    }

    const sheet = workbook.Sheets[firstSheetName]!;
    rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
      defval: '',
      raw: false,
    });

    headers =
      rows.length > 0 ? Object.keys(rows[0] as Record<string, string>) : [];
  } else {
    throw new Error(`Unsupported file type: ${mimeType}`);
  }

  // Auto-detect key columns
  const domainColumn = findColumn(headers, [
    'domain',
    'website',
    'url',
    'site',
  ]);
  const companyNameColumn = findColumn(headers, [
    'company',
    'name',
    'organization',
    'org',
  ]);
  const emailColumn = findColumn(headers, [
    'email',
    'e-mail',
    'email_address',
    'contact_email',
  ]);

  return {
    rows,
    headers,
    domainColumn,
    companyNameColumn,
    emailColumn,
    rowCount: rows.length,
    fileType,
  };
}

/**
 * Checks whether a parsed file contains at least one recognizable column
 * (domain or company name). Returns false when the file has headers but none
 * match the expected keywords, which typically means the user uploaded a file
 * with non-standard column names.
 *
 * @param parsed - The result of {@link parseFile}.
 * @returns `true` if at least one key column was detected, `false` otherwise.
 */
export function hasRecognizableColumns(parsed: ParsedFile): boolean {
  return parsed.domainColumn !== null || parsed.companyNameColumn !== null;
}

/**
 * Validates the number of rows in a parsed file and returns the tier
 * classification.
 *
 * @param rowCount - Total data rows (excluding header)
 */
export function validateRowCount(rowCount: number): RowCountValidation {
  if (rowCount <= 1000) {
    return { valid: true, tier: 'standard' };
  }
  return {
    valid: false,
    tier: 'rejected',
    message:
      'File exceeds the 1,000 row limit. Please split the file into smaller batches and try again.',
  };
}
