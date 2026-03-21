/**
 * Analytics Service (T086)
 *
 * Query builders for dialer performance analytics:
 * - Rep performance (aggregate CallSession by bdrId)
 * - List performance (aggregate by campaign)
 * - Account performance (aggregate by companyName)
 * - Call history (paginated call log)
 * - Objections breakdown
 * - When-to-call heatmap data
 */

import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

/** Maximum date range: 90 days. */
const MAX_RANGE_DAYS = 90;

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface AnalyticsFilters {
  clientId: string;
  startDate: Date;
  endDate: Date;
  bdrIds?: string[];
  campaignIds?: string[];
  companyNames?: string[];
  callTypes?: string[];
}

export interface RepPerformanceRow {
  bdrId: string;
  bdrName: string;
  dials: number;
  connects: number;
  conversations: number;
  meetings: number;
  callbacks: number;
  callbackConnects: number;
  voicemails: number;
  noAnswers: number;
  dialToConnectPct: number;
  callbackToConnectPct: number;
  connectToConversationPct: number;
  conversationToMeetingPct: number;
  totalTalkTimeSeconds: number;
  totalSessionTimeSeconds: number;
}

export interface ListPerformanceRow {
  campaignId: string;
  campaignName: string;
  dials: number;
  connects: number;
  conversations: number;
  meetings: number;
  dialToConnectPct: number;
  connectToConversationPct: number;
  conversationToMeetingPct: number;
  dispositionBreakdown: Record<string, number>;
}

export interface AccountPerformanceRow {
  companyName: string;
  dials: number;
  connects: number;
  conversations: number;
  meetings: number;
  lastCalledAt: string | null;
}

export interface CallHistoryRow {
  id: string;
  bdrName: string;
  contactName: string;
  contactPhone: string;
  companyName: string | null;
  campaignName: string | null;
  disposition: string | null;
  durationSeconds: number | null;
  dialedAt: string;
  amdResult: string | null;
}

export interface KPISummary {
  totalDials: number;
  totalCallbacks: number;
  totalConnects: number;
  totalConversations: number;
  totalMeetings: number;
  dialToConnectPct: number;
  callbackToConnectPct: number;
  connectToConversationPct: number;
  conversationToMeetingPct: number;
}

export interface ObjectionRow {
  type: string;
  count: number;
  percentage: number;
  byBdr: Array<{ bdrId: string; bdrName: string; count: number }>;
}

export interface WhenToCallCell {
  dayOfWeek: number; // 0=Sun, 6=Sat
  hour: number; // 0-23
  dials: number;
  connects: number;
  connectRate: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Safe percentage: rounds to one decimal place.
 * Returns 0 when denominator is zero.
 */
function pct(num: number, den: number): number {
  return den > 0 ? Math.round((num / den) * 1000) / 10 : 0;
}

/**
 * Validate that the date range does not exceed MAX_RANGE_DAYS.
 * Throws an Error if it does.
 */
export function validateDateRange(startDate: Date, endDate: Date): void {
  const diffMs = endDate.getTime() - startDate.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays < 0) {
    throw new Error('startDate must be before endDate');
  }
  if (diffDays > MAX_RANGE_DAYS) {
    throw new Error(`Date range cannot exceed ${MAX_RANGE_DAYS} days (requested ${Math.ceil(diffDays)} days)`);
  }
}

/**
 * Build a Prisma-compatible `where` clause for CallSession queries.
 */
export function buildWhereClause(filters: AnalyticsFilters): Record<string, any> {
  const where: Record<string, any> = {
    clientId: filters.clientId,
    dialedAt: {
      gte: filters.startDate,
      lte: filters.endDate,
    },
  };

  if (filters.bdrIds && filters.bdrIds.length > 0) {
    where.bdrId = { in: filters.bdrIds };
  }
  if (filters.campaignIds && filters.campaignIds.length > 0) {
    where.dialerSession = { campaignId: { in: filters.campaignIds } };
  }
  if (filters.companyNames && filters.companyNames.length > 0) {
    where.companyName = { in: filters.companyNames };
  }
  if (filters.callTypes && filters.callTypes.length > 0) {
    where.disposition = { in: filters.callTypes };
  }

  return where;
}

/**
 * Build optional SQL filter fragments for bdrIds, campaignIds, companyNames, callTypes.
 * Returns raw SQL string to append inside a WHERE clause (already AND-prefixed).
 */
