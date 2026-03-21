import { useState } from 'react';
import { Loader2, Plus, Workflow, Layers, AlertCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useTemplates, useCreateWorkflow } from '@/services/workflows';
import type { WorkflowTemplate } from '@/types/api';

interface TemplateLibraryProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Callback fired when the dialog open state changes. */
  onOpenChange: (open: boolean) => void;
  /** Callback fired after a workflow is created, with the new workflow ID. */
  onSelect: (workflowId: string) => void;
  /** Slack team ID to associate with the created workflow. */
  teamId: string;
  /** ID of the user creating the workflow. */
  userId: string;
}

/**
 * Dialog that displays available workflow templates.
 * Users can pick a template or start from scratch to create a new workflow.
 */
export function TemplateLibrary({
  open,
  onOpenChange,
  onSelect,
  teamId,
  userId,
}: TemplateLibraryProps) {
  const { data, isLoading, isError } = useTemplates();
  const createWorkflow = useCreateWorkflow();
  const [creatingId, setCreatingId] = useState<string | null>(null);

  const templates = data?.templates ?? [];

  /**
   * Creates a workflow from a template and navigates to it.
   */
  async function handleTemplateSelect(template: WorkflowTemplate) {
    if (createWorkflow.isPending) return;
    setCreatingId(template.id);
    try {
      const workflow = await createWorkflow.mutateAsync({
        name: template.name,
        trigger_type: 'FILE_UPLOAD',
        slack_team_id: teamId,
        created_by_user_id: userId,
        template_id: template.id,
      });
      onOpenChange(false);
      onSelect(workflow.id);
    } finally {
      setCreatingId(null);
    }
  }

  /**
   * Creates a blank workflow and navigates to it.
   */
  async function handleStartFromScratch() {
    if (createWorkflow.isPending) return;
    setCreatingId('scratch');
    try {
      const workflow = await createWorkflow.mutateAsync({
        name: 'Untitled Workflow',
        trigger_type: 'FILE_UPLOAD',
        slack_team_id: teamId,
        created_by_user_id: userId,
      });
      onOpenChange(false);
      onSelect(workflow.id);
    } finally {
      setCreatingId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Choose a Template</DialogTitle>
          <DialogDescription>
            Select a template to get started quickly, or start from scratch.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-destructive">
            <AlertCircle className="h-6 w-6" />
            <p className="text-sm">Failed to load templates. Please try again.</p>
          </div>
        )}

        {!isLoading && !isError && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {/* Start from Scratch card */}
            <Card
              role="button"
              tabIndex={0}
              className="cursor-pointer border-dashed transition-colors hover:border-primary"
              onClick={handleStartFromScratch}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleStartFromScratch();
                }
              }}
            >
              <CardHeader className="items-center p-4 pb-2">
                {creatingId === 'scratch' ? (
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                ) : (
                  <Plus className="h-8 w-8 text-muted-foreground" />
                )}
              </CardHeader>
              <CardContent className="p-4 pt-0 text-center">
                <CardTitle className="text-sm">Start from Scratch</CardTitle>
                <CardDescription className="mt-1 text-xs">
                  Build your workflow step by step
                </CardDescription>
              </CardContent>
            </Card>

            {/* Template cards */}
            {templates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                isCreating={creatingId === template.id}
                disabled={createWorkflow.isPending}
                onSelect={() => handleTemplateSelect(template)}
              />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Internal sub-component
// ---------------------------------------------------------------------------

interface TemplateCardProps {
  /** The template to render. */
  template: WorkflowTemplate;
  /** Whether this specific card is currently being created. */
  isCreating: boolean;
  /** Whether interaction is disabled (another creation in progress). */
  disabled: boolean;
  /** Callback when the card is selected. */
  onSelect: () => void;
}

/**
 * A single template card within the grid.
 */
function TemplateCard({ template, isCreating, disabled, onSelect }: TemplateCardProps) {
  return (
    <Card
      role="button"
      tabIndex={0}
      className={`cursor-pointer transition-colors hover:border-primary ${
        disabled && !isCreating ? 'pointer-events-none opacity-60' : ''
      }`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <CardHeader className="items-center p-4 pb-2">
        {isCreating ? (
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        ) : (
          <Workflow className="h-8 w-8 text-muted-foreground" />
        )}
      </CardHeader>
      <CardContent className="p-4 pt-0 text-center">
        <CardTitle className="text-sm">{template.name}</CardTitle>
        <CardDescription className="mt-1 line-clamp-2 text-xs">
          {template.description}
        </CardDescription>
        <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          <Layers className="h-3 w-3" />
          {template.node_count} {template.node_count === 1 ? 'node' : 'nodes'}
        </div>
      </CardContent>
    </Card>
  );
}
