/**
 * Upload page for config documents.
 *
 * Accessible at /upload/:token (public route, no admin auth).
 * Users arrive here via the /upload Slack command link.
 */

import { useState, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import {
  validateToken,
  fetchDocs,
  uploadDoc,
  fetchDocContent,
  downloadDoc,
  renameDocLabel,
  deleteDoc,
  type DocSlot,
  type DocContentResponse,
} from '@/services/upload';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/** Human-readable doc type labels. */
const DOC_TYPE_LABELS: Record<string, string> = {
  ICP: 'ICP (Ideal Customer Profile)',
  USE_CASES: 'Use Cases',
  CAMPAIGNS: 'Campaigns',
  SETTINGS: 'Settings',
};

const DOC_TYPE_DESCRIPTIONS: Record<string, string> = {
  ICP: 'Define your ideal customer profile for targeted analysis',
  USE_CASES: 'Describe your product use cases and value propositions',
  CAMPAIGNS: 'Configure campaign strategies and messaging',
  SETTINGS: 'General analysis settings and preferences',
};

const ACCEPTED_TYPES = '.txt,.md,.csv,.docx,.pdf,.xlsx';

export default function UploadPage() {
  const { token } = useParams<{ token: string }>();
  const queryClient = useQueryClient();

  // Validate token on mount
  const {
    data: context,
    isLoading: isValidating,
    error: validationError,
  } = useQuery({
    queryKey: queryKeys.upload.context(token!),
    queryFn: () => validateToken(token!),
    enabled: !!token,
    retry: false,
  });

  // Fetch docs once validated
  const {
    data: docsData,
    isLoading: isLoadingDocs,
  } = useQuery({
    queryKey: queryKeys.upload.docs(token!),
    queryFn: () => fetchDocs(token!),
    enabled: !!context?.valid,
  });

  if (isValidating) {
    return <CenteredMessage>Validating upload link...</CenteredMessage>;
  }

  if (validationError || !context?.valid) {
    return (
      <CenteredMessage>
        <h2 className="text-xl font-semibold mb-2">Link Expired or Invalid</h2>
        <p className="text-muted-foreground">
          Please run <code className="bg-muted px-1.5 py-0.5 rounded">/upload</code> again in Slack to get a new link.
        </p>
      </CenteredMessage>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-1">Upload Config Documents</h1>
          <p className="text-muted-foreground">
            {context.clientName
              ? `Client: ${context.clientName}`
              : `Channel: ${context.channelId}`}
          </p>
        </div>

        {/* Doc type cards */}
        {isLoadingDocs ? (
          <p className="text-muted-foreground">Loading documents...</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {docsData?.docs.map((slot) => (
              <DocCard
                key={slot.docType}
                slot={slot}
                token={token!}
                onRefresh={() =>
                  queryClient.invalidateQueries({ queryKey: queryKeys.upload.docs(token!) })
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Card for a single doc type slot. */
function DocCard({
  slot,
  token,
  onRefresh,
}: {
  slot: DocSlot;
  token: string;
  onRefresh: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<DocContentResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelValue, setLabelValue] = useState(slot.displayLabel || '');
  const [savingLabel, setSavingLabel] = useState(false);

  const isUploaded = slot.id !== null;

  /** Handle file selection and upload. */
  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setUploading(true);
      setUploadError(null);
      try {
        await uploadDoc(token, slot.docType, file);
        onRefresh();
      } catch (err: any) {
        const msg = err?.response?.data?.error || 'Upload failed. Please try again.';
        setUploadError(msg);
      } finally {
        setUploading(false);
        // Reset file input
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [token, slot.docType, onRefresh],
  );

  /** Open preview modal. */
  const handlePreview = useCallback(async () => {
    if (!slot.id) return;
    setPreviewLoading(true);
    setPreviewOpen(true);
    try {
      const data = await fetchDocContent(token, slot.id);
      setPreviewData(data);
    } catch {
      setPreviewData(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [token, slot.id]);

  /** Save label rename. */
  const handleLabelSave = useCallback(async () => {
    if (!slot.id || !labelValue.trim()) return;
    setSavingLabel(true);
    try {
      await renameDocLabel(token, slot.id, labelValue.trim());
      setEditingLabel(false);
      onRefresh();
    } catch {
      // Silently fail, user can retry
    } finally {
      setSavingLabel(false);
    }
  }, [token, slot.id, labelValue, onRefresh]);

  /** Delete document. */
  const handleDelete = useCallback(async () => {
    if (!slot.id) return;
    try {
      await deleteDoc(token, slot.id);
      setDeleteOpen(false);
      onRefresh();
    } catch {
      // Silently fail
    }
  }, [token, slot.id, onRefresh]);

  return (
    <>
      <Card className={isUploaded ? 'border-green-200 dark:border-green-900' : ''}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              {DOC_TYPE_LABELS[slot.docType] || slot.docType}
            </CardTitle>
            {isUploaded ? (
              <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                v{slot.version}
              </Badge>
            ) : (
              <Badge variant="outline">Missing</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {isUploaded ? (
            <>
              {/* Display label (click to edit) */}
              {editingLabel ? (
                <div className="flex gap-2">
                  <Input
                    value={labelValue}
                    onChange={(e) => setLabelValue(e.target.value)}
                    maxLength={100}
                    className="text-sm h-8"
                    onKeyDown={(e) => e.key === 'Enter' && handleLabelSave()}
                    autoFocus
                  />
                  <Button size="sm" variant="outline" onClick={handleLabelSave} disabled={savingLabel}>
                    {savingLabel ? '...' : 'Save'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingLabel(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <p
                  className="text-sm text-muted-foreground cursor-pointer hover:text-foreground"
                  onClick={() => {
                    setLabelValue(slot.displayLabel || '');
                    setEditingLabel(true);
                  }}
                  title="Click to rename"
                >
                  {slot.displayLabel || slot.originalFileName}
                </p>
              )}

              {/* Info line */}
              <p className="text-xs text-muted-foreground">
                {slot.originalFileName}
                {slot.uploadedAt && ` - ${new Date(slot.uploadedAt).toLocaleDateString()}`}
              </p>

              {/* Actions */}
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant="outline" onClick={handlePreview}>
                  Preview
                </Button>
                {slot.s3DownloadUrl && (
                  <Button size="sm" variant="outline" onClick={() => downloadDoc(token, slot.id!)}>
                    Download
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? 'Uploading...' : 'Replace'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-600 hover:text-red-700"
                  onClick={() => setDeleteOpen(true)}
                >
                  Delete
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {DOC_TYPE_DESCRIPTIONS[slot.docType]}
              </p>
              <Button
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? 'Uploading...' : 'Upload File'}
              </Button>
            </>
          )}

          {uploadError && (
            <p className="text-sm text-red-600">{uploadError}</p>
          )}

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            className="hidden"
            onChange={handleFileChange}
          />
        </CardContent>
      </Card>

      {/* Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{previewData?.displayLabel || 'Document Preview'}</DialogTitle>
          </DialogHeader>
          {previewLoading ? (
            <p className="text-muted-foreground">Loading preview...</p>
          ) : previewData ? (
            <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
              {previewData.markdownContent}
            </div>
          ) : (
            <p className="text-muted-foreground">Failed to load preview.</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {DOC_TYPE_LABELS[slot.docType]}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the document and its original file.
              You can always upload a new one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Simple centered message layout. */
function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center space-y-2 max-w-md px-4">{children}</div>
    </div>
  );
}