function buildOptionalSqlFilters(filters: AnalyticsFilters): string {
  const parts: string[] = [];

  if (filters.bdrIds && filters.bdrIds.length > 0) {
    const escaped = filters.bdrIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(',');
    parts.push(`AND cs."bdrId" IN (${escaped})`);
  }
  if (filters.campaignIds && filters.campaignIds.length > 0) {
    const escaped = filters.campaignIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(',');
    parts.push(`AND ds."campaignId" IN (${escaped})`);
  }
  if (filters.companyNames && filters.companyNames.length > 0) {
    const escaped = filters.companyNames.map((n) => `'${n.replace(/'/g, "''")}'`).join(',');
    parts.push(`AND cs."companyName" IN (${escaped})`);
  }
  if (filters.callTypes && filters.callTypes.length > 0) {
    const escaped = filters.callTypes.map((t) => `'${t.replace(/'/g, "''")}'`).join(',');
    parts.push(`AND cs."disposition" IN (${escaped})`);
  }

  return parts.join('\n    ');
}

/* ------------------------------------------------------------------ */
/*  KPI Summary                                                        */
/* ------------------------------------------------------------------ */

/**
 * Aggregate KPI summary across all matching CallSessions.
 */
export async function getKPISummary(filters: AnalyticsFilters): Promise<KPISummary> {
  validateDateRange(filters.startDate, filters.endDate);

  const optFilters = buildOptionalSqlFilters(filters);
  const needsDialerJoin = filters.campaignIds && filters.campaignIds.length > 0;
  const dialerJoin = needsDialerJoin
    ? 'LEFT JOIN "DialerSession" ds ON cs."dialerSessionId" = ds."id"'
    : '';

  const rows: any[] = await (prisma as any).$queryRawUnsafe(`
    SELECT
      COUNT(*)::int AS "totalDials",
      COUNT(*) FILTER (WHERE cs."disposition" LIKE 'CONNECTED_%')::int AS "totalConnects",
      COUNT(*) FILTER (WHERE cs."disposition" IN ('CONNECTED_INTERESTED', 'CONNECTED_CALLBACK_REQUESTED'))::int AS "totalConversations",
      COUNT(*) FILTER (WHERE cs."disposition" = 'CONNECTED_INTERESTED')::int AS "totalMeetings",
      COUNT(*) FILTER (WHERE cs."disposition" = 'CONNECTED_CALLBACK_REQUESTED')::int AS "totalCallbacks",
      COUNT(*) FILTER (WHERE cs."disposition" = 'VOICEMAIL_LEFT')::int AS "totalVoicemails"
    FROM "CallSession" cs
    ${dialerJoin}
    WHERE cs."clientId" = $1
      AND cs."dialedAt" >= $2
      AND cs."dialedAt" <= $3
      ${optFilters}
  `, filters.clientId, filters.startDate, filters.endDate);

  const r = rows[0] || {};
  const totalDials = Number(r.totalDials) || 0;
  const totalConnects = Number(r.totalConnects) || 0;
  const totalConversations = Number(r.totalConversations) || 0;
  const totalMeetings = Number(r.totalMeetings) || 0;
  const totalCallbacks = Number(r.totalCallbacks) || 0;

  // Count completed callbacks from ScheduledCallback model
  let callbackConnects = 0;
  try {
    const cbRows: any[] = await (prisma as any).$queryRawUnsafe(`
      SELECT COUNT(*)::int AS cnt
      FROM "ScheduledCallback" sc
      WHERE sc."clientId" = $1
        AND sc."status" = 'COMPLETED'
        AND sc."scheduledAt" >= $2
        AND sc."scheduledAt" <= $3
    `, filters.clientId, filters.startDate, filters.endDate);
    callbackConnects = Number(cbRows[0]?.cnt) || 0;
  } catch {
    // ScheduledCallback table may not exist yet
    logger.warn('[Analytics] ScheduledCallback query failed, defaulting callbackConnects to 0');
  }

  return {
    totalDials,
    totalCallbacks,
    totalConnects,
    totalConversations,
    totalMeetings,
    dialToConnectPct: pct(totalConnects, totalDials),
    callbackToConnectPct: pct(callbackConnects, totalCallbacks),
    connectToConversationPct: pct(totalConversations, totalConnects),
    conversationToMeetingPct: pct(totalMeetings, totalConversations),
  };
}

/* ------------------------------------------------------------------ */
/*  Rep Performance                                                    */
/* ------------------------------------------------------------------ */

