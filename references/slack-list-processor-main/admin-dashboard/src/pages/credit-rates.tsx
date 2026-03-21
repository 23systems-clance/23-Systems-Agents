import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Save, Eye } from 'lucide-react';
import { queryKeys } from '@/lib/query-keys';
import { fetchCreditRates, updateCreditRates, previewCreditRates } from '@/services/billing';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';

export default function CreditRatesPage() {
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useQuery({
    queryKey: queryKeys.creditRates.active(),
    queryFn: fetchCreditRates,
  });

  const [form, setForm] = useState({
    builtWithCtuLookupCost: 10,
    builtWithDomainLookupCost: 5,
    apolloPeopleSearchCost: 3,
    apolloBulkEnrichCost: 2,
    markupPercent: 25,
  });
  const [formLoaded, setFormLoaded] = useState(false);
  const [previewData, setPreviewData] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    if (config && !formLoaded) {
      setForm({
        builtWithCtuLookupCost: config.builtWithCtuLookupCost,
        builtWithDomainLookupCost: config.builtWithDomainLookupCost,
        apolloPeopleSearchCost: config.apolloPeopleSearchCost,
        apolloBulkEnrichCost: config.apolloBulkEnrichCost,
        markupPercent: config.markupPercent,
      });
      setFormLoaded(true);
    }
  }, [config, formLoaded]);

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, number>) => updateCreditRates(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['creditRates'] });
      setPreviewData(null);
    },
  });

  const handlePreview = async () => {
    const params: Record<string, string> = {};
    for (const [key, val] of Object.entries(form)) {
      params[key] = String(val);
    }
    const result = await previewCreditRates(params);
    setPreviewData(result.preview);
  };

  if (isLoading || !config) return <PageSkeleton />;

  const labels: Record<string, string> = {
    builtWithCtuLookup: 'BuiltWith CTU Lookup',
    builtWithDomainLookup: 'BuiltWith Domain Lookup',
    apolloPeopleSearch: 'Apollo People Search',
    apolloBulkEnrich: 'Apollo Bulk Enrich',
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">Credit Rate Configuration</h2>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Base Costs Form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Base Costs (credits per operation)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>BuiltWith CTU Lookup</Label>
              <Input
                type="number"
                value={form.builtWithCtuLookupCost}
                onChange={(e) => setForm({ ...form, builtWithCtuLookupCost: parseInt(e.target.value) || 0 })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>BuiltWith Domain Lookup</Label>
              <Input
                type="number"
                value={form.builtWithDomainLookupCost}
                onChange={(e) => setForm({ ...form, builtWithDomainLookupCost: parseInt(e.target.value) || 0 })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Apollo People Search</Label>
              <Input
                type="number"
                value={form.apolloPeopleSearchCost}
                onChange={(e) => setForm({ ...form, apolloPeopleSearchCost: parseInt(e.target.value) || 0 })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Apollo Bulk Enrich</Label>
              <Input
                type="number"
                value={form.apolloBulkEnrichCost}
                onChange={(e) => setForm({ ...form, apolloBulkEnrichCost: parseInt(e.target.value) || 0 })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Markup Percent</Label>
              <Input
                type="number"
                value={form.markupPercent}
                onChange={(e) => setForm({ ...form, markupPercent: parseInt(e.target.value) || 0 })}
              />
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={handlePreview} className="flex-1">
                <Eye className="mr-1.5 h-4 w-4" />
                Preview
              </Button>
              <Button
                onClick={() => saveMutation.mutate(form)}
                disabled={saveMutation.isPending}
                className="flex-1"
              >
                <Save className="mr-1.5 h-4 w-4" />
                {saveMutation.isPending ? 'Saving...' : 'Save Rates'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Effective Costs Display */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Effective Costs (after markup)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {Object.entries(labels).map(([key, label]) => {
                const current = config.effectiveCosts[key as keyof typeof config.effectiveCosts];
                const preview = previewData?.[key];
                const changed = preview !== undefined && preview !== current;

                return (
                  <div key={key} className="flex items-center justify-between rounded-lg border p-3">
                    <span className="text-sm font-medium">{label}</span>
                    <div className="flex items-center gap-2">
                      <span className={`font-mono text-lg ${changed ? 'text-muted-foreground line-through' : 'font-bold'}`}>
                        {current}
                      </span>
                      {changed && (
                        <span className="font-mono text-lg font-bold text-blue-600">
                          {preview}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">credits</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <p className="mt-4 text-xs text-muted-foreground">
              Formula: ceil(baseCost * (1 + markupPercent / 100))
            </p>
            <p className="text-xs text-muted-foreground">
              Changes take effect for new enrichment jobs immediately. In-progress jobs use their snapshotted rates.
            </p>
          </CardContent>
        </Card>
      </div>
    </motion.div>
  );
}
