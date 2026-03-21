/**
 * Client Overview page (T059).
 *
 * Shows workspace credit balance, usage stats, and enabled features.
 */

import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { CreditCard, FileSpreadsheet, Rows3, Zap } from 'lucide-react';
import { getClientOverview } from '@/services/client-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';

export default function ClientOverviewPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['client-overview'],
    queryFn: getClientOverview,
  });

  if (isLoading || !data) return <PageSkeleton />;

  const stats = [
    { label: 'Credit Balance', value: data.creditBalance.toLocaleString(), icon: CreditCard, color: data.creditBalance <= 0 ? 'text-red-600' : 'text-green-600' },
    { label: 'Credits Used This Month', value: data.creditsUsedThisMonth.toLocaleString(), icon: Zap, color: 'text-blue-600' },
    { label: 'Jobs This Month', value: data.enrichmentJobsThisMonth.toLocaleString(), icon: FileSpreadsheet, color: 'text-purple-600' },
    { label: 'Rows Enriched', value: data.totalRowsEnrichedThisMonth.toLocaleString(), icon: Rows3, color: 'text-orange-600' },
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{data.workspaceName}</h2>
        <p className="text-muted-foreground capitalize">{data.subscriptionTier} plan</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{stat.label}</CardTitle>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {data.monthlyAllowance > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Monthly Allowance Usage</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className="flex-1 bg-muted rounded-full h-3 overflow-hidden">
                <div
                  className="bg-primary h-full rounded-full transition-all"
                  style={{ width: `${Math.min(100, (data.creditsUsedThisMonth / data.monthlyAllowance) * 100)}%` }}
                />
              </div>
              <span className="text-sm text-muted-foreground whitespace-nowrap">
                {data.creditsUsedThisMonth} / {data.monthlyAllowance}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {data.enabledFeatures.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Enabled Features</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {data.enabledFeatures.map((feature) => (
              <Badge key={feature} variant="secondary" className="capitalize">
                {feature.replace(/([A-Z])/g, ' $1').trim()}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}
    </motion.div>
  );
}
