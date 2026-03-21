/**
 * RecordingDetailPage (T075 - Recording Detail Page)
 *
 * Full detail view for a single call recording, combining the audio player,
 * transcript, coaching notes, and call metadata in a responsive two-column layout.
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Phone,
  Building2,
  User,
  Briefcase,
  Clock,
  Star,
  Flag,
  FileText,
} from 'lucide-react';
import { RecordingPlayer } from '@/components/dialer/RecordingPlayer';
import { CoachingNotes } from '@/components/dialer/CoachingNotes';
import * as recordingsApi from '@/services/recordings-api';
import type { RecordingDetail } from '@/services/recordings-api';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';
import { cn } from '@/lib/utils';

// ── Review status options ────────────────────────────────────────────────────

const REVIEW_STATUS_OPTIONS = ['FLAGGED', 'REVIEWED', 'NEEDS_COACHING'] as const;

const REVIEW_STATUS_STYLES: Record<string, string> = {
  FLAGGED: 'bg-red-100 text-red-700 border-red-200',
  REVIEWED: 'bg-green-100 text-green-700 border-green-200',
  NEEDS_COACHING: 'bg-yellow-100 text-yellow-700 border-yellow-200',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Format seconds into MM:SS display string. */
function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/** Format an ISO date string into a human-readable form. */
function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ── Component ────────────────────────────────────────────────────────────────

