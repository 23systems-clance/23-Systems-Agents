/**
 * Identity resolution orchestrator for HubSpot sync.
 *
 * For each incoming contact, resolves against HubSpot records using a
 * three-tier strategy: (1) exact email match, (2) normalized domain match,
 * (3) fuzzy company name match.
 */

import { normalizeDomain } from './domainNormalizer.js';
import { normalizeCompanyName } from './nameNormalizer.js';
import { fuzzyMatch } from './fuzzyMatcher.js';
import logger from '../../lib/logger.js';

/** Confidence levels for match results. */
export type MatchConfidence = 'high' | 'medium' | 'low' | 'none';

/** Result of identity resolution for a single contact. */
export interface IdentityMatch {
  /** Whether a match was found. */
  matched: boolean;
  /** HubSpot record ID if matched. */
  hubspotId?: string;
  /** How the match was determined. */
  matchMethod?: 'email' | 'domain' | 'fuzzy_name';
  /** Confidence level of the match. */
  confidence: MatchConfidence;
  /** Whether the match should be flagged for manual review. */
  flagForReview: boolean;
  /** Similarity score (only for fuzzy matches). */
  similarityScore?: number;
}

/** A HubSpot record used for matching. */
export interface HubSpotMatchCandidate {
  id: string;
  email?: string;
  domain?: string;
  companyName?: string;
  updatedAt?: string;
}

/**
 * Resolves a contact against a set of HubSpot records.
 *
 * @param contact - The incoming contact to resolve.
 * @param candidates - HubSpot records to match against.
 * @param fuzzyThreshold - Jaro-Winkler threshold (0-1). Default 0.85.
 * @returns The best match result.
 */
export function resolveIdentity(
  contact: { email?: string; domain?: string; companyName?: string },
  candidates: HubSpotMatchCandidate[],
  fuzzyThreshold = 0.85
): IdentityMatch {
  if (!candidates.length) {
    return { matched: false, confidence: 'none', flagForReview: false };
  }

  // Tier 1: Exact email match (highest confidence)
  if (contact.email) {
    const emailLower = contact.email.toLowerCase();
    const emailMatch = candidates.find(
      (c) => c.email && c.email.toLowerCase() === emailLower
    );
    if (emailMatch) {
      return {
        matched: true,
        hubspotId: emailMatch.id,
        matchMethod: 'email',
        confidence: 'high',
        flagForReview: false,
      };
    }
  }

  // Tier 2: Normalized domain match
  if (contact.domain) {
    const normalizedContactDomain = normalizeDomain(contact.domain);
    if (normalizedContactDomain) {
      const domainMatches = candidates.filter(
        (c) => c.domain && normalizeDomain(c.domain) === normalizedContactDomain
      );
      if (domainMatches.length === 1) {
        return {
          matched: true,
          hubspotId: domainMatches[0].id,
          matchMethod: 'domain',
          confidence: 'medium',
          flagForReview: false,
        };
      }
      if (domainMatches.length > 1) {
        // Multiple domain matches — pick most recently updated, flag for review
        const sorted = domainMatches.sort(
          (a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
        );
        return {
          matched: true,
          hubspotId: sorted[0].id,
          matchMethod: 'domain',
          confidence: 'medium',
          flagForReview: true,
        };
      }
    }
  }

  // Tier 3: Fuzzy company name match (lowest confidence)
  if (contact.companyName) {
    const targetNames = candidates
      .filter((c) => c.companyName)
      .map((c) => c.companyName!);

    const result = fuzzyMatch(contact.companyName, targetNames, fuzzyThreshold);
    if (result) {
      const matchedCandidate = candidates.find(
        (c) => c.companyName === result.matchedName
      );

      // Check for multiple equally-likely matches
      const allAboveThreshold = targetNames.filter((name) => {
        const normalizedCandidate = normalizeCompanyName(contact.companyName!);
        const normalizedTarget = normalizeCompanyName(name);
        // Simple check — if they normalize to the same string, they're equal
        return normalizedCandidate === normalizedTarget;
      });

      const needsReview = allAboveThreshold.length > 1;

      return {
        matched: true,
        hubspotId: matchedCandidate?.id,
        matchMethod: 'fuzzy_name',
        confidence: 'low',
        flagForReview: needsReview || result.score < 0.95,
        similarityScore: result.score,
      };
    }
  }

  return { matched: false, confidence: 'none', flagForReview: false };
}
