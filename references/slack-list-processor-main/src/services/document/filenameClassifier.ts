/**
 * Filename convention classifier and slug generator.
 *
 * Classifies documents by filename prefix convention and generates
 * URL-safe slugs from filenames for use as document identifiers.
 */

import type { DocumentType } from '@prisma/client';

/** Map of filename patterns to document types (case-insensitive). */
const PATTERN_MAP: Array<{ pattern: RegExp; type: DocumentType }> = [
  { pattern: /^icp[-_.].*\.md$|^icp\.md$/i, type: 'ICP' },
  { pattern: /^use[-_]?case[-_.].*\.md$|^usecase\.md$/i, type: 'USE_CASE' },
  { pattern: /^settings[-_.].*\.md$|^settings\.md$/i, type: 'SETTINGS' },
  { pattern: /^one[-_]?pager[-_.].*\.md$|^onepager\.md$/i, type: 'ONE_PAGER' },
];

/**
 * Classifies a document type based on filename convention.
 *
 * Now supports flexible variations:
 * - ICP variations: ICP.md, icp.md, ICP-acme.md, ICP_acme.md, icp-tech.md
 * - UseCase variations: UseCase.md, usecase.md, use-case.md, use_case-demo.md
 * - Settings variations: Settings.md, settings.md, settings-prod.md
 * - OnePager variations: OnePager.md, onepager.md, one-pager.md, one_pager-v2.md
 *
 * @param filename - Original filename (e.g., "ICP-acme.md", "UseCase.md").
 * @returns Matched DocumentType or null if no convention match.
 */
export function classifyByFilename(filename: string): DocumentType | null {
  for (const { pattern, type } of PATTERN_MAP) {
    if (pattern.test(filename)) {
      return type;
    }
  }
  return null;
}

/**
 * Generates a URL-safe slug from a filename.
 *
 * Strips the file extension, lowercases, replaces non-alphanumeric
 * characters with hyphens, and collapses consecutive hyphens.
 *
 * @param filename - Original filename (e.g., "Acme ICP Document.md").
 * @returns URL-safe slug (e.g., "acme-icp-document").
 */
export function generateSlug(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, '')       // Strip extension
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')   // Replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, '')       // Trim leading/trailing hyphens
    .replace(/-{2,}/g, '-');        // Collapse consecutive hyphens
}