export default function RecordingDetailPage() {
  const { recordingId } = useParams<{ recordingId: string }>();

  // ── State ────────────────────────────────────────────────────────────────
  const [recording, setRecording] = useState<RecordingDetail | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPlaybackTime, setCurrentPlaybackTime] = useState(0);
  const [isSubmittingNote, setIsSubmittingNote] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [reviewStatus, setReviewStatus] = useState<string | null>(null);
  const [showReviewMenu, setShowReviewMenu] = useState(false);

  // ── Fetch recording detail + audio URL ───────────────────────────────────
  useEffect(() => {
    if (!recordingId) return;

    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const [detail, audio] = await Promise.all([
          recordingsApi.getRecordingDetail(recordingId!),
          recordingsApi.getAudioUrl(recordingId!),
        ]);

        if (cancelled) return;

        setRecording(detail);
        setAudioUrl(audio.url);
        setIsFavorited(detail.isFavorited);
        setReviewStatus(detail.reviewStatus);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to load recording';
        setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [recordingId]);

  // ── Time update callback (memoized to avoid RecordingPlayer re-renders) ──
  const handleTimeUpdate = useCallback((time: number) => {
    setCurrentPlaybackTime(time);
  }, []);

  // ── Add coaching note ────────────────────────────────────────────────────
  const handleAddNote = useCallback(
    async (content: string, timestampSeconds?: number) => {
      if (!recordingId) return;
      setIsSubmittingNote(true);

      try {
        const newNote = await recordingsApi.addCoachingNote(
          recordingId,
          content,
          timestampSeconds,
        );
        setRecording((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            coachingNotes: [...prev.coachingNotes, newNote],
          };
        });
      } catch (err) {
        console.error('Failed to add coaching note:', err);
      } finally {
        setIsSubmittingNote(false);
      }
    },
    [recordingId],
  );

  // ── Toggle favorite ──────────────────────────────────────────────────────
  const handleToggleFavorite = useCallback(async () => {
    if (!recordingId) return;

    // Optimistic update
    setIsFavorited((prev) => !prev);

    try {
      const result = await recordingsApi.toggleFavorite(recordingId);
      setIsFavorited(result.isFavorited);
    } catch (err) {
      // Revert on failure
      setIsFavorited((prev) => !prev);
      console.error('Failed to toggle favorite:', err);
    }
  }, [recordingId]);

  // ── Set review status ────────────────────────────────────────────────────
  const handleSetReviewStatus = useCallback(
    async (status: string) => {
      if (!recordingId) return;

      const previousStatus = reviewStatus;
      setReviewStatus(status);
      setShowReviewMenu(false);

      try {
        await recordingsApi.setReviewStatus(recordingId, status);
      } catch (err) {
        // Revert on failure
        setReviewStatus(previousStatus);
        console.error('Failed to set review status:', err);
      }
    },
    [recordingId, reviewStatus],
  );

  // ── Loading state ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-4">
        <Link
          to="/recordings"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Library
        </Link>
        <PageSkeleton />
      </div>
    );
  }

  // ── Error state ──────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="space-y-4">
        <Link
          to="/recordings"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Library
        </Link>
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm font-medium text-red-700">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-3 text-sm text-red-600 underline hover:text-red-800"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── 404 state ────────────────────────────────────────────────────────────
  if (!recording) {
    return (
      <div className="space-y-4">
        <Link
          to="/recordings"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Library
        </Link>
        <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
          <FileText className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm font-medium text-gray-600">Recording not found</p>
          <p className="mt-1 text-xs text-gray-400">
            The recording may have been deleted or you don't have access.
          </p>
        </div>
      </div>
    );
  }

  // ── Main layout ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Top bar: Back link + title + badges */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/recordings"
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Library
          </Link>
        </div>

        <div className="flex items-center gap-2">
          {/* Manager Review badge when FLAGGED */}
          {reviewStatus === 'FLAGGED' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700 border border-red-200">
              <Flag className="h-3 w-3" />
              Manager Review
            </span>
          )}

          {/* Favorite toggle */}
          <button
            onClick={handleToggleFavorite}
            className="rounded-md p-1.5 transition-colors hover:bg-gray-100"
            aria-label={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
            title={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Star
              className={cn(
                'h-5 w-5 transition-colors',
                isFavorited ? 'fill-yellow-400 text-yellow-400' : 'text-gray-400',
              )}
            />
          </button>

          {/* Review status dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowReviewMenu((prev) => !prev)}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                reviewStatus
                  ? REVIEW_STATUS_STYLES[reviewStatus] ?? 'bg-gray-100 text-gray-600 border-gray-200'
                  : 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200',
              )}
              title="Set review status"
            >
              <Flag className="h-3.5 w-3.5" />
              {reviewStatus ?? 'Set Status'}
            </button>

            {showReviewMenu && (
              <>
                {/* Backdrop to close menu */}
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowReviewMenu(false)}
                />
                <div className="absolute right-0 z-20 mt-1 w-40 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
                  {REVIEW_STATUS_OPTIONS.map((status) => (
                    <button
                      key={status}
                      onClick={() => handleSetReviewStatus(status)}
                      className={cn(
                        'flex w-full items-center gap-2 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-gray-50',
                        reviewStatus === status ? 'text-blue-600' : 'text-gray-700',
                      )}
                    >
                      {reviewStatus === status && (
                        <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />
                      )}
                      {status.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Title row */}
      <div>
        <h1 className="text-lg font-semibold text-gray-900">
          Call with {recording.contactName}
        </h1>
        <p className="text-sm text-gray-500">
          {formatDate(recording.createdAt)}
        </p>
      </div>

      {/* Two-column layout: left = metadata + coaching, right = player + transcript */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* LEFT COLUMN: metadata + coaching notes */}
        <div className="space-y-6 lg:col-span-1">
          {/* Call Metadata Card */}
          <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-4 py-2">
              <h3 className="text-sm font-medium text-gray-700">Call Details</h3>
            </div>
            <div className="divide-y divide-gray-50">
              {/* BDR Name */}
              <MetadataRow
                icon={<Briefcase className="h-4 w-4 text-gray-400" />}
                label="BDR"
                value={recording.bdrName}
              />

              {/* Contact Name */}
              <MetadataRow
                icon={<User className="h-4 w-4 text-gray-400" />}
                label="Contact"
                value={recording.contactName}
              />

              {/* Company */}
              <MetadataRow
                icon={<Building2 className="h-4 w-4 text-gray-400" />}
                label="Company"
                value={recording.companyName ?? 'N/A'}
              />

              {/* Job Title */}
              {recording.jobTitle && (
                <MetadataRow
                  icon={<Briefcase className="h-4 w-4 text-gray-400" />}
                  label="Title"
                  value={recording.jobTitle}
                />
              )}

              {/* Phone */}
              <MetadataRow
                icon={<Phone className="h-4 w-4 text-gray-400" />}
                label="Phone"
                value={recording.contactPhone}
              />

              {/* Disposition */}
              <MetadataRow
                icon={<FileText className="h-4 w-4 text-gray-400" />}
                label="Disposition"
                value={
                  recording.disposition ? (
                    <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                      {recording.disposition}
                    </span>
                  ) : (
                    'N/A'
                  )
                }
              />

              {/* Duration */}
              <MetadataRow
                icon={<Clock className="h-4 w-4 text-gray-400" />}
                label="Duration"
                value={formatDuration(recording.durationSeconds)}
              />

              {/* Date */}
              <MetadataRow
                icon={<Clock className="h-4 w-4 text-gray-400" />}
                label="Date"
                value={formatDate(recording.createdAt)}
              />
            </div>
          </div>

          {/* Notes (call notes, not coaching notes) */}
          {recording.notes && (
            <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-4 py-2">
                <h3 className="text-sm font-medium text-gray-700">Call Notes</h3>
              </div>
              <div className="px-4 py-3">
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{recording.notes}</p>
              </div>
            </div>
          )}

          {/* Coaching Notes */}
          <CoachingNotes
            notes={recording.coachingNotes}
            onAddNote={handleAddNote}
            currentPlaybackTime={currentPlaybackTime}
            isSubmitting={isSubmittingNote}
          />
        </div>

        {/* RIGHT COLUMN: player + transcript */}
        <div className="space-y-4 lg:col-span-2">
          {/* Recording Player (always at top) */}
          {audioUrl ? (
            <RecordingPlayer
              audioUrl={audioUrl}
              transcript={recording.transcript ?? undefined}
              onTimeUpdate={handleTimeUpdate}
            />
          ) : (
            <div className="rounded-lg border border-gray-200 bg-white p-6 text-center">
              <p className="text-sm text-gray-500">Audio unavailable</p>
            </div>
          )}

          {/* Standalone Transcript Panel (scrollable, below the player) */}
          {recording.transcript && recording.transcript.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-4 py-2">
                <h3 className="text-sm font-medium text-gray-700">
                  Full Transcript ({recording.transcript.length} lines)
                </h3>
              </div>
              <div className="max-h-96 overflow-y-auto divide-y divide-gray-50">
                {recording.transcript.map((line, idx) => {
                  const isActive =
                    currentPlaybackTime >= line.startSeconds &&
                    currentPlaybackTime < line.endSeconds;

                  return (
                    <div
                      key={`${line.startSeconds}-${idx}`}
                      className={cn(
                        'flex gap-3 px-4 py-2 transition-colors',
                        isActive && 'bg-blue-50 ring-1 ring-inset ring-blue-200',
                      )}
                    >
                      <span className="shrink-0 text-xs font-mono text-gray-400 tabular-nums pt-0.5">
                        {formatDuration(line.startSeconds)}
                      </span>
                      <div className="min-w-0">
                        <span className="text-xs font-semibold text-gray-600">
                          {line.speaker}:{' '}
                        </span>
                        <span
                          className={cn(
                            'text-sm',
                            isActive ? 'text-gray-900 font-medium' : 'text-gray-700',
                          )}
                        >
                          {line.text}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* No transcript message */}
          {(!recording.transcript || recording.transcript.length === 0) && (
            <div className="rounded-lg border border-gray-200 bg-white p-6 text-center">
              <FileText className="mx-auto h-8 w-8 text-gray-300" />
              <p className="mt-2 text-sm text-gray-500">No transcript available for this call</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── MetadataRow sub-component ────────────────────────────────────────────────

interface MetadataRowProps {
  /** Icon to display on the left side. */
  icon: React.ReactNode;
  /** Label for the metadata field. */
  label: string;
  /** Value to display (string or React node for badges). */
  value: React.ReactNode;
}

/** A single row in the call metadata card. */
function MetadataRow({ icon, label, value }: MetadataRowProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      {icon}
      <span className="text-xs font-medium text-gray-500 w-20 shrink-0">{label}</span>
      <span className="text-sm text-gray-900 min-w-0 truncate">{value}</span>
    </div>
  );
}
