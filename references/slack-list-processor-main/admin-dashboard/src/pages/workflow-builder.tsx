import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Save,
  Rocket,
  Check,
  AlertTriangle,
  Loader2,
  Undo2,
  Redo2,
  LayoutGrid,
  ShieldCheck,
  History,
  RotateCcw,
  BookmarkPlus,
  Pencil,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { WorkflowCanvas } from '@/components/workflow/WorkflowCanvas';
import type { WorkflowCanvasRef } from '@/components/workflow/WorkflowCanvas';
import { NodePalette } from '@/components/workflow/NodePalette';
import { NodeConfigPanel } from '@/components/workflow/NodeConfigPanel';
import { SlackPreview } from '@/components/workflow/SlackPreview';
import { WorkflowValidation } from '@/components/workflow/WorkflowValidation';
import { WorkflowScopePanel } from '@/components/workflow/WorkflowScopePanel';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';
import {
  useWorkflow,
  useWorkflowVersion,
  useUpdateDraftVersion,
  useUpdateWorkflowName,
  usePublishWorkflow,
  useCreateDraftFromPublished,
  useSaveAsTemplate,
} from '@/services/workflows';
import type { WorkflowGraph, WorkflowVersionSummary } from '@/types/api';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maps version status to badge styling. */
const VERSION_STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  PUBLISHED: 'bg-green-100 text-green-800 border-green-200',
  ARCHIVED: 'bg-gray-100 text-gray-600 border-gray-200',
};

/** Empty graph used as a default before server data loads. */
const EMPTY_GRAPH: WorkflowGraph = { nodes: [], edges: [] };

/** Node types that support Slack preview rendering. */
const PREVIEW_NODE_TYPES = ['MESSAGE', 'BUTTON_CHOICE', 'FORM_MODAL'];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * WorkflowBuilderPage is the main page for editing a workflow.
 *
 * It loads a workflow version's graph, renders a three-column layout with
 * NodePalette (left), WorkflowCanvas (center), and NodeConfigPanel (right),
 * and provides save/publish/validate/undo/redo controls in a top bar.
 *
 * Route: /workflows/:workflowId/edit
 */
