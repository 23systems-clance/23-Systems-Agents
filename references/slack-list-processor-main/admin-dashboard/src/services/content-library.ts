import { api } from '@/lib/api-client';

/** Placeholder team ID until workspace selector is implemented. */
const TEAM_ID = 'T_DEFAULT';

export interface ContentLibraryItem {
  id: string;
  type: string;
  title: string;
  content: string | null;
  metadata: Record<string, unknown> | null;
  estimated_minutes: number | null;
  category_tags: string[];
  usage_count: number;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface ContentCategory {
  tag: string;
  count: number;
}

export interface CreateContentItemInput {
  type: string;
  title: string;
  content?: string;
  metadata?: Record<string, unknown>;
  estimated_minutes?: number;
  category_tags?: string[];
}

export interface UpdateContentItemInput {
  title?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  estimated_minutes?: number;
  category_tags?: string[];
}

/** Fetch content library items with optional filters. */
export async function fetchContentLibrary(
  filters?: { type?: string; category?: string; search?: string },
): Promise<{ items: ContentLibraryItem[]; total: number }> {
  const { data } = await api.get<{ items: ContentLibraryItem[]; total: number }>(
    '/content-library',
    { params: { teamId: TEAM_ID, ...filters } },
  );
  return data;
}

/** Create a new content library item. */
export async function createContentItem(
  input: CreateContentItemInput,
): Promise<ContentLibraryItem> {
  const { data } = await api.post<ContentLibraryItem>('/content-library', {
    ...input,
    slack_team_id: TEAM_ID,
    created_by_user_id: 'admin',
  });
  return data;
}

/** Response from updating a content library item. */
export interface UpdateContentItemResponse {
  item: ContentLibraryItem;
  warning?: string;
}

/** Update an existing content library item. */
export async function updateContentItem(
  itemId: string,
  input: UpdateContentItemInput,
): Promise<UpdateContentItemResponse> {
  const { data } = await api.put<UpdateContentItemResponse>(`/content-library/${itemId}`, input);
  return data;
}

/** Delete a content library item. */
export async function deleteContentItem(itemId: string): Promise<void> {
  await api.delete(`/content-library/${itemId}`);
}

/** Fetch available content categories with usage counts. */
export async function fetchContentCategories(): Promise<ContentCategory[]> {
  const { data } = await api.get<{ categories: ContentCategory[] }>(
    '/content-library/categories',
    { params: { teamId: TEAM_ID } },
  );
  return data.categories;
}
