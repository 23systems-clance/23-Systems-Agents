/**
 * CoachingNotes Component (T073 - Recording Library Coaching Notes)
 *
 * Displays existing coaching notes and provides a form to add new ones,
 * with optional linking to the current audio playback position.
 */

import { useState } from 'react';
import { MessageSquare, Clock, Plus, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CoachingNote } from '@/services/recordings-api';

interface CoachingNotesProps {
  /** Existing coaching notes for this recording. */
  notes: CoachingNote[];
  /** Callback to submit a new coaching note. */
  onAddNote: (content: string, timestampSeconds?: number) => void;
  /** Current audio playback time in seconds (used for "Link to position"). */
  currentPlaybackTime?: number;
  /** Whether a note submission is in flight. */
  isSubmitting?: boolean;
}

/**
 * Format seconds into MM:SS display string.
 */
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * Format an ISO date string into a human-readable short form.
 */
function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function CoachingNotes({
  notes,
  onAddNote,
  currentPlaybackTime,
  isSubmitting = false,
}: CoachingNotesProps) {
  const [content, setContent] = useState('');
  const [linkedTimestamp, setLinkedTimestamp] = useState<number | null>(null);

  /** Link or unlink the current playback position to this note. */
  const handleLinkPosition = () => {
    if (linkedTimestamp !== null) {
      // Unlink
      setLinkedTimestamp(null);
    } else if (currentPlaybackTime !== undefined) {
      setLinkedTimestamp(Math.floor(currentPlaybackTime));
    }
  };

  /** Submit the new coaching note. */
  const handleSubmit = () => {
    const trimmed = content.trim();
    if (!trimmed) return;
    onAddNote(trimmed, linkedTimestamp ?? undefined);
    setContent('');
    setLinkedTimestamp(null);
  };

  /** Submit on Enter (without Shift). */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2">
        <MessageSquare className="h-4 w-4 text-gray-500" />
        <h3 className="text-sm font-medium text-gray-700">
          Coaching Notes{notes.length > 0 && ` (${notes.length})`}
        </h3>
      </div>

      {/* Notes list */}
      <div className="max-h-72 overflow-y-auto divide-y divide-gray-50">
        {notes.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-gray-400">
            No coaching notes yet. Add one below.
          </div>
        )}

        {notes.map((note) => (
          <div key={note.id} className="px-4 py-3 space-y-1">
            {/* Author + timestamp reference */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-700">{note.authorName}</span>
              {note.timestampSeconds !== null && (
                <span className="inline-flex items-center gap-0.5 rounded bg-blue-50 px-1.5 py-0.5 text-xs font-mono text-blue-600">
                  <Clock className="h-3 w-3" />
                  {formatTime(note.timestampSeconds)}
                </span>
              )}
              <span className="ml-auto text-xs text-gray-400">{formatDate(note.createdAt)}</span>
            </div>
            {/* Content */}
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{note.content}</p>
          </div>
        ))}
      </div>

      {/* Add note form */}
      <div className="border-t border-gray-200 px-4 py-3 space-y-2">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a coaching note..."
          rows={2}
          disabled={isSubmitting}
          className={cn(
            'w-full resize-none rounded-md border border-gray-200 px-3 py-2 text-sm',
            'placeholder:text-gray-400 focus:border-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-300',
            isSubmitting && 'opacity-50 cursor-not-allowed',
          )}
        />

        <div className="flex items-center justify-between">
          {/* Link to current position */}
          <button
            type="button"
            onClick={handleLinkPosition}
            disabled={currentPlaybackTime === undefined}
            className={cn(
              'inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors',
              linkedTimestamp !== null
                ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
              currentPlaybackTime === undefined && 'opacity-50 cursor-not-allowed',
            )}
          >
            <Clock className="h-3 w-3" />
            {linkedTimestamp !== null
              ? `Linked @ ${formatTime(linkedTimestamp)}`
              : 'Link to current position'}
          </button>

          {/* Submit */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!content.trim() || isSubmitting}
            className={cn(
              'inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors',
              'hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {isSubmitting ? (
              <>
                <Plus className="h-3.5 w-3.5 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Send className="h-3.5 w-3.5" />
                Add Note
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
