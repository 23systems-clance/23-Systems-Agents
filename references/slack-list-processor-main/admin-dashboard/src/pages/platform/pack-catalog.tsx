/**
 * Pack Catalog page (T050 - Feature 39).
 *
 * Client-facing catalog showing published packs with name, description,
 * skills included, pricing, and "Subscribe" button.
 * Shows active subscriptions with credit usage bars.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Package, Check, X } from 'lucide-react';
import {
  browsePackCatalog,
  listPackSubscriptions,
  subscribeToPack,
  cancelPackSubscription,
  type CatalogPack,
  type PackSubscription,
} from '@/services/client-api';
import { CreditUsageChart } from '@/components/platform/CreditUsageChart';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';

const TIER_COLORS: Record<string, string> = {
  FREE: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
  STARTER: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  GROWTH: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
  AGENCY: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
};

export default function PackCatalogPage() {
  const queryClient = useQueryClient();

  const { data: catalog, isLoading: loadingCatalog } = useQuery({
    queryKey: ['pack-catalog'],
    queryFn: browsePackCatalog,
  });

  const { data: subscriptions, isLoading: loadingSubs } = useQuery({
    queryKey: ['pack-subscriptions'],
    queryFn: listPackSubscriptions,
  });

  const subscribeMutation = useMutation({
    mutationFn: subscribeToPack,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pack-catalog'] });
      queryClient.invalidateQueries({ queryKey: ['pack-subscriptions'] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: cancelPackSubscription,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pack-catalog'] });
      queryClient.invalidateQueries({ queryKey: ['pack-subscriptions'] });
    },
  });

  if (loadingCatalog || loadingSubs) return <PageSkeleton />;

  const packs = catalog ?? [];
  const activeSubs = subscriptions ?? [];

  return (
    <div className="space-y-8">
      {/* Active Subscriptions */}
      {activeSubs.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-bold">Your Subscriptions</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeSubs.map((sub: PackSubscription) => (
              <div key={sub.id} className="space-y-3">
                <CreditUsageChart
                  creditsUsed={sub.creditsUsed}
                  creditsIncluded={sub.creditsIncluded}
                  label={sub.pack.name}
                />
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs text-muted-foreground">
                    Period ends {new Date(sub.currentPeriodEnd).toLocaleDateString()}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    onClick={() => cancelMutation.mutate(sub.id)}
                    disabled={cancelMutation.isPending}
                  >
                    <X className="mr-1 h-3 w-3" />
                    Cancel
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pack Catalog */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Package className="h-6 w-6 text-muted-foreground" />
          <div>
            <h2 className="text-xl font-bold">Pack Catalog</h2>
            <p className="text-sm text-muted-foreground">
              Browse available vertical packs and subscribe to unlock skills.
            </p>
          </div>
        </div>

        {packs.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No packs available yet. Check back soon.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {packs.map((pack: CatalogPack) => (
              <Card key={pack.id} className="flex flex-col">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-lg">{pack.name}</CardTitle>
                    <Badge variant="outline" className={TIER_COLORS[pack.tier] ?? ''}>
                      {pack.tier}
                    </Badge>
                  </div>
                  {pack.description && (
                    <p className="text-sm text-muted-foreground">{pack.description}</p>
                  )}
                </CardHeader>
                <CardContent className="flex-1 space-y-4">
                  {/* Pricing */}
                  <div className="text-center py-2">
                    {pack.monthlyPriceUsd > 0 ? (
                      <div>
                        <span className="text-3xl font-bold">${pack.monthlyPriceUsd}</span>
                        <span className="text-muted-foreground">/mo</span>
                      </div>
                    ) : (
                      <span className="text-3xl font-bold text-green-600">Free</span>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      {pack.creditsIncluded.toLocaleString()} credits included
                    </p>
                  </div>

                  {/* Skills */}
                  {pack.skills.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground uppercase">Skills Included</p>
                      <ul className="space-y-1">
                        {pack.skills.map((skill, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <Check className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                            <span>{skill.name}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Subscribe / Status */}
                  <div className="pt-2">
                    {pack.isSubscribed ? (
                      <Button variant="outline" className="w-full" disabled>
                        <Check className="mr-2 h-4 w-4" />
                        Subscribed
                      </Button>
                    ) : (
                      <Button
                        className="w-full"
                        onClick={() => subscribeMutation.mutate(pack.id)}
                        disabled={subscribeMutation.isPending}
                      >
                        Subscribe
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
