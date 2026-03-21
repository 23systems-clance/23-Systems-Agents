import { api } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Status of a BDR on the salesfloor. */
export type BdrStatus =
  | 'ON_CALL'
  | 'RINGING'
  | 'DISPOSITIONING'
  | 'IDLE'
  | 'PAUSED'
  | 'OFFLINE';

/** Individual BDR card data for the salesfloor grid. */
export interface BdrStatusCard {
  bdrId: string;
  bdrName: string;
  avatarInitial: string;
  status: BdrStatus;
  currentContact: {
    name: string;
    company: string | null;
    phone: string;
  } | null;
  callDurationSeconds: number | null;
  callStartedAt: string | null;
  sessionStats: {
    dialsToday: number;
    connectsToday: number;
    queueRemaining: number;
  };
  idleMinutes: number | null;
  isIdleWarning: boolean;
  activeCallSessionId: string | null;
  conferenceName: string | null;
}

/** Aggregate team-level KPI pulse. */
export interface TeamPulse {
  totalActiveBdrs: number;
  totalDialsToday: number;
  totalConnectsToday: number;
  avgDialToConnectPct: number;
}

/** Combined salesfloor snapshot returned by the API. */
export interface SalesfloorData {
  bdrCards: BdrStatusCard[];
  teamPulse: TeamPulse;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** Fetch the current salesfloor snapshot for a given client. */
export async function getSalesfloorData(
  clientId: string,
  filters?: { teamId?: string; bdrIds?: string[] },
): Promise<SalesfloorData> {
  const params: Record<string, string> = { clientId };
  if (filters?.teamId) params.teamId = filters.teamId;
  if (filters?.bdrIds?.length) params.bdrIds = filters.bdrIds.join(',');
  const { data } = await api.get('/salesfloor', { params });
  return data;
}
