/**
 * MCP Tool Schema Definitions
 * Zod schemas for tool input validation
 */

import { z } from 'zod';

/**
 * Free Lookup Tool Schema
 */
export const freeLookupSchema = z.object({
  domain: z.string().min(1, 'Domain is required').describe('Domain to lookup (e.g., example.com)'),
});

export type FreeLookupInput = z.infer<typeof freeLookupSchema>;

/**
 * Domain Lookup Tool Schema
 */
export const domainLookupSchema = z.object({
  domain: z.string().min(1, 'Domain is required').describe('Domain to analyze'),
  hideMetadata: z
    .boolean()
    .optional()
    .default(false)
    .describe('Hide descriptions, links, tags, categories'),
  onlyLive: z
    .boolean()
    .optional()
    .default(false)
    .describe('Return only currently active technologies'),
});

export type DomainLookupInput = z.infer<typeof domainLookupSchema>;

/**
 * List Sites Tool Schema
 */
export const listSitesSchema = z.object({
  technology: z
    .string()
    .min(1, 'Technology is required')
    .describe('Technology identifier (e.g., "WordPress", "React")'),
  limit: z.number().min(1).max(1000).optional().default(100).describe('Maximum number of results'),
  includeMetadata: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include contact and company information'),
  offset: z.number().min(0).optional().describe('Pagination offset'),
  since: z.string().optional().describe('Filter results modified since date (YYYY-MM-DD)'),
});

export type ListSitesInput = z.infer<typeof listSitesSchema>;
