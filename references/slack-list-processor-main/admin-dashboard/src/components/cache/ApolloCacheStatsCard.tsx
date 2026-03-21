import { useQuery } from '@tanstack/react-query';
import { Database, Phone, Search, TrendingUp, DollarSign } from 'lucide-react';
import { api } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface CacheMetrics {
  searchCache: {
    totalEntries: number;
    activeEntries: number;
    expiredEntries: number;
    hitRate7d: number;
    hitRate30d: number;
    totalHits7d: number;
    totalMisses7d: number;
    totalHits30d: number;
    totalMisses30d: number;
    zeroResultEntries: number;
  };
  contactCache: {
    totalEntries: number;
    activeEntries: number;
    expiredEntries: number;
    withPhoneData: number;
    withoutPhoneData: number;
    hitRate7d: number;
    hitRate30d: number;
    totalHits7d: number;
    totalMisses7d: number;
    totalHits30d: number;
    totalMisses30d: number;
    estimatedCreditsSaved: number;
    estimatedCostSavedUsd: number;
  };
  topSearchedDomains: Array<{ domain: string; hitCount: number }>;
  topCachedContacts: Array<{ apolloPersonId: string; fullName: string; hitCount: number }>;
}

function StatRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

function HitRateBadge({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100);
  const variant = pct >= 30 ? 'default' : pct >= 15 ? 'secondary' : 'outline';
  return <Badge variant={variant}>{pct}%</Badge>;
}

export function ApolloCacheStatsCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['apollo-cache-metrics'],
    queryFn: async () => {
      const res = await api.get<CacheMetrics>('/cache/apollo/metrics');
      return res.data;
    },
    refetchInterval: 60_000,
  });

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4" />
            Apollo Cache Metrics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-4 rounded bg-muted" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const { searchCache, contactCache, topSearchedDomains, topCachedContacts } = data;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Search Cache */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Search className="h-4 w-4" />
            Search Cache
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <StatRow label="Active entries" value={searchCache.activeEntries.toLocaleString()} />
          <StatRow label="Expired entries" value={searchCache.expiredEntries.toLocaleString()} />
          <StatRow label="Zero-result entries" value={searchCache.zeroResultEntries.toLocaleString()} />
          <div className="flex items-center justify-between py-1">
            <span className="text-sm text-muted-foreground">Hit rate (7d)</span>
            <HitRateBadge rate={searchCache.hitRate7d} />
          </div>
          <div className="flex items-center justify-between py-1">
            <span className="text-sm text-muted-foreground">Hit rate (30d)</span>
            <HitRateBadge rate={searchCache.hitRate30d} />
          </div>
          <StatRow
            label="7d usage"
            value={`${searchCache.totalHits7d} hits / ${searchCache.totalMisses7d} misses`}
          />

          {topSearchedDomains.length > 0 && (
            <div className="mt-3 border-t pt-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Top Domains
              </p>
              {topSearchedDomains.slice(0, 5).map((d) => (
                <div key={d.domain} className="flex items-center justify-between py-0.5 text-xs">
                  <span className="truncate">{d.domain}</span>
                  <span className="text-muted-foreground">{d.hitCount} hits</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Contact Cache */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4" />
            Contact Cache
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <StatRow label="Active entries" value={contactCache.activeEntries.toLocaleString()} />
          <StatRow label="Expired entries" value={contactCache.expiredEntries.toLocaleString()} />
          <div className="flex items-center justify-between py-1">
            <span className="text-sm text-muted-foreground">Phone data</span>
            <span className="text-sm">
              <Phone className="mr-1 inline h-3 w-3" />
              {contactCache.withPhoneData.toLocaleString()} / {contactCache.withoutPhoneData.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center justify-between py-1">
            <span className="text-sm text-muted-foreground">Hit rate (7d)</span>
            <HitRateBadge rate={contactCache.hitRate7d} />
          </div>
          <div className="flex items-center justify-between py-1">
            <span className="text-sm text-muted-foreground">Hit rate (30d)</span>
            <HitRateBadge rate={contactCache.hitRate30d} />
          </div>
          <div className="flex items-center justify-between py-1 border-t mt-2 pt-2">
            <span className="text-sm font-medium">Credits saved</span>
            <span className="text-sm font-bold text-green-600">
              {contactCache.estimatedCreditsSaved.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center justify-between py-1">
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              <DollarSign className="h-3 w-3" /> Cost saved
            </span>
            <span className="text-sm font-bold text-green-600">
              ${contactCache.estimatedCostSavedUsd.toFixed(2)}
            </span>
          </div>

          {topCachedContacts.length > 0 && (
            <div className="mt-3 border-t pt-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Top Contacts
              </p>
              {topCachedContacts.slice(0, 5).map((c) => (
                <div key={c.apolloPersonId} className="flex items-center justify-between py-0.5 text-xs">
                  <span className="truncate">{c.fullName || c.apolloPersonId}</span>
                  <span className="text-muted-foreground">{c.hitCount} hits</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
