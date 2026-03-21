/**
 * HubSpot property mapping service.
 *
 * Handles auto-detection of CSV column → HubSpot property mappings,
 * fetching available contact properties from a client's HubSpot portal,
 * and ensuring custom enrichment properties exist.
 *
 * @deprecated Superseded by `src/services/crm/adapters/hubspot/hubspotFieldMap.ts`
 * (default field map) and `src/services/crm/adapters/hubspot/hubspotAdapter.ts`
 * (getProperties, ensureCustomProperties) as part of the canonical data schema
 * (Feature 18). Retained for backward compatibility.
 */

import { Client as HubSpotClient } from '@hubspot/api-client';
import { prisma } from '../../models/index.js';
import { getAccessToken } from './hubspotOAuth.js';
import redis from '../../lib/redis.js';
import logger from '../../lib/logger.js';

/** TTL for cached HubSpot property lists (1 hour). */
const PROPERTY_CACHE_TTL = 3600;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Represents a HubSpot contact property. */
export interface HubSpotProperty {
  name: string;
  label: string;
  type: string;
  groupName: string;
  isCustom: boolean;
}

// ---------------------------------------------------------------------------
// Column Mapping Dictionary
// ---------------------------------------------------------------------------

/**
 * Maps normalized CSV header aliases to HubSpot internal property names.
 * Keys are lowercase, trimmed, with special characters removed.
 */
const COLUMN_ALIAS_MAP: Record<string, string> = {
  // Email
  'email': 'email',
  'email address': 'email',
  'e-mail': 'email',
  'contact email': 'email',
  'person email': 'email',
  'work email': 'email',

  // First Name
  'firstname': 'firstname',
  'first name': 'firstname',
  'contact first name': 'firstname',
  'first': 'firstname',
  'given name': 'firstname',

  // Last Name
  'lastname': 'lastname',
  'last name': 'lastname',
  'contact last name': 'lastname',
  'last': 'lastname',
  'surname': 'lastname',
  'family name': 'lastname',

  // Full Name
  'name': 'firstname',
  'full name': 'firstname',
  'contact name': 'firstname',

  // Job Title
  'jobtitle': 'jobtitle',
  'job title': 'jobtitle',
  'title': 'jobtitle',
  'position': 'jobtitle',
  'role': 'jobtitle',
  'contact title': 'jobtitle',

  // Company
  'company': 'company',
  'company name': 'company',
  'organization': 'company',
  'org': 'company',
  'account': 'company',
  'account name': 'company',

  // Phone
  'phone': 'phone',
  'phone number': 'phone',
  'business phone': 'phone',
  'direct phone': 'phone',
  'work phone': 'phone',
  'office phone': 'phone',

  // Mobile Phone
  'mobilephone': 'mobilephone',
  'mobile phone': 'mobilephone',
  'mobile number': 'mobilephone',
  'mobile': 'mobilephone',
  'cell phone': 'mobilephone',
  'cell': 'mobilephone',

  // LinkedIn
  'linkedin': 'hs_linkedin_url',
  'linkedin url': 'hs_linkedin_url',
  'linkedin profile': 'hs_linkedin_url',
  'linkedin link': 'hs_linkedin_url',

  // City
  'city': 'city',
  'contact city': 'city',

  // State
  'state': 'state',
  'contact state': 'state',
  'state/region': 'state',
  'region': 'state',
  'province': 'state',

  // Country
  'country': 'country',
  'contact country': 'country',
  'country/region': 'country',

  // Website
  'website': 'website',
  'domain': 'website',
  'company website': 'website',
  'web': 'website',
  'url': 'website',

  // Industry
  'industry': 'industry',

  // Zip/Postal
  'zip': 'zip',
  'zip code': 'zip',
  'postal code': 'zip',
  'postcode': 'zip',
};

// ---------------------------------------------------------------------------
// Service Functions
// ---------------------------------------------------------------------------

