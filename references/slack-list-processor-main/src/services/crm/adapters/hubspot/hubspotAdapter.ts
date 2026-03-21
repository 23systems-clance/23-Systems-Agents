/**
 * HubSpot CRM adapter.
 *
 * Implements the CrmAdapter interface for HubSpot, wrapping existing HubSpot
 * client operations (identity resolution, batch create/update, property
 * management) behind the CRM-agnostic adapter contract.
 *
 * Uses 100-contact batch size with exponential backoff on 429 rate limits.
 * Supports partial success — succeeded records are committed even if some fail.
 */

import { Client as HubSpotClient } from '@hubspot/api-client';
import type { CrmType, CrmConnectionStatus, CrmFieldMapping } from '@prisma/client';
import { prisma } from '../../../../models/index.js';
import { getAccessToken } from '../../../hubspot/hubspotOAuth.js';
import { resolveIdentity, type HubSpotMatchCandidate } from '../../../hubspot/identityResolver.js';
import { normalizeDomain } from '../../../hubspot/domainNormalizer.js';
import redis from '../../../../lib/redis.js';
import logger from '../../../../lib/logger.js';
import { CrmAdapter, type CrmUpsertResult, type CrmPropertyInfo, type CrmAdapterError } from '../../types.js';
import type { CanonicalContactData } from '../../../canonical/types.js';
import { HUBSPOT_CUSTOM_PROPERTIES, HUBSPOT_ENRICHMENT_GROUP } from './hubspotFieldMap.js';

const BATCH_SIZE = 100;
const PROPERTY_CACHE_TTL = 3600; // 1 hour

/**
 * HubSpot adapter implementing the CrmAdapter interface.
 */
export class HubSpotAdapter extends CrmAdapter {
  readonly crmType: CrmType = 'HUBSPOT';

  /**
   * Verify HubSpot connection is active by checking token validity.
   */
  async connect(connectionId: string): Promise<void> {
    const clientId = await this.getClientId(connectionId);
    await getAccessToken(clientId);

    await prisma.crmConnection.update({
      where: { id: connectionId },
      data: { status: 'ACTIVE' },
    });
  }

  /**
   * Mark CRM connection as disconnected.
   */
  async disconnect(connectionId: string): Promise<void> {
    await prisma.crmConnection.update({
      where: { id: connectionId },
      data: { status: 'DISCONNECTED' },
    });
  }

