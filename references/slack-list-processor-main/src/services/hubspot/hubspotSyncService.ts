/**
 * HubSpot sync orchestrator service.
 *
 * Orchestrates the sync of contacts to HubSpot using identity resolution
 * to avoid duplicates. Produces a sync report with create/update/skip/fail counts.
 *
 * @deprecated Superseded by `src/services/crm/crmImportService.ts` and
 * `src/services/crm/adapters/hubspot/hubspotAdapter.ts` as part of the
 * canonical data schema (Feature 18). Retained for backward compatibility
 * with workflow nodes that fall back to legacy sync when no CrmConnection exists.
 */

import { resolveIdentity, type HubSpotMatchCandidate } from './identityResolver.js';
import { normalizeDomain } from './domainNormalizer.js';
import { properCase } from './nameNormalizer.js';
import type { HubSpotNodeConfig } from '../workflow/types.js';
import logger from '../../lib/logger.js';

/** Result of a HubSpot sync operation. */
export interface SyncReport {
  mode: 'sync';
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors?: Array<{ index: number; error: string }>;
}

/**
 * Syncs an array of contacts to HubSpot with identity resolution.
 *
 * @param contacts - Array of contact objects from workflow context.
 * @param config - HubSpot node configuration with field mappings and match settings.
 * @returns A sync report with counts.
 */
export async function syncContactsToHubSpot(
  contacts: Record<string, unknown>[],
  config: HubSpotNodeConfig
): Promise<SyncReport> {
  const report: SyncReport = {
    mode: 'sync',
    total: contacts.length,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  const threshold = (config.fuzzyThreshold ?? 85) / 100;

  // Gather all emails and domains for batch search
  const emails = contacts
    .map((c) => String(c.email || ''))
    .filter((e) => e.includes('@'));
  const domains = contacts
    .map((c) => normalizeDomain(String(c.domain || c.website || '')))
    .filter(Boolean);

  // Search HubSpot for existing records
  let existingContacts: HubSpotMatchCandidate[] = [];
  try {
    const { searchContactsByEmail, searchCompaniesByDomain } = await import('./hubspotClient.js');

    if (emails.length > 0) {
      const emailResults = await searchContactsByEmail(emails);
      existingContacts.push(
        ...emailResults.map((c: any) => ({
          id: c.id,
          email: c.properties?.email,
          domain: normalizeDomain(c.properties?.company),
          companyName: c.properties?.company,
          updatedAt: c.updatedAt,
        }))
      );
    }
  } catch (err) {
    logger.warn('HubSpot sync: failed to search existing contacts', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Resolve identity for each contact and sort into create/update buckets
  const toCreate: Record<string, unknown>[] = [];
  const toUpdate: Array<{ hubspotId: string; data: Record<string, unknown> }> = [];

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    try {
      const match = resolveIdentity(
        {
          email: String(contact.email || ''),
          domain: normalizeDomain(String(contact.domain || contact.website || '')),
          companyName: String(contact.companyName || contact.company || ''),
        },
        existingContacts,
        threshold
      );

      if (match.matched && match.hubspotId) {
        if (config.updateExisting !== false) {
          toUpdate.push({
            hubspotId: match.hubspotId,
            data: applyFieldMapping(contact, config.fieldMapping),
          });
        } else {
          report.skipped++;
        }
      } else {
        if (config.createNewRecords !== false) {
          toCreate.push(applyFieldMapping(contact, config.fieldMapping));
        } else {
          report.skipped++;
        }
      }
    } catch (err) {
      report.failed++;
      report.errors!.push({
        index: i,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Batch create
  if (toCreate.length > 0) {
    try {
      const { batchCreateContacts } = await import('./hubspotClient.js');
      await batchCreateContacts(toCreate);
      report.created = toCreate.length;
    } catch (err) {
      report.failed += toCreate.length;
      logger.error('HubSpot batch create failed', {
        count: toCreate.length,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Batch update
  if (toUpdate.length > 0) {
    try {
      const { batchUpdateContacts } = await import('./hubspotClient.js');
      await batchUpdateContacts(toUpdate);
      report.updated = toUpdate.length;
    } catch (err) {
      report.failed += toUpdate.length;
      logger.error('HubSpot batch update failed', {
        count: toUpdate.length,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('HubSpot sync completed', {
    total: report.total,
    created: report.created,
    updated: report.updated,
    skipped: report.skipped,
    failed: report.failed,
  });

  return report;
}

/**
 * Applies field mappings to transform a contact for HubSpot.
 */
function applyFieldMapping(
  contact: Record<string, unknown>,
  mappings?: Array<{ sourceField: string; targetField: string }>
): Record<string, unknown> {
  if (!mappings || mappings.length === 0) {
    return { ...contact };
  }

  const mapped: Record<string, unknown> = {};
  for (const mapping of mappings) {
    if (contact[mapping.sourceField] !== undefined) {
      mapped[mapping.targetField] = contact[mapping.sourceField];
    }
  }
  return mapped;
}
