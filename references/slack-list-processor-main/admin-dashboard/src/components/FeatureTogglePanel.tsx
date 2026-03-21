/**
 * FeatureTogglePanel component (T047).
 *
 * 9 toggle switches for per-workspace feature flags with save functionality.
 * Platform owner workspaces show all toggles locked-on.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, Save, Loader2 } from 'lucide-react';
import { updateWorkspaceFeatures } from '@/services/workspace-management-api';
import type { FeatureFlags } from '@/services/licensing-api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

const FLAG_LABELS: Record<keyof FeatureFlags, { label: string; description: string }> = {
  enrichment: { label: 'Enrichment', description: 'Company & contact list enrichment via BuiltWith + Apollo' },
  campaigns: { label: 'Campaigns', description: 'Multi-step outreach campaign management' },
  workflows: { label: 'Workflows', description: 'Visual workflow builder and automation' },
  onboarding: { label: 'Onboarding', description: 'BDR onboarding plans and tracking' },
  dialer: { label: 'Power Dialer', description: 'In-browser calling with recording and coaching' },
  analytics: { label: 'Analytics', description: 'Usage analytics and reporting dashboard' },
  icpAnalysis: { label: 'ICP Analysis', description: 'ICP document processing and analysis reports' },
  personalityAnalysis: { label: 'Personality Analysis', description: 'AIARC personality profiling for contacts' },
  aiAgent: { label: 'AI Agent', description: 'Conversational AI assistant in Slack' },
};

interface FeatureTogglePanelProps {
  slackTeamId: string;
  featureFlags: FeatureFlags;
  isPlatformOwner: boolean;
}

export function FeatureTogglePanel({
  slackTeamId,
  featureFlags,
  isPlatformOwner,
}: FeatureTogglePanelProps) {
  const queryClient = useQueryClient();
  const [localFlags, setLocalFlags] = useState<FeatureFlags>(featureFlags);
  const [hasChanges, setHasChanges] = useState(false);

  const saveMutation = useMutation({
    mutationFn: () => updateWorkspaceFeatures(slackTeamId, localFlags),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      setHasChanges(false);
    },
  });

  const handleToggle = (flag: keyof FeatureFlags, checked: boolean) => {
    const updated = { ...localFlags, [flag]: checked };
    setLocalFlags(updated);
    setHasChanges(true);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Shield className="h-4 w-4" />
          Feature Toggles
          {isPlatformOwner && (
            <span className="text-xs bg-purple-500/10 text-purple-600 px-2 py-0.5 rounded-full">
              Platform Owner
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {(Object.keys(FLAG_LABELS) as Array<keyof FeatureFlags>).map((flag) => (
          <div key={flag} className="flex items-center justify-between py-1">
            <div>
              <Label className="text-sm font-medium">{FLAG_LABELS[flag].label}</Label>
              <p className="text-xs text-muted-foreground">{FLAG_LABELS[flag].description}</p>
            </div>
            <Switch
              checked={isPlatformOwner ? true : localFlags[flag]}
              onCheckedChange={(checked) => handleToggle(flag, checked)}
              disabled={isPlatformOwner}
            />
          </div>
        ))}

        {!isPlatformOwner && (
          <div className="pt-2 border-t">
            <Button
              size="sm"
              onClick={() => saveMutation.mutate()}
              disabled={!hasChanges || saveMutation.isPending}
            >
              {saveMutation.isPending ? (
                <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Saving...</>
              ) : (
                <><Save className="mr-1.5 h-3.5 w-3.5" /> Save Changes</>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
