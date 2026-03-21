import { api } from '@/lib/api-client';

/** Quality gate configuration response shape. */
export interface QualityGateConfigResponse {
  id: string | null;
  clientId: string;
  isCustom: boolean;
  config: {
    rejectPersonalEmails: boolean;
    rejectMissingCompany: boolean;
    rejectDuplicateEmails: boolean;
    deduplicateDomains: boolean;
    suppressionDomains: string[];
    personalDomainOverrides: string[];
    allowPersonalDomains: string[];
  };
  effectivePersonalDomains: string[];
}

/** Global defaults response shape. */
export interface QualityGateDefaultsResponse {
  config: {
    rejectPersonalEmails: boolean;
    rejectMissingCompany: boolean;
    rejectDuplicateEmails: boolean;
    deduplicateDomains: boolean;
    suppressionDomains: string[];
    personalDomainOverrides: string[];
    allowPersonalDomains: string[];
  };
  defaultPersonalDomains: string[];
}

/** Input for updating quality gate config. */
export interface QualityGateConfigInput {
  rejectPersonalEmails?: boolean;
  rejectMissingCompany?: boolean;
  rejectDuplicateEmails?: boolean;
  deduplicateDomains?: boolean;
  suppressionDomains?: string[];
  personalDomainOverrides?: string[];
  allowPersonalDomains?: string[];
}

export async function getConfig(clientId: string): Promise<QualityGateConfigResponse> {
  const { data } = await api.get<QualityGateConfigResponse>(
    `/quality-gate-config/${clientId}`,
  );
  return data;
}

export async function getDefaults(): Promise<QualityGateDefaultsResponse> {
  const { data } = await api.get<QualityGateDefaultsResponse>(
    '/quality-gate-config/defaults',
  );
  return data;
}

export async function updateConfig(
  clientId: string,
  input: QualityGateConfigInput,
): Promise<QualityGateConfigResponse> {
  const { data } = await api.put<QualityGateConfigResponse>(
    `/quality-gate-config/${clientId}`,
    input,
  );
  return data;
}

export async function resetConfig(
  clientId: string,
): Promise<{ message: string; clientId: string }> {
  const { data } = await api.delete<{ message: string; clientId: string }>(
    `/quality-gate-config/${clientId}`,
  );
  return data;
}