/**
 * Per-rep performance metrics grouped by bdrId.
 */
export async function getRepPerformance(filters: AnalyticsFilters): Promise<RepPerformanceRow[]> {
  validateDateRange(filters.startDate, filters.endDate);

  const optFilters = buildOptionalSqlFilters(filters);
  const needsDialerJoin = filters.campaignIds && filters.campaignIds.length > 0;
  const dialerJoin = needsDialerJoin
    ? 'LEFT JOIN "DialerSession" ds ON cs."dialerSessionId" = ds."id"'
    : '';

  const rows: any[] = await (prisma as any).$queryRawUnsafe(`
    SELECT
      cs."bdrId",
      b."displayName" AS "bdrName",
      COUNT(*)::int AS dials,
      COUNT(*) FILTER (WHERE cs."disposition" LIKE 'CONNECTED_%')::int AS connects,
      COUNT(*) FILTER (WHERE cs."disposition" IN ('CONNECTED_INTERESTED', 'CONNECTED_CALLBACK_REQUESTED'))::int AS conversations,
      COUNT(*) FILTER (WHERE cs."disposition" = 'CONNECTED_INTERESTED')::int AS meetings,
      COUNT(*) FILTER (WHERE cs."disposition" = 'CONNECTED_CALLBACK_REQUESTED')::int AS callbacks,
      COUNT(*) FILTER (WHERE cs."disposition" = 'VOICEMAIL_LEFT')::int AS voicemails,
      COUNT(*) FILTER (WHERE cs."disposition" = 'NO_ANSWER')::int AS "noAnswers",
      COALESCE(SUM(cs."durationSeconds"), 0)::int AS "totalTalkTimeSeconds",
      COALESCE(SUM(cs."sessionDurationSeconds"), 0)::int AS "totalSessionTimeSeconds"
    FROM "CallSession" cs
    LEFT JOIN "Bdr" b ON cs."bdrId" = b."id"
    ${dialerJoin}
    WHERE cs."clientId" = $1
      AND cs."dialedAt" >= $2
      AND cs."dialedAt" <= $3
      ${optFilters}
    GROUP BY cs."bdrId", b."displayName"
    ORDER BY dials DESC
  `, filters.clientId, filters.startDate, filters.endDate);

  // Fetch callback connects per BDR
  let callbackMap: Record<string, number> = {};
  try {
    const cbRows: any[] = await (prisma as any).$queryRawUnsafe(`
      SELECT sc."bdrId", COUNT(*)::int AS cnt
      FROM "ScheduledCallback" sc
      WHERE sc."clientId" = $1
        AND sc."status" = 'COMPLETED'
        AND sc."scheduledAt" >= $2
        AND sc."scheduledAt" <= $3
      GROUP BY sc."bdrId"
    `, filters.clientId, filters.startDate, filters.endDate);
    for (const row of cbRows) {
      callbackMap[row.bdrId] = Number(row.cnt) || 0;
    }
  } catch {
    logger.warn('[Analytics] ScheduledCallback query failed for rep performance');
  }

  return rows.map((r) => {
    const dials = Number(r.dials);
    const connects = Number(r.connects);
    const conversations = Number(r.conversations);
    const meetings = Number(r.meetings);
    const callbacks = Number(r.callbacks);
    const callbackConnects = callbackMap[r.bdrId] || 0;

    return {
      bdrId: r.bdrId,
      bdrName: r.bdrName || 'Unknown',
      dials,
      connects,
      conversations,
      meetings,
      callbacks,
      callbackConnects,
      voicemails: Number(r.voicemails),
      noAnswers: Number(r.noAnswers),
      dialToConnectPct: pct(connects, dials),
      callbackToConnectPct: pct(callbackConnects, callbacks),
      connectToConversationPct: pct(conversations, connects),
      conversationToMeetingPct: pct(meetings, conversations),
      totalTalkTimeSeconds: Number(r.totalTalkTimeSeconds),
      totalSessionTimeSeconds: Number(r.totalSessionTimeSeconds),
    };
  });
}

/* ------------------------------------------------------------------ */
/*  List Performance                                                   */
/* ------------------------------------------------------------------ */

/**
 * Per-campaign/list performance metrics with disposition breakdowns.
 */