export default function WorkflowBuilderPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const navigate = useNavigate();

  // ---- Workflow detail (contains versions list) ----
  const {
    data: workflow,
    isLoading: workflowLoading,
  } = useWorkflow(workflowId);

  // ---- Determine which version to edit ----
  const targetVersion: WorkflowVersionSummary | undefined = useMemo(() => {
    if (!workflow?.versions?.length) return undefined;
    // Prefer the draft version, fall back to latest by version number.
    const draft = workflow.versions.find((v) => v.status === 'DRAFT');
    if (draft) return draft;
    return [...workflow.versions].sort((a, b) => b.version - a.version)[0];
  }, [workflow]);

  // ---- Fetch the full version with graph ----
  const {
    data: versionDetail,
    isLoading: versionLoading,
  } = useWorkflowVersion(workflowId, targetVersion?.id);

  // ---- Mutations ----
  const saveDraftMutation = useUpdateDraftVersion(workflowId ?? '');
  const renameMutation = useUpdateWorkflowName(workflowId ?? '');
  const publishMutation = usePublishWorkflow(workflowId ?? '');
  const createDraftFromPublishedMutation = useCreateDraftFromPublished(workflowId ?? '');
  const saveTemplateMutation = useSaveAsTemplate();

  // ---- Canvas ref for imperative actions ----
  const canvasRef = useRef<WorkflowCanvasRef>(null);

  // ---- Local graph state ----
  const [localGraph, setLocalGraph] = useState<WorkflowGraph>(EMPTY_GRAPH);
  const savedGraphRef = useRef<WorkflowGraph>(EMPTY_GRAPH);

  // ---- Workflow name editing ----
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  // ---- Node selection (drives NodeConfigPanel) ----
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // ---- Palette collapse state ----
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);

  // ---- Undo/Redo state ----
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // ---- Validation panel toggle ----
  const [validationOpen, setValidationOpen] = useState(false);
  const validationRef = useRef<HTMLDivElement>(null);

  // ---- Version history panel toggle ----
  const [versionPanelOpen, setVersionPanelOpen] = useState(false);
  const versionPanelRef = useRef<HTMLDivElement>(null);

  // ---- Publish confirmation dialog ----
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);

  // ---- Error / success feedback ----
  const [publishError, setPublishError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [templateSaved, setTemplateSaved] = useState(false);

  // ---- Initialise local state from fetched version data ----
  useEffect(() => {
    if (versionDetail?.graph) {
      setLocalGraph(versionDetail.graph);
      savedGraphRef.current = versionDetail.graph;
    }
  }, [versionDetail]);

  // ---- Initialise name from workflow data ----
  useEffect(() => {
    if (workflow?.name) {
      setNameValue(workflow.name);
    }
  }, [workflow]);

  // ---- Compute published version (for comparison indicator & publish dialog) ----
  const publishedVersion: WorkflowVersionSummary | undefined = useMemo(() => {
    if (!workflow?.versions?.length) return undefined;
    return workflow.versions.find((v) => v.status === 'PUBLISHED');
  }, [workflow]);

  // ---- Sorted versions list for the history panel (newest first) ----
  const sortedVersions: WorkflowVersionSummary[] = useMemo(() => {
    if (!workflow?.versions?.length) return [];
    return [...workflow.versions].sort((a, b) => b.version - a.version);
  }, [workflow]);

  // ---- Close validation panel on outside click ----
  useEffect(() => {
    if (!validationOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (
        validationRef.current &&
        !validationRef.current.contains(event.target as Node)
      ) {
        setValidationOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [validationOpen]);

  // ---- Close version history panel on outside click ----
  useEffect(() => {
    if (!versionPanelOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (
        versionPanelRef.current &&
        !versionPanelRef.current.contains(event.target as Node)
      ) {
        setVersionPanelOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [versionPanelOpen]);

  // ---- Handle restoring an archived version (creates a new draft) ----
  const handleRestoreVersion = useCallback(() => {
    createDraftFromPublishedMutation.mutate(undefined, {
      onSuccess: () => {
        setVersionPanelOpen(false);
      },
    });
  }, [createDraftFromPublishedMutation]);

  // ---- Track dirty state (has unsaved changes) ----
  const hasChanges = useMemo(() => {
    return JSON.stringify(localGraph) !== JSON.stringify(savedGraphRef.current);
  }, [localGraph]);

  // ---- Canvas change handler ----
  const handleCanvasChange = useCallback((graph: WorkflowGraph) => {
    setLocalGraph(graph);
  }, []);

  // ---- Node selection handler ----
  const handleNodeSelect = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
  }, []);

  // ---- Undo/Redo change handler from canvas ----
  const handleUndoRedoChange = useCallback(
    (undoAvailable: boolean, redoAvailable: boolean) => {
      setCanUndo(undoAvailable);
      setCanRedo(redoAvailable);
    },
    [],
  );

  // ---- Drag-and-drop from palette: create new node at drop position ----
  const handleNodeDrop = useCallback(
    (
      type: string,
      position: { x: number; y: number },
      data: Record<string, unknown>,
    ) => {
      const newNode = {
        id: `node-${Date.now()}`,
        type,
        position,
        data,
      };
      setLocalGraph((prev) => ({
        ...prev,
        nodes: [...prev.nodes, newNode],
      }));
    },
    [],
  );

  // ---- Node config save handler ----
  const handleNodeConfigSave = useCallback(
    (nodeId: string, data: Record<string, unknown>) => {
      setLocalGraph((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) =>
          n.id === nodeId ? { ...n, data } : n,
        ),
      }));
    },
    [],
  );

  // ---- Node delete handler ----
  const handleNodeDelete = useCallback(
    (nodeId: string) => {
      setLocalGraph((prev) => ({
        ...prev,
        nodes: prev.nodes.filter((n) => n.id !== nodeId),
        edges: prev.edges.filter(
          (e) => e.source !== nodeId && e.target !== nodeId,
        ),
      }));
      setSelectedNodeId(null);
    },
    [],
  );

  // ---- Save draft ----
  const handleSaveDraft = useCallback(() => {
    if (!targetVersion?.id) return;
    saveDraftMutation.mutate(
      { versionId: targetVersion.id, graph: localGraph },
      {
        onSuccess: () => {
          savedGraphRef.current = localGraph;
          setSaveSuccess(true);
          setTimeout(() => setSaveSuccess(false), 2000);
        },
      },
    );
  }, [targetVersion?.id, localGraph, saveDraftMutation]);

  // ---- Name editing ----
  const handleStartEditingName = useCallback(() => {
    setEditingName(true);
    // Focus the input after React renders it.
    setTimeout(() => nameInputRef.current?.focus(), 0);
  }, []);

  const handleFinishEditingName = useCallback(() => {
    setEditingName(false);
    const trimmed = nameValue.trim();
    if (trimmed && trimmed !== workflow?.name) {
      renameMutation.mutate({ name: trimmed });
    } else if (!trimmed && workflow?.name) {
      // Reset to original name if blank.
      setNameValue(workflow.name);
    }
  }, [nameValue, workflow?.name, renameMutation]);

  const handleNameKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handleFinishEditingName();
      } else if (e.key === 'Escape') {
        setEditingName(false);
        setNameValue(workflow?.name ?? '');
      }
    },
    [handleFinishEditingName, workflow?.name],
  );

  // ---- Publish flow ----
  const handlePublishConfirm = useCallback(() => {
    setPublishError(null);
    // TODO: replace with actual user ID from auth context
    const userId = 'admin';
    publishMutation.mutate(userId, {
      onSuccess: () => {
        setPublishDialogOpen(false);
        setPublishError(null);
      },
      onError: (err) => {
        setPublishError(
          (err as Error)?.message ?? 'Failed to publish workflow.',
        );
      },
    });
  }, [publishMutation]);

  // ---- Validation node click handler (focuses the node on the canvas) ----
  const handleValidationNodeClick = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setValidationOpen(false);
  }, []);

  // ---- Derived state ----
  const isLoading = workflowLoading || versionLoading;
  const isSaving = saveDraftMutation.isPending;
  const isPublishing = publishMutation.isPending;
  const isDraft = targetVersion?.status === 'DRAFT';

  // ---- Has a published version (needed for "Save as Template" visibility) ----
  const hasPublishedVersion = useMemo(() => {
    return workflow?.versions?.some((v) => v.status === 'PUBLISHED') ?? false;
  }, [workflow]);

  // ---- Find selected node from the graph for the config panel ----
  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    const found = localGraph.nodes.find((n) => n.id === selectedNodeId);
    if (!found) return null;
    return {
      id: found.id,
      type: found.type,
      data: found.data,
    };
  }, [selectedNodeId, localGraph.nodes]);

  // ---- Loading state ----
  if (isLoading) {
    return <PageSkeleton />;
  }

  // ---- Workflow not found ----
  if (!workflow) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <p className="text-muted-foreground">Workflow not found.</p>
        <Button variant="outline" onClick={() => navigate('/workflows')}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to Workflows
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* ---- Top Bar ---- */}
      <div className="flex items-center justify-between border-b bg-background px-4 py-2">
        {/* Left side: Back button + Name + Version badge */}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/workflows')}
            title="Back to Workflows"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>

          {/* Inline-editable workflow name */}
          {editingName ? (
            <Input
              ref={nameInputRef}
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={handleFinishEditingName}
              onKeyDown={handleNameKeyDown}
              className="h-8 w-64 text-lg font-bold"
            />
          ) : (
            <button
              type="button"
              onClick={handleStartEditingName}
              className="rounded px-1 py-0.5 text-lg font-bold hover:bg-muted transition-colors"
              title="Click to rename"
            >
              {workflow.name}
            </button>
          )}

          {/* Version status badge + History toggle */}
          {targetVersion && (
            <div className="relative flex items-center gap-1" ref={versionPanelRef}>
              <Badge
                className={
                  VERSION_STATUS_STYLES[targetVersion.status] ?? ''
                }
              >
                v{targetVersion.version} {targetVersion.status}
              </Badge>

              <Button
                variant={versionPanelOpen ? 'secondary' : 'ghost'}
                size="icon"
                className="h-7 w-7"
                onClick={() => setVersionPanelOpen((prev) => !prev)}
                title="Version history"
              >
                <History className="h-3.5 w-3.5" />
              </Button>

              {/* Version history dropdown panel */}
              {versionPanelOpen && (
                <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-md border bg-background shadow-lg">
                  <div className="border-b px-3 py-2">
                    <p className="text-sm font-semibold">Version History</p>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {sortedVersions.map((v) => {
                      const isCurrentVersion = v.id === targetVersion.id;
                      const statusStyle = VERSION_STATUS_STYLES[v.status] ?? '';
                      return (
                        <div
                          key={v.id}
                          className={`flex items-center justify-between px-3 py-2 text-sm ${
                            isCurrentVersion ? 'bg-muted/50' : 'hover:bg-muted/30'
                          }`}
                        >
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">v{v.version}</span>
                              <Badge variant="outline" className={`text-xs px-1.5 py-0 ${statusStyle}`}>
                                {v.status}
                              </Badge>
                              {isCurrentVersion && (
                                <span className="text-xs text-muted-foreground">(current)</span>
                              )}
                            </div>
                            {v.published_at && (
                              <span className="text-xs text-muted-foreground">
                                Published {new Date(v.published_at).toLocaleDateString()}
                              </span>
                            )}
                            <span className="text-xs text-muted-foreground">
                              {v.node_count} nodes, {v.edge_count} edges
                            </span>
                          </div>

                          {/* Restore button for archived versions */}
                          {v.status === 'ARCHIVED' && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={handleRestoreVersion}
                              disabled={createDraftFromPublishedMutation.isPending}
                              title="Create a new draft from this archived version"
                            >
                              {createDraftFromPublishedMutation.isPending ? (
                                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                              ) : (
                                <RotateCcw className="mr-1 h-3 w-3" />
                              )}
                              Restore
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Version comparison indicator */}
          {isDraft && publishedVersion && targetVersion && (
            <span className="text-xs text-muted-foreground">
              Editing draft v{targetVersion.version} | Active: v{publishedVersion.version}
            </span>
          )}
        </div>

        {/* Right side: Undo/Redo + Auto-layout + Validate + Save + Publish */}
        <div className="flex items-center gap-2">
          {/* Unsaved changes indicator */}
          {hasChanges && (
            <span className="text-xs text-muted-foreground">
              Unsaved changes
            </span>
          )}

          {/* Undo button */}
          {isDraft && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => canvasRef.current?.undo()}
              disabled={!canUndo}
              title="Undo (Ctrl+Z)"
            >
              <Undo2 className="h-4 w-4" />
            </Button>
          )}

          {/* Redo button */}
          {isDraft && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => canvasRef.current?.redo()}
              disabled={!canRedo}
              title="Redo (Ctrl+Shift+Z)"
            >
              <Redo2 className="h-4 w-4" />
            </Button>
          )}

          {/* Auto-layout button (available in all modes) */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => canvasRef.current?.autoLayout()}
            title="Auto-align nodes"
          >
            <LayoutGrid className="h-4 w-4 mr-1" />
            Auto Align
          </Button>

          {/* Validate button with dropdown panel */}
          {isDraft && workflowId && (
            <div className="relative" ref={validationRef}>
              <Button
                variant={validationOpen ? 'secondary' : 'ghost'}
                size="icon"
                onClick={() => setValidationOpen((prev) => !prev)}
                title="Validate workflow"
              >
                <ShieldCheck className="h-4 w-4" />
              </Button>

              {/* Validation dropdown panel */}
              {validationOpen && (
                <div className="absolute right-0 top-full z-50 mt-1 w-80 rounded-md border bg-background p-3 shadow-lg">
                  <WorkflowValidation
                    workflowId={workflowId}
                    onNodeClick={handleValidationNodeClick}
                  />
                </div>
              )}
            </div>
          )}

          {/* Create Draft button — shown when viewing a published version with no draft */}
          {!isDraft && targetVersion?.status === 'PUBLISHED' && (
            <Button
              variant="default"
              size="sm"
              onClick={() => {
                createDraftFromPublishedMutation.mutate(undefined, {
                  onSuccess: () => {
                    // Query invalidation will reload with the new DRAFT version
                  },
                });
              }}
              disabled={createDraftFromPublishedMutation.isPending}
            >
              {createDraftFromPublishedMutation.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Pencil className="mr-1 h-4 w-4" />
              )}
              {createDraftFromPublishedMutation.isPending ? 'Creating Draft...' : 'Edit Workflow'}
            </Button>
          )}

          {/* Save as Template button - only for published workflows */}
          {hasPublishedVersion && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                saveTemplateMutation.mutate(
                  { workflowId: workflowId!, teamId: 'T_DEFAULT' },
                  {
                    onSuccess: () => {
                      setTemplateSaved(true);
                      setTimeout(() => setTemplateSaved(false), 2000);
                    },
                  },
                );
              }}
              disabled={saveTemplateMutation.isPending}
              title="Save this workflow as a reusable template"
            >
              {saveTemplateMutation.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : templateSaved ? (
                <Check className="mr-1 h-4 w-4 text-green-600" />
              ) : (
                <BookmarkPlus className="mr-1 h-4 w-4" />
              )}
              {saveTemplateMutation.isPending ? 'Saving...' : templateSaved ? 'Saved!' : 'Save as Template'}
            </Button>
          )}

          {/* Save Draft button */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleSaveDraft}
            disabled={isSaving || !hasChanges || !isDraft}
            title={!isDraft ? 'Only draft versions can be saved' : undefined}
          >
            {isSaving ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : saveSuccess ? (
              <Check className="mr-1 h-4 w-4 text-green-600" />
            ) : (
              <Save className="mr-1 h-4 w-4" />
            )}
            {isSaving ? 'Saving...' : saveSuccess ? 'Saved' : 'Save Draft'}
          </Button>

          {/* Publish button */}
          <Button
            size="sm"
            onClick={() => setPublishDialogOpen(true)}
            disabled={isPublishing || !isDraft}
            title={!isDraft ? 'No draft version to publish' : undefined}
          >
            {isPublishing ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Rocket className="mr-1 h-4 w-4" />
            )}
            {isPublishing ? 'Publishing...' : 'Publish'}
          </Button>
        </div>
      </div>

      {/* ---- Save/Publish error display ---- */}
      {saveDraftMutation.isError && (
        <div className="flex items-center gap-2 border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Failed to save: {(saveDraftMutation.error as Error)?.message ?? 'Unknown error'}
        </div>
      )}

      {/* ---- Read-only banner for published versions ---- */}
      {!isDraft && targetVersion?.status === 'PUBLISHED' && (
        <div className="flex items-center justify-between border-b bg-blue-50 px-4 py-2 text-sm text-blue-800">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            <span>
              You are viewing the published version (v{targetVersion.version}). Click <strong>Edit Workflow</strong> to create a draft for editing.
            </span>
          </div>
        </div>
      )}

      {/* ---- Three-column layout ---- */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar: Node Palette (only in draft mode) */}
        {isDraft && (
          <NodePalette
            collapsed={paletteCollapsed}
            onCollapse={setPaletteCollapsed}
          />
        )}

        {/* Center: Workflow Canvas */}
        <div className="flex-1">
          <WorkflowCanvas
            ref={canvasRef}
            graph={localGraph}
            onChange={handleCanvasChange}
            onNodeSelect={handleNodeSelect}
            readOnly={!isDraft}
            onDrop={handleNodeDrop}
            onUndoRedoChange={handleUndoRedoChange}
          />
        </div>

        {/* Right sidebar: Node Config + Slack Preview + Scope Panel (draft mode) */}
        {isDraft && (
          <div className="flex flex-col border-l w-80">
            {selectedNode && (
              <>
                <NodeConfigPanel
                  node={selectedNode}
                  onSave={handleNodeConfigSave}
                  onClose={() => setSelectedNodeId(null)}
                  onDelete={handleNodeDelete}
                />
                {PREVIEW_NODE_TYPES.includes(selectedNode.type) && (
                  <div className="border-t p-3">
                    <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                      Slack Preview
                    </p>
                    <SlackPreview
                      nodeType={selectedNode.type}
                      nodeData={selectedNode.data}
                    />
                  </div>
                )}
              </>
            )}
            {workflowId && workflow && (
              <WorkflowScopePanel
                workflowId={workflowId}
                workflow={workflow}
              />
            )}
          </div>
        )}
      </div>

      {/* ---- Publish Confirmation AlertDialog ---- */}
      <AlertDialog open={publishDialogOpen} onOpenChange={setPublishDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish Workflow</AlertDialogTitle>
            <AlertDialogDescription>
              {publishedVersion
                ? `This will replace the currently active version (v${publishedVersion.version}) and make v${targetVersion?.version} the live workflow. The previous version will be archived.`
                : 'This will make this workflow version active and available for execution.'}
              {' '}Are you sure you want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* Validation / publish errors */}
          {publishError && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{publishError}</span>
            </div>
          )}

          {/* Unsaved changes warning */}
          {hasChanges && (
            <div className="flex items-start gap-2 rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                You have unsaved changes. Save your draft before publishing to
                include the latest edits.
              </span>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPublishing}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handlePublishConfirm}
              disabled={isPublishing}
            >
              {isPublishing ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  Publishing...
                </>
              ) : (
                <>
                  <Rocket className="mr-1 h-4 w-4" />
                  Publish
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
