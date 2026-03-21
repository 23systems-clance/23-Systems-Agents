import { describe, it, expect } from 'vitest';
import { validateFile } from '../../../src/services/file/validator.js';
import type { ParsedFile } from '../../../src/services/file/parser.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a minimal ParsedFile for testing. */
function makeParsedFile(overrides: Partial<ParsedFile> = {}): ParsedFile {
  return {
    rows: [
      { domain: 'example.com', company: 'Example Corp' },
      { domain: 'acme.org', company: 'Acme Industries' },
    ],
    headers: ['domain', 'company'],
    domainColumn: 'domain',
    companyNameColumn: 'company',
    rowCount: 2,
    fileType: 'csv',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validateFile', () => {
  it('should pass for a valid file with domain and company columns', () => {
    const parsed = makeParsedFile();
    const result = validateFile(parsed);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should fail when no recognizable columns exist', () => {
    const parsed = makeParsedFile({
      headers: ['foo', 'bar'],
      domainColumn: null,
      companyNameColumn: null,
      rows: [{ foo: 'val1', bar: 'val2' }],
      rowCount: 1,
    });

    const result = validateFile(parsed);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'NO_RECOGNIZABLE_COLUMNS')).toBe(true);
  });

  it('should fail when row count exceeds 1000', () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({
      domain: `example${i}.com`,
      company: `Company ${i}`,
    }));

    const parsed = makeParsedFile({ rows, rowCount: 1001 });
    const result = validateFile(parsed);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'ROW_LIMIT_EXCEEDED')).toBe(true);
  });

  it('should fail when >50% of rows have empty domain and company', () => {
    const rows = [
      { domain: '', company: '' },
      { domain: '', company: '' },
      { domain: '', company: '' },
      { domain: 'example.com', company: 'Example Corp' },
    ];

    const parsed = makeParsedFile({ rows, rowCount: 4 });
    const result = validateFile(parsed);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'LOW_DATA_QUALITY')).toBe(true);
  });

  it('should pass when exactly 50% of rows have data', () => {
    const rows = [
      { domain: '', company: '' },
      { domain: 'example.com', company: 'Example Corp' },
    ];

    const parsed = makeParsedFile({ rows, rowCount: 2 });
    const result = validateFile(parsed);

    expect(result.valid).toBe(true);
  });

  it('should warn about HTML contamination in domain values', () => {
    const rows = [
      { domain: '<a href="/foo">example.com</a>', company: 'Example Corp' },
      { domain: 'acme.org', company: 'Acme' },
    ];

    const parsed = makeParsedFile({ rows, rowCount: 2 });
    const result = validateFile(parsed);

    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.code === 'HTML_CONTAMINATION')).toBe(true);
    expect(result.warnings[0]!.affectedCount).toBe(1);
  });

  it('should normalize domain values in returned rows', () => {
    const rows = [
      { domain: 'https://www.example.com/', company: 'Example Corp' },
      { domain: 'HTTP://ACME.ORG/path', company: 'Acme' },
    ];

    const parsed = makeParsedFile({ rows, rowCount: 2 });
    const result = validateFile(parsed);

    expect(result.valid).toBe(true);
    expect(result.normalizedRows[0]!.domain).toBe('example.com');
    expect(result.normalizedRows[1]!.domain).toBe('acme.org');
    expect(result.warnings.some((w) => w.code === 'DOMAINS_NORMALIZED')).toBe(true);
  });

  it('should not modify the original parsed rows', () => {
    const rows = [
      { domain: 'https://www.example.com/', company: 'Example Corp' },
    ];

    const parsed = makeParsedFile({ rows, rowCount: 1 });
    validateFile(parsed);

    // Original row should be unchanged.
    expect(rows[0]!.domain).toBe('https://www.example.com/');
  });

  it('should handle file with only company column (no domain)', () => {
    const rows = [
      { company: 'Example Corp' },
      { company: 'Acme Industries' },
    ];

    const parsed = makeParsedFile({
      rows,
      headers: ['company'],
      domainColumn: null,
      companyNameColumn: 'company',
      rowCount: 2,
    });

    const result = validateFile(parsed);

    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });
});