export async function getListPerformance(filters: AnalyticsFilters): Promise<ListPerformanceRow[]> {
  validateDateRange(filters.startDate, filters.endDate);

  const optFilters = buildOptionalSqlFilters(filters);

  // Aggregate per campaign
  const rows: any[] = await (prisma as any).$queryRawUnsafe(`
    SELECT
      ds."campaignId",
      c."name" AS "campaignName",
      COUNT(*)::int AS dials,
      COUNT(*) FILTER (WHERE cs."disposition" LIKE 'CONNECTED_%')::int AS connects,
      COUNT(*) FILTER (WHERE cs."disposition" IN ('CONNECTED_INTERESTED', 'CONNECTED_CALLBACK_REQUESTED'))::int AS conversations,
      COUNT(*) FILTER (WHERE cs."disposition" = 'CONNECTED_INTERESTED')::int AS meetings
    FROM "CallSession" cs
    LEFT JOIN "DialerSession" ds ON cs."dialerSessionId" = ds."id"
    LEFT JOIN "Campaign" c ON ds."campaignId" = c."id"
    WHERE cs."clientId" = $1
      AND cs."dialedAt" >= $2
      AND cs."dialedAt" <= $3
      AND ds."campaignId" IS NOT NULL
      ${optFilters}
    GROUP BY ds."campaignId", c."name"
    ORDER BY dials DESC
  `, filters.clientId, filters.startDate, filters.endDate);

  // Fetch disposition breakdowns per campaign
  const dispoRows: any[] = await (prisma as any).$queryRawUnsafe(`
    SELECT
      ds."campaignId",
      cs."disposition",
      COUNT(*)::int AS cnt
    FROM "CallSession" cs
    LEFT JOIN "DialerSession" ds ON cs."dialerSessionId" = ds."id"
    WHERE cs."clientId" = $1
      AND cs."dialedAt" >= $2
      AND cs."dialedAt" <= $3
      AND ds."campaignId" IS NOT NULL
      AND cs."disposition" IS NOT NULL
      ${optFilters}
    GROUP BY ds."campaignId", cs."disposition"
  `, filters.clientId, filters.startDate, filters.endDate);

  // Build disposition map: campaignId -> { disposition -> count }
  const dispoMap: Record<string, Record<string, number>> = {};
  for (const dr of dispoRows) {
    if (!dispoMap[dr.campaignId]) dispoMap[dr.campaignId] = {};
    dispoMap[dr.campaignId][dr.disposition] = Number(dr.cnt);
  }

  return rows.map((r) => {
    const dials = Number(r.dials);
    const connects = Number(r.connects);
    const conversations = Number(r.conversations);
    const meetings = Number(r.meetings);

    return {
      campaignId: r.campaignId,
      campaignName: r.campaignName || 'Unknown',
      dials,
      connects,
      conversations,
      meetings,
      dialToConnectPct: pct(connects, dials),
      connectToConversationPct: pct(conversations, connects),
      conversationToMeetingPct: pct(meetings, conversations),
      dispositionBreakdown: dispoMap[r.campaignId] || {},
    };
  });
}

/* ------------------------------------------------------------------ */
/*  Account Performance                                                */
/* ------------------------------------------------------------------ */

/**
 * Per-company performance metrics.
 */
export async function getAccountPerformance(filters: AnalyticsFilters): Promise<AccountPerformanceRow[]> {
  validateDateRange(filters.startDate, filters.endDate);

  const optFilters = buildOptionalSqlFilters(filters);
  const needsDialerJoin = filters.campaignIds && filters.campaignIds.length > 0;
  const dialerJoin = needsDialerJoin
    ? 'LEFT JOIN "DialerSession" ds ON cs."dialerSessionId" = ds."id"'
    : '';

  const rows: any[] = await (prisma as any).$queryRawUnsafe(`
    SELECT
      cs."companyName",
      COUNT(*)::int AS dials,
      COUNT(*) FILTER (WHERE cs."disposition" LIKE 'CONNECTED_%')::int AS connects,
      COUNT(*) FILTER (WHERE cs."disposition" IN ('CONNECTED_INTERESTED', 'CONNECTED_CALLBACK_REQUESTED'))::int AS conversations,
      COUNT(*) FILTER (WHERE cs."disposition" = 'CONNECTED_INTERESTED')::int AS meetings,
      MAX(cs."dialedAt") AS "lastCalledAt"
    FROM "CallSession" cs
    ${dialerJoin}
    WHERE cs."clientId" = $1
      AND cs."dialedAt" >= $2
      AND cs."dialedAt" <= $3
      AND cs."companyName" IS NOT NULL
      ${optFilters}
    GROUP BY cs."companyName"
    ORDER BY dials DESC
  `, filters.clientId, filters.startDate, filters.endDate);

  return rows.map((r) => ({
    companyName: r.companyName,
    dials: Number(r.dials),
    connects: Number(r.connects),
    conversations: Number(r.conversations),
    meetings: Number(r.meetings),
    lastCalledAt: r.lastCalledAt ? new Date(r.lastCalledAt).toISOString() : null,
  }));
}

