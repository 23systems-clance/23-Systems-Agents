/**
 * API client for config document upload endpoints.
 *
 * Uses its own axios instance with token-based auth via query param
 * (separate from the admin API client which uses session cookies).
 */

import axios from 'axios';

const uploadApi = axios.create({
  baseURL: '/api/v1/upload',
  withCredentials: true,
});

/** Channel context returned after token validation. */
export interface UploadContext {
  valid: boolean;
  teamId: string;
  channelId: string;
  userId: string;
  clientName: string | null;
  clientId: string | null;
}

/** A config document slot (uploaded or empty). */
export interface DocSlot {
  id: string | null;
  docType: string;
  displayLabel: string | null;
  originalFileName: string | null;
  version: number;
  contentPreview: string | null;
  uploadedByUserId: string | null;
  uploadedAt: string | null;
  s3DownloadUrl: string | null;
  contentSizeBytes: number | null;
  clientId: string | null;
}

/** Response from GET /docs. */
export interface DocsResponse {
  channelId: string;
  clientName: string | null;
  docs: DocSlot[];
}

/** Response from GET /docs/:id/content. */
export interface DocContentResponse {
  id: string;
  docType: string;
  displayLabel: string;
  markdownContent: string;
}

/** Validates the upload token and returns channel context. */
export async function validateToken(token: string): Promise<UploadContext> {
  const { data } = await uploadApi.post<UploadContext>('/validate-token', null, {
    params: { token },
  });
  return data;
}

/** Fetches all 4 doc slots for the channel. */
export async function fetchDocs(token: string): Promise<DocsResponse> {
  const { data } = await uploadApi.get<DocsResponse>('/docs', {
    params: { token },
  });
  return data;
}

/** Uploads a config document file. */
export async function uploadDoc(
  token: string,
  docType: string,
  file: File,
): Promise<DocSlot> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('docType', docType);

  const { data } = await uploadApi.post<DocSlot>('/docs', formData, {
    params: { token },
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

/** Fetches full markdown content for preview. */
export async function fetchDocContent(
  token: string,
  docId: string,
): Promise<DocContentResponse> {
  const { data } = await uploadApi.get<DocContentResponse>(`/docs/${docId}/content`, {
    params: { token },
  });
  return data;
}

/** Triggers file download from S3. */
export async function downloadDoc(token: string, docId: string): Promise<void> {
  // Open in new tab to trigger browser download
  window.open(`/api/v1/upload/docs/${docId}/download?token=${token}`, '_blank');
}

/** Renames the display label of a document. */
export async function renameDocLabel(
  token: string,
  docId: string,
  displayLabel: string,
): Promise<{ id: string; docType: string; displayLabel: string; version: number }> {
  const { data } = await uploadApi.put(`/docs/${docId}/label`, { displayLabel }, {
    params: { token },
  });
  return data;
}

/** Deletes a config document. */
export async function deleteDoc(
  token: string,
  docId: string,
): Promise<{ deleted: boolean; docType: string }> {
  const { data } = await uploadApi.delete(`/docs/${docId}`, {
    params: { token },
  });
  return data;
}
