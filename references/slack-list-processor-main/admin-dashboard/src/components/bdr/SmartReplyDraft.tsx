/**
 * Smart Reply Draft panel for UniBox.
 *
 * Shows AI-generated draft with intent badge, inline editing,
 * accept/dismiss actions, tone regeneration, and loading/error states.
 */

import { useState, useRef } from 'react';
import { Sparkles, Check, X, Loader2, AlertCircle, RefreshCw, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import type { SmartReplyDraftStatus, DraftTone } from '@/services/bdr-unibox';

const ALLOWED_EXTENSIONS = '.pdf,.docx,.xlsx,.png,.jpg,.jpeg,.gif';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_FILES = 5;

/** Intent label config for display. */
const INTENT_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  interested: { label: 'Interested', variant: 'default' },
  meeting_request: { label: 'Meeting Request', variant: 'default' },
  question: { label: 'Question', variant: 'secondary' },
  objection: { label: 'Objection', variant: 'destructive' },
  not_interested: { label: 'Not Interested', variant: 'destructive' },
  wrong_person: { label: 'Wrong Person', variant: 'outline' },
  out_of_office: { label: 'Out of Office', variant: 'outline' },
  auto_reply: { label: 'Auto Reply', variant: 'outline' },
  other: { label: 'Other', variant: 'outline' },
};

const TONE_OPTIONS: { value: DraftTone; label: string }[] = [
  { value: 'professional', label: 'Professional' },
  { value: 'casual', label: 'Casual' },
  { value: 'assertive', label: 'Assertive' },
  { value: 'empathetic', label: 'Empathetic' },
];

interface SmartReplyDraftProps {
  draftBody: string | null;
  draftStatus: SmartReplyDraftStatus | null;
  draftIntent: string | null;
  draftError: string | null;
  onAccept: (body?: string, files?: File[]) => void;
  onDismiss: () => void;
  onRetry?: () => void;
  onRegenerate?: (tone: DraftTone) => void;
  isAccepting?: boolean;
  isDismissing?: boolean;
  isRegenerating?: boolean;
}

export default function SmartReplyDraft({
  draftBody,
  draftStatus,
  draftIntent,
  draftError,
  onAccept,
  onDismiss,
  onRetry,
  onRegenerate,
  isAccepting = false,
  isDismissing = false,
  isRegenerating = false,
}: SmartReplyDraftProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedBody, setEditedBody] = useState(draftBody ?? '');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = Array.from(e.target.files ?? []);
    const validFiles = newFiles.filter((f) => f.size <= MAX_FILE_SIZE);
    setAttachedFiles((prev) => [...prev, ...validFiles].slice(0, MAX_FILES));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Don't render if no draft data
  if (!draftStatus) return null;

  // SENT or REJECTED — already handled
  if (draftStatus === 'SENT' || draftStatus === 'REJECTED') return null;

  const intentConfig = draftIntent ? INTENT_CONFIG[draftIntent] ?? INTENT_CONFIG.other : null;

  // GENERATING state
  if (draftStatus === 'GENERATING') {
    return (
      <div className="border rounded-lg p-4 bg-muted/30 space-y-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-500" />
          <span className="text-sm font-medium">Smart Reply</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Generating draft reply...
        </div>
      </div>
    );
  }

  // FAILED state
  if (draftStatus === 'FAILED') {
    return (
      <div className="border border-destructive/30 rounded-lg p-4 bg-destructive/5 space-y-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-500" />
          <span className="text-sm font-medium">Smart Reply</span>
          {intentConfig && (
            <Badge variant={intentConfig.variant} className="text-[10px]">
              {intentConfig.label}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-3.5 w-3.5" />
          {draftError ?? 'Draft generation failed'}
        </div>
        <div className="flex gap-2">
          {onRetry && (
            <Button size="sm" variant="outline" onClick={onRetry}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              Retry
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onDismiss} disabled={isDismissing}>
            <X className="h-3.5 w-3.5 mr-1" />
            Dismiss
          </Button>
        </div>
      </div>
    );
  }

  // READY state — show draft with accept/dismiss/regenerate
  return (
    <div className="border rounded-lg p-4 bg-amber-500/5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-500" />
          <span className="text-sm font-medium">Smart Reply</span>
          {intentConfig && (
            <Badge variant={intentConfig.variant} className="text-[10px]">
              {intentConfig.label}
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-xs"
          onClick={() => {
            setIsEditing(!isEditing);
            if (!isEditing) setEditedBody(draftBody ?? '');
          }}
        >
          {isEditing ? 'Cancel Edit' : 'Edit'}
        </Button>
      </div>

      {isEditing ? (
        <Textarea
          value={editedBody}
          onChange={(e) => setEditedBody(e.target.value)}
          className="min-h-[100px] text-sm"
        />
      ) : (
        <p className="text-sm whitespace-pre-wrap leading-relaxed text-muted-foreground">
          {draftBody}
        </p>
      )}

      {/* File attachments */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_EXTENSIONS}
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-xs"
          onClick={() => fileInputRef.current?.click()}
          disabled={attachedFiles.length >= MAX_FILES}
        >
          <Paperclip className="h-3 w-3 mr-1" />
          Attach
        </Button>
        {attachedFiles.map((file, i) => (
          <Badge key={i} variant="secondary" className="text-[10px] gap-1">
            {file.name}
            <button onClick={() => removeFile(i)} className="ml-1 hover:text-destructive">
              <X className="h-2.5 w-2.5" />
            </button>
          </Badge>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => onAccept(isEditing ? editedBody : undefined, attachedFiles.length > 0 ? attachedFiles : undefined)}
            disabled={isAccepting || (isEditing && !editedBody.trim())}
          >
            {isAccepting ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5 mr-1" />
            )}
            {isAccepting ? 'Sending...' : 'Accept & Send'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onDismiss}
            disabled={isDismissing}
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Dismiss
          </Button>
        </div>

        {/* Tone regeneration */}
        {onRegenerate && (
          <div className="flex items-center gap-1">
            <RefreshCw className="h-3 w-3 text-muted-foreground mr-1" />
            {TONE_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                size="sm"
                variant="outline"
                className="h-6 text-[10px] px-2"
                onClick={() => onRegenerate(opt.value)}
                disabled={isRegenerating}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
