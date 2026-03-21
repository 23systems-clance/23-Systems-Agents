/**
 * Quality gate configuration loading and defaults.
 *
 * Loads per-workspace config from DB (QualityGateConfig), merges with global
 * defaults, and computes the effective personal domain list.
 */

import { prisma } from '../../models/index.js';
import { DEFAULT_PERSONAL_DOMAINS } from '../file/domainUtils.js';
import type { QualityGateConfigSnapshot } from './types.js';

// ---------------------------------------------------------------------------
// Default config constant (T007)
// ---------------------------------------------------------------------------

/** Global default quality gate configuration applied when no workspace override exists. */
export const DEFAULT_QUALITY_GATE_CONFIG = {
  rejectPersonalEmails: true,
  rejectMissingCompany: true,
  rejectDuplicateEmails: true,
  deduplicateDomains: true,
  suppressionDomains: [] as string[],
  personalDomainOverrides: [] as string[],
  allowPersonalDomains: [] as string[],
} as const;

/** The 12 default personal email domains as an array (for config snapshots). */
export const DEFAULT_PERSONAL_DOMAIN_LIST: string[] = [...DEFAULT_PERSONAL_DOMAINS];

// ---------------------------------------------------------------------------
// Effective config type
// ---------------------------------------------------------------------------

/** Merged config with computed effective personal domains. */
export interface EffectiveQualityGateConfig {
  rejectPersonalEmails: boolean;
  rejectMissingCompany: boolean;
  rejectDuplicateEmails: boolean;
  deduplicateDomains: boolean;
  suppressionDomains: string[];
  personalDomainOverrides: string[];
  allowPersonalDomains: string[];
  effectivePersonalDomains: Set<string>;
}

// ---------------------------------------------------------------------------
// Config loading (T008)
// ---------------------------------------------------------------------------

/**
 * Loads the quality gate config for a workspace, merging workspace overrides
 * with global defaults.
 *
 * - If a QualityGateConfig record exists for the client, merges it with defaults.
 * - If no record exists, returns defaults.
 * - Computes `effectivePersonalDomains` = (defaults + overrides) - allow list.
 *
 * @param clientId - The ManagedClient UUID. Pass null to get pure defaults.
 * @returns The effective config ready for use by the quality gate.
 */
export async function loadQualityGateConfig(
  clientId: string | null,
): Promise<EffectiveQualityGateConfig> {
  let dbConfig: {
    rejectPersonalEmails: boolean;
    rejectMissingCompany: boolean;
    rejectDuplicateEmails: boolean;
    deduplicateDomains: boolean;
    suppressionDomains: string[];
    personalDomainOverrides: string[];
    allowPersonalDomains: string[];
  } | null = null;

  if (clientId) {
    dbConfig = await prisma.qualityGateConfig.findUnique({
      where: { clientId },
      select: {
        rejectPersonalEmails: true,
        rejectMissingCompany: true,
        rejectDuplicateEmails: true,
        deduplicateDomains: true,
        suppressionDomains: true,
        personalDomainOverrides: true,
        allowPersonalDomains: true,
      },
    });
  }

  const merged = dbConfig ?? { ...DEFAULT_QUALITY_GATE_CONFIG };

  // Compute effective personal domains: (defaults + overrides) - allow list
  const effectivePersonalDomains = new Set<string>(DEFAULT_PERSONAL_DOMAINS);
  for (const domain of merged.personalDomainOverrides) {
    effectivePersonalDomains.add(domain.toLowerCase());
  }
  for (const domain of merged.allowPersonalDomains) {
    effectivePersonalDomains.delete(domain.toLowerCase());
  }

  return {
    rejectPersonalEmails: merged.rejectPersonalEmails,
    rejectMissingCompany: merged.rejectMissingCompany,
    rejectDuplicateEmails: merged.rejectDuplicateEmails,
    deduplicateDomains: merged.deduplicateDomains,
    suppressionDomains: merged.suppressionDomains,
    personalDomainOverrides: merged.personalDomainOverrides,
    allowPersonalDomains: merged.allowPersonalDomains,
    effectivePersonalDomains,
  };
}

// ---------------------------------------------------------------------------
// Config snapshot (T009)
// ---------------------------------------------------------------------------

/**
 * Creates a JSON-serializable snapshot of the effective config for storage
 * in `Job.qualityGateConfigSnapshot` (FR-014).
 *
 * @param config - The effective config from {@link loadQualityGateConfig}.
 * @returns A plain object safe for JSONB storage.
 */
export function snapshotConfig(
  config: EffectiveQualityGateConfig,
): QualityGateConfigSnapshot {
  return {
    rejectPersonalEmails: config.rejectPersonalEmails,
    rejectMissingCompany: config.rejectMissingCompany,
    rejectDuplicateEmails: config.rejectDuplicateEmails,
    deduplicateDomains: config.deduplicateDomains,
    suppressionDomains: [...config.suppressionDomains],
    personalDomainOverrides: [...config.personalDomainOverrides],
    allowPersonalDomains: [...config.allowPersonalDomains],
    effectivePersonalDomains: [...config.effectivePersonalDomains],
  };
}
