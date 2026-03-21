/**
 * Prompt detail page with version management (Feature 19 — T025).
 */

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import {
  fetchPromptBySlug,
  fetchVersion,
  createVersion,
  updateVersion,
  publishVersion,
  updatePrompt,
  type PromptVersionSummary,
} from '@/services/prompts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { PromptTestPanel } from '@/pages/prompt-test-panel';

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-yellow-100 text-yellow-800',
  PUBLISHED: 'bg-green-100 text-green-800',
  ARCHIVED: 'bg-gray-100 text-gray-800',
};

export default function PromptDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const queryClient = useQueryClient();

  const [editingDraft, setEditingDraft] = useState<string | null>(null);
  const [draftContent, setDraftContent] = useState('');
  const [changeNote, setChangeNote] = useState('');

  // Metadata editing
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaName, setMetaName] = useState('');
  const [metaDescription, setMetaDescription] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.prompts.detail(slug!),
    queryFn: () => fetchPromptBySlug(slug!),
    enabled: !!slug,
  });

  const prompt = data?.prompt;
  const publishedVersion = prompt?.versions.find((v) => v.status === 'PUBLISHED');
  const draftVersion = prompt?.versions.find((v) => v.status === 'DRAFT');

  // Load draft content when clicking edit
  const loadDraftMutation = useMutation({
    mutationFn: (versionId: string) => fetchVersion(slug!, versionId),
    onSuccess: (result) => {
      setDraftContent(result.version.content);
      setEditingDraft(result.version.id);
    },
  });

  // Create new version
  const createVersionMutation = useMutation({
    mutationFn: (input: { content?: string; copyFromVersionId?: string; changeNote?: string }) =>
      createVersion(slug!, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.prompts.detail(slug!) });
    },
  });

  // Update draft
  const updateDraftMutation = useMutation({
    mutationFn: () =>
      updateVersion(slug!, editingDraft!, {
        content: draftContent,
        changeNote: changeNote || undefined,
        updatedAt: prompt?.updatedAt,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.prompts.detail(slug!) });
      setEditingDraft(null);
    },
    onError: (error: { response?: { status: number } }) => {
      if (error.response?.status === 409) {
        alert('Conflict: this prompt was modified by another user. Please reload the page.');
      }
    },
  });

  // Publish
  const publishMutation = useMutation({
    mutationFn: (versionId: string) => publishVersion(slug!, versionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.prompts.detail(slug!) });
    },
  });

  // Update metadata
  const updateMetaMutation = useMutation({
    mutationFn: () =>
      updatePrompt(slug!, {
        displayName: metaName,
        description: metaDescription,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.prompts.detail(slug!) });
      setEditingMeta(false);
    },
  });

  if (isLoading) return <div className="p-8">Loading...</div>;
  if (!prompt) return <div className="p-8">Prompt not found</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/prompts" className="text-sm text-muted-foreground hover:underline">
          Prompt Library
        </Link>
        <span className="text-muted-foreground">/</span>
        <h1 className="text-2xl font-bold">{prompt.displayName}</h1>
        <Badge className={STATUS_COLORS[prompt.publishedVersion?.status ?? 'DRAFT']}>
          {prompt.publishedVersion ? `v${prompt.publishedVersion.version} Published` : 'No published version'}
        </Badge>
      </div>

      <Tabs defaultValue="content">
        <TabsList>
          <TabsTrigger value="content">Content</TabsTrigger>
          <TabsTrigger value="metadata">Metadata</TabsTrigger>
          <TabsTrigger value="versions">Versions ({prompt.versions.length})</TabsTrigger>
          {draftVersion && <TabsTrigger value="test">Test</TabsTrigger>}
        </TabsList>

        {/* Content Tab */}
        <TabsContent value="content" className="space-y-4">
          {/* Published version (read-only) */}
          {publishedVersion && !editingDraft && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg">
                  Published Version (v{publishedVersion.version})
                </CardTitle>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      createVersionMutation.mutate({
                        copyFromVersionId: publishedVersion.id,
                        changeNote: `Copy from v${publishedVersion.version}`,
                      });
                    }}
                    disabled={!!draftVersion || createVersionMutation.isPending}
                  >
                    {draftVersion ? 'Draft exists' : 'Create New Version'}
                  </Button>
                  {draftVersion && (
                    <Button
                      size="sm"
                      onClick={() => loadDraftMutation.mutate(draftVersion.id)}
                    >
                      Edit Draft (v{draftVersion.version})
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <PublishedVersionContent slug={slug!} versionId={publishedVersion.id} />
              </CardContent>
            </Card>
          )}

          {/* Draft editor */}
          {editingDraft && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  Editing Draft (v{draftVersion?.version})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Textarea
                  value={draftContent}
                  onChange={(e) => setDraftContent(e.target.value)}
                  className="min-h-[400px] font-mono text-sm"
                  placeholder="Enter prompt content..."
                />
                <Input
                  placeholder="Change note (optional)"
                  value={changeNote}
                  onChange={(e) => setChangeNote(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button
                    onClick={() => updateDraftMutation.mutate()}
                    disabled={updateDraftMutation.isPending}
                  >
                    {updateDraftMutation.isPending ? 'Saving...' : 'Save Draft'}
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="default" disabled={publishMutation.isPending}>
                        Publish
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Publish this version?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will make v{draftVersion?.version} the active version. The current
                          published version will be archived. This action takes effect within 5
                          minutes (Redis cache TTL).
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => {
                            publishMutation.mutate(editingDraft!);
                            setEditingDraft(null);
                          }}
                        >
                          Publish
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  <Button variant="outline" onClick={() => setEditingDraft(null)}>
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* No published version */}
          {!publishedVersion && !editingDraft && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No published version yet.
                {!draftVersion ? (
                  <Button
                    variant="link"
                    onClick={() => createVersionMutation.mutate({ content: '' })}
                  >
                    Create first draft
                  </Button>
                ) : (
                  <Button
                    variant="link"
                    onClick={() => loadDraftMutation.mutate(draftVersion.id)}
                  >
                    Edit draft (v{draftVersion.version})
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Metadata Tab */}
        <TabsContent value="metadata" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Prompt Metadata</CardTitle>
              {!editingMeta && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setMetaName(prompt.displayName);
                    setMetaDescription(prompt.description ?? '');
                    setEditingMeta(true);
                  }}
                >
                  Edit
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {editingMeta ? (
                <>
                  <div>
                    <Label>Display Name</Label>
                    <Input value={metaName} onChange={(e) => setMetaName(e.target.value)} />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Textarea
                      value={metaDescription}
                      onChange={(e) => setMetaDescription(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={() => updateMetaMutation.mutate()}>Save</Button>
                    <Button variant="outline" onClick={() => setEditingMeta(false)}>
                      Cancel
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <Label className="text-muted-foreground">Slug</Label>
                    <p className="font-mono">{prompt.slug}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Category</Label>
                    <p>{prompt.category}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Description</Label>
                    <p>{prompt.description || 'No description'}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Model Config</Label>
                    <pre className="mt-1 rounded bg-muted p-2 text-sm">
                      {JSON.stringify(prompt.modelConfig, null, 2)}
                    </pre>
                  </div>
                  {prompt.variables.length > 0 && (
                    <div>
                      <Label className="text-muted-foreground">Template Variables</Label>
                      <div className="mt-1 flex gap-2">
                        {prompt.variables.map((v) => (
                          <Badge key={v.id} variant="outline">
                            {`{{${v.name}}}`}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Versions Tab */}
        <TabsContent value="versions" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Version History</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {prompt.versions.map((v: PromptVersionSummary) => (
                  <div
                    key={v.id}
                    className="flex items-center justify-between rounded border p-3"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-medium">v{v.version}</span>
                      <Badge className={STATUS_COLORS[v.status]}>{v.status}</Badge>
                      {v.changeNote && (
                        <span className="text-sm text-muted-foreground">{v.changeNote}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-muted-foreground">
                        {new Date(v.createdAt).toLocaleDateString()}
                      </span>
                      {v.status === 'ARCHIVED' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            createVersionMutation.mutate({
                              copyFromVersionId: v.id,
                              changeNote: `Rollback from v${v.version}`,
                            })
                          }
                          disabled={!!draftVersion}
                        >
                          Rollback
                        </Button>
                      )}
                      {v.status === 'DRAFT' && (
                        <Button
                          size="sm"
                          onClick={() => loadDraftMutation.mutate(v.id)}
                        >
                          Edit
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Test Tab (only visible when a draft exists) */}
        {draftVersion && (
          <TabsContent value="test" className="space-y-4">
            <PromptTestPanel
              slug={slug!}
              versionId={draftVersion.id}
              versionNumber={draftVersion.version}
            />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

/** Loads and displays the published version content (read-only). */
function PublishedVersionContent({ slug, versionId }: { slug: string; versionId: string }) {
  const { data } = useQuery({
    queryKey: queryKeys.prompts.version(slug, versionId),
    queryFn: () => fetchVersion(slug, versionId),
  });

  if (!data) return <div className="text-muted-foreground">Loading content...</div>;

  return (
    <pre className="whitespace-pre-wrap rounded bg-muted p-4 text-sm font-mono max-h-[500px] overflow-auto">
      {data.version.content}
    </pre>
  );
}
