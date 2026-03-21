import { api } from '@/lib/api-client';
import type {
  EnrichmentPresetsResponse,
  EnrichmentPresetEntry,
  EnrichmentPresetCreateInput,
} from '@/types/api';

export async function fetchEnrichmentPresets(): Promise<EnrichmentPresetsResponse> {
  const { data } = await api.get<EnrichmentPresetsResponse>('/enrichment-presets');
  return data;
}

export async function createEnrichmentPreset(
  input: EnrichmentPresetCreateInput,
): Promise<EnrichmentPresetEntry> {
  const { data } = await api.post<EnrichmentPresetEntry>('/enrichment-presets', input);
  return data;
}

export async function updateEnrichmentPreset(
  id: string,
  input: Partial<EnrichmentPresetCreateInput>,
): Promise<EnrichmentPresetEntry> {
  const { data } = await api.put<EnrichmentPresetEntry>(`/enrichment-presets/${id}`, input);
  return data;
}

export async function deleteEnrichmentPreset(id: string): Promise<void> {
  await api.delete(`/enrichment-presets/${id}`);
}
