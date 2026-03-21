/**
 * TypeScript interfaces for the canonical data layer.
 *
 * These types represent CRM-agnostic contact and account records that sit
 * between enrichment output (JobCompany/JobContact) and CRM-specific adapters.
 */

/** CRM-agnostic contact record with 16 standard fields. */
export interface CanonicalContactData {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  jobTitle?: string | null;
  company?: string | null;
  domain?: string | null;
  phone?: string | null;
  mobilePhone?: string | null;
  linkedinUrl?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  enrichmentSource?: string | null;
  enrichmentDate?: Date | null;
  techSpendTier?: string | null;
  enrichmentJobId?: string | null;
  jobContactId?: string | null;
}

/** CRM-agnostic account record with 12 standard fields. */
export interface CanonicalAccountData {
  domain: string;
  companyName?: string | null;
  industry?: string | null;
  employeeCount?: number | null;
  annualRevenue?: number | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  technologies?: string[];
  cloudProvider?: string | null;
  trafficRank?: number | null;
  techSpendTier?: string | null;
  jobCompanyId?: string | null;
  enrichmentJobId?: string | null;
}

/** Canonical field category groupings for the admin UI field picker. */
export const CANONICAL_CONTACT_FIELD_GROUPS = {
  'Name': ['firstName', 'lastName'],
  'Contact Info': ['email', 'jobTitle', 'company'],
  'Phone Numbers': ['phone', 'mobilePhone'],
  'Location': ['city', 'state', 'country'],
  'Links': ['linkedinUrl'],
  'Enrichment Data': ['enrichmentSource', 'enrichmentDate', 'techSpendTier', 'enrichmentJobId'],
} as const;

/** All canonical contact field names. */
export const CANONICAL_CONTACT_FIELDS = [
  'email', 'firstName', 'lastName', 'jobTitle', 'company', 'domain',
  'phone', 'mobilePhone', 'linkedinUrl', 'city', 'state', 'country',
  'enrichmentSource', 'enrichmentDate', 'techSpendTier', 'enrichmentJobId',
] as const;

/** All canonical account field names. */
export const CANONICAL_ACCOUNT_FIELDS = [
  'domain', 'companyName', 'industry', 'employeeCount', 'annualRevenue',
  'city', 'state', 'country', 'technologies', 'cloudProvider',
  'trafficRank', 'techSpendTier',
] as const;

export type CanonicalContactField = (typeof CANONICAL_CONTACT_FIELDS)[number];
export type CanonicalAccountField = (typeof CANONICAL_ACCOUNT_FIELDS)[number];
