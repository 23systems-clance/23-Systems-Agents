/**
 * Dialer Config Admin Route (T107 - Phone Number Pool Management)
 *
 * GET    /dialer-config/phone-numbers          — List all TwilioPhoneNumbers with client assignments
 * POST   /dialer-config/phone-numbers          — Provision a new number from Twilio by area code
 * POST   /dialer-config/phone-numbers/:id/assign — Assign number to a client, set isPrimary
 * DELETE /dialer-config/phone-numbers/:id      — Release number from Twilio and delete from DB
 */

import { Router, type Request, type Response } from 'express';
import { prisma } from '../../models/index.js';
import { twilioRestClient } from '../../services/dialer/twilioClient.js';
import logger from '../../lib/logger.js';

const router = Router();

/**
 * GET /dialer-config/phone-numbers
 * List all provisioned Twilio phone numbers with their client assignments.
 * Optionally filter by clientId query param.
 */
router.get('/phone-numbers', async (req: Request, res: Response) => {
  try {
    const clientId = req.query.clientId as string | undefined;

    const where: Record<string, any> = {};
    if (clientId) {
      where.clientId = clientId;
    }

    const phoneNumbers = await prisma.twilioPhoneNumber.findMany({
      where,
      include: {
        client: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ phoneNumbers });
  } catch (error: any) {
    logger.error('[DialerConfig] Failed to list phone numbers', { error: error.message });
    res.status(500).json({ error: 'Failed to list phone numbers' });
  }
});

/**
 * POST /dialer-config/phone-numbers
 * Provision a new phone number from Twilio by area code.
 * Body: { areaCode: string, state?: string }
 */
router.post('/phone-numbers', async (req: Request, res: Response) => {
  try {
    const { areaCode, state } = req.body;

    if (!areaCode || typeof areaCode !== 'string') {
      res.status(400).json({ error: 'areaCode is required' });
      return;
    }

    // Provision number from Twilio
    const purchased = await twilioRestClient.incomingPhoneNumbers.create({
      areaCode: parseInt(areaCode, 10).toString(),
      voiceUrl: `${process.env.BASE_URL || ''}/api/twilio/voice`,
      voiceMethod: 'POST',
      statusCallback: `${process.env.BASE_URL || ''}/api/twilio/status`,
      statusCallbackMethod: 'POST',
    });

    logger.info('[DialerConfig] Provisioned Twilio number', {
      phoneNumber: purchased.phoneNumber,
      sid: purchased.sid,
      areaCode,
    });

    // Store in database
    const record = await prisma.twilioPhoneNumber.create({
      data: {
        phoneNumber: purchased.phoneNumber,
        twilioSid: purchased.sid,
        areaCode,
        state: state || null,
      },
    });

    res.status(201).json({ phoneNumber: record });
  } catch (error: any) {
    logger.error('[DialerConfig] Failed to provision phone number', { error: error.message });
    res.status(500).json({ error: 'Failed to provision phone number', details: error.message });
  }
});

/**
 * POST /dialer-config/phone-numbers/:id/assign
 * Assign a phone number to a client and optionally set it as primary.
 * Body: { clientId: string, isPrimary?: boolean }
 */
router.post('/phone-numbers/:id/assign', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { clientId, isPrimary } = req.body;

    if (!clientId || typeof clientId !== 'string') {
      res.status(400).json({ error: 'clientId is required' });
      return;
    }

    // Verify the phone number exists
    const existing = await prisma.twilioPhoneNumber.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Phone number not found' });
      return;
    }

    // If setting as primary, unset any existing primary for this client
    if (isPrimary) {
      await prisma.twilioPhoneNumber.updateMany({
        where: { clientId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    const updated = await prisma.twilioPhoneNumber.update({
      where: { id },
      data: {
        clientId,
        isPrimary: isPrimary ?? false,
      },
      include: {
        client: {
          select: { id: true, name: true },
        },
      },
    });

    logger.info('[DialerConfig] Assigned phone number to client', {
      phoneNumberId: id,
      clientId,
      isPrimary: isPrimary ?? false,
    });

    res.json({ phoneNumber: updated });
  } catch (error: any) {
    logger.error('[DialerConfig] Failed to assign phone number', {
      id: req.params.id,
      error: error.message,
    });
    res.status(500).json({ error: 'Failed to assign phone number' });
  }
});

/**
 * DELETE /dialer-config/phone-numbers/:id
 * Release a phone number from Twilio and remove from the database.
 */
router.delete('/phone-numbers/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    // Look up the record to get the Twilio SID
    const record = await prisma.twilioPhoneNumber.findUnique({ where: { id } });
    if (!record) {
      res.status(404).json({ error: 'Phone number not found' });
      return;
    }

    // Release from Twilio
    try {
      await twilioRestClient.incomingPhoneNumbers(record.twilioSid).remove();
      logger.info('[DialerConfig] Released Twilio number', {
        phoneNumber: record.phoneNumber,
        twilioSid: record.twilioSid,
      });
    } catch (twilioError: any) {
      logger.error('[DialerConfig] Twilio release failed, proceeding with DB deletion', {
        twilioSid: record.twilioSid,
        error: twilioError.message,
      });
    }

    // Delete from database
    await prisma.twilioPhoneNumber.delete({ where: { id } });

    res.json({ success: true, deleted: record.phoneNumber });
  } catch (error: any) {
    logger.error('[DialerConfig] Failed to delete phone number', {
      id: req.params.id,
      error: error.message,
    });
    res.status(500).json({ error: 'Failed to delete phone number' });
  }
});

export { router as dialerConfigRouter };
