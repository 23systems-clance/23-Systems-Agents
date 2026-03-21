/**
 * Quality gate configuration CRUD endpoints.
 *
 * GET    /api/v1/admin/quality-gate-config/defaults     — Global defaults
 * GET    /api/v1/admin/quality-gate-config/:clientId     — Workspace config
 * PUT    /api/v1/admin/quality-gate-config/:clientId     — Upsert workspace config
 * DELETE /api/v1/admin/quality-gate-config/:clientId     — Reset to defaults
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../../models/index.js';
import { logAudit } from '../../lib/auditLogger.js';
import {
  DEFAULT_QUALITY_GATE_CONFIG,
  DEFAULT_PERSONAL_DOMAIN_LIST,
} from '../../services/qualityGate/config.js';
import { DEFAULT_PERSONAL_DOMAINS } from '../../services/file/domainUtils.js';

export const qualityGateConfigRouter = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Domain format regex: must contain a dot, no protocol, no paths. */
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * Validates a domain string.
 * @returns Error message or null if valid.
 */
function validateDomain(domain: string): string | null {
  const normalized = domain.toLowerCase().trim();
  if (!normalized) return 'Empty domain';
  if (!normalized.includes('.')) return `Invalid domain: '${domain}' (must contain '.')`;
  if (normalized.includes('://')) return `Invalid domain: '${domain}' (remove protocol)`;
  if (normalized.includes('/')) return `Invalid domain: '${domain}' (remove paths)`;
  if (!DOMAIN_RE.test(normalized)) return `Invalid domain format: '${domain}'`;
  return null;
}

/**
 * Validates an array of domains with a max count.
 * @returns Array of validation error detail objects, or empty if all valid.
 */
function validateDomainArray(
  domains: unknown,
  fieldName: string,
  maxCount: number,
): { field: string; message: string }[] {
  if (!Array.isArray(domains)) return [];
  if (domains.length > maxCount) {
    return [{ field: fieldName, message: `Maximum ${maxCount} entries allowed` }];
  }
  const errors: { field: string; message: string }[] = [];
  for (let i = 0; i < domains.length; i++) {
    if (typeof domains[i] !== 'string') {
      errors.push({ field: `${fieldName}[${i}]`, message: 'Must be a string' });
      continue;
    }
    const err = validateDomain(domains[i] as string);
    if (err) errors.push({ field: `${fieldName}[${i}]`, message: err });
  }
  return errors;
}

/**
 * Computes effective personal domains from config.
 */
function computeEffectivePersonalDomains(
  overrides: string[],
  allow: string[],
): string[] {
  const effective = new Set<string>(DEFAULT_PERSONAL_DOMAINS);
  for (const d of overrides) effective.add(d.toLowerCase());
  for (const d of allow) effective.delete(d.toLowerCase());
  return [...effective].sort();
}

// ---------------------------------------------------------------------------
// GET /defaults — Global default configuration
// ---------------------------------------------------------------------------

