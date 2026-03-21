/**
 * Fuzzy company name matching service using Jaro-Winkler similarity.
 *
 * Provides configurable threshold-based matching with name normalization
 * as a preprocessing step.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const jaroWinkler = require('jaro-winkler') as (a: string, b: string) => number;
import { normalizeCompanyName } from './nameNormalizer.js';

/** Result of a fuzzy match attempt. */
export interface FuzzyMatchResult {
  /** The original (non-normalized) matched name. */
  matchedName: string;
  /** The Jaro-Winkler similarity score (0-1). */
  score: number;
  /** Index of the match in the target array. */
  index: number;
}

/**
 * Finds the best fuzzy match for a candidate name among a list of targets.
 *
 * Both candidate and target names are normalized before comparison
 * (lowercase, legal suffixes removed, punctuation stripped).
 *
 * @param candidateName - The name to match.
 * @param targetNames - The array of names to match against.
 * @param threshold - Minimum similarity score (0-1). Default 0.85.
 * @returns The best match above the threshold, or null if no match found.
 *
 * @example
 * fuzzyMatch("Acme Inc", ["Acme, Inc.", "Beta Corp"], 0.85)
 * // { matchedName: "Acme, Inc.", score: 0.97, index: 0 }
 */
export function fuzzyMatch(
  candidateName: string,
  targetNames: string[],
  threshold = 0.85
): FuzzyMatchResult | null {
  if (!candidateName || !targetNames.length) return null;

  const normalizedCandidate = normalizeCompanyName(candidateName);
  if (!normalizedCandidate) return null;

  let bestMatch: FuzzyMatchResult | null = null;

  for (let i = 0; i < targetNames.length; i++) {
    const normalizedTarget = normalizeCompanyName(targetNames[i]);
    if (!normalizedTarget) continue;

    const score = jaroWinkler(normalizedCandidate, normalizedTarget);

    if (score >= threshold && (!bestMatch || score > bestMatch.score)) {
      bestMatch = {
        matchedName: targetNames[i],
        score,
        index: i,
      };
    }
  }

  return bestMatch;
}
