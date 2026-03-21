/**
 * Call Quality Service (T043)
 * Collects post-call quality metrics from Twilio Voice Insights API.
 * Stores in CallQualityMetric for analytics.
 */

import { prisma } from '../../models/index.js';
import { twilioRestClient } from './twilioClient.js';
import logger from '../../lib/logger.js';

interface QualityMetrics {
  mos: number | null;
  jitter: number | null;
  packetLossPercentage: number | null;
  rttMs: number | null;
  codec: string | null;
  edge: string | null;
}

/**
 * Collect post-call quality metrics from Twilio Voice Insights.
 * Should be called ~90 seconds after call ends (Insights data takes time to be available).
 */
export async function collectPostCallMetrics(callSessionId: string): Promise<void> {
  const callSession = await prisma.callSession.findUnique({
    where: { id: callSessionId },
  });

  if (!callSession?.twilioCallSid) {
    logger.warn('[CallQuality] No Twilio call SID for session', { callSessionId });
    return;
  }

  try {
    // Fetch Call Summary from Twilio Voice Insights API
    const summary = await twilioRestClient
      .insights.v1
      .calls(callSession.twilioCallSid)
      .summary()
      .fetch();

    const metrics: QualityMetrics = {
      mos: (summary as any).callQuality?.mos ?? null,
      jitter: (summary as any).callQuality?.jitter ?? null,
      packetLossPercentage: (summary as any).callQuality?.packetLossPercentage ?? null,
      rttMs: (summary as any).callQuality?.rtt ?? null,
      codec: (summary as any).properties?.codec ?? null,
      edge: (summary as any).properties?.edge ?? null,
    };

    // Store in CallQualityMetric
    await prisma.callQualityMetric.create({
      data: {
        callSessionId,
        bdrId: callSession.bdrId,
        clientId: callSession.clientId,
        mos: metrics.mos,
        jitter: metrics.jitter,
        packetLossPercentage: metrics.packetLossPercentage,
        roundTripTimeMs: metrics.rttMs,
        codec: metrics.codec,
        edge: metrics.edge,
      },
    });

    logger.info('[CallQuality] Metrics collected', {
      callSessionId,
      mos: metrics.mos,
      edge: metrics.edge,
    });
  } catch (error: any) {
    logger.error('[CallQuality] Failed to collect metrics', {
      callSessionId,
      error: error.message,
    });
  }
}

/**
 * Get quality trends for the admin dashboard.
 */
export async function getQualityTrends(clientId: string, days: number = 30): Promise<{
  avgMos: number;
  warningPercentage: number;
  totalCalls: number;
  mosDistribution: Array<{ range: string; count: number }>;
}> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const metrics = await prisma.callQualityMetric.findMany({
    where: {
      clientId,
      createdAt: { gte: since },
    },
    select: { mos: true },
  });

  const totalCalls = metrics.length;
  const mosValues = metrics.map((m: any) => m.mos).filter((v: any): v is number => v !== null);
  const avgMos = mosValues.length > 0 ? mosValues.reduce((a: number, b: number) => a + b, 0) / mosValues.length : 0;
  const warningCount = mosValues.filter((m: number) => m < 3.5).length;
  const warningPercentage = totalCalls > 0 ? (warningCount / totalCalls) * 100 : 0;

  // MOS distribution buckets
  const buckets = [
    { range: '< 2.0', min: 0, max: 2 },
    { range: '2.0 - 3.0', min: 2, max: 3 },
    { range: '3.0 - 3.5', min: 3, max: 3.5 },
    { range: '3.5 - 4.0', min: 3.5, max: 4 },
    { range: '4.0 - 5.0', min: 4, max: 5.1 },
  ];

  const mosDistribution = buckets.map(b => ({
    range: b.range,
    count: mosValues.filter((m: number) => m >= b.min && m < b.max).length,
  }));

  return { avgMos, warningPercentage, totalCalls, mosDistribution };
}

/**
 * Get flagged calls with low MOS scores.
 */
export async function getFlaggedCalls(clientId: string, limit: number = 50): Promise<any[]> {
  const flagged = await prisma.callQualityMetric.findMany({
    where: {
      clientId,
      mos: { lt: 3.5 },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      callSession: {
        select: {
          id: true,
          contactName: true,
          contactPhone: true,
          companyName: true,
          dialedAt: true,
          durationSeconds: true,
        },
      },
      bdr: {
        select: { id: true, name: true },
      },
    },
  });

  return flagged.map((f: any) => ({
    id: f.id,
    callSessionId: f.callSessionId,
    mos: f.mos,
    jitter: f.jitter,
    rttMs: f.roundTripTimeMs,
    codec: f.codec,
    edge: f.edge,
    bdrName: f.bdr?.name,
    contactName: f.callSession?.contactName,
    companyName: f.callSession?.companyName,
    dialedAt: f.callSession?.dialedAt,
    durationSeconds: f.callSession?.durationSeconds,
    createdAt: f.createdAt,
  }));
}