/* ------------------------------------------------------------------ */
/*  Call History (Paginated)                                           */
/* ------------------------------------------------------------------ */

/**
 * Paginated call log with BDR name, contact info, disposition, duration.
 */
export async function getCallHistory(
  filters: AnalyticsFilters,
  page: number,
  pageSize: number,
): Promise<{ rows: CallHistoryRow[]; total: number }> {
  validateDateRange(filters.startDate, filters.endDate);

  const offset = (page - 1) * pageSize;
  const optFilters = buildOptionalSqlFilters(filters);
  const needsDialerJoin = filters.campaignIds && filters.campaignIds.length > 0;
  const dialerJoin = needsDialerJoin
    ? 'LEFT JOIN "DialerSession" ds ON cs."dialerSessionId" = ds."id"'
    : '';

  // Always join DialerSession and Campaign for display even if not filtering
  const displayJoins = needsDialerJoin
    ? 'LEFT JOIN "Campaign" camp ON ds."campaignId" = camp."id"'
    : `LEFT JOIN "DialerSession" ds2 ON cs."dialerSessionId" = ds2."id"
       LEFT JOIN "Campaign" camp ON ds2."campaignId" = camp."id"`;

  const dsAlias = needsDialerJoin ? 'ds' : 'ds2';

  // Total count
  const countRows: any[] = await (prisma as any).$queryRawUnsafe(`
    SELECT COUNT(*)::int AS total
    FROM "CallSession" cs
    ${dialerJoin}
    WHERE cs."clientId" = $1
      AND cs."dialedAt" >= $2
      AND cs."dialedAt" <= $3
      ${optFilters}
  `, filters.clientId, filters.startDate, filters.endDate);

  const total = Number(countRows[0]?.total) || 0;

  // Data rows
  const rows: any[] = await (prisma as any).$queryRawUnsafe(`
    SELECT
      cs."id",
      b."displayName" AS "bdrName",
      cs."contactName",
      cs."contactPhone",
      cs."companyName",
      camp."name" AS "campaignName",
      cs."disposition",
      cs."durationSeconds",
      cs."dialedAt",
      cs."amdResult"
    FROM "CallSession" cs
    LEFT JOIN "Bdr" b ON cs."bdrId" = b."id"
    ${dialerJoin}
    ${displayJoins}
    WHERE cs."clientId" = $1
      AND cs."dialedAt" >= $2
      AND cs."dialedAt" <= $3
      ${optFilters}
    ORDER BY cs."dialedAt" DESC
    LIMIT $4 OFFSET $5
  `, filters.clientId, filters.startDate, filters.endDate, pageSize, offset);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      bdrName: r.bdrName || 'Unknown',
      contactName: r.contactName || '',
      contactPhone: r.contactPhone || '',
      companyName: r.companyName || null,
      campaignName: r.campaignName || null,
      disposition: r.disposition || null,
      durationSeconds: r.durationSeconds != null ? Number(r.durationSeconds) : null,
      dialedAt: new Date(r.dialedAt).toISOString(),
      amdResult: r.amdResult || null,
    })),
    total,
  };
}

/* ------------------------------------------------------------------ */
/*  Objections Breakdown                                               */
/* ------------------------------------------------------------------ */

/** Dispositions treated as "objections". */
const OBJECTION_DISPOSITIONS = [
  'CONNECTED_NOT_INTERESTED',
  'CONNECTED_WRONG_PERSON',
  'CONNECTED_DO_NOT_CALL',
  'DO_NOT_CALL',
] as const;

/**
 * Objection-type breakdown with per-BDR detail.
 */
