/**
 * Cache management admin endpoints (Feature 17).
 *
 * GET    /metrics       — Cache performance metrics
 * GET    /config        — Current cache configuration
 * PUT    /config        — Update cache configuration
 * POST   /purge         — Purge cache entries
 * GET    /entries       — List cache entries (paginated)
 * DELETE /entries/:id   — Delete a single cache entry
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../models/index.js';
import { config } from '../../config/index.js';
import * as domainCacheService from '../../services/builtwith/domainCache.js';
import { logAudit } from '../../lib/auditLogger.js';
import logger from '../../lib/logger.js';

export const cacheRouter = Router();

// ---------------------------------------------------------------------------
// GET /metrics — Cache performance metrics
// ---------------------------------------------------------------------------

cacheRouter.get('/metrics', async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Count total and active entries
    const [totalEntries, activeEntries] = await Promise.all([
      prisma.domainEnrichmentCache.count(),
      prisma.domainEnrichmentCache.count({ where: { expiresAt: { gt: now } } }),
    ]);

    // Aggregate cache hits/misses from completed jobs
    const [stats7d, stats30d] = await Promise.all([
      prisma.job.aggregate({
        _sum: { cacheHits: true, cacheMisses: true },
        where: { completedAt: { gte: sevenDaysAgo } },
      }),
      prisma.job.aggregate({
        _sum: { cacheHits: true, cacheMisses: true },
        where: { completedAt: { gte: thirtyDaysAgo } },
      }),
    ]);

    const totalHits7d = stats7d._sum.cacheHits ?? 0;
    const totalMisses7d = stats7d._sum.cacheMisses ?? 0;
    const totalHits30d = stats30d._sum.cacheHits ?? 0;
    const totalMisses30d = stats30d._sum.cacheMisses ?? 0;

    const hitRate7d = totalHits7d + totalMisses7d > 0
      ? totalHits7d / (totalHits7d + totalMisses7d)
      : 0;
    const hitRate30d = totalHits30d + totalMisses30d > 0
      ? totalHits30d / (totalHits30d + totalMisses30d)
      : 0;

    // Cache size via pg_total_relation_size
    let cacheSizeMb = 0;
    try {
      const sizeResult = await prisma.$queryRaw<Array<{ size: bigint }>>`
        SELECT pg_total_relation_size('domain_enrichment_cache') AS size
      `;
      if (sizeResult[0]) {
        cacheSizeMb = Number(sizeResult[0].size) / (1024 * 1024);
      }
    } catch {
      logger.warn('Failed to get cache table size via pg_total_relation_size');
    }

    // Top 10 domains by hit count
    const topDomains = await prisma.domainEnrichmentCache.findMany({
      select: { normalizedDomain: true, hitCount: true },
      orderBy: { hitCount: 'desc' },
      take: 10,
    });

    const costPerCredit = config.builtwith.costPerCredit;

    res.json({
      totalEntries,
      activeEntries,
      expiredEntries: totalEntries - activeEntries,
      hitRate7d: Math.round(hitRate7d * 100) / 100,
      hitRate30d: Math.round(hitRate30d * 100) / 100,
      totalHits7d,
      totalMisses7d,
      totalHits30d,
      totalMisses30d,
      estimatedCreditsSaved: totalHits30d,
      estimatedCostSavedUsd: Math.round(totalHits30d * costPerCredit * 100) / 100,
      cacheSizeMb: Math.round(cacheSizeMb * 100) / 100,
      topDomains: topDomains.map((d) => ({
        domain: d.normalizedDomain,
        hitCount: d.hitCount,
      })),
    });
  } catch (error) {
    logger.error('Failed to fetch cache metrics', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'internal_error', message: 'Failed to fetch cache metrics' });
  }
});

// ---------------------------------------------------------------------------
// GET /config — Current cache configuration
// ---------------------------------------------------------------------------

cacheRouter.get('/config', async (_req: Request, res: Response) => {
  try {
    const cacheConfig = await domainCacheService.getConfig();
    res.json(cacheConfig);
  } catch (error) {
    logger.error('Failed to fetch cache config', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'internal_error', message: 'Failed to fetch cache config' });
  }
});

// ---------------------------------------------------------------------------
// PUT /config — Update cache configuration
// ---------------------------------------------------------------------------

cacheRouter.put('/config', async (req: Request, res: Response) => {
  try {
    const { ttlDays, enabled } = req.body;

    if (ttlDays !== undefined) {
      if (typeof ttlDays !== 'number' || !Number.isInteger(ttlDays) || ttlDays < 30 || ttlDays > 90) {
        res.status(400).json({
          error: 'validation_error',
          message: 'ttlDays must be an integer between 30 and 90',
        });
        return;
      }
    }

    if (enabled !== undefined && typeof enabled !== 'boolean') {
      res.status(400).json({
        error: 'validation_error',
        message: 'enabled must be a boolean',
      });
      return;
    }

    const oldConfig = await domainCacheService.getConfig();

    const updated = await prisma.cacheConfig.update({
      where: { id: oldConfig.id },
      data: {
        ...(ttlDays !== undefined ? { ttlDays } : {}),
        ...(enabled !== undefined ? { enabled } : {}),
      },
    });

    await logAudit({
      action: 'cache_config_updated',
      actorUserId: req.admin!.id,
      actorTeamId: 'admin',
      metadata: {
        oldTtlDays: oldConfig.ttlDays,
        newTtlDays: updated.ttlDays,
        oldEnabled: oldConfig.enabled,
        newEnabled: updated.enabled,
      },
    });

    res.json(updated);
  } catch (error) {
    logger.error('Failed to update cache config', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'internal_error', message: 'Failed to update cache config' });
  }
});

// ---------------------------------------------------------------------------
// POST /purge — Purge cache entries
// ---------------------------------------------------------------------------

cacheRouter.post('/purge', async (req: Request, res: Response) => {
  try {
    const { mode } = req.body;

    if (mode !== 'all' && mode !== 'expired') {
      res.status(400).json({
        error: 'validation_error',
        message: 'mode must be "all" or "expired"',
      });
      return;
    }

    const purgedCount = mode === 'all'
      ? await domainCacheService.purgeAll()
      : await domainCacheService.purgeExpired();

    await logAudit({
      action: 'cache_purged',
      actorUserId: req.admin!.id,
      actorTeamId: 'admin',
      metadata: { mode, purgedCount },
    });

    res.json({ purgedCount, mode });
  } catch (error) {
    logger.error('Failed to purge cache', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'internal_error', message: 'Failed to purge cache' });
  }
});

// ---------------------------------------------------------------------------
// GET /entries — List cache entries (paginated)
// ---------------------------------------------------------------------------

cacheRouter.get('/entries', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query['page'] as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query['limit'] as string, 10) || 50));
    const search = (req.query['search'] as string) || undefined;
    const sortBy = (req.query['sortBy'] as string) || 'enrichedAt';
    const sortOrder = (req.query['sortOrder'] as string) === 'asc' ? 'asc' : 'desc';

    const allowedSortFields = ['enrichedAt', 'hitCount', 'expiresAt'];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'enrichedAt';

    const where: Prisma.DomainEnrichmentCacheWhereInput = search
      ? { normalizedDomain: { contains: search, mode: 'insensitive' } }
      : {};

    const [entries, total] = await Promise.all([
      prisma.domainEnrichmentCache.findMany({
        where,
        select: {
          id: true,
          normalizedDomain: true,
          techSpendTier: true,
          companyName: true,
          technologies: true,
          hitCount: true,
          isComplete: true,
          enrichedAt: true,
          expiresAt: true,
        },
        orderBy: { [sortField]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.domainEnrichmentCache.count({ where }),
    ]);

    res.json({
      entries: entries.map((e) => ({
        id: e.id,
        normalizedDomain: e.normalizedDomain,
        techSpendTier: e.techSpendTier,
        companyName: e.companyName,
        technologyCount: Array.isArray(e.technologies) ? (e.technologies as unknown[]).length : 0,
        hitCount: e.hitCount,
        isComplete: e.isComplete,
        enrichedAt: e.enrichedAt,
        expiresAt: e.expiresAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error('Failed to list cache entries', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'internal_error', message: 'Failed to list cache entries' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /entries/:id — Delete a single cache entry
// ---------------------------------------------------------------------------

cacheRouter.delete('/entries/:id', async (req: Request, res: Response) => {
  try {
    const entryId = req.params['id'] as string;

    const entry = await prisma.domainEnrichmentCache.findUnique({
      where: { id: entryId },
      select: { id: true, normalizedDomain: true },
    });

    if (!entry) {
      res.status(404).json({ error: 'not_found', message: 'Cache entry not found' });
      return;
    }

    await prisma.domainEnrichmentCache.delete({ where: { id: entryId } });

    await logAudit({
      action: 'cache_entry_deleted',
      actorUserId: req.admin!.id,
      actorTeamId: 'admin',
      metadata: { domain: entry.normalizedDomain },
    });

    res.json({ deleted: true, domain: entry.normalizedDomain });
  } catch (error) {
    logger.error('Failed to delete cache entry', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'internal_error', message: 'Failed to delete cache entry' });
  }
});
