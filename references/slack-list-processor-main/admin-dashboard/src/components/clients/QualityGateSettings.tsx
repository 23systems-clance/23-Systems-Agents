/**
 * Quality gate configuration panel for a managed client.
 *
 * Renders toggle switches for filter flags, editable domain lists
 * (suppression, personal overrides, allow), effective personal domain
 * display, and a reset-to-defaults action.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, RotateCcw, Plus, X, ChevronDown, ChevronUp } from 'lucide-react';
import { queryKeys } from '@/lib/query-keys';
import {
  getConfig,
  updateConfig,
  resetConfig,
  type QualityGateConfigInput,
} from '@/services/qualityGateConfig';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// ---------------------------------------------------------------------------
// Domain list validation
// ---------------------------------------------------------------------------

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function isValidDomain(domain: string): boolean {
  const d = domain.toLowerCase().trim();
  return d.length > 0 && d.includes('.') && !d.includes('://') && !d.includes('/') && DOMAIN_RE.test(d);
}

// ---------------------------------------------------------------------------
// DomainListEditor sub-component
// ---------------------------------------------------------------------------

interface DomainListEditorProps {
  label: string;
  description: string;
  domains: string[];
  maxCount: number;
  onChange: (domains: string[]) => void;
  disabled?: boolean;
}

function DomainListEditor({ label, description, domains, maxCount, onChange, disabled }: DomainListEditorProps) {
  const [newDomain, setNewDomain] = useState('');
  const [error, setError] = useState('');

  function handleAdd() {
    const d = newDomain.toLowerCase().trim();
    if (!d) return;
    if (!isValidDomain(d)) {
      setError('Invalid domain format (e.g. example.com)');
      return;
    }
    if (domains.includes(d)) {
      setError('Domain already in list');
      return;
    }
    if (domains.length >= maxCount) {
      setError(`Maximum ${maxCount} domains allowed`);
      return;
    }
    onChange([...domains, d]);
    setNewDomain('');
    setError('');
  }

  function handleRemove(domain: string) {
    onChange(domains.filter((d) => d !== domain));
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  }

  return (
    <div className="space-y-2">
      <div>
        <Label className="text-sm font-medium">{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="flex gap-2">
        <Input
          value={newDomain}
          onChange={(e) => { setNewDomain(e.target.value); setError(''); }}
          onKeyDown={handleKeyDown}
          placeholder="example.com"
          className="flex-1"
          disabled={disabled}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleAdd}
          disabled={disabled || !newDomain.trim()}
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {domains.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {domains.map((d) => (
            <Badge key={d} variant="secondary" className="gap-1 pr-1 text-xs">
              {d}
              <button
                type="button"
                onClick={() => handleRemove(d)}
                className="ml-0.5 rounded-sm hover:bg-muted-foreground/20"
                disabled={disabled}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {domains.length}/{maxCount} domains
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface QualityGateSettingsProps {
  clientId: string;
}

export function QualityGateSettings({ clientId }: QualityGateSettingsProps) {
  const queryClient = useQueryClient();
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showEffective, setShowEffective] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<QualityGateConfigInput | null>(null);

  // Fetch config for this client
  const configQuery = useQuery({
    queryKey: queryKeys.qualityGateConfig.detail(clientId),
    queryFn: () => getConfig(clientId),
    enabled: !!clientId,
  });

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: (input: QualityGateConfigInput) => updateConfig(clientId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.qualityGateConfig.detail(clientId) });
      setPendingChanges(null);
    },
  });

  // Reset mutation
  const resetMutation = useMutation({
    mutationFn: () => resetConfig(clientId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.qualityGateConfig.detail(clientId) });
      setPendingChanges(null);
      setShowResetConfirm(false);
    },
    onError: () => {
      setShowResetConfirm(false);
    },
  });

  // Merge config with pending changes for display
  const config = configQuery.data;
  const effective = pendingChanges
    ? { ...config?.config, ...pendingChanges }
    : config?.config;

  /** Apply a partial change — accumulates in pendingChanges. */
  function applyChange(partial: QualityGateConfigInput) {
    setPendingChanges((prev) => ({ ...prev, ...partial }));
  }

  function handleSave() {
    if (!pendingChanges) return;
    saveMutation.mutate(pendingChanges);
  }

  function handleDiscard() {
    setPendingChanges(null);
  }

  if (configQuery.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4" /> Quality Gate
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading configuration...</p>
        </CardContent>
      </Card>
    );
  }

  if (configQuery.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4" /> Quality Gate
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">Failed to load quality gate configuration.</p>
        </CardContent>
      </Card>
    );
  }

  if (!config || !effective) return null;

  const hasPending = pendingChanges !== null;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-4 w-4" /> Quality Gate
            </CardTitle>
            <div className="flex items-center gap-2">
              {config.isCustom && (
                <Badge variant="outline" className="text-xs">Custom</Badge>
              )}
              {!config.isCustom && (
                <Badge variant="secondary" className="text-xs">Defaults</Badge>
              )}
              {config.isCustom && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={() => setShowResetConfirm(true)}
                  disabled={resetMutation.isPending}
                >
                  <RotateCcw className="mr-1 h-3 w-3" /> Reset
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Filter Toggles */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium">Filter Rules</h4>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm">Reject personal emails</Label>
                  <p className="text-xs text-muted-foreground">
                    Filter rows with personal email domains (gmail, yahoo, etc.)
                  </p>
                </div>
                <Switch
                  checked={effective.rejectPersonalEmails}
                  onCheckedChange={(val) => applyChange({ rejectPersonalEmails: val })}
                  disabled={saveMutation.isPending}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm">Reject missing company</Label>
                  <p className="text-xs text-muted-foreground">
                    Filter rows with no company name and no domain
                  </p>
                </div>
                <Switch
                  checked={effective.rejectMissingCompany}
                  onCheckedChange={(val) => applyChange({ rejectMissingCompany: val })}
                  disabled={saveMutation.isPending}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm">Reject duplicate emails</Label>
                  <p className="text-xs text-muted-foreground">
                    Keep first occurrence of duplicate email addresses
                  </p>
                </div>
                <Switch
                  checked={effective.rejectDuplicateEmails}
                  onCheckedChange={(val) => applyChange({ rejectDuplicateEmails: val })}
                  disabled={saveMutation.isPending}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm">Deduplicate domains</Label>
                  <p className="text-xs text-muted-foreground">
                    Group duplicate domains to avoid redundant technographic lookups
                  </p>
                </div>
                <Switch
                  checked={effective.deduplicateDomains}
                  onCheckedChange={(val) => applyChange({ deduplicateDomains: val })}
                  disabled={saveMutation.isPending}
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* Suppression Domains */}
          <DomainListEditor
            label="Suppression Domains"
            description="Rows matching these domains will be filtered out (e.g., competitors)"
            domains={effective.suppressionDomains ?? []}
            maxCount={500}
            onChange={(domains) => applyChange({ suppressionDomains: domains })}
            disabled={saveMutation.isPending}
          />

          <Separator />

          {/* Personal Domain Overrides */}
          <DomainListEditor
            label="Personal Domain Overrides"
            description="Additional domains to treat as personal email (added to default list)"
            domains={effective.personalDomainOverrides ?? []}
            maxCount={100}
            onChange={(domains) => applyChange({ personalDomainOverrides: domains })}
            disabled={saveMutation.isPending}
          />

          {/* Allow Personal Domains */}
          <DomainListEditor
            label="Allow Personal Domains"
            description="Domains to remove from the personal email list (exceptions)"
            domains={effective.allowPersonalDomains ?? []}
            maxCount={50}
            onChange={(domains) => applyChange({ allowPersonalDomains: domains })}
            disabled={saveMutation.isPending}
          />

          <Separator />

          {/* Effective Personal Domains (collapsible) */}
          <div>
            <button
              type="button"
              className="flex w-full items-center justify-between text-sm font-medium"
              onClick={() => setShowEffective(!showEffective)}
            >
              <span>
                Effective Personal Domains
                <span className="ml-2 text-xs text-muted-foreground">
                  ({config.effectivePersonalDomains.length} domains)
                </span>
              </span>
              {showEffective
                ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
                : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </button>
            {showEffective && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {config.effectivePersonalDomains.map((d) => (
                  <Badge key={d} variant="outline" className="text-xs">
                    {d}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Save / Discard bar */}
          {hasPending && (
            <>
              <Separator />
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">You have unsaved changes</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleDiscard}
                    disabled={saveMutation.isPending}
                  >
                    Discard
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={saveMutation.isPending}
                  >
                    {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </div>
            </>
          )}

          {saveMutation.isError && (
            <p className="text-sm text-destructive">
              {(saveMutation.error as any)?.response?.data?.error || 'Failed to save configuration'}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Reset Confirmation Dialog */}
      <AlertDialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset Quality Gate Config</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the custom configuration and revert to global defaults.
              All custom suppression domains and personal domain overrides will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => resetMutation.mutate()}
              disabled={resetMutation.isPending}
            >
              {resetMutation.isPending ? 'Resetting...' : 'Reset to Defaults'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
