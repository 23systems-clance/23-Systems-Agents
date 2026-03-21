/**
 * Document reference resolver.
 *
 * Resolves document slug references from ENRICH commands by searching
 * across all docs channels in the workspace. Handles per-channel
 * isolation with cross-channel disambiguation when the same slug
 * exists in multiple channels.
 */

import type { DocumentType } from '@prisma/client';
import { prisma } from '../../models/index.js';
import { downloadFile } from '../../lib/storage.js';
import { parseSettings } from './settingsParser.js';
import { config } from '../../config/index.js';
import logger from '../../lib/logger.js';

/** A successfully resolved document with its content. */
export interface ResolvedDocument {
  slug: string;
  channelId: string;
  documentType: DocumentType;
  content: string;
  parsedSettings?: Record<string, unknown>;
}

/** A slug found in multiple channels requiring user disambiguation. */
export interface AmbiguousSlug {
  slug: string;
  channels: Array<{ channelId: string; channelName?: string }>;
}

/** A suggestion for a slug that was not found. */
export interface SlugSuggestion {
  slug: string;
  suggestions: string[];
}

/** Result of resolving document references. */
export interface ResolveResult {
  documents: ResolvedDocument[];
  notFound: string[];
  archived: string[];
  ambiguous: AmbiguousSlug[];
  suggestions: SlugSuggestion[];
}

/**
 * Resolves document slugs to their content for AI context injection.
 *
 * For each slug, searches across all docs channels in the workspace.
 * If found in exactly one channel, fetches the content from S3 and
 * truncates to `config.doc.maxContextChars`. If found in multiple
 * channels, adds to the ambiguous list for user disambiguation.
 *
 * @param teamId - Slack workspace/team ID.
 * @param slugs - Array of document slugs to resolve.
 * @returns Resolved documents, not-found slugs, archived slugs, and ambiguous slugs.
 */
export async function resolveDocumentReferences(
  teamId: string,
  slugs: string[],
): Promise<ResolveResult> {
  const documents: ResolvedDocument[] = [];
  const notFound: string[] = [];
  const suggestions: SlugSuggestion[] = [];
  const archived: string[] = [];
  const ambiguous: AmbiguousSlug[] = [];

  for (const slug of slugs) {
    // Search across all channels for this slug.
    const matches = await prisma.clientDocument.findMany({
      where: {
        slackTeamId: teamId,
        slug,
        status: 'ACTIVE',
      },
    });

    if (matches.length === 0) {
      // Check if it's archived rather than non-existent.
      const archivedDoc = await prisma.clientDocument.findFirst({
        where: {
          slackTeamId: teamId,
          slug,
          status: 'ARCHIVED',
        },
      });

      if (archivedDoc) {
        archived.push(slug);
      } else {
        notFound.push(slug);

        // Search for similar slugs to suggest.
        const similar = await prisma.clientDocument.findMany({
          where: {
            slackTeamId: teamId,
            slug: { contains: slug },
            status: 'ACTIVE',
          },
          select: { slug: true },
          take: 5,
        });

        if (similar.length > 0) {
          suggestions.push({
            slug,
            suggestions: [...new Set(similar.map((s) => s.slug))],
          });
        }
      }
      continue;
    }

    if (matches.length > 1) {
      // Same slug exists in multiple channels -- needs disambiguation.
      ambiguous.push({
        slug,
        channels: matches.map((doc) => ({
          channelId: doc.slackChannelId,
        })),
      });
      continue;
    }

    // Single match -- resolve content.
    const doc = matches[0];
    try {
      const contentBuffer = await downloadFile(doc.s3Key);
      let content = contentBuffer.toString('utf-8');

      // Truncate to max context chars.
      if (content.length > config.doc.maxContextChars) {
        content = content.slice(0, config.doc.maxContextChars) + '\n...[truncated]';
      }

      const resolved: ResolvedDocument = {
        slug,
        channelId: doc.slackChannelId,
        documentType: doc.documentType,
        content,
      };

      // Parse settings if this is a SETTINGS document.
      if (doc.documentType === 'SETTINGS') {
        const { settings } = parseSettings(content);
        resolved.parsedSettings = settings;
      }

      documents.push(resolved);
    } catch (error) {
      logger.error('Failed to fetch document content from S3', {
        slug,
        s3Key: doc.s3Key,
        error: error instanceof Error ? error.message : String(error),
      });
      notFound.push(slug);
    }
  }

  return { documents, notFound, archived, ambiguous, suggestions };
}

/**
 * Extracts potential document slug references from an ENRICH message.
 *
 * Matches patterns like "using <slug>", "with <slug>",
 * "using <slug1> and <slug2>".
 *
 * @param message - The raw ENRICH message text.
 * @returns Array of unique potential slugs.
 */
export function extractSlugsFromMessage(message: string): string[] {
  const slugs = new Set<string>();

  // Pattern: "using slug1 and slug2"
  const usingAndPattern = /using\s+([\w-]+)\s+and\s+([\w-]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = usingAndPattern.exec(message)) !== null) {
    slugs.add(match[1].toLowerCase());
    slugs.add(match[2].toLowerCase());
  }

  // Pattern: "using slug" (single)
  const usingPattern = /using\s+([\w-]+)/gi;
  while ((match = usingPattern.exec(message)) !== null) {
    slugs.add(match[1].toLowerCase());
  }

  // Pattern: "with slug"
  const withPattern = /with\s+([\w-]+)/gi;
  while ((match = withPattern.exec(message)) !== null) {
    slugs.add(match[1].toLowerCase());
  }

  // Filter out common English words that aren't slugs.
  const stopWords = new Set([
    'this', 'that', 'the', 'a', 'an', 'my', 'your', 'our', 'their',
    'it', 'them', 'these', 'those', 'all', 'some', 'any', 'each',
  ]);

  return Array.from(slugs).filter((s) => !stopWords.has(s));
}
