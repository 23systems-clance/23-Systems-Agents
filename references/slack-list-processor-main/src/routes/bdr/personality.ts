/**
 * BDR personality analysis route.
 *
 * On-demand personality enrichment via the AI ARK People Analysis API.
 * Returns a self-contained HTML page (V2 Dark Analytics design).
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../../models/index.js';
import { getBdrIdentity } from '../../lib/bdrAuth.js';
import { personalityAnalysis } from '../../services/aiark/client.js';
import { renderPersonalityHtml } from '../../services/personality/renderer.js';
import type { PersonalityAnalysisResponse } from '../../types/personality.js';
import logger from '../../lib/logger.js';

const router = Router();

/** Cache TTL: 7 days in milliseconds. */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Normalize a LinkedIn URL for consistent cache lookups.
 * Strips trailing slashes and query params.
 */
function normalizeLinkedinUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return url.toLowerCase().replace(/\/+$/, '');
  }
}

/**
 * GET /api/v1/bdr/personality/:contactId
 *
 * Looks up a CampaignContact by ID, calls the AI ARK personality API
 * (or serves from cache), and returns a self-contained HTML page.
 */
router.get('/:contactId', async (req: Request, res: Response) => {
  try {
    const identity = getBdrIdentity(req);
    if (!identity) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const contactId = req.params.contactId as string;

    // Look up the contact with campaign and client context
    const contact = await prisma.campaignContact.findUnique({
      where: { id: contactId },
      include: {
        campaign: {
          select: {
            name: true,
            client: { select: { name: true } },
          },
        },
      },
    });

    if (!contact) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }

    if (!contact.linkedinUrl) {
      res.status(400).json({
        error: 'No LinkedIn URL available for this contact. Personality analysis requires a LinkedIn profile.',
      });
      return;
    }

    const normalizedUrl = normalizeLinkedinUrl(contact.linkedinUrl);
    const contactName = `${contact.firstName} ${contact.lastName}`;

    // Check cache
    const cached = await prisma.personalityAnalysis.findUnique({
      where: { linkedinUrl: normalizedUrl },
    });

    let data: PersonalityAnalysisResponse;

    if (cached && (Date.now() - cached.updatedAt.getTime()) < CACHE_TTL_MS) {
      logger.info('Personality cache hit', { contactId, linkedinUrl: normalizedUrl });
      data = cached.rawResponse as unknown as PersonalityAnalysisResponse;
    } else {
      logger.info('Personality cache miss, calling AI ARK', {
        contactId,
        linkedinUrl: normalizedUrl,
        cacheAge: cached ? Date.now() - cached.updatedAt.getTime() : null,
      });

      data = await personalityAnalysis({ linkedin: contact.linkedinUrl });

      if (data.error) {
        logger.warn('AI ARK personality analysis returned error', {
          contactId,
          error: data.error,
        });
        res.status(502).json({
          error: `Personality analysis unavailable: ${data.error}`,
        });
        return;
      }

      // Upsert cache
      await prisma.personalityAnalysis.upsert({
        where: { linkedinUrl: normalizedUrl },
        create: {
          linkedinUrl: normalizedUrl,
          contactName,
          rawResponse: data as any,
          archetypeName: data.archetype?.name ?? null,
          archetypeScore: data.archetype?.score ?? null,
        },
        update: {
          contactName,
          rawResponse: data as any,
          archetypeName: data.archetype?.name ?? null,
          archetypeScore: data.archetype?.score ?? null,
        },
      });
    }

    // Overlay contact metadata from our DB (more reliable than API response)
    data.name = data.name || contactName;
    data.title = data.title || contact.jobTitle || undefined;
    data.company = data.company || contact.companyName || undefined;
    data.linkedin_url = data.linkedin_url || contact.linkedinUrl || undefined;
    data.email = data.email || contact.email || undefined;

    const html = renderPersonalityHtml(data, {
      contactId: contact.id,
      campaignName: contact.campaign?.name ?? undefined,
      clientName: contact.campaign?.client?.name ?? undefined,
      enrichedAt: cached?.updatedAt ?? new Date(),
    });

    res.type('html').send(html);
  } catch (err) {
    const error = err as Error;
    logger.error('Personality analysis failed', {
      contactId: req.params.contactId,
      error: error.message,
      stack: error.stack,
    });

    if (error.name === 'AIArkRateLimitError') {
      res.status(429).json({ error: 'AI ARK rate limit exceeded. Please try again shortly.' });
      return;
    }

    res.status(500).json({ error: 'Personality analysis failed. Please try again.' });
  }
});

