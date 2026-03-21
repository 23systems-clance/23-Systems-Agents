/**
 * Salesfloor Service (T099)
 *
 * Real-time BDR activity monitoring for the Salesfloor Dashboard:
 * - Active BDR statuses with current call info
 * - Team Pulse aggregate KPIs
 * - Idle BDR detection
 */

import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface BdrStatusCard {
  bdrId: string;
  bdrName: string;
  avatarInitial: string;
  status: 'ON_CALL' | 'RINGING' | 'DISPOSITIONING' | 'IDLE' | 'PAUSED' | 'OFFLINE';
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

export interface TeamPulse {
  totalActiveBdrs: number;
  totalDialsToday: number;
  totalConnectsToday: number;
  avgDialToConnectPct: number;
}

export interface SalesfloorData {
  bdrCards: BdrStatusCard[];
  teamPulse: TeamPulse;
}

/** Idle threshold in minutes before a warning is shown. */
const IDLE_WARNING_MINUTES = 5;

/* ------------------------------------------------------------------ */
/*  getActiveBdrStatuses                                               */
/* ------------------------------------------------------------------ */

/**
 * Fetch all active BDR status cards for the salesfloor dashboard.
 *
 * Uses a single raw SQL query with a LATERAL join to efficiently
 * retrieve each active session's latest call, plus inline subquery
 * counts for dials, connects, and remaining queue items.
 *
 * @param clientId - The client (workspace) to query.
 * @param filters  - Optional team or BDR-level filters.
 * @returns Array of BdrStatusCard sorted by BDR name.
 */
export async function getActiveBdrStatuses(
  clientId: string,
  filters?: { teamId?: string; bdrIds?: string[] },
): Promise<BdrStatusCard[]> {
  // Build optional WHERE clauses for filters.
  const conditions: string[] = [
    `ds."clientId" = $1`,
    `ds.status IN ('ACTIVE', 'PAUSED')`,
  ];
  const params: any[] = [clientId];
  let paramIndex = 2;

  if (filters?.teamId) {
    conditions.push(`b."teamId" = $${paramIndex}`);
    params.push(filters.teamId);
    paramIndex++;
  }

  if (filters?.bdrIds && filters.bdrIds.length > 0) {
    conditions.push(`b.id = ANY($${paramIndex}::text[])`);
    params.push(filters.bdrIds);
    paramIndex++;
  }

  const whereClause = conditions.join(' AND ');

  const sql = `
    SELECT
      ds.id          AS "sessionId",
      ds.status      AS "sessionStatus",
      b.id           AS "bdrId",
      b."displayName" AS "bdrName",
      cs.id          AS "callSessionId",
      cs.status      AS "callStatus",
      cs."answeredAt",
      cs."endedAt",
      cs."contactName",
      cs."contactPhone",
      cs."companyName",
      cs."conferenceName",
      cs.disposition,
      (SELECT COUNT(*) FROM "CallSession" WHERE "dialerSessionId" = ds.id) AS "dialsToday",
      (SELECT COUNT(*) FROM "CallSession" WHERE "dialerSessionId" = ds.id AND disposition LIKE 'CONNECTED_%') AS "connectsToday",
      (SELECT COUNT(*) FROM "DialerQueueItem" WHERE "dialerSessionId" = ds.id AND status = 'PENDING') AS "queueRemaining"
    FROM "DialerSession" ds
    JOIN "Bdr" b ON ds."bdrId" = b.id
    LEFT JOIN LATERAL (
      SELECT * FROM "CallSession"
      WHERE "dialerSessionId" = ds.id
      ORDER BY "createdAt" DESC LIMIT 1
    ) cs ON true
    WHERE ${whereClause}
    ORDER BY b."displayName" ASC
  `;

  const rows: any[] = await (prisma as any).$queryRawUnsafe(sql, ...params);
  const now = Date.now();

  return rows.map((row) => {
    const status = deriveBdrStatus(row);
    const callStartedAt = row.answeredAt ? new Date(row.answeredAt).toISOString() : null;
    const callDurationSeconds = row.answeredAt && !row.endedAt
      ? Math.floor((now - new Date(row.answeredAt).getTime()) / 1000)
      : null;

    // Idle minutes: time since last call ended (only when not on a call).
    let idleMinutes: number | null = null;
    if (status !== 'ON_CALL' && status !== 'RINGING' && row.endedAt) {
      idleMinutes = Math.floor((now - new Date(row.endedAt).getTime()) / 60000);
    }

    const isIdleWarning =
      status !== 'PAUSED' && idleMinutes !== null && idleMinutes >= IDLE_WARNING_MINUTES;

    const bdrName = row.bdrName ?? 'Unknown';

    return {
      bdrId: row.bdrId,
      bdrName,
      avatarInitial: bdrName.charAt(0).toUpperCase(),
      status,
      currentContact:
        status === 'ON_CALL' || status === 'RINGING' || status === 'DISPOSITIONING'
          ? {
              name: row.contactName ?? 'Unknown',
              company: row.companyName ?? null,
              phone: row.contactPhone ?? '',
            }
          : null,
      callDurationSeconds,
      callStartedAt,
      sessionStats: {
        dialsToday: Number(row.dialsToday),
        connectsToday: Number(row.connectsToday),
        queueRemaining: Number(row.queueRemaining),
      },
      idleMinutes,
      isIdleWarning,
      activeCallSessionId: status === 'ON_CALL' || status === 'RINGING' ? row.callSessionId : null,
      conferenceName:
        status === 'ON_CALL' || status === 'RINGING' ? (row.conferenceName ?? null) : null,
    } satisfies BdrStatusCard;
  });
}

/* ------------------------------------------------------------------ */
/*  getTeamPulseKPIs                                                   */
/* ------------------------------------------------------------------ */

/**
 * Compute aggregate Team Pulse KPIs across all active sessions for a client.
 *
 * @param clientId - The client (workspace) to query.
 * @returns TeamPulse with total active BDRs, dials, connects, and avg connect %.
 */
export async function getTeamPulseKPIs(clientId: string): Promise<TeamPulse> {
  const sql = `
    SELECT
      COUNT(DISTINCT ds."bdrId")::int AS "totalActiveBdrs",
      COALESCE(SUM(sub."dials"), 0)::int AS "totalDialsToday",
      COALESCE(SUM(sub."connects"), 0)::int AS "totalConnectsToday"
    FROM "DialerSession" ds
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int AS "dials",
        COUNT(*) FILTER (WHERE disposition LIKE 'CONNECTED_%')::int AS "connects"
      FROM "CallSession"
      WHERE "dialerSessionId" = ds.id
    ) sub ON true
    WHERE ds."clientId" = $1
      AND ds.status IN ('ACTIVE', 'PAUSED')
  `;

  const rows: any[] = await (prisma as any).$queryRawUnsafe(sql, clientId);
  const row = rows[0] ?? {};

  const totalDialsToday = Number(row.totalDialsToday ?? 0);
  const totalConnectsToday = Number(row.totalConnectsToday ?? 0);
  const avgDialToConnectPct =
    totalDialsToday > 0
      ? Math.round((totalConnectsToday / totalDialsToday) * 10000) / 100
      : 0;

  return {
    totalActiveBdrs: Number(row.totalActiveBdrs ?? 0),
    totalDialsToday,
    totalConnectsToday,
    avgDialToConnectPct,
  };
}

/* ------------------------------------------------------------------ */
/*  detectIdleBDRs                                                     */
/* ------------------------------------------------------------------ */

/**
 * Detect BDRs with active (non-paused) sessions that have had no call
 * activity for 5+ minutes.
 *
 * @param clientId - The client (workspace) to query.
 * @returns Array of bdrId strings for idle BDRs.
 */
export async function detectIdleBDRs(clientId: string): Promise<string[]> {
  const sql = `
    SELECT DISTINCT ds."bdrId"
    FROM "DialerSession" ds
    LEFT JOIN LATERAL (
      SELECT "endedAt", "createdAt"
      FROM "CallSession"
      WHERE "dialerSessionId" = ds.id
      ORDER BY "createdAt" DESC LIMIT 1
    ) cs ON true
    WHERE ds."clientId" = $1
      AND ds.status = 'ACTIVE'
      AND (
        -- No call sessions at all (idle since session start)
        cs."endedAt" IS NULL AND cs."createdAt" IS NULL
        OR
        -- Last call ended 5+ minutes ago
        (cs."endedAt" IS NOT NULL
         AND cs."endedAt" < NOW() - INTERVAL '${IDLE_WARNING_MINUTES} minutes')
      )
  `;

  const rows: any[] = await (prisma as any).$queryRawUnsafe(sql, clientId);
  return rows.map((r) => r.bdrId as string);
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Derive the BDR display status from the raw query row.
 *
 * Priority:
 *   1. Session PAUSED -> PAUSED
 *   2. Latest CallSession IN_PROGRESS + answeredAt -> ON_CALL
 *   3. Latest CallSession IN_PROGRESS + no answeredAt -> RINGING
 *   4. Latest CallSession COMPLETED + no disposition -> DISPOSITIONING
 *   5. Otherwise -> IDLE
 */
function deriveBdrStatus(
  row: any,
): BdrStatusCard['status'] {
  if (row.sessionStatus === 'PAUSED') return 'PAUSED';

  if (row.callStatus === 'IN_PROGRESS') {
    return row.answeredAt ? 'ON_CALL' : 'RINGING';
  }

  if (row.callStatus === 'COMPLETED' && !row.disposition) {
    return 'DISPOSITIONING';
  }

  return 'IDLE';
}
