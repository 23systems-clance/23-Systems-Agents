import { describe, it, expect } from 'vitest';
import {
  autoDetectAndNormalizeColumns,
  detectUrlColumn,
  detectCompanyNameColumn,
  normalizeUrlForDisplay,
  normalizeCompanyNameValue,
} from '../../../src/services/file/columnAutoDetector';
import type { ParsedFile } from '../../../src/services/file/parser';

describe('columnAutoDetector', () => {
  describe('detectUrlColumn', () => {
    it('should detect column with URL in ROW 2', () => {
      const rows = [{ Website: 'google.com', Name: 'Google' }];
      const headers = ['Website', 'Name'];

      const result = detectUrlColumn(rows, headers);

      expect(result).toBe('Website');
    });

    it('should detect column with https:// URL', () => {
      const rows = [{ Domain: 'https://www.salesforce.com', Company: 'Salesforce' }];
      const headers = ['Domain', 'Company'];

      const result = detectUrlColumn(rows, headers);

      expect(result).toBe('Domain');
    });

    it('should detect column with www prefix', () => {
      const rows = [{ Site: 'www.amazon.com', Org: 'Amazon' }];
      const headers = ['Site', 'Org'];

      const result = detectUrlColumn(rows, headers);

      expect(result).toBe('Site');
    });

    it('should NOT detect email as URL', () => {
      const rows = [{ Email: 'user@example.com', Company: 'Example Corp' }];
      const headers = ['Email', 'Company'];

      const result = detectUrlColumn(rows, headers);

      expect(result).toBe(null);
    });

    it('should NOT detect plain number as URL', () => {
      const rows = [{ ID: '12345', Company: 'Test' }];
      const headers = ['ID', 'Company'];

      const result = detectUrlColumn(rows, headers);

      expect(result).toBe(null);
    });

    it('should return first matching column if multiple URLs exist', () => {
      const rows = [{ Primary: 'google.com', Secondary: 'gmail.com' }];
      const headers = ['Primary', 'Secondary'];

      const result = detectUrlColumn(rows, headers);

      expect(result).toBe('Primary');
    });

    it('should return null if ROW 2 is empty', () => {
      const rows: Record<string, string>[] = [];
      const headers = ['Domain', 'Company'];

      const result = detectUrlColumn(rows, headers);

      expect(result).toBe(null);
    });
  });

  describe('detectCompanyNameColumn', () => {
    it('should detect column with company name in ROW 2', () => {
      const rows = [{ Domain: 'google.com', Organization: 'Google Inc' }];
      const headers = ['Domain', 'Organization'];

      const result = detectCompanyNameColumn(rows, headers);

      expect(result).toBe('Organization');
    });

    it('should prefer column with business suffix (higher score)', () => {
      const rows = [{ Name: 'Acme Corporation', Label: 'Test123' }];
      const headers = ['Name', 'Label'];

      const result = detectCompanyNameColumn(rows, headers);

      expect(result).toBe('Name');
    });

    it('should NOT detect URL column as company name', () => {
      const rows = [{ Website: 'https://test.com', ID: '555' }];
      const headers = ['Website', 'ID'];

      const result = detectCompanyNameColumn(rows, headers);

      expect(result).toBe(null);
    });

    it('should NOT detect email as company name', () => {
      const rows = [{ Contact: 'admin@test.com', Phone: '555-1234' }];
      const headers = ['Contact', 'Phone'];

      const result = detectCompanyNameColumn(rows, headers);

      expect(result).toBe(null);
    });

    it('should detect column with letters and numbers', () => {
      const rows = [{ Company: 'Test 123', Domain: 'test.com' }];
      const headers = ['Company', 'Domain'];

      const result = detectCompanyNameColumn(rows, headers);

      expect(result).toBe('Company');
    });

    it('should return null if no company-like column found', () => {
      const rows = [{ Domain: 'test.com', Email: 'user@test.com' }];
      const headers = ['Domain', 'Email'];

      const result = detectCompanyNameColumn(rows, headers);

      expect(result).toBe(null);
    });

    it('should return null if ROW 2 is empty', () => {
      const rows: Record<string, string>[] = [];
      const headers = ['Company', 'Domain'];

      const result = detectCompanyNameColumn(rows, headers);

      expect(result).toBe(null);
    });
  });

  describe('normalizeUrlForDisplay', () => {
    it('should add https:// to domain without protocol', () => {
      expect(normalizeUrlForDisplay('google.com')).toBe('https://google.com');
    });

    it('should preserve www in domain', () => {
      expect(normalizeUrlForDisplay('www.salesforce.com')).toBe(
        'https://www.salesforce.com'
      );
    });

    it('should upgrade http:// to https://', () => {
      expect(normalizeUrlForDisplay('http://example.org')).toBe(
        'https://example.org'
      );
    });

    it('should preserve existing https://', () => {
      expect(normalizeUrlForDisplay('https://github.com')).toBe(
        'https://github.com'
      );
    });

    it('should preserve www with https://', () => {
      expect(normalizeUrlForDisplay('https://www.amazon.com')).toBe(
        'https://www.amazon.com'
      );
    });

    it('should handle URLs with paths (strip path)', () => {
      expect(normalizeUrlForDisplay('google.com/path/to/page')).toBe(
        'https://google.com'
      );
    });

    it('should handle URLs with query strings (strip query)', () => {
      expect(normalizeUrlForDisplay('example.com?param=value')).toBe(
        'https://example.com'
      );
    });

    it('should handle URLs with fragments (strip fragment)', () => {
      expect(normalizeUrlForDisplay('test.org#section')).toBe(
        'https://test.org'
      );
    });

    it('should return null for empty string', () => {
      expect(normalizeUrlForDisplay('')).toBe(null);
    });

    it('should return null for null input', () => {
      expect(normalizeUrlForDisplay(null)).toBe(null);
    });

    it('should return null for undefined input', () => {
      expect(normalizeUrlForDisplay(undefined)).toBe(null);
    });

    it('should trim whitespace', () => {
      expect(normalizeUrlForDisplay('  google.com  ')).toBe(
        'https://google.com'
      );
    });
  });

  describe('normalizeCompanyNameValue', () => {
    it('should remove LLC suffix', () => {
      expect(normalizeCompanyNameValue('Acme LLC')).toBe('Acme');
    });

    it('should remove Inc suffix', () => {
      expect(normalizeCompanyNameValue('Microsoft Inc')).toBe('Microsoft');
    });

    it('should remove Corp suffix', () => {
      expect(normalizeCompanyNameValue('Test Corp')).toBe('Test');
    });

    it('should remove Corporation suffix', () => {
      expect(normalizeCompanyNameValue('Microsoft Corporation')).toBe(
        'Microsoft'
      );
    });

    it('should remove multiple suffixes', () => {
      expect(normalizeCompanyNameValue('Acme Corp, LLC')).toBe('Acme');
    });

    it('should remove Ltd suffix', () => {
      expect(normalizeCompanyNameValue('Example Ltd')).toBe('Example');
    });

    it('should preserve company names without suffixes', () => {
      expect(normalizeCompanyNameValue('Google')).toBe('Google');
    });

    it('should preserve punctuation that is part of brand', () => {
      expect(normalizeCompanyNameValue('Yahoo!')).toBe('Yahoo!');
    });

    it('should return null for empty string', () => {
      expect(normalizeCompanyNameValue('')).toBe(null);
    });

    it('should return null for null input', () => {
      expect(normalizeCompanyNameValue(null)).toBe(null);
    });

    it('should return null for undefined input', () => {
      expect(normalizeCompanyNameValue(undefined)).toBe(null);
    });
  });

  describe('autoDetectAndNormalizeColumns', () => {
    it('should detect and rename domain column from "Website" to "Domain"', () => {
      const parsed: ParsedFile = {
        rows: [
          { Website: 'google.com', Company: 'Google Inc' },
          { Website: 'amazon.com', Company: 'Amazon LLC' },
        ],
        headers: ['Website', 'Company'],
        domainColumn: null,
        companyNameColumn: null,
        emailColumn: null,
        rowCount: 2,
        fileType: 'csv',
      };

      const result = autoDetectAndNormalizeColumns(parsed);

      expect(result.headers).toEqual(['Domain', 'Company Name']);
      expect(result.domainColumn).toBe('Domain');
      expect(result.companyNameColumn).toBe('Company Name');
      expect(result.rows[0]).toHaveProperty('Domain');
      expect(result.rows[0]).not.toHaveProperty('Website');
    });

    it('should detect and rename company column to "Company Name"', () => {
      const parsed: ParsedFile = {
        rows: [
          { Domain: 'google.com', Organization: 'Google Inc' },
          { Domain: 'amazon.com', Organization: 'Amazon LLC' },
        ],
        headers: ['Domain', 'Organization'],
        domainColumn: 'Domain',
        companyNameColumn: null,
        emailColumn: null,
        rowCount: 2,
        fileType: 'csv',
      };

      const result = autoDetectAndNormalizeColumns(parsed);

      expect(result.headers).toEqual(['Domain', 'Company Name']);
      expect(result.companyNameColumn).toBe('Company Name');
      expect(result.rows[0]).toHaveProperty('Company Name');
      expect(result.rows[0]).not.toHaveProperty('Organization');
    });

    it('should normalize URLs for display (add https://)', () => {
      const parsed: ParsedFile = {
        rows: [
          { Website: 'google.com', Company: 'Google' },
          { Website: 'www.salesforce.com', Company: 'Salesforce' },
        ],
        headers: ['Website', 'Company'],
        domainColumn: null,
        companyNameColumn: null,
        emailColumn: null,
        rowCount: 2,
        fileType: 'csv',
      };

      const result = autoDetectAndNormalizeColumns(parsed);

      expect(result.rows[0]?.Domain).toBe('https://google.com');
      expect(result.rows[1]?.Domain).toBe('https://www.salesforce.com');
    });

    it('should remove legal suffixes from company names', () => {
      const parsed: ParsedFile = {
        rows: [
          { Domain: 'google.com', Organization: 'Google Inc' },
          { Domain: 'microsoft.com', Organization: 'Microsoft Corporation' },
          { Domain: 'acme.com', Organization: 'Acme Corp, LLC' },
        ],
        headers: ['Domain', 'Organization'],
        domainColumn: 'Domain',
        companyNameColumn: null,
        emailColumn: null,
        rowCount: 3,
        fileType: 'csv',
      };

      const result = autoDetectAndNormalizeColumns(parsed);

      expect(result.rows[0]?.['Company Name']).toBe('Google');
      expect(result.rows[1]?.['Company Name']).toBe('Microsoft');
      expect(result.rows[2]?.['Company Name']).toBe('Acme');
    });

    it('should preserve existing column detection if already present', () => {
      const parsed: ParsedFile = {
        rows: [{ Domain: 'google.com', 'Company Name': 'Google Inc' }],
        headers: ['Domain', 'Company Name'],
        domainColumn: 'Domain',
        companyNameColumn: 'Company Name',
        emailColumn: null,
        rowCount: 1,
        fileType: 'csv',
      };

      const result = autoDetectAndNormalizeColumns(parsed);

      expect(result.domainColumn).toBe('Domain');
      expect(result.companyNameColumn).toBe('Company Name');
      expect(result.headers).toEqual(['Domain', 'Company Name']);
    });

    it('should handle files with no detectable columns gracefully', () => {
      const parsed: ParsedFile = {
        rows: [{ Email: 'user@test.com', Phone: '555-1234' }],
        headers: ['Email', 'Phone'],
        domainColumn: null,
        companyNameColumn: null,
        emailColumn: 'Email',
        rowCount: 1,
        fileType: 'csv',
      };

      const result = autoDetectAndNormalizeColumns(parsed);

      expect(result.domainColumn).toBe(null);
      expect(result.companyNameColumn).toBe(null);
      expect(result.headers).toEqual(['Email', 'Phone']);
    });

    it('should handle empty files gracefully', () => {
      const parsed: ParsedFile = {
        rows: [],
        headers: ['Domain', 'Company'],
        domainColumn: null,
        companyNameColumn: null,
        emailColumn: null,
        rowCount: 0,
        fileType: 'csv',
      };

      const result = autoDetectAndNormalizeColumns(parsed);

      expect(result.domainColumn).toBe(null);
      expect(result.companyNameColumn).toBe(null);
    });

    it('should normalize both domain and company name in same file', () => {
      const parsed: ParsedFile = {
        rows: [
          {
            Website: 'google.com',
            Organization: 'Google LLC',
            Email: 'contact@google.com',
          },
        ],
        headers: ['Website', 'Organization', 'Email'],
        domainColumn: null,
        companyNameColumn: null,
        emailColumn: 'Email',
        rowCount: 1,
        fileType: 'csv',
      };

      const result = autoDetectAndNormalizeColumns(parsed);

      expect(result.headers).toEqual(['Domain', 'Company Name', 'Email']);
      expect(result.domainColumn).toBe('Domain');
      expect(result.companyNameColumn).toBe('Company Name');
      expect(result.rows[0]?.Domain).toBe('https://google.com');
      expect(result.rows[0]?.['Company Name']).toBe('Google');
    });
  });
});
