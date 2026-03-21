/**
 * CRM API service for the admin dashboard.
 *
 * Functions for managing CRM connections, field mappings, and imports.
 */

import { api } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CrmConnection {
  id: string;
  clientId: string;
  crmType: 'HUBSPOT' | 'ATTIO' | 'SALESFORCE';
  status: 'ACTIVE' | 'DISCONNECTED' | 'TOKEN_EXPIRED' | 'ERROR';
  displayName: string | null;
  hubspotConnectionId: string | null;
  adapterConfig: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  client?: { id: string; name: string };
  hubspotConnection?: { id: string; portalId: string; portalName: string; status?: string };
  _count?: { fieldMappings: number; pushRecords: number };
  fieldMappings?: CrmFieldMapping[];
}

export interface CrmFieldMapping {
  id: string;
  crmConnectionId: string;
  canonicalField: string;
  crmProperty: string;
  crmPropertyLabel: string | null;
  dataType: string;
  transformRule: string | null;
  isRequired: boolean;
  syncDirection: 'TO_CRM' | 'FROM_CRM' | 'BIDIRECTIONAL';
  overwriteExisting: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CrmPropertyInfo {
  name: string;
  label: string;
  type: string;
  groupName: string;
  isCustom: boolean;
}

export interface CrmImportResult {
  totalContacts: number;
  totalAccounts: number;
  upsertResult: {
    succeeded: number;
    failed: number;
    errors: Array<{ email: string; error: string }>;
  };
  listCreated: boolean;
  listId?: string;
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

export async function listConnections(clientId?: string): Promise<CrmConnection[]> {
  const params = clientId ? { clientId } : {};
  const { data } = await api.get<{ connections: CrmConnection[] }>('/crm/connections', { params });
  return data.connections;
}

export async function getConnection(id: string): Promise<CrmConnection> {
  const { data } = await api.get<{ connection: CrmConnection }>(`/crm/connections/${id}`);
  return data.connection;
}

export async function createConnection(params: {
  clientId: string;
  crmType: string;
  displayName?: string;
  hubspotConnectionId?: string;
}): Promise<CrmConnection> {
  const { data } = await api.post<{ connection: CrmConnection }>('/crm/connections', params);
  return data.connection;
}

export async function deleteConnection(id: string): Promise<CrmConnection> {
  const { data } = await api.delete<{ connection: CrmConnection }>(`/crm/connections/${id}`);
  return data.connection;
}

// ---------------------------------------------------------------------------
// Field Mappings
// ---------------------------------------------------------------------------

export async function listFieldMappings(connectionId: string): Promise<{
  mappings: CrmFieldMapping[];
  unmappedCanonicalFields: string[];
}> {
  const { data } = await api.get<{
    mappings: CrmFieldMapping[];
    unmappedCanonicalFields: string[];
  }>(`/crm/connections/${connectionId}/field-mappings`);
  return data;
}

export async function bulkUpdateFieldMappings(
  connectionId: string,
  mappings: Array<{
    canonicalField: string;
    crmProperty: string;
    crmPropertyLabel?: string;
    dataType?: string;
    overwriteExisting?: boolean;
    syncDirection?: string;
    displayOrder?: number;
  }>,
): Promise<CrmFieldMapping[]> {
  const { data } = await api.put<{ mappings: CrmFieldMapping[] }>(
    `/crm/connections/${connectionId}/field-mappings`,
    { mappings },
  );
  return data.mappings;
}

export async function updateFieldMapping(
  connectionId: string,
  mappingId: string,
  updates: Partial<CrmFieldMapping>,
): Promise<CrmFieldMapping> {
  const { data } = await api.patch<{ mapping: CrmFieldMapping }>(
    `/crm/connections/${connectionId}/field-mappings/${mappingId}`,
    updates,
  );
  return data.mapping;
}

export async function deleteFieldMapping(
  connectionId: string,
  mappingId: string,
): Promise<void> {
  await api.delete(`/crm/connections/${connectionId}/field-mappings/${mappingId}`);
}

export async function autoDetectMappings(connectionId: string): Promise<{
  mappings: CrmFieldMapping[];
  count: number;
}> {
  const { data } = await api.post<{ mappings: CrmFieldMapping[]; count: number }>(
    `/crm/connections/${connectionId}/auto-map`,
  );
  return data;
}

// ---------------------------------------------------------------------------
// CRM Properties
// ---------------------------------------------------------------------------

export async function getCrmProperties(connectionId: string): Promise<CrmPropertyInfo[]> {
  const { data } = await api.get<{ properties: CrmPropertyInfo[] }>(
    `/crm/connections/${connectionId}/properties`,
  );
  return data.properties;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export async function triggerImport(
  connectionId: string,
  enrichmentJobId: string,
  options?: { listName?: string; incrementalOnly?: boolean },
): Promise<CrmImportResult> {
  const { data } = await api.post<{ result: CrmImportResult }>(
    `/crm/connections/${connectionId}/import`,
    { enrichmentJobId, ...options },
  );
  return data.result;
}
