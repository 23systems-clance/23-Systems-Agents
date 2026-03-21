import { useQuery } from '@tanstack/react-query';
import { fetchClients } from '@/services/clients';

/**
 * Returns the first available workspace's slack_team_id.
 * Used by pages that need to filter data by workspace.
 */
export function useWorkspaceId(): { teamId: string | null; isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'workspaces'],
    queryFn: () => fetchClients(),
    staleTime: 5 * 60 * 1000, // 5 min — workspace list rarely changes
  });

  const teamId = data?.clients?.[0]?.slack_team_id ?? null;
  return { teamId, isLoading };
}
