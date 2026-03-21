/**
 * Cache Metrics admin page (Feature 17).
 *
 * Displays cache performance stats, configuration controls,
 * and a searchable/sortable table of cached domain entries.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Database, TrendingUp, DollarSign, HardDrive,
  Trash2, RefreshCw, Search,
} from 'lucide-react';
import { queryKeys } from '@/lib/query-keys';
import {
  fetchCacheMetrics,
  fetchCacheConfig,
  updateCacheConfig,
  purgeCache,
  fetchCacheEntries,
  deleteCacheEntry,
} from '@/services/cacheMetrics';
import type { CacheEntry } from '@/services/cacheMetrics';
import { StatCard } from '@/components/shared/StatCard';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
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

export default function CacheMetricsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('enrichedAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [ttlInput, setTtlInput] = useState<number | null>(null);

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------
  const metricsQuery = useQuery({
    queryKey: queryKeys.cache.metrics(),
    queryFn: fetchCacheMetrics,
  });

  const configQuery = useQuery({
    queryKey: queryKeys.cache.config(),
    queryFn: fetchCacheConfig,
  });

  const entriesParams: Record<string, string> = {
    page: String(page),
    limit: '20',
    sortBy,
    sortOrder,
    ...(search ? { search } : {}),
  };
  const entriesQuery = useQuery({
    queryKey: queryKeys.cache.entries(entriesParams),
    queryFn: () => fetchCacheEntries(entriesParams),
  });

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------
  const updateConfigMut = useMutation({
    mutationFn: updateCacheConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.cache.config() });
      setTtlInput(null);
    },
  });

  const purgeMut = useMutation({
    mutationFn: purgeCache,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.cache.metrics() });
      queryClient.invalidateQueries({ queryKey: queryKeys.cache.entries(entriesParams) });
    },
  });

  const deleteEntryMut = useMutation({
    mutationFn: deleteCacheEntry,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.cache.metrics() });
      queryClient.invalidateQueries({ queryKey: queryKeys.cache.entries(entriesParams) });
    },
  });

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------
  if (metricsQuery.isLoading || configQuery.isLoading) return <PageSkeleton />;

  const metrics = metricsQuery.data;
  const cacheConfig = configQuery.data;
  const entries = entriesQuery.data;

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  function handleSort(field: string) {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
    setPage(1);
  }

  function handleSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Cache Metrics</h2>
          <p className="text-sm text-muted-foreground">
            BuiltWith domain enrichment cache performance and configuration
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      {metrics && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Active Entries"
            value={metrics.activeEntries.toLocaleString()}
            subtitle={`${metrics.totalEntries.toLocaleString()} total (${metrics.expiredEntries.toLocaleString()} expired)`}
            icon={Database}
            accent="teal"
          />
          <StatCard
            title="Hit Rate (7d)"
            value={`${(metrics.hitRate7d * 100).toFixed(1)}%`}
            subtitle={`${metrics.totalHits7d} hits / ${metrics.totalMisses7d} misses`}
            icon={TrendingUp}
            accent="indigo"
          />
          <StatCard
            title="Credits Saved (30d)"
            value={metrics.estimatedCreditsSaved.toLocaleString()}
            subtitle={`$${metrics.estimatedCostSavedUsd.toFixed(2)} estimated savings`}
            icon={DollarSign}
            accent="amber"
          />
          <StatCard
            title="Cache Size"
            value={`${metrics.cacheSizeMb.toFixed(1)} MB`}
            subtitle={`30d hit rate: ${(metrics.hitRate30d * 100).toFixed(1)}%`}
            icon={HardDrive}
            accent="rose"
          />
        </div>
      )}

      {/* Top Domains + Config side by side */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top Domains */}
        {metrics && metrics.topDomains.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top Cached Domains</CardTitle>
              <CardDescription>Most frequently hit domains by cache lookups</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {metrics.topDomains.map((d) => (
                  <div key={d.domain} className="flex items-center justify-between text-sm">
                    <span className="font-mono text-muted-foreground">{d.domain}</span>
                    <Badge variant="secondary">{d.hitCount} hits</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Configuration */}
        {cacheConfig && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cache Configuration</CardTitle>
              <CardDescription>Manage TTL and cache state</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Enabled toggle */}
              <div className="flex items-center justify-between">
                <Label htmlFor="cache-enabled">Cache Enabled</Label>
                <Switch
                  id="cache-enabled"
                  checked={cacheConfig.enabled}
                  onCheckedChange={(checked) =>
                    updateConfigMut.mutate({ enabled: checked })
                  }
                />
              </div>

              {/* TTL */}
              <div className="space-y-2">
                <Label>TTL (days)</Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min={30}
                    max={90}
                    value={ttlInput ?? cacheConfig.ttlDays}
                    onChange={(e) => setTtlInput(parseInt(e.target.value, 10))}
                    className="w-24"
                  />
                  <Button
                    size="sm"
                    disabled={
                      !ttlInput ||
                      ttlInput === cacheConfig.ttlDays ||
                      ttlInput < 30 ||
                      ttlInput > 90 ||
                      updateConfigMut.isPending
                    }
                    onClick={() => ttlInput && updateConfigMut.mutate({ ttlDays: ttlInput })}
                  >
                    Save
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Range: 30-90 days. Current: {cacheConfig.ttlDays} days.
                </p>
              </div>

              {/* Purge buttons */}
              <div className="flex gap-2 pt-2">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm">
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                      Purge Expired
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Purge Expired Entries</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will remove all expired cache entries. Active entries will not be affected.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => purgeMut.mutate('expired')}
                      >
                        Purge Expired
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm">
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      Purge All
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Purge All Cache Entries</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete ALL cached domain data. This action cannot be undone.
                        Cache will rebuild over time as new enrichment jobs run.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={() => purgeMut.mutate('all')}
                      >
                        Purge All
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>

              {purgeMut.isSuccess && purgeMut.data && (
                <p className="text-xs text-green-600">
                  Purged {purgeMut.data.purgedCount} entries ({purgeMut.data.mode})
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Cache Entries Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Cache Entries</CardTitle>
              <CardDescription>
                {entries?.pagination.total.toLocaleString() ?? 0} cached domains
              </CardDescription>
            </div>
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search domains..."
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th
                    className="cursor-pointer p-3 text-left font-medium"
                    onClick={() => handleSort('enrichedAt')}
                  >
                    Domain {sortBy === 'enrichedAt' && (sortOrder === 'asc' ? '\u2191' : '\u2193')}
                  </th>
                  <th className="p-3 text-left font-medium">Company</th>
                  <th className="p-3 text-left font-medium">Tier</th>
                  <th className="p-3 text-center font-medium">Techs</th>
                  <th
                    className="cursor-pointer p-3 text-center font-medium"
                    onClick={() => handleSort('hitCount')}
                  >
                    Hits {sortBy === 'hitCount' && (sortOrder === 'asc' ? '\u2191' : '\u2193')}
                  </th>
                  <th
                    className="cursor-pointer p-3 text-left font-medium"
                    onClick={() => handleSort('expiresAt')}
                  >
                    Expires {sortBy === 'expiresAt' && (sortOrder === 'asc' ? '\u2191' : '\u2193')}
                  </th>
                  <th className="p-3 text-center font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries?.entries.map((entry: CacheEntry) => (
                  <tr key={entry.id} className="border-b last:border-b-0">
                    <td className="p-3 font-mono text-xs">{entry.normalizedDomain}</td>
                    <td className="p-3 text-muted-foreground">{entry.companyName ?? '-'}</td>
                    <td className="p-3">
                      {entry.techSpendTier ? (
                        <Badge variant={
                          entry.techSpendTier === 'HIGH' ? 'default' :
                          entry.techSpendTier === 'MID' ? 'secondary' : 'outline'
                        }>
                          {entry.techSpendTier}
                        </Badge>
                      ) : '-'}
                    </td>
                    <td className="p-3 text-center">{entry.technologyCount}</td>
                    <td className="p-3 text-center">{entry.hitCount}</td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {new Date(entry.expiresAt).toLocaleDateString()}
                    </td>
                    <td className="p-3 text-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteEntryMut.mutate(entry.id)}
                        disabled={deleteEntryMut.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {entries?.entries.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-muted-foreground">
                      {search ? 'No entries matching your search' : 'No cache entries yet'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {entries && entries.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-xs text-muted-foreground">
                Page {entries.pagination.page} of {entries.pagination.totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= entries.pagination.totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
