import { api } from '@/lib/api-client';
import type {
  AdminUsersResponse,
  AdminUserEntry,
  AdminUserCreateInput,
  AdminUserCreateResponse,
} from '@/types/api';

export async function fetchUsers(): Promise<AdminUsersResponse> {
  const { data } = await api.get<AdminUsersResponse>('/users');
  return data;
}

export async function createUser(input: AdminUserCreateInput): Promise<AdminUserCreateResponse> {
  const { data } = await api.post<AdminUserCreateResponse>('/users', input);
  return data;
}

export async function updateUser(
  id: string,
  input: Partial<{ name: string; email: string; role: string; isActive: boolean; password: string }>,
): Promise<AdminUserEntry> {
  const { data } = await api.put<AdminUserEntry>(`/users/${id}`, input);
  return data;
}

export async function deleteUser(id: string): Promise<void> {
  await api.delete(`/users/${id}`);
}
