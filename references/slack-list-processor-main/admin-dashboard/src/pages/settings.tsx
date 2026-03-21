import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import { Lock, Pencil, Check, X } from 'lucide-react';
import { queryKeys } from '@/lib/query-keys';
import { fetchRetention, updateRetention } from '@/services/retention';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';
import type { RetentionConfig } from '@/types/api';

export default function SettingsPage() {
  const [editingType, setEditingType] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: queryKeys.retention.list(),
    queryFn: fetchRetention,
  });

  const updateMut = useMutation({
    mutationFn: ({ dataType, days }: { dataType: string; days: number }) => updateRetention(dataType, days),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['retention'] });
      setEditingType(null);
    },
  });

  const startEdit = (config: RetentionConfig) => {
    setEditingType(config.data_type);
    setEditValue(String(config.retention_days));
  };

  const saveEdit = () => {
    if (!editingType) return;
    const days = Number(editValue);
    if (isNaN(days) || days < 30) return;
    updateMut.mutate({ dataType: editingType, days });
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <h2 className="text-2xl font-bold">Settings</h2>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Data Retention</CardTitle>
          <CardDescription>
            Configure how long each data type is retained. Locked types cannot be modified (permanent retention).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {listQuery.isLoading ? (
            <PageSkeleton />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Data Type</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Retention (days)</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Last Purged</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(listQuery.data?.configs ?? []).map((c: RetentionConfig) => (
                    <tr key={c.data_type} className="border-b">
                      <td className="px-4 py-3 font-medium">{c.data_type}</td>
                      <td className="px-4 py-3 text-right">
                        {editingType === c.data_type ? (
                          <Input
                            type="number"
                            min={30}
                            className="ml-auto w-24"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            autoFocus
                          />
                        ) : (
                          c.retention_days === 0 ? 'Permanent' : c.retention_days
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {c.locked ? (
                          <Tooltip>
                            <TooltipTrigger>
                              <Badge variant="secondary" className="gap-1">
                                <Lock className="h-3 w-3" />
                                Locked
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>This data type has permanent retention</TooltipContent>
                          </Tooltip>
                        ) : (
                          <Badge variant="outline">Configurable</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {c.last_purged_at
                          ? format(parseISO(c.last_purged_at), 'MMM d, yyyy HH:mm')
                          : 'Never'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {c.locked ? null : editingType === c.data_type ? (
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={saveEdit}
                              disabled={updateMut.isPending || isNaN(Number(editValue)) || Number(editValue) < 30}
                            >
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => setEditingType(null)}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <Button variant="ghost" size="icon" onClick={() => startEdit(c)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-4 text-xs text-muted-foreground">
            Minimum retention period is 30 days. Set to 0 for permanent retention.
          </p>
        </CardContent>
      </Card>
    </motion.div>
  );
}
