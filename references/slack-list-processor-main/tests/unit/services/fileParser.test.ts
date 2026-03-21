import { describe, it, expect } from 'vitest';
import {
  parseFile,
  validateRowCount,
  hasRecognizableColumns,
} from '../../../src/services/file/parser.js';
import type { ParsedFile } from '../../../src/services/file/parser.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a CSV Buffer from a raw string. Mirrors what Slack sends when a user
 * uploads a `.csv` file.
 */
function csvBuffer(content: string): Buffer {
  return Buffer.from(content, 'utf-8');
}

/**
 * Generates a CSV string with the given number of data rows (plus a header).
 * Each row contains a dummy domain and company name.
 */
function generateCsv(rowCount: number): string {
  const header = 'domain,company';
  const rows = Array.from(
    { length: rowCount },
    (_, i) => `example${i}.com,Company ${i}`,
  );
  return [header, ...rows].join('\n');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fileParser', () => {
  // -----------------------------------------------------------------------
  // parseFile – column detection
  // -----------------------------------------------------------------------

  describe('parseFile – column detection', () => {
    it('should detect a domain column from CSV headers', () => {
      const csv = csvBuffer(
        'domain,revenue\nexample.com,1000\ntest.com,2000',
      );

      const result = parseFile(csv, 'text/csv');

      expect(result.domainColumn).toBe('domain');
      expect(result.fileType).toBe('csv');
      expect(result.rowCount).toBe(2);
      expect(result.rows).toHaveLength(2);
      expect(result.headers).toContain('domain');
    });

    it('should detect a company name column from CSV headers', () => {
      const csv = csvBuffer(
        'company,revenue\nExample Corp,1000\nTest Inc,2000',
      );

      const result = parseFile(csv, 'text/csv');

      expect(result.companyNameColumn).toBe('company');
      expect(result.domainColumn).toBeNull();
      expect(result.rowCount).toBe(2);
    });

    it('should detect both domain and company name columns', () => {
      const csv = csvBuffer(
        'domain,company\nexample.com,Example Corp\ntest.com,Test Inc',
      );

      const result = parseFile(csv, 'text/csv');

      expect(result.domainColumn).toBe('domain');
      expect(result.companyNameColumn).toBe('company');
      expect(result.rowCount).toBe(2);
      expect(result.headers).toEqual(['domain', 'company']);
    });

    it('should detect columns using alternative keyword variants', () => {
      const csv = csvBuffer(
        'website,organization\nexample.com,Example Corp',
      );

      const result = parseFile(csv, 'text/csv');

      expect(result.domainColumn).toBe('website');
      expect(result.companyNameColumn).toBe('organization');
    });

    it('should set domainColumn and companyNameColumn to null for unrecognizable headers', () => {
      const csv = csvBuffer('foo,bar\nval1,val2');

      const result = parseFile(csv, 'text/csv');

      expect(result.domainColumn).toBeNull();
      expect(result.companyNameColumn).toBeNull();
      expect(result.rowCount).toBe(1);
    });

    it('should throw for an unsupported MIME type', () => {
      const buf = Buffer.from('data');

      expect(() => parseFile(buf, 'application/pdf')).toThrow(
        'Unsupported file type: application/pdf',
      );
    });
  });

  // -----------------------------------------------------------------------
  // validateRowCount
  // -----------------------------------------------------------------------

  describe('validateRowCount', () => {
    it('should return standard tier for <= 1000 rows', () => {
      const result = validateRowCount(1000);

      expect(result.valid).toBe(true);
      expect(result.tier).toBe('standard');
      expect(result.message).toBeUndefined();
    });

    it('should return standard tier for 0 rows', () => {
      const result = validateRowCount(0);

      expect(result.valid).toBe(true);
      expect(result.tier).toBe('standard');
    });

    it('should reject files with > 1000 rows', () => {
      const result = validateRowCount(1001);

      expect(result.valid).toBe(false);
      expect(result.tier).toBe('rejected');
      expect(result.message).toContain('1,000 row limit');
    });

    it('should reject files at 5000 rows', () => {
      const result = validateRowCount(5000);

      expect(result.valid).toBe(false);
      expect(result.tier).toBe('rejected');
    });

    it('should accept exactly 1000 rows', () => {
      const result = validateRowCount(1000);

      expect(result.valid).toBe(true);
      expect(result.tier).toBe('standard');
    });
  });

  // -----------------------------------------------------------------------
  // hasRecognizableColumns
  // -----------------------------------------------------------------------

  describe('hasRecognizableColumns', () => {
    it('should return true when a domain column is detected', () => {
      const parsed: ParsedFile = {
        rows: [{ domain: 'example.com' }],
        headers: ['domain'],
        domainColumn: 'domain',
        companyNameColumn: null,
        rowCount: 1,
        fileType: 'csv',
      };

      expect(hasRecognizableColumns(parsed)).toBe(true);
    });

    it('should return true when a company name column is detected', () => {
      const parsed: ParsedFile = {
        rows: [{ company: 'Acme' }],
        headers: ['company'],
        domainColumn: null,
        companyNameColumn: 'company',
        rowCount: 1,
        fileType: 'csv',
      };

      expect(hasRecognizableColumns(parsed)).toBe(true);
    });

    it('should return true when both columns are detected', () => {
      const parsed: ParsedFile = {
        rows: [{ domain: 'example.com', company: 'Acme' }],
        headers: ['domain', 'company'],
        domainColumn: 'domain',
        companyNameColumn: 'company',
        rowCount: 1,
        fileType: 'csv',
      };

      expect(hasRecognizableColumns(parsed)).toBe(true);
    });

    it('should return false when no recognizable columns exist', () => {
      const parsed: ParsedFile = {
        rows: [{ foo: 'bar' }],
        headers: ['foo'],
        domainColumn: null,
        companyNameColumn: null,
        rowCount: 1,
        fileType: 'csv',
      };

      expect(hasRecognizableColumns(parsed)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // parseFile – integration with row count (large CSV)
  // -----------------------------------------------------------------------

  describe('parseFile – row count accuracy', () => {
    it('should accurately count rows for a standard-tier file', () => {
      const csv = csvBuffer(generateCsv(50));
      const result = parseFile(csv, 'text/csv');

      expect(result.rowCount).toBe(50);
      expect(validateRowCount(result.rowCount).tier).toBe('standard');
    });
  });
});
