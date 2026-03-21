import { describe, it, expect } from 'vitest';
import {
  normalizeDomain,
  containsHtml,
  stripHtmlTags,
} from '../../../src/services/file/domainUtils.js';

describe('domainUtils', () => {
  // -------------------------------------------------------------------------
  // containsHtml
  // -------------------------------------------------------------------------

  describe('containsHtml', () => {
    it('should detect HTML anchor tags', () => {
      expect(containsHtml('<a href="/foo">text</a>')).toBe(true);
    });

    it('should detect HTML span tags', () => {
      expect(containsHtml('<span class="x">text</span>')).toBe(true);
    });

    it('should return false for plain text', () => {
      expect(containsHtml('example.com')).toBe(false);
    });

    it('should return false for text with angle brackets that are not tags', () => {
      expect(containsHtml('value > 5 and < 10')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // stripHtmlTags
  // -------------------------------------------------------------------------

  describe('stripHtmlTags', () => {
    it('should strip anchor tags and return text content', () => {
      expect(stripHtmlTags('<a href="/foo">example.com</a>')).toBe('example.com');
    });

    it('should handle multiple nested tags', () => {
      expect(stripHtmlTags('<div><a href="#">text</a></div>')).toBe('text');
    });

    it('should return plain text unchanged', () => {
      expect(stripHtmlTags('example.com')).toBe('example.com');
    });
  });

  // -------------------------------------------------------------------------
  // normalizeDomain
  // -------------------------------------------------------------------------

  describe('normalizeDomain', () => {
    it('should strip https:// protocol', () => {
      expect(normalizeDomain('https://example.com')).toBe('example.com');
    });

    it('should strip http:// protocol', () => {
      expect(normalizeDomain('http://example.com')).toBe('example.com');
    });

    it('should strip www. prefix', () => {
      expect(normalizeDomain('www.example.com')).toBe('example.com');
    });

    it('should strip both protocol and www.', () => {
      expect(normalizeDomain('https://www.example.com')).toBe('example.com');
    });

    it('should strip trailing slash', () => {
      expect(normalizeDomain('example.com/')).toBe('example.com');
    });

    it('should strip path components', () => {
      expect(normalizeDomain('example.com/path/to/page')).toBe('example.com');
    });

    it('should strip query string', () => {
      expect(normalizeDomain('example.com?query=1')).toBe('example.com');
    });

    it('should strip fragment', () => {
      expect(normalizeDomain('example.com#section')).toBe('example.com');
    });

    it('should lowercase the domain', () => {
      expect(normalizeDomain('EXAMPLE.COM')).toBe('example.com');
    });

    it('should handle HTML anchor tags from Salesforce exports', () => {
      const html = '<a href="/0054z00000AqEv5" target="_blank">Marcellus Martin</a>';
      // HTML text content is "Marcellus Martin" which has no dot, so invalid
      expect(normalizeDomain(html)).toBeNull();
    });

    it('should extract domain text from HTML with domain content', () => {
      const html = '<a href="/link">example.com</a>';
      expect(normalizeDomain(html)).toBe('example.com');
    });

    it('should return null for null input', () => {
      expect(normalizeDomain(null)).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(normalizeDomain(undefined)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(normalizeDomain('')).toBeNull();
    });

    it('should return null for whitespace-only string', () => {
      expect(normalizeDomain('   ')).toBeNull();
    });

    it('should return null for string without a dot', () => {
      expect(normalizeDomain('localhost')).toBeNull();
    });

    it('should return null for string with spaces', () => {
      expect(normalizeDomain('not a domain')).toBeNull();
    });

    it('should handle a clean domain as-is', () => {
      expect(normalizeDomain('example.com')).toBe('example.com');
    });

    it('should trim whitespace', () => {
      expect(normalizeDomain('  example.com  ')).toBe('example.com');
    });
  });
});
