/**
 * Apollo cache admin routes.
 *
 * GET    /metrics         — Aggregate cache performance metrics
 * GET    /config          — Read Apollo cache TTL configuration
 * PUT    /config          — Update Apollo cache TTLs
 * POST   /purge           — Purge search/contact/both caches
 * GET    /search-entries  — Paginated search cache entries
 * GET    /contact-entries — Paginated contact cache entries
 * DELETE /entries/:id     — Delete a single cache entry
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../../models/index.js';
import { config } from '../../config/index.js';
import { logAudit } from '../../lib/auditLogger.js';
import { getCacheConfig } from '../../lib/cacheConfig.js';
import * as searchCacheService from '../../services/apollo/searchCache.js';
import * as contactCacheService from '../../services/apollo/contactCache.js';

export const apolloCacheRouter = Router();

// ---------------------------------------------------------------------------
// GET /metrics — Aggregate Apollo cache performance metrics
// ---------------------------------------------------------------------------

apolloCacheRouter.get('/metrics', async (req: Request, res: Response) => {
  try {
    const period = req.query['period'] === '7d' ? 7 : 30;
    const since = new Date();
    since.setDate(since.getDate() - period);

    const now = new Date();

    // Search cache counts
    const [
      searchTotal,
      searchActive,
      searchZeroResult,
    ] = await Promise.all([
      prisma.apolloSearchCache.count(),
      prisma.apolloSearchCache.count({ where: { expiresAt: { gt: now } } }),
      prisma.apolloSearchCache.count({ where: { resultCount: 0 } }),
    ]);

    // Contact cache counts
    const [
      contactTotal,
      contactActive,
      contactWithPhone,
      contactWithoutPhone,
    ] = await Promise.all([
      prisma.apolloContactCache.count(),
      prisma.apolloContactCache.count({ where: { expiresAt: { gt: now } } }),
      prisma.apolloContactCache.count({ where: { hasPhoneData: true } }),
      prisma.apolloContactCache.count({ where: { hasPhoneData: false } }),
    ]);

    // Hit/miss aggregation from Job records within period
    const jobAgg = await prisma.job.aggregate({
      where: { createdAt: { gte: since } },
      _sum: {
        apolloSearchCacheHits: true,
        apolloSearchCacheMisses: true,
        apolloContactCacheHits: true,
        apolloContactCacheMisses: true,
      },
    });

    const searchHits = jobAgg._sum.apolloSearchCacheHits ?? 0;
    const searchMisses = jobAgg._sum.apolloSearchCacheMisses ?? 0;
    const contactHits = jobAgg._sum.apolloContactCacheHits ?? 0;
    const contactMisses = jobAgg._sum.apolloContactCacheMisses ?? 0;

    const searchHitRate = searchHits + searchMisses > 0
      ? searchHits / (searchHits + searchMisses)
      : 0;
    const contactHitRate = contactHits + contactMisses > 0
      ? contactHits / (contactHits + contactMisses)
      : 0;

    // Also compute 7d stats separately if period is 30d
    let searchHits7d = searchHits;
    let searchMisses7d = searchMisses;
    let contactHits7d = contactHits;
    let contactMisses7d = contactMisses;

    if (period === 30) {
      const since7d = new Date();
      since7d.setDate(since7d.getDate() - 7);
      const agg7d = await prisma.job.aggregate({
        where: { createdAt: { gte: since7d } },
        _sum: {
          apolloSearchCacheHits: true,
          apolloSearchCacheMisses: true,
          apolloContactCacheHits: true,
          apolloContactCacheMisses: true,
        },
      });
      searchHits7d = agg7d._sum.apolloSearchCacheHits ?? 0;
      searchMisses7d = agg7d._sum.apolloSearchCacheMisses ?? 0;
      contactHits7d = agg7d._sum.apolloContactCacheHits ?? 0;
      contactMisses7d = agg7d._sum.apolloContactCacheMisses ?? 0;
    }

    const searchHitRate7d = searchHits7d + searchMisses7d > 0
      ? searchHits7d / (searchHits7d + searchMisses7d)
      : 0;
    const contactHitRate7d = contactHits7d + contactMisses7d > 0
      ? contactHits7d / (contactHits7d + contactMisses7d)
      : 0;

    const estimatedCreditsSaved = contactHits;
    const estimatedCostSavedUsd = estimatedCreditsSaved * config.apollo.costPerCredit;

    // Top searched domains (by hitCount)
    const topDomains = await prisma.apolloSearchCache.findMany({
      orderBy: { hitCount: 'desc' },
      take: 10,
      select: { normalizedDomain: true, hitCount: true },
    });

    // Top cached contacts (by hitCount)
    const topContacts = await prisma.apolloContactCache.findMany({
      orderBy: { hitCount: 'desc' },
      take: 10,
      select: { apolloPersonId: true, fullName: true, hitCount: true },
    });

    res.json({
      searchCache: {
        totalEntries: searchTotal,
        activeEntries: searchActive,
        expiredEntries: searchTotal - searchActive,
        hitRate7d: Math.round(searchHitRate7d * 100) / 100,
        hitRate30d: Math.round(searchHitRate * 100) / 100,
        totalHits7d: searchHits7d,
        totalMisses7d: searchMisses7d,
        totalHits30d: searchHits,
        totalMisses30d: searchMisses,
        zeroResultEntries: searchZeroResult,
      },
      contactCache: {
        totalEntries: contactTotal,
        activeEntries: contactActive,
        expiredEntries: contactTotal - contactActive,
        withPhoneData: contactWithPhone,
        withoutPhoneData: contactWithoutPhone,
        hitRate7d: Math.round(contactHitRate7d * 100) / 100,
        hitRate30d: Math.round(contactHitRate * 100) / 100,
        totalHits7d: contactHits7d,
        totalMisses7d: contactMisses7d,
        totalHits30d: contactHits,
        totalMisses30d: contactMisses,
        estimatedCreditsSaved,
        estimatedCostSavedUsd: Math.round(estimatedCostSavedUsd * 100) / 100,
      },
      topSearchedDomains: topDomains.map((d) => ({
        domain: d.normalizedDomain,
        hitCount: d.hitCount,
      })),
      topCachedContacts: topContacts.map((c) => ({
        apolloPersonId: c.apolloPersonId,
        fullName: c.fullName,
        hitCount: c.hitCount,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// GET /config — Read Apollo cache configuration
// ---------------------------------------------------------------------------

apolloCacheRouter.get('/config', async (_req: Request, res: Response) => {
  try {
    const cacheConfig = await getCacheConfig();
    res.json({
      apolloSearchTtlDays: cacheConfig.apolloSearchTtlDays,
      apolloContactTtlDays: cacheConfig.apolloContactTtlDays,
      enabled: cacheConfig.enabled,
      updatedAt: cacheConfig.updatedAt,
    });
  } catch (error) {
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// PUT /config — Update Apollo cache TTLs
// ---------------------------------------------------------------------------

apolloCacheRouter.put('/config', async (req: Request, res: Response) => {
  try {
    const { apolloSearchTtlDays, apolloContactTtlDays } = req.body;

    // Validation
    const errors: string[] = [];
    if (apolloSearchTtlDays !== undefined) {
      if (!Number.isInteger(apolloSearchTtlDays) || apolloSearchTtlDays < 7 || apolloSearchTtlDays > 30) {
        errors.push('apolloSearchTtlDays must be an integer between 7 and 30');
      }
    }
    if (apolloContactTtlDays !== undefined) {
      if (!Number.isInteger(apolloContactTtlDays) || apolloContactTtlDays < 14 || apolloContactTtlDays > 60) {
        errors.push('apolloContactTtlDays must be an integer between 14 and 60');
      }
    }
    if (errors.length > 0) {
      res.status(400).json({ error: 'validation_error', details: errors });
      return;
    }

    const existing = await getCacheConfig();

    const data: Record<string, unknown> = {};
    if (apolloSearchTtlDays !== undefined) data.apolloSearchTtlDays = apolloSearchTtlDays;
    if (apolloContactTtlDays !== undefined) data.apolloContactTtlDays = apolloContactTtlDays;

    const updated = await prisma.cacheConfig.update({
      where: { id: existing.id },
      data,
    });

    await logAudit({
      action: 'APOLLO_CACHE_CONFIG_UPDATED',
      actorUserId: req.admin!.id,
      actorTeamId: 'admin',
      targetType: 'cache_config',
      targetId: updated.id,
      metadata: {
        old: {
          apolloSearchTtlDays: existing.apolloSearchTtlDays,
          apolloContactTtlDays: existing.apolloContactTtlDays,
        },
        new: {
          apolloSearchTtlDays: updated.apolloSearchTtlDays,
          apolloContactTtlDays: updated.apolloContactTtlDays,
        },
      },
    });

    res.json({
      apolloSearchTtlDays: updated.apolloSearchTtlDays,
      apolloContactTtlDays: updated.apolloContactTtlDays,
      updatedAt: updated.updatedAt,
    });
  } catch (error) {
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// POST /purge — Purge Apollo cache entries
// ---------------------------------------------------------------------------

apolloCacheRouter.post('/purge', async (req: Request, res: Response) => {
  try {
    const { target, mode } = req.body;

    if (!['search', 'contact', 'both'].includes(target)) {
      res.status(400).json({ error: 'validation_error', message: 'target must be "search", "contact", or "both"' });
      return;
    }
    if (!['all', 'expired'].includes(mode)) {
      res.status(400).json({ error: 'validation_error', message: 'mode must be "all" or "expired"' });
      return;
    }

    let purgedCount = 0;

    if (target === 'search' || target === 'both') {
      if (mode === 'all') {
        purgedCount += await searchCacheService.purgeAll();
      } else {
        purgedCount += await searchCacheService.purgeExpired();
      }
    }

    if (target === 'contact' || target === 'both') {
      if (mode === 'all') {
        purgedCount += await contactCacheService.purgeAll();
      } else {
        purgedCount += await contactCacheService.purgeExpired();
      }
    }

    await logAudit({
      action: 'APOLLO_CACHE_PURGED',
      actorUserId: req.admin!.id,
      actorTeamId: 'admin',
      targetType: 'apollo_cache',
      targetId: target,
      metadata: { target, mode, purgedCount },
    });

    res.json({ purgedCount, target, mode });
  } catch (error) {
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// GET /search-entries — Paginated search cache entries
// ---------------------------------------------------------------------------

apolloCacheRouter.get('/search-entries', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query['page'] as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query['limit'] as string) || 50));
    const search = (req.query['search'] as string) || '';
    const sortBy = (req.query['sortBy'] as string) || 'searchedAt';
    const sortOrder = (req.query['sortOrder'] as string) === 'asc' ? 'asc' : 'desc';

    const where = search
      ? { normalizedDomain: { contains: search.toLowerCase() } }
      : {};

    const sortMap: Record<string, string> = {
      searchedAt: 'searchedAt',
      hitCount: 'hitCount',
      resultCount: 'resultCount',
    };
    const orderField = sortMap[sortBy] || 'searchedAt';

    const [entries, total] = await Promise.all([
      prisma.apolloSearchCache.findMany({
        where,
        orderBy: { [orderField]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          normalizedDomain: true,
          resultCount: true,
          hitCount: true,
          filterSnapshot: true,
          searchedAt: true,
          expiresAt: true,
        },
      }),
      prisma.apolloSearchCache.count({ where }),
    ]);

    res.json({
      entries,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// GET /contact-entries — Paginated contact cache entries
// ---------------------------------------------------------------------------

apolloCacheRouter.get('/contact-entries', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query['page'] as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query['limit'] as string) || 50));
    const search = (req.query['search'] as string) || '';
    const sortBy = (req.query['sortBy'] as string) || 'enrichedAt';
    const sortOrder = (req.query['sortOrder'] as string) === 'asc' ? 'asc' : 'desc';
    const hasPhoneData = req.query['hasPhoneData'];

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { apolloPersonId: { contains: search } },
      ];
    }
    if (hasPhoneData === 'true') where.hasPhoneData = true;
    if (hasPhoneData === 'false') where.hasPhoneData = false;

    const sortMap: Record<string, string> = {
      enrichedAt: 'enrichedAt',
      hitCount: 'hitCount',
      fullName: 'fullName',
    };
    const orderField = sortMap[sortBy] || 'enrichedAt';

    const [entries, total] = await Promise.all([
      prisma.apolloContactCache.findMany({
        where,
        orderBy: { [orderField]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          apolloPersonId: true,
          fullName: true,
          email: true,
          jobTitle: true,
          hasPhoneData: true,
          hitCount: true,
          enrichedAt: true,
          expiresAt: true,
        },
      }),
      prisma.apolloContactCache.count({ where }),
    ]);

    res.json({
      entries,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /entries/:id — Delete a single cache entry
// ---------------------------------------------------------------------------

apolloCacheRouter.delete('/entries/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params['id'] as string;
    const type = req.query['type'] as string;

    if (!['search', 'contact'].includes(type)) {
      res.status(400).json({ error: 'validation_error', message: 'type query param must be "search" or "contact"' });
      return;
    }

    let identifier = id;

    if (type === 'search') {
      const entry = await prisma.apolloSearchCache.findUnique({ where: { id } });
      if (!entry) {
        res.status(404).json({ error: 'not_found', message: 'Search cache entry not found' });
        return;
      }
      identifier = entry.normalizedDomain;
      await prisma.apolloSearchCache.delete({ where: { id } });
    } else {
      const entry = await prisma.apolloContactCache.findUnique({ where: { id } });
      if (!entry) {
        res.status(404).json({ error: 'not_found', message: 'Contact cache entry not found' });
        return;
      }
      identifier = entry.apolloPersonId;
      await prisma.apolloContactCache.delete({ where: { id } });
    }

    await logAudit({
      action: 'APOLLO_CACHE_ENTRY_DELETED',
      actorUserId: req.admin!.id,
      actorTeamId: 'admin',
      targetType: 'apollo_cache_entry',
      targetId: id,
      metadata: { type, identifier },
    });

    res.json({ deleted: true, type, identifier });
  } catch (error) {
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});
