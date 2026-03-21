/**
 * Default HubSpot canonical-to-property mapping.
 *
 * Maps canonical field names to HubSpot internal property names. Used as the
 * default field mapping when a CrmConnection is first created and for
 * auto-detect during field mapping setup.
 *
 * Migrated from the COLUMN_ALIAS_MAP in hubspotPropertyMapping.ts into the
 * canonical field → HubSpot property format.
 */

import type { CanonicalContactField, CanonicalAccountField } from '../../../canonical/types.js';

/** Default mapping of canonical contact fields to HubSpot contact properties. */
export const HUBSPOT_CONTACT_FIELD_MAP: Record<CanonicalContactField, string | null> = {
  email: 'email',
  firstName: 'firstname',
  lastName: 'lastname',
  jobTitle: 'jobtitle',
  company: 'company',
  domain: 'website',
  phone: 'phone',
  mobilePhone: 'mobilephone',
  linkedinUrl: 'hs_linkedin_url',
  city: 'city',
  state: 'state',
  country: 'country',
  enrichmentSource: 'enrichment_source',
  enrichmentDate: 'enrichment_date',
  techSpendTier: 'tech_spend_tier',
  enrichmentJobId: 'enrichment_job_id',
};

/** Default mapping of canonical account fields to HubSpot company properties. */
export const HUBSPOT_ACCOUNT_FIELD_MAP: Record<CanonicalAccountField, string | null> = {
  domain: 'website',
  companyName: 'name',
  industry: 'industry',
  employeeCount: 'numberofemployees',
  annualRevenue: 'annualrevenue',
  city: 'city',
  state: 'state',
  country: 'country',
  technologies: null,       // Custom property, not mapped by default
  cloudProvider: null,       // Custom property, not mapped by default
  trafficRank: null,         // Custom property, not mapped by default
  techSpendTier: 'tech_spend_tier',
};

/** Custom HubSpot properties that need to be created for enrichment data. */
export const HUBSPOT_CUSTOM_PROPERTIES = [
  {
    name: 'enrichment_source',
    label: 'Enrichment Source',
    type: 'string',
    fieldType: 'text',
    groupName: 'enrichment_data',
    description: 'Source system that enriched this contact',
  },
  {
    name: 'enrichment_date',
    label: 'Enrichment Date',
    type: 'date',
    fieldType: 'date',
    groupName: 'enrichment_data',
    description: 'Date when contact was enriched',
  },
  {
    name: 'tech_spend_tier',
    label: 'Tech Spend Tier',
    type: 'enumeration',
    fieldType: 'select',
    groupName: 'enrichment_data',
    description: 'Technology spend classification tier',
    options: [
      { label: 'Tier 1', value: 'Tier 1', displayOrder: 1, hidden: false },
      { label: 'Tier 2', value: 'Tier 2', displayOrder: 2, hidden: false },
      { label: 'Tier 3', value: 'Tier 3', displayOrder: 3, hidden: false },
      { label: 'Unclassified', value: 'Unclassified', displayOrder: 4, hidden: false },
    ],
  },
  {
    name: 'enrichment_job_id',
    label: 'Enrichment Job ID',
    type: 'string',
    fieldType: 'text',
    groupName: 'enrichment_data',
    description: 'Internal enrichment job reference ID',
  },
] as const;

/** The HubSpot property group for enrichment custom fields. */
export const HUBSPOT_ENRICHMENT_GROUP = {
  name: 'enrichment_data',
  label: 'Enrichment Data',
  displayOrder: -1,
} as const;