export async function getObjections(filters: AnalyticsFilters): Promise<ObjectionRow[]> {
  validateDateRange(filters.startDate, filters.endDate);

  const optFilters = buildOptionalSqlFilters(filters);
  const needsDialerJoin = filters.campaignIds && filters.campaignIds.length > 0;
  const dialerJoin = needsDialerJoin
    ? 'LEFT JOIN "DialerSession" ds ON cs."dialerSessionId" = ds."id"'
    : '';

  const dispoList = OBJECTION_DISPOSITIONS.map((d) => `'${d}'`).join(',');

  // Overall counts by type
  const typeRows: any[] = await (prisma as any).$queryRawUnsafe(`
    SELECT
      cs."disposition" AS type,
      COUNT(*)::int AS count
    FROM "CallSession" cs
    ${dialerJoin}
    WHERE cs."clientId" = $1
      AND cs."dialedAt" >= $2
      AND cs."dialedAt" <= $3
      AND cs."disposition" IN (${dispoList})
      ${optFilters}
    GROUP BY cs."disposition"
    ORDER BY count DESC
  `, filters.clientId, filters.startDate, filters.endDate);

  const grandTotal = typeRows.reduce((sum, r) => sum + Number(r.count), 0);

  // Per-BDR breakdown
  const bdrRows: any[] = await (prisma as any).$queryRawUnsafe(`
    SELECT
      cs."disposition" AS type,
      cs."bdrId",
      b."displayName" AS "bdrName",
      COUNT(*)::int AS count
    FROM "CallSession" cs
    LEFT JOIN "Bdr" b ON cs."bdrId" = b."id"
    ${dialerJoin}
    WHERE cs."clientId" = $1
      AND cs."dialedAt" >= $2
      AND cs."dialedAt" <= $3
      AND cs."disposition" IN (${dispoList})
      ${optFilters}
    GROUP BY cs."disposition", cs."bdrId", b."displayName"
    ORDER BY cs."disposition", count DESC
  `, filters.clientId, filters.startDate, filters.endDate);

  // Map BDR rows by type
  const bdrMap: Record<string, Array<{ bdrId: string; bdrName: string; count: number }>> = {};
  for (const br of bdrRows) {
    const type = br.type;
    if (!bdrMap[type]) bdrMap[type] = [];
    bdrMap[type].push({
      bdrId: br.bdrId,
      bdrName: br.bdrName || 'Unknown',
      count: Number(br.count),
    });
  }

  return typeRows.map((r) => ({
    type: r.type,
    count: Number(r.count),
    percentage: pct(Number(r.count), grandTotal),
    byBdr: bdrMap[r.type] || [],
  }));
}

/* ------------------------------------------------------------------ */
/*  When-to-Call Heatmap                                               */
/* ------------------------------------------------------------------ */

/**
 * Day-of-week / hour-of-day heatmap showing dial counts and connect rates.
 * Returns 7 * 24 = 168 cells.
 */
export async function getWhenToCall(filters: AnalyticsFilters): Promise<WhenToCallCell[]> {
  validateDateRange(filters.startDate, filters.endDate);

  const optFilters = buildOptionalSqlFilters(filters);
  const needsDialerJoin = filters.campaignIds && filters.campaignIds.length > 0;
  const dialerJoin = needsDialerJoin
    ? 'LEFT JOIN "DialerSession" ds ON cs."dialerSessionId" = ds."id"'
    : '';

  const rows: any[] = await (prisma as any).$queryRawUnsafe(`
    SELECT
      EXTRACT(DOW FROM cs."dialedAt")::int AS "dayOfWeek",
      EXTRACT(HOUR FROM cs."dialedAt")::int AS hour,
      COUNT(*)::int AS dials,
      COUNT(*) FILTER (WHERE cs."disposition" LIKE 'CONNECTED_%')::int AS connects
    FROM "CallSession" cs
    ${dialerJoin}
    WHERE cs."clientId" = $1
      AND cs."dialedAt" >= $2
      AND cs."dialedAt" <= $3
      ${optFilters}
    GROUP BY "dayOfWeek", hour
    ORDER BY "dayOfWeek", hour
  `, filters.clientId, filters.startDate, filters.endDate);

  // Build a full 7x24 grid, filling in zeros for missing cells
  const dataMap: Record<string, { dials: number; connects: number }> = {};
  for (const r of rows) {
    const key = `${r.dayOfWeek}-${r.hour}`;
    dataMap[key] = {
      dials: Number(r.dials),
      connects: Number(r.connects),
    };
  }

  const cells: WhenToCallCell[] = [];
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const key = `${day}-${hour}`;
      const data = dataMap[key] || { dials: 0, connects: 0 };
      cells.push({
        dayOfWeek: day,
        hour,
        dials: data.dials,
        connects: data.connects,
        connectRate: pct(data.connects, data.dials),
      });
    }
  }

  return cells;
}
