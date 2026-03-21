/**
 * Uncallable (DNC) Admin Route (T108 - Admin DNC Management)
 *
 * UncallableContact CRUD:
 *   GET    /uncallable          — List uncallable contacts for a client, optional reason filter
 *   POST   /uncallable          — Manually add a DNC entry
 *   DELETE /uncallable/:id      — Admin-only hard delete of a DNC entry
 *   GET    /uncallable/export   — CSV export of uncallable contacts for audit
 *
 * ContactOptOut CRUD:
 *   GET    /uncallable/opt-outs — List opt-out entries for a client
 *   POST   /uncallable/opt-outs — Create an opt-out entry
 */

import { Router, type Request, type Response } from 'express';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

const router = Router();

/* ------------------------------------------------------------------ */
/*  UncallableContact endpoints                                        */
/* ------------------------------------------------------------------ */

/**
 * GET /uncallable
 * List UncallableContact records for a client.
 * Query params: clientId (required), reason (optional filter)
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const clientId = req.query.clientId as string | undefined;
    const reason = req.query.reason as string | undefined;

    if (!clientId) {
      res.status(400).json({ error: 'clientId query parameter is required' });
      return;
    }

    const where: Record<string, any> = { clientId };
    if (reason) {
      where.reason = reason;
    }

    const contacts = await prisma.uncallableContact.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    res.json({ contacts, total: contacts.length });
  } catch (error: any) {
    logger.error('[UncallableAdmin] Failed to list uncallable contacts', { error: error.message });
    res.status(500).json({ error: 'Failed to list uncallable contacts' });
  }
});

/**
 * GET /uncallable/export
 * CSV export of uncallable contacts for audit purposes.
 * Query params: clientId (required)
 * Returns Content-Type: text/csv
 */
router.get('/export', async (req: Request, res: Response) => {
  try {
    const clientId = req.query.clientId as string | undefined;

    if (!clientId) {
      res.status(400).json({ error: 'clientId query parameter is required' });
      return;
    }

    const contacts = await prisma.uncallableContact.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
    });

    // Build CSV content
    const header = 'phoneNumber,contactName,reason,createdAt';
    const rows = contacts.map((c: any) => {
      const phone = escapeCsvField(c.contactPhone || c.phoneNumber || '');
      const name = escapeCsvField(c.contactName || '');
      const reason = escapeCsvField(c.reason || '');
      const createdAt = escapeCsvField(c.createdAt ? new Date(c.createdAt).toISOString() : '');
      return `${phone},${name},${reason},${createdAt}`;
    });

    const csv = [header, ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="uncallable-export-${clientId}.csv"`);
    res.send(csv);
  } catch (error: any) {
    logger.error('[UncallableAdmin] Failed to export uncallable contacts', { error: error.message });
    res.status(500).json({ error: 'Failed to export uncallable contacts' });
  }
});

/**
 * POST /uncallable
 * Manually add a DNC entry.
 * Body: { phoneNumber: string, contactName?: string, reason: string, clientId: string }
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { phoneNumber, contactName, reason, clientId } = req.body;

    if (!phoneNumber || !reason || !clientId) {
      res.status(400).json({ error: 'phoneNumber, reason, and clientId are required' });
      return;
    }

    // Check for existing active entry to prevent duplicates
    const existing = await prisma.uncallableContact.findFirst({
      where: {
        clientId,
        contactPhone: phoneNumber,
        reAddedAt: null,
      },
    });

    if (existing) {
      res.status(409).json({ error: 'Contact is already marked as uncallable', existing });
      return;
    }

    const contact = await prisma.uncallableContact.create({
      data: {
        contactPhone: phoneNumber,
        contactName: contactName || null,
        reason,
        source: 'manual',
        clientId,
      },
    });

    logger.info('[UncallableAdmin] Manually added DNC entry', {
      phoneNumber,
      reason,
      clientId,
    });

    res.status(201).json({ contact });
  } catch (error: any) {
    logger.error('[UncallableAdmin] Failed to add DNC entry', { error: error.message });
    res.status(500).json({ error: 'Failed to add DNC entry' });
  }
});

/**
 * DELETE /uncallable/:id
 * Admin-only hard delete of an uncallable contact record.
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const existing = await prisma.uncallableContact.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Uncallable contact not found' });
      return;
    }

    await prisma.uncallableContact.delete({ where: { id } });

    logger.info('[UncallableAdmin] Hard-deleted DNC entry', {
      id,
      phoneNumber: (existing as any).contactPhone,
      reason: existing.reason,
    });

    res.json({ success: true, deleted: id });
  } catch (error: any) {
    logger.error('[UncallableAdmin] Failed to delete DNC entry', {
      id: req.params.id,
      error: error.message,
    });
    res.status(500).json({ error: 'Failed to delete DNC entry' });
  }
});

/* ------------------------------------------------------------------ */
/*  ContactOptOut endpoints                                            */
/* ------------------------------------------------------------------ */

/**
 * GET /uncallable/opt-outs
 * List ContactOptOut entries for a client.
 * Query params: clientId (required)
 */
router.get('/opt-outs', async (req: Request, res: Response) => {
  try {
    const clientId = req.query.clientId as string | undefined;

    if (!clientId) {
      res.status(400).json({ error: 'clientId query parameter is required' });
      return;
    }

    const optOuts = await prisma.contactOptOut.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ optOuts, total: optOuts.length });
  } catch (error: any) {
    logger.error('[UncallableAdmin] Failed to list opt-outs', { error: error.message });
    res.status(500).json({ error: 'Failed to list opt-outs' });
  }
});

/**
 * POST /uncallable/opt-outs
 * Create a new ContactOptOut entry.
 * Body: { phoneNumber: string, reason?: string, source: string, clientId?: string }
 */
router.post('/opt-outs', async (req: Request, res: Response) => {
  try {
    const { phoneNumber, reason, source, clientId } = req.body;

    if (!phoneNumber || !source) {
      res.status(400).json({ error: 'phoneNumber and source are required' });
      return;
    }

    // Check for existing opt-out (phoneNumber is unique)
    const existing = await prisma.contactOptOut.findUnique({
      where: { phoneNumber },
    });

    if (existing) {
      res.status(409).json({ error: 'Opt-out already exists for this phone number', existing });
      return;
    }

    const optOut = await prisma.contactOptOut.create({
      data: {
        phoneNumber,
        reason: reason || null,
        source,
        clientId: clientId || null,
      },
    });

    logger.info('[UncallableAdmin] Created opt-out entry', {
      phoneNumber,
      source,
    });

    res.status(201).json({ optOut });
  } catch (error: any) {
    logger.error('[UncallableAdmin] Failed to create opt-out', { error: error.message });
    res.status(500).json({ error: 'Failed to create opt-out entry' });
  }
});

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Escape a value for CSV output.
 * Wraps in double quotes if the value contains commas, quotes, or newlines.
 *
 * @param value - Raw string value.
 * @returns CSV-safe string.
 */
function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export { router as uncallableAdminRouter };
