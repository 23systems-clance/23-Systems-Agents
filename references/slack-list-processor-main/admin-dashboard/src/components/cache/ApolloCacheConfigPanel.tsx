import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings, Trash2 } from 'lucide-react';
import { api } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface CacheConfig {
  apolloSearchTtlDays: number;
  apolloContactTtlDays: number;
  enabled: boolean;
  updatedAt: string;
}

export function ApolloCacheConfigPanel() {
  const queryClient = useQueryClient();
  const [searchTtl, setSearchTtl] = useState<number | null>(null);
  const [contactTtl, setContactTtl] = useState<number | null>(null);

  const configQuery = useQuery({
    queryKey: ['apollo-cache-config'],
    queryFn: async () => {
      const res = await api.get<CacheConfig>('/cache/apollo/config');
      return res.data;
    },
  });

  const updateConfig = useMutation({
    mutationFn: async (data: { apolloSearchTtlDays?: number; apolloContactTtlDays?: number }) => {
      const res = await api.put('/cache/apollo/config', data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apollo-cache-config'] });
      setSearchTtl(null);
      setContactTtl(null);
    },
  });

  const purgeCache = useMutation({
    mutationFn: async ({ target, mode }: { target: string; mode: string }) => {
      const res = await api.post('/cache/apollo/purge', { target, mode });
      return res.data as { purgedCount: number; target: string; mode: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apollo-cache-metrics'] });
    },
  });

  const handleSave = () => {
    const data: Record<string, number> = {};
    if (searchTtl !== null) data.apolloSearchTtlDays = searchTtl;
    if (contactTtl !== null) data.apolloContactTtlDays = contactTtl;
    if (Object.keys(data).length > 0) {
      updateConfig.mutate(data);
    }
  };

  const config = configQuery.data;
  const effectiveSearchTtl = searchTtl ?? config?.apolloSearchTtlDays ?? 14;
  const effectiveContactTtl = contactTtl ?? config?.apolloContactTtlDays ?? 30;
  const hasChanges = searchTtl !== null || contactTtl !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Settings className="h-4 w-4" />
          Apollo Cache Configuration
        </CardTitle>
        <CardDescription>
          Configure TTL (time-to-live) for Apollo search and contact caches.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* TTL Configuration */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">Search Cache TTL</label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={7}
                max={30}
                value={effectiveSearchTtl}
                onChange={(e) => setSearchTtl(parseInt(e.target.value) || 14)}
                className="w-20"
              />
              <span className="text-sm text-muted-foreground">days (7-30)</span>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Contact Cache TTL</label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={14}
                max={60}
                value={effectiveContactTtl}
                onChange={(e) => setContactTtl(parseInt(e.target.value) || 30)}
                className="w-20"
              />
              <span className="text-sm text-muted-foreground">days (14-60)</span>
            </div>
          </div>
        </div>

        {hasChanges && (
          <Button onClick={handleSave} disabled={updateConfig.isPending} size="sm">
            {updateConfig.isPending ? 'Saving...' : 'Save TTL Changes'}
          </Button>
        )}

        {/* Purge Controls */}
        <div className="border-t pt-4">
          <p className="mb-3 text-sm font-medium">Cache Purge</p>
          <div className="flex flex-wrap gap-2">
            <PurgeButton
              label="Purge Expired (Search)"
              target="search"
              mode="expired"
              onPurge={purgeCache.mutate}
              isPending={purgeCache.isPending}
            />
            <PurgeButton
              label="Purge All (Search)"
              target="search"
              mode="all"
              onPurge={purgeCache.mutate}
              isPending={purgeCache.isPending}
              destructive
            />
            <PurgeButton
              label="Purge Expired (Contact)"
              target="contact"
              mode="expired"
              onPurge={purgeCache.mutate}
              isPending={purgeCache.isPending}
            />
            <PurgeButton
              label="Purge All (Contact)"
              target="contact"
              mode="all"
              onPurge={purgeCache.mutate}
              isPending={purgeCache.isPending}
              destructive
            />
          </div>
          {purgeCache.data && (
            <p className="mt-2 text-xs text-muted-foreground">
              Purged {purgeCache.data.purgedCount} {purgeCache.data.target} entries ({purgeCache.data.mode})
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function PurgeButton({
  label,
  target,
  mode,
  onPurge,
  isPending,
  destructive = false,
}: {
  label: string;
  target: string;
  mode: string;
  onPurge: (params: { target: string; mode: string }) => void;
  isPending: boolean;
  destructive?: boolean;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant={destructive ? 'destructive' : 'outline'}
          size="sm"
          disabled={isPending}
        >
          <Trash2 className="mr-1.5 h-3 w-3" />
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirm Purge</AlertDialogTitle>
          <AlertDialogDescription>
            This will {mode === 'all' ? 'permanently delete ALL' : 'remove expired'} {target} cache entries.
            {mode === 'all' && ' This action cannot be undone.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => onPurge({ target, mode })}>
            {isPending ? 'Purging...' : 'Purge'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
