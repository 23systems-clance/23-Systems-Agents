/**
 * Twilio Capability Token Endpoint
 * POST /api/v1/dialer/token
 *
 * Generates a short-lived Twilio AccessToken for the BDR's browser
 * to initialize the Twilio Voice SDK Device.
 */

import { Router, type Request, type Response } from 'express';
import { prisma } from '../../models/index.js';
import { generateAccessToken } from '../../services/dialer/twilioClient.js';
import { getBdrIdentity } from '../../lib/bdrAuth.js';
import logger from '../../lib/logger.js';
const router = Router();

/**
 * POST /token
 * Returns a Twilio access token for WebRTC voice calling.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const identity = getBdrIdentity(req);
    if (!identity) {
      res.status(401).json({ error: 'BDR identity not found' });
      return;
    }

    // Look up BDR record to use as Twilio identity
    const bdr = await prisma.bdr.findFirst({
      where: {
        slackUserId: identity.slackUserId,
        slackTeamId: identity.slackTeamId,
      },
      select: { id: true, name: true },
    });

    if (!bdr) {
      res.status(404).json({ error: 'BDR record not found' });
      return;
    }

    const tokenResult = generateAccessToken(bdr.id);

    logger.info('[Dialer] Token generated', { bdrId: bdr.id, bdrName: bdr.name });

    res.json(tokenResult);
  } catch (error) {
    logger.error('[Dialer] Token generation failed', { error });
    res.status(500).json({ error: 'Failed to generate Twilio token' });
  }
});

export { router as tokenRouter };
