/**
 * Extracts cloud hosting provider information from BuiltWith technology data.
 *
 * Matches each technology's Name and Tag against the canonical
 * {@link cloudProviderKeywords} list, accumulates weighted scores per
 * provider, and determines the primary cloud provider.
 *
 * Tie-breaking uses signal strength priority:
 *   compute > serverless > load_balancer > cdn > dns > storage > database > other
 */

import { cloudProviderKeywords } from '../../data/cloudProviderKeywords.js';
import type { CloudProviderKeyword } from '../../data/cloudProviderKeywords.js';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/** Result of cloud provider extraction from a technology profile. */
export interface CloudExtractionResult {
  /** The provider with the highest weighted score, or "Unknown". */
  primaryProvider: string;
  /** All detected providers sorted by score descending. */
  allProviders: string[];
}

// ---------------------------------------------------------------------------
// Internal types and constants
// ---------------------------------------------------------------------------

/** Signal strength priority for tie-breaking (higher index = stronger). */
const CATEGORY_PRIORITY: Record<CloudProviderKeyword['category'], number> = {
  other: 0,
  database: 1,
  storage: 2,
  dns: 3,
  cdn: 4,
  load_balancer: 5,
  serverless: 6,
  compute: 7,
};

/** Accumulated scoring state for a single cloud provider. */
interface ProviderScore {
  totalWeight: number;
  highestCategoryPriority: number;
}

// ---------------------------------------------------------------------------
// Main extraction function
// ---------------------------------------------------------------------------

/**
 * Determines cloud provider usage from a BuiltWith technologies array.
 *
 * For each technology, the Name and Tag are checked against every entry in
 * {@link cloudProviderKeywords} using case-insensitive substring matching.
 * Matched keywords contribute their weight to the associated provider.
 *
 * The primary provider is the one with the highest total weight. When two
 * providers are tied on weight, the one with the stronger signal category
 * wins (compute beats CDN, etc.). If no keywords match at all, the primary
 * provider is reported as "Unknown".
 *
 * @param technologies - Array of technologies with Name and Tag fields
 *   as returned by the BuiltWith Domain API.
 * @returns Primary provider and a sorted list of all detected providers.
 */
export function extractCloudProviders(
  technologies: Array<{ Name: string; Tag: string }>,
): CloudExtractionResult {
  const scores = new Map<string, ProviderScore>();

  for (const tech of technologies) {
    const nameLower = tech.Name.toLowerCase();
    const tagLower = tech.Tag.toLowerCase();

    for (const kw of cloudProviderKeywords) {
      const kwLower = kw.keyword.toLowerCase();

      if (nameLower.includes(kwLower) || tagLower.includes(kwLower)) {
        const existing = scores.get(kw.provider);
        const categoryPriority = CATEGORY_PRIORITY[kw.category];

        if (existing) {
          existing.totalWeight += kw.weight;
          existing.highestCategoryPriority = Math.max(
            existing.highestCategoryPriority,
            categoryPriority,
          );
        } else {
          scores.set(kw.provider, {
            totalWeight: kw.weight,
            highestCategoryPriority: categoryPriority,
          });
        }
      }
    }
  }

  if (scores.size === 0) {
    return { primaryProvider: 'Unknown', allProviders: [] };
  }

  // Sort providers: primary sort by total weight desc, secondary by category priority desc
  const sorted = [...scores.entries()].sort((a, b) => {
    const weightDiff = b[1].totalWeight - a[1].totalWeight;
    if (weightDiff !== 0) {
      return weightDiff;
    }
    return b[1].highestCategoryPriority - a[1].highestCategoryPriority;
  });

  return {
    primaryProvider: sorted[0][0],
    allProviders: sorted.map(([provider]) => provider),
  };
}