/**
 * Auto-detects column mappings from CSV headers using the alias dictionary.
 *
 * Headers are normalized (lowercased, trimmed, special chars removed) and
 * matched against known aliases. Returns a mapping of CSV header → HubSpot
 * property name. Unrecognized headers are not included.
 *
 * @param csvHeaders - Array of CSV column header strings
 * @returns Mapping of original CSV header → HubSpot property name
 */
export function autoDetectMapping(csvHeaders: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const usedProperties = new Set<string>();

  for (const header of csvHeaders) {
    const normalized = header.toLowerCase().trim().replace(/[^a-z0-9\s/-]/g, '');
    const hubspotProp = COLUMN_ALIAS_MAP[normalized];

    if (hubspotProp && !usedProperties.has(hubspotProp)) {
      mapping[header] = hubspotProp;
      usedProperties.add(hubspotProp);
    }
  }

  return mapping;
}

/**
 * Fetches all contact properties (standard + custom) from a client's HubSpot portal.
 *
 * @param clientId - ManagedClient UUID
 * @returns Array of HubSpotProperty objects
 */
export async function getContactProperties(clientId: string): Promise<HubSpotProperty[]> {
  // Check Redis cache first
  const cacheKey = `hubspot:props:${clientId}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached) as HubSpotProperty[];
  }

  const accessToken = await getAccessToken(clientId);
  const hubspotClient = new HubSpotClient({ accessToken });

  const response = await hubspotClient.crm.properties.coreApi.getAll('contacts');

  const properties = response.results.map((prop) => ({
    name: prop.name,
    label: prop.label,
    type: prop.type,
    groupName: prop.groupName,
    isCustom: !prop.name.startsWith('hs_') && prop.groupName !== 'contactinformation',
  }));

  // Cache for 1 hour
  await redis.set(cacheKey, JSON.stringify(properties), 'EX', PROPERTY_CACHE_TTL);

  return properties;
}

/**
 * Ensures custom enrichment properties and property group exist in the
 * client's HubSpot portal. Creates them if not present.
 *
 * Properties created:
 * - `enrichment_source` (string) - Source system identifier
 * - `enrichment_date` (date) - Date of enrichment
 * - `tech_spend_tier` (enumeration) - Tier 1 / Tier 2 / Tier 3 / Unclassified
 * - `enrichment_job_id` (string) - Internal job reference
 *
 * @param clientId - ManagedClient UUID
 */
export async function ensureEnrichmentProperties(clientId: string): Promise<void> {
  const connection = await prisma.hubSpotConnection.findUnique({
    where: { clientId },
  });

  if (!connection) {
    throw new Error(`No HubSpot connection for client ${clientId}`);
  }

  if (connection.propertiesCreated) {
    return; // Already provisioned
  }

  const accessToken = await getAccessToken(clientId);
  const hubspotClient = new HubSpotClient({ accessToken });

  // 1. Create property group
  try {
    await hubspotClient.crm.properties.groupsApi.create('contacts', {
      name: 'enrichment_data',
      label: 'Enrichment Data',
      displayOrder: -1,
    });
  } catch (err: unknown) {
    // 409 = already exists — safe to ignore
    const statusCode = (err as { code?: number })?.code;
    if (statusCode !== 409) {
      logger.warn('Failed to create enrichment property group (may already exist)', { error: err });
    }
  }

  // 2. Create custom properties
  const propertyDefs = [
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
  ];

  for (const propDef of propertyDefs) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await hubspotClient.crm.properties.coreApi.create('contacts', propDef as any);
    } catch (err: unknown) {
      const statusCode = (err as { code?: number })?.code;
      if (statusCode !== 409) {
        logger.warn(`Failed to create enrichment property ${propDef.name} (may already exist)`, { error: err });
      }
    }
  }

  // 3. Mark as provisioned
  await prisma.hubSpotConnection.update({
    where: { id: connection.id },
    data: { propertiesCreated: true },
  });

  logger.info('Enrichment properties created in HubSpot', { clientId, connectionId: connection.id });
}
