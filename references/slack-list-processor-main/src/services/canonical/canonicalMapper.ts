/**
 * Canonical mapper service.
 *
 * Converts enrichment output (JobCompany/JobContact rows) into CRM-agnostic
 * CanonicalAccount and CanonicalContact records. Enrichment metadata (source,
 * date, techSpendTier, jobId) is pulled from the parent Job record.
 */

import type { Job, JobCompany, JobContact } from '@prisma/client';
import type { CanonicalContactData, CanonicalAccountData } from './types.js';

/**
 * Convert a JobCompany row into a CanonicalAccountData record.
 *
 * @param company - The enriched JobCompany record.
 * @param job - The parent Job (for enrichment metadata).
 * @returns CRM-agnostic account data.
 */
export function mapJobCompanyToCanonicalAccount(
  company: JobCompany,
  job: Job,
): CanonicalAccountData {
  const domain = company.resolvedDomain || company.domain;
  if (!domain) {
    throw new Error(`JobCompany ${company.id} has no domain or resolvedDomain`);
  }

  return {
    domain,
    companyName: company.companyNameFromApi || company.companyName || null,
    industry: company.vertical || null,
    employeeCount: company.employeeCount || null,
    annualRevenue: company.salesRevenue ? Number(company.salesRevenue) : null,
    city: company.locationCity || null,
    state: company.locationState || null,
    country: company.locationCountry || null,
    technologies: extractTechnologies(company),
    cloudProvider: company.cloudProviderPrimary || null,
    trafficRank: company.trafficRank || null,
    techSpendTier: company.techSpendTier || null,
    jobCompanyId: company.id,
    enrichmentJobId: job.id,
  };
}

/**
 * Convert a JobContact row into a CanonicalContactData record.
 *
 * @param contact - The enriched JobContact record.
 * @param company - The parent JobCompany (for domain and company name).
 * @param job - The parent Job (for enrichment metadata).
 * @returns CRM-agnostic contact data.
 */
export function mapJobContactToCanonicalContact(
  contact: JobContact,
  company: JobCompany,
  job: Job,
): CanonicalContactData {
  if (!contact.email) {
    throw new Error(`JobContact ${contact.id} has no email address`);
  }

  return {
    email: contact.email.toLowerCase().trim(),
    firstName: contact.firstName || null,
    lastName: contact.lastName || null,
    jobTitle: contact.jobTitle || null,
    company: company.companyNameFromApi || company.companyName || null,
    domain: company.resolvedDomain || company.domain || null,
    phone: contact.directPhone || contact.businessPhone || null,
    mobilePhone: null, // Apollo delivers mobile phones async via webhook
    linkedinUrl: contact.linkedinUrl || null,
    city: company.locationCity || null,
    state: company.locationState || null,
    country: company.locationCountry || null,
    enrichmentSource: deriveEnrichmentSource(job),
    enrichmentDate: job.completedAt || job.updatedAt,
    techSpendTier: company.techSpendTier || null,
    enrichmentJobId: job.id,
    jobContactId: contact.id,
  };
}

/**
 * Batch convert all JobCompany rows for a job into CanonicalAccountData.
 *
 * Skips companies without a valid domain.
 *
 * @param companies - Array of enriched JobCompany records.
 * @param job - The parent Job record.
 * @returns Array of canonical account records (one per unique domain).
 */
export function mapJobCompaniesToCanonicalAccounts(
  companies: JobCompany[],
  job: Job,
): CanonicalAccountData[] {
  const seen = new Set<string>();
  const accounts: CanonicalAccountData[] = [];

  for (const company of companies) {
    const domain = company.resolvedDomain || company.domain;
    if (!domain || seen.has(domain)) continue;

    seen.add(domain);
    accounts.push(mapJobCompanyToCanonicalAccount(company, job));
  }

  return accounts;
}

/**
 * Batch convert all JobContact rows for a job into CanonicalContactData.
 *
 * Skips contacts without an email. Requires a map of companyId → JobCompany
 * for looking up parent company data.
 *
 * @param contacts - Array of enriched JobContact records.
 * @param companyMap - Map of JobCompany ID → JobCompany record.
 * @param job - The parent Job record.
 * @returns Array of canonical contact records (one per unique email).
 */
export function mapJobContactsToCanonicalContacts(
  contacts: JobContact[],
  companyMap: Map<string, JobCompany>,
  job: Job,
): CanonicalContactData[] {
  const seen = new Set<string>();
  const canonicalContacts: CanonicalContactData[] = [];

  for (const contact of contacts) {
    if (!contact.email) continue;

    const email = contact.email.toLowerCase().trim();
    if (seen.has(email)) continue;

    const company = companyMap.get(contact.jobCompanyId);
    if (!company) continue;

    seen.add(email);
    canonicalContacts.push(mapJobContactToCanonicalContact(contact, company, job));
  }

  return canonicalContacts;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract technology names from a JobCompany.
 *
 * Technologies are stored as a relation (CompanyTechnology[]) but the
 * mapper receives a flat JobCompany row. If the technologies relation was
 * eagerly loaded, they'll be available; otherwise returns an empty array.
 */
function extractTechnologies(company: JobCompany & { technologies?: Array<{ name: string }> }): string[] {
  if (company.technologies && Array.isArray(company.technologies)) {
    return company.technologies
      .map((t: any) => (typeof t === 'string' ? t : t.name))
      .filter(Boolean);
  }
  return [];
}

/**
 * Derive enrichment source label from job metadata.
 *
 * The enrichment pipeline uses BuiltWith for technographics and Apollo for
 * contacts, so the source is effectively "BuiltWith + Apollo".
 */
function deriveEnrichmentSource(job: Job): string {
  return 'BuiltWith + Apollo';
}