/**
 * POST /api/v1/bdr/personality/:contactId/enrich
 *
 * JSON enrichment endpoint: validates contact has LinkedIn URL + email,
 * calls AI ARK, stores result in PersonalityAnalysis cache and
 * CampaignContact.personalityData. Skips if already enriched (unless force=true).
 */
router.post('/:contactId/enrich', async (req: Request, res: Response) => {
  try {
    const identity = getBdrIdentity(req);
    if (!identity) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const contactId = req.params.contactId as string;
    const force = req.body?.force === true;

    const contact = await prisma.campaignContact.findUnique({
      where: { id: contactId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        linkedinUrl: true,
        personalityData: true,
        personalityEnrichedAt: true,
        jobTitle: true,
        companyName: true,
      },
    });

    if (!contact) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }

    if (!contact.email) {
      res.status(400).json({ error: 'Contact has no email address. Both email and LinkedIn URL are required.' });
      return;
    }

    if (!contact.linkedinUrl) {
      res.status(400).json({ error: 'Contact has no LinkedIn URL. Both email and LinkedIn URL are required.' });
      return;
    }

    // Skip if already enriched (unless force=true)
    if (!force && contact.personalityData && contact.personalityEnrichedAt) {
      const existingData = contact.personalityData as Record<string, unknown>;
      const archetype = existingData.archetype as Record<string, unknown> | undefined;
      res.json({
        skipped: true,
        reason: 'Already enriched. Pass force=true to re-enrich.',
        archetype: archetype?.name ?? null,
        enrichedAt: contact.personalityEnrichedAt,
      });
      return;
    }

    const normalizedUrl = normalizeLinkedinUrl(contact.linkedinUrl);
    const contactName = `${contact.firstName} ${contact.lastName}`;

    // Call AI ARK
    const data = await personalityAnalysis({ linkedin: contact.linkedinUrl });

    if (data.error) {
      res.status(502).json({ error: `Personality analysis unavailable: ${data.error}` });
      return;
    }

    // Upsert PersonalityAnalysis cache
    await prisma.personalityAnalysis.upsert({
      where: { linkedinUrl: normalizedUrl },
      create: {
        linkedinUrl: normalizedUrl,
        contactName,
        rawResponse: data as any,
        archetypeName: data.archetype?.name ?? null,
        archetypeScore: data.archetype?.score ?? null,
      },
      update: {
        contactName,
        rawResponse: data as any,
        archetypeName: data.archetype?.name ?? null,
        archetypeScore: data.archetype?.score ?? null,
      },
    });

    // Store on CampaignContact
    await prisma.campaignContact.update({
      where: { id: contactId },
      data: {
        personalityData: data as any,
        personalityEnrichedAt: new Date(),
      },
    });

    logger.info('Personality enrichment completed', {
      contactId,
      archetype: data.archetype?.name,
      bdr: identity.slackUserId,
    });

    res.json({
      success: true,
      archetype: data.archetype?.name ?? null,
      enrichedAt: new Date(),
    });
  } catch (err) {
    const error = err as Error;
    logger.error('Personality enrichment failed', {
      contactId: req.params.contactId,
      error: error.message,
    });

    if (error.name === 'AIArkRateLimitError') {
      res.status(429).json({ error: 'AI ARK rate limit exceeded. Please try again shortly.' });
      return;
    }

    res.status(500).json({ error: 'Personality enrichment failed. Please try again.' });
  }
});

export { router as personalityRouter };
