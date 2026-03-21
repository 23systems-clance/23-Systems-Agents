import { api } from '@/lib/api-client';

// ── Types ───────────────────────────────────────────────────────────────────

export interface Recording {
  id: string;
  callSessionId: string;
  bdrName: string;
  contactName: string;
  contactPhone: string;
  companyName: string | null;
  disposition: string | null;
  durationSeconds: number | null;
  isFavorited: boolean;
  reviewStatus: string | null;
  createdAt: string;
  hasTranscript: boolean;
}

export interface TranscriptLine {
  speaker: string;
  text: string;
  startSeconds: number;
  endSeconds: number;
}

export interface CoachingNote {
  id: string;
  authorName: string;
  content: string;
  timestampSeconds: number | null;
  createdAt: string;
}

export interface RecordingDetail extends Recording {
  bdrId: string;
  campaignId: string | null;
  contactEmail: string | null;
  jobTitle: string | null;
  transcript: TranscriptLine[] | null;
  coachingNotes: CoachingNote[];
  notes: string | null;
}

export interface ListRecordingsParams {
  page?: number;
  limit?: number;
  bdrId?: string;
  campaignId?: string;
  clientId?: string;
  disposition?: string;
  minDuration?: number;
  maxDuration?: number;
  dateFrom?: string;
  dateTo?: string;
  reviewStatus?: string;
  favoritesOnly?: boolean;
}

export interface ListRecordingsResponse {
  recordings: Recording[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ── API Functions ───────────────────────────────────────────────────────────

/** Fetch a paginated, filterable list of call recordings. */
export async function listRecordings(params: ListRecordingsParams = {}): Promise<ListRecordingsResponse> {
  const { data } = await api.get('/recordings', { params });
  return data;
}

/** Fetch full details for a single recording, including transcript and coaching notes. */
export async function getRecordingDetail(recordingId: string): Promise<RecordingDetail> {
  const { data } = await api.get(`/recordings/${recordingId}`);
  return data;
}

/** Get a pre-signed audio URL for playback. */
export async function getAudioUrl(recordingId: string): Promise<{ url: string }> {
  const { data } = await api.get(`/recordings/${recordingId}/audio`);
  return data;
}

/** Toggle the favorite status of a recording. */
export async function toggleFavorite(recordingId: string): Promise<{ isFavorited: boolean }> {
  const { data } = await api.post(`/recordings/${recordingId}/favorite`);
  return data;
}

/** Set the review status (e.g. "REVIEWED", "NEEDS_COACHING", "FLAGGED"). */
export async function setReviewStatus(recordingId: string, status: string): Promise<void> {
  await api.patch(`/recordings/${recordingId}/review-status`, { status });
}

/** Add a coaching note to a recording, optionally linked to a playback timestamp. */
export async function addCoachingNote(
  recordingId: string,
  content: string,
  timestampSeconds?: number,
): Promise<CoachingNote> {
  const { data } = await api.post(`/recordings/${recordingId}/coaching-notes`, {
    content,
    timestampSeconds: timestampSeconds ?? null,
  });
  return data;
}
