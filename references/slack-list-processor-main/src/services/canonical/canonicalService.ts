/**
 * Canonical CRUD service.
 *
 * Handles upsert and retrieval of CanonicalContact and CanonicalAccount
 * records using Prisma. Upserts are keyed on email (contacts) and domain
 * (accounts) to ensure re-enrichment updates existing records.
 */

import { prisma } from '../../models/index.js';
import type { CanonicalContact, CanonicalAccount } from '@prisma/client';
import type { CanonicalContactData, CanonicalAccountData } from './types.js';
import logger from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Account operations
// ---------------------------------------------------------------------------

/**
 * Upsert canonical accounts by domain.
 *
 * Creates new records or updates existing ones. On re-enrichment, all fields
 * are overwritten with the latest data.
 *
 * @param accounts - Array of canonical account data to upsert.
 * @returns Array of upserted CanonicalAccount records.
 */
export async function upsertAccounts(
  accounts: CanonicalAccountData[],
): Promise<CanonicalAccount[]> {
  const results: CanonicalAccount[] = [];

  for (const account of accounts) {
    try {
      const upserted = await prisma.canonicalAccount.upsert({
        where: { domain: account.domain },
        create: {
          domain: account.domain,
          companyName: account.companyName,
          industry: account.industry,
          employeeCount: account.employeeCount,
          annualRevenue: account.annualRevenue,
          city: account.city,
          state: account.state,
          country: account.country,
          technologies: account.technologies || [],
          cloudProvider: account.cloudProvider,
          trafficRank: account.trafficRank,
          techSpendTier: account.techSpendTier,
          jobCompanyId: account.jobCompanyId,
          enrichmentJobId: account.enrichmentJobId,
        },
        update: {
          companyName: account.companyName,
          industry: account.industry,
          employeeCount: account.employeeCount,
          annualRevenue: account.annualRevenue,
          city: account.city,
          state: account.state,
          country: account.country,
          technologies: account.technologies || [],
          cloudProvider: account.cloudProvider,
          trafficRank: account.trafficRank,
          techSpendTier: account.techSpendTier,
          jobCompanyId: account.jobCompanyId,
          enrichmentJobId: account.enrichmentJobId,
        },
      });
      results.push(upserted);
    } catch (err) {
      logger.error('Failed to upsert canonical account', {
        domain: account.domain,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('Canonical accounts upserted', {
    total: accounts.length,
    succeeded: results.length,
    failed: accounts.length - results.length,
  });

  return results;
}

/**
 * Upsert canonical contacts by email.
 *
 * Creates new records or updates existing ones. On re-enrichment, all fields
 * are overwritten with the latest data.
 *
 * @param contacts - Array of canonical contact data to upsert.
 * @returns Array of upserted CanonicalContact records.
 */
export async function upsertContacts(
  contacts: CanonicalContactData[],
): Promise<CanonicalContact[]> {
  const results: CanonicalContact[] = [];

  for (const contact of contacts) {
    try {
      const upserted = await prisma.canonicalContact.upsert({
        where: { email: contact.email },
        create: {
          email: contact.email,
          firstName: contact.firstName,
          lastName: contact.lastName,
          jobTitle: contact.jobTitle,
          company: contact.company,
          domain: contact.domain,
          phone: contact.phone,
          mobilePhone: contact.mobilePhone,
          linkedinUrl: contact.linkedinUrl,
          city: contact.city,
          state: contact.state,
          country: contact.country,
          enrichmentSource: contact.enrichmentSource,
          enrichmentDate: contact.enrichmentDate,
          techSpendTier: contact.techSpendTier,
          enrichmentJobId: contact.enrichmentJobId,
          jobContactId: contact.jobContactId,
        },
        update: {
          firstName: contact.firstName,
          lastName: contact.lastName,
          jobTitle: contact.jobTitle,
          company: contact.company,
          domain: contact.domain,
          phone: contact.phone,
          mobilePhone: contact.mobilePhone,
          linkedinUrl: contact.linkedinUrl,
          city: contact.city,
          state: contact.state,
          country: contact.country,
          enrichmentSource: contact.enrichmentSource,
          enrichmentDate: contact.enrichmentDate,
          techSpendTier: contact.techSpendTier,
          enrichmentJobId: contact.enrichmentJobId,
          jobContactId: contact.jobContactId,
        },
      });
      results.push(upserted);
    } catch (err) {
      logger.error('Failed to upsert canonical contact', {
        email: contact.email,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('Canonical contacts upserted', {
    total: contacts.length,
    succeeded: results.length,
    failed: contacts.length - results.length,
  });

  return results;
}

// ---------------------------------------------------------------------------
// Query operations
// ---------------------------------------------------------------------------

/**
 * Get all canonical contacts associated with a specific enrichment job.
 *
 * @param enrichmentJobId - The Job UUID.
 * @returns Array of CanonicalContact records.
 */
export async function getContactsByJobId(
  enrichmentJobId: string,
): Promise<CanonicalContact[]> {
  return prisma.canonicalContact.findMany({
    where: { enrichmentJobId },
    orderBy: { email: 'asc' },
  });
}

/**
 * Get all canonical accounts associated with a specific enrichment job.
 *
 * @param enrichmentJobId - The Job UUID.
 * @returns Array of CanonicalAccount records.
 */
export async function getAccountsByJobId(
  enrichmentJobId: string,
): Promise<CanonicalAccount[]> {
  return prisma.canonicalAccount.findMany({
    where: { enrichmentJobId },
    orderBy: { domain: 'asc' },
  });
}