qualityGateConfigRouter.get('/defaults', async (_req: Request, res: Response) => {
  try {
    res.json({
      config: { ...DEFAULT_QUALITY_GATE_CONFIG },
      defaultPersonalDomains: DEFAULT_PERSONAL_DOMAIN_LIST,
    });
  } catch (error) {
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// GET /:clientId — Workspace config (or defaults with isCustom: false)
// ---------------------------------------------------------------------------

qualityGateConfigRouter.get('/:clientId', async (req: Request, res: Response) => {
  try {
    const clientId = req.params['clientId'] as string;

    // Verify client exists.
    const client = await prisma.managedClient.findUnique({ where: { id: clientId } });
    if (!client) {
      res.status(404).json({ error: 'Client not found', clientId });
      return;
    }

    const dbConfig = await prisma.qualityGateConfig.findUnique({
      where: { clientId },
    });

    if (dbConfig) {
      res.json({
        id: dbConfig.id,
        clientId: dbConfig.clientId,
        isCustom: true,
        config: {
          rejectPersonalEmails: dbConfig.rejectPersonalEmails,
          rejectMissingCompany: dbConfig.rejectMissingCompany,
          rejectDuplicateEmails: dbConfig.rejectDuplicateEmails,
          deduplicateDomains: dbConfig.deduplicateDomains,
          suppressionDomains: dbConfig.suppressionDomains,
          personalDomainOverrides: dbConfig.personalDomainOverrides,
          allowPersonalDomains: dbConfig.allowPersonalDomains,
        },
        effectivePersonalDomains: computeEffectivePersonalDomains(
          dbConfig.personalDomainOverrides,
          dbConfig.allowPersonalDomains,
        ),
      });
    } else {
      res.json({
        id: null,
        clientId,
        isCustom: false,
        config: { ...DEFAULT_QUALITY_GATE_CONFIG },
        effectivePersonalDomains: DEFAULT_PERSONAL_DOMAIN_LIST,
      });
    }
  } catch (error) {
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// PUT /:clientId — Upsert workspace config
// ---------------------------------------------------------------------------

qualityGateConfigRouter.put('/:clientId', async (req: Request, res: Response) => {
  try {
    const clientId = req.params['clientId'] as string;

    const client = await prisma.managedClient.findUnique({ where: { id: clientId } });
    if (!client) {
      res.status(404).json({ error: 'Client not found', clientId });
      return;
    }

    const {
      rejectPersonalEmails,
      rejectMissingCompany,
      rejectDuplicateEmails,
      deduplicateDomains,
      suppressionDomains,
      personalDomainOverrides,
      allowPersonalDomains,
    } = req.body;

    // Validate domain arrays.
    const validationErrors = [
      ...validateDomainArray(suppressionDomains, 'suppressionDomains', 500),
      ...validateDomainArray(personalDomainOverrides, 'personalDomainOverrides', 100),
      ...validateDomainArray(allowPersonalDomains, 'allowPersonalDomains', 50),
    ];

    if (validationErrors.length > 0) {
      res.status(400).json({ error: 'Validation failed', details: validationErrors });
      return;
    }

    // Normalize domain arrays (lowercase).
    const normalizedSuppression = Array.isArray(suppressionDomains)
      ? suppressionDomains.map((d: string) => d.toLowerCase().trim())
      : undefined;
    const normalizedOverrides = Array.isArray(personalDomainOverrides)
      ? personalDomainOverrides.map((d: string) => d.toLowerCase().trim())
      : undefined;
    const normalizedAllow = Array.isArray(allowPersonalDomains)
      ? allowPersonalDomains.map((d: string) => d.toLowerCase().trim())
      : undefined;

    const data: Record<string, unknown> = {};
    if (rejectPersonalEmails !== undefined) data.rejectPersonalEmails = rejectPersonalEmails;
    if (rejectMissingCompany !== undefined) data.rejectMissingCompany = rejectMissingCompany;
    if (rejectDuplicateEmails !== undefined) data.rejectDuplicateEmails = rejectDuplicateEmails;
    if (deduplicateDomains !== undefined) data.deduplicateDomains = deduplicateDomains;
    if (normalizedSuppression !== undefined) data.suppressionDomains = normalizedSuppression;
    if (normalizedOverrides !== undefined) data.personalDomainOverrides = normalizedOverrides;
    if (normalizedAllow !== undefined) data.allowPersonalDomains = normalizedAllow;

    const upserted = await prisma.qualityGateConfig.upsert({
      where: { clientId },
      create: {
        clientId,
        ...DEFAULT_QUALITY_GATE_CONFIG,
        suppressionDomains: [],
        personalDomainOverrides: [],
        allowPersonalDomains: [],
        ...data,
      },
      update: data,
    });

    await logAudit({
      action: 'quality_gate_config_updated',
      actorUserId: req.admin!.id,
      actorTeamId: 'admin',
      targetType: 'quality_gate_config',
      targetId: upserted.id,
      metadata: { clientId, changes: req.body },
    });

    res.json({
      id: upserted.id,
      clientId: upserted.clientId,
      isCustom: true,
      config: {
        rejectPersonalEmails: upserted.rejectPersonalEmails,
        rejectMissingCompany: upserted.rejectMissingCompany,
        rejectDuplicateEmails: upserted.rejectDuplicateEmails,
        deduplicateDomains: upserted.deduplicateDomains,
        suppressionDomains: upserted.suppressionDomains,
        personalDomainOverrides: upserted.personalDomainOverrides,
        allowPersonalDomains: upserted.allowPersonalDomains,
      },
      effectivePersonalDomains: computeEffectivePersonalDomains(
        upserted.personalDomainOverrides,
        upserted.allowPersonalDomains,
      ),
    });
  } catch (error) {
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /:clientId — Reset to defaults
// ---------------------------------------------------------------------------

qualityGateConfigRouter.delete('/:clientId', async (req: Request, res: Response) => {
  try {
    const clientId = req.params['clientId'] as string;

    const existing = await prisma.qualityGateConfig.findUnique({
      where: { clientId },
    });

    if (!existing) {
      res.status(404).json({
        error: 'No custom config found for client',
        clientId,
      });
      return;
    }

    await prisma.qualityGateConfig.delete({ where: { clientId } });

    await logAudit({
      action: 'quality_gate_config_reset',
      actorUserId: req.admin!.id,
      actorTeamId: 'admin',
      targetType: 'quality_gate_config',
      targetId: existing.id,
      metadata: { clientId },
    });

    res.json({
      message: 'Quality gate config reset to defaults',
      clientId,
    });
  } catch (error) {
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});