  /**
   * Check HubSpot connection status by attempting a token validation.
   */
  async getConnectionStatus(connectionId: string): Promise<CrmConnectionStatus> {
    try {
      const clientId = await this.getClientId(connectionId);
      await getAccessToken(clientId);
      return 'ACTIVE';
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.includes('TOKEN_EXPIRED') || message.includes('token expired')) {
        return 'TOKEN_EXPIRED';
      }
      if (message.includes('DISCONNECTED') || message.includes('No active')) {
        return 'DISCONNECTED';
      }
      return 'ERROR';
    }
  }

  /**
   * Batch upsert canonical contacts into HubSpot.
   *
   * Uses identity resolution (email match) to sort contacts into
   * create vs update buckets, then executes batch API calls.
   * Supports partial success.
   */
  async upsertContacts(
    connectionId: string,
    contacts: CanonicalContactData[],
    fieldMappings: CrmFieldMapping[],
  ): Promise<CrmUpsertResult> {
    const result: CrmUpsertResult = {
      succeeded: 0,
      failed: 0,
      errors: [],
      crmRecordIds: new Map(),
    };

    if (contacts.length === 0) return result;

    const clientId = await this.getClientId(connectionId);
    const accessToken = await getAccessToken(clientId);

    // Search HubSpot for existing contacts by email
    const emails = contacts.map((c) => c.email).filter(Boolean);
    const existingContacts = await this.searchExistingContacts(accessToken, emails);

    // Build lookup map: email → hubspot contact
    const existingByEmail = new Map<string, { id: string }>();
    for (const ec of existingContacts) {
      const email = (ec as any).properties?.email?.toLowerCase();
      if (email) existingByEmail.set(email, ec);
    }

    // Sort into create/update buckets
    const toCreate: Array<{ contact: CanonicalContactData; properties: Record<string, string> }> = [];
    const toUpdate: Array<{ hubspotId: string; contact: CanonicalContactData; properties: Record<string, string> }> = [];

    for (const contact of contacts) {
      const properties = this.applyFieldMappings(contact, fieldMappings);
      const existing = existingByEmail.get(contact.email.toLowerCase());

      if (existing) {
        toUpdate.push({ hubspotId: existing.id, contact, properties });
      } else {
        toCreate.push({ contact, properties });
      }
    }

    // Batch create
    for (let i = 0; i < toCreate.length; i += BATCH_SIZE) {
      const batch = toCreate.slice(i, i + BATCH_SIZE);
      try {
        const created = await this.withRetry(() =>
          this.batchCreate(accessToken, batch.map((b) => b.properties)),
        );
        for (let j = 0; j < created.length; j++) {
          const email = batch[j].contact.email;
          result.crmRecordIds.set(email, created[j].id);
          result.succeeded++;
        }
      } catch (err) {
        for (const item of batch) {
          result.failed++;
          result.errors.push({
            email: item.contact.email,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // Batch update
    for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
      const batch = toUpdate.slice(i, i + BATCH_SIZE);
      try {
        const updated = await this.withRetry(() =>
          this.batchUpdate(
            accessToken,
            batch.map((b) => ({ id: b.hubspotId, properties: b.properties })),
          ),
        );
        for (let j = 0; j < updated.length; j++) {
          const email = batch[j].contact.email;
          result.crmRecordIds.set(email, batch[j].hubspotId);
          result.succeeded++;
        }
      } catch (err) {
        for (const item of batch) {
          result.failed++;
          result.errors.push({
            email: item.contact.email,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    logger.info('HubSpot adapter upsert complete', {
      connectionId,
      total: contacts.length,
      created: toCreate.length - result.errors.filter((e) => toCreate.some((c) => c.contact.email === e.email)).length,
      updated: toUpdate.length - result.errors.filter((e) => toUpdate.some((u) => u.contact.email === e.email)).length,
      failed: result.failed,
    });

    return result;
  }

  /**
   * Create a static contact list in HubSpot.
   */
  async createList(connectionId: string, name: string): Promise<string> {
    const clientId = await this.getClientId(connectionId);
    const accessToken = await getAccessToken(clientId);

    const response = await this.withRetry(() =>
      this.hubspotFetch<{ listId: string }>(accessToken, '/crm/v3/lists', {
        method: 'POST',
        body: JSON.stringify({
          name,
          objectTypeId: '0-1', // contacts
          processingType: 'MANUAL',
        }),
      }),
    );

    logger.info('HubSpot list created', { connectionId, listId: response.listId, name });
    return response.listId;
  }

  /**
   * Add contacts to an existing HubSpot list by record IDs.
   */
  async addContactsToList(
    connectionId: string,
    listId: string,
    crmContactIds: string[],
  ): Promise<void> {
    if (crmContactIds.length === 0) return;

    const clientId = await this.getClientId(connectionId);
    const accessToken = await getAccessToken(clientId);

    // HubSpot allows up to 500 records per add-to-list call
    const batchSize = 500;
    for (let i = 0; i < crmContactIds.length; i += batchSize) {
      const batch = crmContactIds.slice(i, i + batchSize);
      await this.withRetry(() =>
        this.hubspotFetch(accessToken, `/crm/v3/lists/${listId}/memberships/add`, {
          method: 'PUT',
          body: JSON.stringify(batch),
        }),
      );
    }

    logger.info('Contacts added to HubSpot list', {
      connectionId,
      listId,
      count: crmContactIds.length,
    });
  }

  /**
   * Fetch all contact properties from a HubSpot portal (with Redis cache).
   */
  async getProperties(connectionId: string): Promise<CrmPropertyInfo[]> {
    const clientId = await this.getClientId(connectionId);

    // Check Redis cache
    const cacheKey = `crm:props:hubspot:${connectionId}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as CrmPropertyInfo[];
    }

    const accessToken = await getAccessToken(clientId);
    const hubspotClient = new HubSpotClient({ accessToken });

    const response = await hubspotClient.crm.properties.coreApi.getAll('contacts');

    const properties: CrmPropertyInfo[] = response.results.map((prop) => ({
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
   * Ensure custom enrichment properties exist in the HubSpot portal.
   */
  async ensureCustomProperties(
    connectionId: string,
    properties: CrmPropertyInfo[],
  ): Promise<void> {
    const clientId = await this.getClientId(connectionId);
    const accessToken = await getAccessToken(clientId);
    const hubspotClient = new HubSpotClient({ accessToken });

    // Create property group
    try {
      await hubspotClient.crm.properties.groupsApi.create('contacts', {
        name: HUBSPOT_ENRICHMENT_GROUP.name,
        label: HUBSPOT_ENRICHMENT_GROUP.label,
        displayOrder: HUBSPOT_ENRICHMENT_GROUP.displayOrder,
      });
    } catch (err: unknown) {
      const statusCode = (err as { code?: number })?.code;
      if (statusCode !== 409) {
        logger.warn('Failed to create enrichment property group (may already exist)', { error: err });
      }
    }

    // Create custom properties
    for (const propDef of HUBSPOT_CUSTOM_PROPERTIES) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await hubspotClient.crm.properties.coreApi.create('contacts', propDef as any);
      } catch (err: unknown) {
        const statusCode = (err as { code?: number })?.code;
        if (statusCode !== 409) {
          logger.warn(`Failed to create property ${propDef.name} (may already exist)`, { error: err });
        }
      }
    }

    logger.info('Custom HubSpot properties ensured', { connectionId });
  }

  // -------------------------------------------------------------------------
  // HubSpot-specific error normalization (T019)
  // -------------------------------------------------------------------------

  /**
   * Override base normalizeError to handle HubSpot-specific error formats.
   */
  protected normalizeError(err: unknown): CrmAdapterError {
    if (err instanceof Error) {
      const statusCode = (err as any).statusCode ?? (err as any).status ?? (err as any).code;
      const body = (err as any).body ?? (err as any).response?.body;

      let code = 'UNKNOWN_ERROR';
      let retryable = false;

      if (statusCode === 401 || statusCode === 403) {
        code = 'AUTH_FAILED';
      } else if (statusCode === 429) {
        code = 'RATE_LIMITED';
        retryable = true;
      } else if (statusCode === 404) {
        code = 'NOT_FOUND';
      } else if (typeof statusCode === 'number' && statusCode >= 500) {
        code = 'SERVER_ERROR';
        retryable = true;
      } else if (err.message.includes('ETIMEDOUT') || err.message.includes('ECONNRESET')) {
        code = 'NETWORK_ERROR';
        retryable = true;
      }

      return {
        code,
        message: err.message,
        crmType: this.crmType,
        retryable,
        details: { statusCode, body },
      };
    }

    return {
      code: 'UNKNOWN_ERROR',
      message: String(err),
      crmType: this.crmType,
      retryable: false,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Look up the ManagedClient ID for a CRM connection.
   */
  private async getClientId(connectionId: string): Promise<string> {
    const conn = await prisma.crmConnection.findUniqueOrThrow({
      where: { id: connectionId },
      select: { clientId: true },
    });
    return conn.clientId;
  }

  /**
   * Apply field mappings to convert a canonical contact to HubSpot properties.
   */
  private applyFieldMappings(
    contact: CanonicalContactData,
    fieldMappings: CrmFieldMapping[],
  ): Record<string, string> {
    const properties: Record<string, string> = {};

    for (const mapping of fieldMappings) {
      if (mapping.syncDirection === 'FROM_CRM') continue;

      const canonicalField = mapping.canonicalField as keyof CanonicalContactData;
      const value = contact[canonicalField];

      if (value === null || value === undefined) continue;

      // Convert value to string for HubSpot API
      if (value instanceof Date) {
        properties[mapping.crmProperty] = value.toISOString().split('T')[0]; // YYYY-MM-DD
      } else if (Array.isArray(value)) {
        properties[mapping.crmProperty] = value.join(';');
      } else {
        properties[mapping.crmProperty] = String(value);
      }
    }

    return properties;
  }

  /**
   * Search HubSpot for existing contacts by email.
   */
  private async searchExistingContacts(
    accessToken: string,
    emails: string[],
  ): Promise<Array<{ id: string; properties?: Record<string, string> }>> {
    if (emails.length === 0) return [];

    const contacts: Array<{ id: string; properties?: Record<string, string> }> = [];
    const batchSize = 50;

    for (let i = 0; i < emails.length; i += batchSize) {
      const batch = emails.slice(i, i + batchSize);
      try {
        const response = await this.withRetry(() =>
          this.hubspotFetch<{ results: Array<{ id: string; properties?: Record<string, string> }> }>(
            accessToken,
            '/crm/v3/objects/contacts/search',
            {
              method: 'POST',
              body: JSON.stringify({
                filterGroups: batch.map((email) => ({
                  filters: [{ propertyName: 'email', operator: 'EQ', value: email }],
                })),
                properties: ['email'],
                limit: 100,
              }),
            },
          ),
        );
        contacts.push(...response.results);
      } catch (err) {
        logger.warn('HubSpot contact search batch failed', {
          error: err instanceof Error ? err.message : String(err),
          batchStart: i,
        });
      }
    }

    return contacts;
  }

  /**
   * Batch create contacts via HubSpot API.
   */
  private async batchCreate(
    accessToken: string,
    propertiesList: Record<string, string>[],
  ): Promise<Array<{ id: string }>> {
    const response = await this.hubspotFetch<{ results: Array<{ id: string }> }>(
      accessToken,
      '/crm/v3/objects/contacts/batch/create',
      {
        method: 'POST',
        body: JSON.stringify({
          inputs: propertiesList.map((properties) => ({ properties })),
        }),
      },
    );
    return response.results;
  }

  /**
   * Batch update contacts via HubSpot API.
   */
  private async batchUpdate(
    accessToken: string,
    updates: Array<{ id: string; properties: Record<string, string> }>,
  ): Promise<Array<{ id: string }>> {
    const response = await this.hubspotFetch<{ results: Array<{ id: string }> }>(
      accessToken,
      '/crm/v3/objects/contacts/batch/update',
      {
        method: 'POST',
        body: JSON.stringify({ inputs: updates }),
      },
    );
    return response.results;
  }

  /**
   * Make an authenticated HubSpot API request.
   */
  private async hubspotFetch<T>(
    accessToken: string,
    path: string,
    options?: RequestInit,
  ): Promise<T> {
    const url = `https://api.hubapi.com${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      const error = new Error(`HubSpot API error ${response.status}: ${body}`);
      (error as any).statusCode = response.status;
      (error as any).body = body;
      throw error;
    }

    return (await response.json()) as T;
  }
}
