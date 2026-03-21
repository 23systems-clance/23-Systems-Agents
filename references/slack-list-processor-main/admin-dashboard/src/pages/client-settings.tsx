/**
 * Client Settings page (T063).
 *
 * Workspace settings: default enrichment type, notification preferences,
 * and read-only enabled features list.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Save } from 'lucide-react';
import { useState, useEffect } from 'react';
import { getClientSettings, updateClientSettings } from '@/services/client-api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';

export default function ClientSettingsPage() {
  const queryClient = useQueryClient();
  const [enrichmentType, setEnrichmentType] = useState<string>('');
  const [notifications, setNotifications] = useState({
    jobComplete: true,
    lowBalance: true,
    weeklyReport: false,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['client-settings'],
    queryFn: getClientSettings,
  });

  useEffect(() => {
    if (data) {
      setEnrichmentType(data.defaultEnrichmentType ?? '');
      setNotifications(data.notificationPreferences);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      updateClientSettings({
        defaultEnrichmentType: enrichmentType || undefined,
        notificationPreferences: notifications,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-settings'] });
    },
  });

  if (isLoading || !data) return <PageSkeleton />;

  const toggleNotification = (key: keyof typeof notifications) => {
    setNotifications((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          <Save className="h-4 w-4 mr-2" />
          {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>

      {/* Default Enrichment Type */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Default Enrichment Type</CardTitle>
          <CardDescription>Set the default type for new enrichment jobs</CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={enrichmentType} onValueChange={setEnrichmentType}>
            <SelectTrigger className="w-[300px]">
              <SelectValue placeholder="Select default type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TECHNOGRAPHIC">Technographic</SelectItem>
              <SelectItem value="CONTACT">Contact</SelectItem>
              <SelectItem value="COMBINED">Combined</SelectItem>
              <SelectItem value="TECH_REPORT">Tech Report</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Notification Preferences */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Notification Preferences</CardTitle>
          <CardDescription>Choose which notifications you want to receive</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            { key: 'jobComplete' as const, label: 'Job Complete', desc: 'Get notified when enrichment jobs finish' },
            { key: 'lowBalance' as const, label: 'Low Balance', desc: 'Alert when credit balance is running low' },
            { key: 'weeklyReport' as const, label: 'Weekly Report', desc: 'Receive a weekly usage summary' },
          ].map((pref) => (
            <div key={pref.key} className="flex items-center justify-between py-2">
              <div>
                <Label className="font-medium">{pref.label}</Label>
                <p className="text-sm text-muted-foreground">{pref.desc}</p>
              </div>
              <Button
                variant={notifications[pref.key] ? 'default' : 'outline'}
                size="sm"
                onClick={() => toggleNotification(pref.key)}
              >
                {notifications[pref.key] ? 'On' : 'Off'}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Enabled Features (read-only) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Enabled Features</CardTitle>
          <CardDescription>Features enabled for your workspace (managed by platform owner)</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {data.enabledFeatures.length > 0 ? (
            data.enabledFeatures.map((feature) => (
              <Badge key={feature} variant="secondary" className="capitalize">
                {feature.replace(/([A-Z])/g, ' $1').trim()}
              </Badge>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No features enabled</p>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
