/**
 * Variable overrides management page (Feature 19 — T037).
 *
 * Two sections:
 * 1. Global Variables — table of all template variables with inline editing.
 * 2. Workspace Overrides — per-workspace variable value overrides.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import {
  fetchVariables,
  createVariable,
  updateVariable,
  fetchOverrides,
  setOverride,
  deleteOverride,
  type PromptVariableWithCount,
  type WorkspaceOverride,
} from '@/services/prompts';
import { fetchClients } from '@/services/clients';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export default function PromptVariablesPage() {
  const queryClient = useQueryClient();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newDefaultValue, setNewDefaultValue] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState('');
  const [editDefaultValue, setEditDefaultValue] = useState('');

  // Workspace overrides state
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>('');
  const [overrideEditId, setOverrideEditId] = useState<string | null>(null);
  const [overrideValue, setOverrideValue] = useState('');
  const [addOverrideVarId, setAddOverrideVarId] = useState('');
  const [addOverrideValue, setAddOverrideValue] = useState('');

  // Queries
  const { data: variablesData, isLoading: variablesLoading } = useQuery({
    queryKey: queryKeys.prompts.variables(),
    queryFn: fetchVariables,
  });

  const { data: workspacesData } = useQuery({
    queryKey: queryKeys.workspaces.list(),
    queryFn: () => fetchClients(),
  });

  const { data: overridesData } = useQuery({
    queryKey: queryKeys.prompts.overrides(selectedWorkspace || undefined),
    queryFn: () => fetchOverrides(selectedWorkspace || undefined),
    enabled: !!selectedWorkspace,
  });

  const variables = variablesData?.variables ?? [];
  const workspaces = workspacesData?.clients ?? [];
  const overrides = overridesData?.overrides ?? [];

  // Mutations
  const createMutation = useMutation({
    mutationFn: () =>
      createVariable({
        name: newName,
        description: newDescription || undefined,
        defaultValue: newDefaultValue || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.prompts.variables() });
      setAddDialogOpen(false);
      setNewName('');
      setNewDescription('');
      setNewDefaultValue('');
    },
  });

  const updateMutation = useMutation({
    mutationFn: (variableId: string) =>
      updateVariable(variableId, {
        description: editDescription,
        defaultValue: editDefaultValue,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.prompts.variables() });
      setEditingId(null);
    },
  });

  const setOverrideMutation = useMutation({
    mutationFn: (input: { variableId: string; value: string }) =>
      setOverride({
        workspaceId: selectedWorkspace,
        variableId: input.variableId,
        overrideValue: input.value,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.prompts.overrides(selectedWorkspace),
      });
      setOverrideEditId(null);
      setAddOverrideVarId('');
      setAddOverrideValue('');
    },
  });

  const deleteOverrideMutation = useMutation({
    mutationFn: (variableId: string) =>
      deleteOverride(selectedWorkspace, variableId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.prompts.overrides(selectedWorkspace),
      });
    },
  });

  if (variablesLoading) return <div className="p-8">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/prompts" className="text-sm text-muted-foreground hover:underline">
          Prompt Library
        </Link>
        <span className="text-muted-foreground">/</span>
        <h1 className="text-2xl font-bold">Template Variables</h1>
      </div>

      {/* Section 1: Global Variables */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Global Variables</CardTitle>
          <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">Add Variable</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Template Variable</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Name</Label>
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="variableName"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Letters, digits, and underscores only. Start with a letter.
                  </p>
                </div>
                <div>
                  <Label>Description</Label>
                  <Input
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    placeholder="Optional description"
                  />
                </div>
                <div>
                  <Label>Default Value</Label>
                  <Input
                    value={newDefaultValue}
                    onChange={(e) => setNewDefaultValue(e.target.value)}
                    placeholder="Optional default value"
                  />
                </div>
                <Button
                  onClick={() => createMutation.mutate()}
                  disabled={!newName || createMutation.isPending}
                >
                  {createMutation.isPending ? 'Creating...' : 'Create'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {variables.length === 0 ? (
            <p className="text-muted-foreground">No template variables defined.</p>
          ) : (
            <div className="space-y-2">
              {variables.map((v: PromptVariableWithCount) => (
                <div
                  key={v.id}
                  className="flex items-center justify-between rounded border p-3"
                >
                  {editingId === v.id ? (
                    <div className="flex flex-1 items-center gap-2">
                      <span className="font-mono font-medium">{`{{${v.name}}}`}</span>
                      <Input
                        className="max-w-[200px]"
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        placeholder="Description"
                      />
                      <Input
                        className="max-w-[200px]"
                        value={editDefaultValue}
                        onChange={(e) => setEditDefaultValue(e.target.value)}
                        placeholder="Default value"
                      />
                      <Button
                        size="sm"
                        onClick={() => updateMutation.mutate(v.id)}
                        disabled={updateMutation.isPending}
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-medium">{`{{${v.name}}}`}</span>
                        {v.description && (
                          <span className="text-sm text-muted-foreground">
                            {v.description}
                          </span>
                        )}
                        <Badge variant="outline">
                          {v.promptCount} prompt{v.promptCount !== 1 ? 's' : ''}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3">
                        {v.defaultValue && (
                          <span className="text-sm font-mono text-muted-foreground">
                            = {v.defaultValue.length > 30
                              ? v.defaultValue.slice(0, 30) + '...'
                              : v.defaultValue}
                          </span>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingId(v.id);
                            setEditDescription(v.description ?? '');
                            setEditDefaultValue(v.defaultValue ?? '');
                          }}
                        >
                          Edit
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 2: Workspace Overrides */}
      <Card>
        <CardHeader>
          <CardTitle>Workspace Overrides</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-[300px]">
            <Label>Select Workspace</Label>
            <Select value={selectedWorkspace} onValueChange={setSelectedWorkspace}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a workspace" />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((ws: { slack_team_id: string; slack_team_name: string }) => (
                  <SelectItem key={ws.slack_team_id} value={ws.slack_team_id}>
                    {ws.slack_team_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedWorkspace && (
            <>
              {overrides.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No overrides for this workspace.
                </p>
              ) : (
                <div className="space-y-2">
                  {overrides.map((o: WorkspaceOverride) => (
                    <div
                      key={o.id}
                      className="flex items-center justify-between rounded border p-3"
                    >
                      {overrideEditId === o.id ? (
                        <div className="flex flex-1 items-center gap-2">
                          <span className="font-mono font-medium">
                            {`{{${o.variableName}}}`}
                          </span>
                          <Input
                            className="flex-1"
                            value={overrideValue}
                            onChange={(e) => setOverrideValue(e.target.value)}
                          />
                          <Button
                            size="sm"
                            onClick={() =>
                              setOverrideMutation.mutate({
                                variableId: o.variableId,
                                value: overrideValue,
                              })
                            }
                            disabled={setOverrideMutation.isPending}
                          >
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setOverrideEditId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-3">
                            <span className="font-mono font-medium">
                              {`{{${o.variableName}}}`}
                            </span>
                            <span className="text-sm font-mono">
                              = {o.overrideValue.length > 50
                                ? o.overrideValue.slice(0, 50) + '...'
                                : o.overrideValue}
                            </span>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setOverrideEditId(o.id);
                                setOverrideValue(o.overrideValue);
                              }}
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() =>
                                deleteOverrideMutation.mutate(o.variableId)
                              }
                              disabled={deleteOverrideMutation.isPending}
                            >
                              Remove
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Add override */}
              {variables.length > 0 && (
                <div className="flex items-end gap-2 pt-2 border-t">
                  <div className="space-y-1">
                    <Label>Variable</Label>
                    <Select
                      value={addOverrideVarId}
                      onValueChange={setAddOverrideVarId}
                    >
                      <SelectTrigger className="w-[200px]">
                        <SelectValue placeholder="Select variable" />
                      </SelectTrigger>
                      <SelectContent>
                        {variables.map((v: PromptVariableWithCount) => (
                          <SelectItem key={v.id} value={v.id}>
                            {v.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex-1 space-y-1">
                    <Label>Override Value</Label>
                    <Input
                      value={addOverrideValue}
                      onChange={(e) => setAddOverrideValue(e.target.value)}
                      placeholder="Override value for this workspace"
                    />
                  </div>
                  <Button
                    onClick={() =>
                      setOverrideMutation.mutate({
                        variableId: addOverrideVarId,
                        value: addOverrideValue,
                      })
                    }
                    disabled={
                      !addOverrideVarId ||
                      !addOverrideValue ||
                      setOverrideMutation.isPending
                    }
                  >
                    Add Override
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
