/**
 * Twilio Webhook Router (T025-T027)
 * Handles all inbound Twilio webhooks with signature verification.
 *
 * Endpoints:
 * - POST /voice  — TwiML App voice handler (browser device.connect)
 * - POST /status — Call status updates (ringing, completed, failed)
 * - POST /amd    — Answering Machine Detection results
 * - POST /recording — Recording ready notification
 */

import { Router, type Request, type Response } from 'express';
import { validateTwilioSignature } from '../../services/dialer/twilioClient.js';
import { handleCallStatusUpdate, handleAmdResult } from '../../services/dialer/dialerEngine.js';
import { handleRecordingReady } from '../../services/dialer/recordingManager.js';
import logger from '../../lib/logger.js';

const router = Router();

/**
 * Twilio request signature verification middleware.
 * Validates X-Twilio-Signature header to ensure requests come from Twilio.
 */
function verifyTwilioSignature(req: Request, res: Response, next: Function): void {
  const signature = req.headers['x-twilio-signature'] as string;
  if (!signature) {
    logger.warn('[Twilio Webhook] Missing X-Twilio-Signature header');
    res.status(403).send('Forbidden: missing signature');
    return;
  }

  const webhookBaseUrl = process.env.WEBHOOK_BASE_URL;
  if (!webhookBaseUrl) {
    logger.error('[Twilio Webhook] WEBHOOK_BASE_URL not configured');
    res.status(500).send('Server misconfigured');
    return;
  }

  const fullUrl = `${webhookBaseUrl}${req.originalUrl}`;
  const isValid = validateTwilioSignature(signature, fullUrl, req.body || {});

  if (!isValid) {
    logger.warn('[Twilio Webhook] Invalid signature', {
      url: fullUrl,
      signature: signature.substring(0, 10) + '...',
    });
    res.status(403).send('Forbidden: invalid signature');
    return;
  }

  next();
}

// Apply signature verification to all webhook routes
router.use(verifyTwilioSignature);

/**
 * POST /voice (T025)
 * TwiML App voice webhook — receives params from BDR's device.connect().
 * Returns TwiML to join the BDR into the Conference room for this call.
 *
 * The BDR's browser sends ConferenceName as a custom parameter when
 * calling device.connect({ params: { ConferenceName: '...' } }).
 */
router.post('/voice', async (req: Request, res: Response) => {
  try {
    const conferenceName = req.body.ConferenceName;
    if (!conferenceName) {
      logger.warn('[Twilio Webhook] /voice called without ConferenceName');
      res.status(400).type('text/xml').send('<Response><Hangup/></Response>');
      return;
    }

    logger.info('[Twilio Webhook] /voice — joining BDR to conference', { conferenceName });

    // BDR joins conference as moderator (startConferenceOnEnter=true)
    // When BDR leaves, conference ends (endConferenceOnExit=true)
    res.type('text/xml').send(
      `<Response><Dial><Conference startConferenceOnEnter="true" endConferenceOnExit="true" beep="false" statusCallbackEvent="join leave end" statusCallback="${process.env.WEBHOOK_BASE_URL}/api/webhooks/twilio/status">${conferenceName}</Conference></Dial></Response>`
    );
  } catch (error: any) {
    logger.error('[Twilio Webhook] /voice error', { error: error.message });
    res.status(500).type('text/xml').send('<Response><Hangup/></Response>');
  }
});

/**
 * POST /status (T027)
 * Call status callback — receives status updates for outbound calls.
 * Delegates to dialerEngine.handleCallStatusUpdate().
 */
router.post('/status', async (req: Request, res: Response) => {
  try {
    const { CallSid, CallStatus, CallDuration } = req.body;

    logger.info('[Twilio Webhook] /status', { callSid: CallSid, callStatus: CallStatus });

    if (CallSid && CallStatus) {
      await handleCallStatusUpdate(CallSid, CallStatus, CallDuration);
    }

    res.status(200).send('OK');
  } catch (error: any) {
    logger.error('[Twilio Webhook] /status error', { error: error.message });
    res.status(200).send('OK'); // Always 200 to prevent Twilio retries
  }
});

/**
 * POST /amd (T026)
 * Answering Machine Detection callback — receives AMD results.
 * Delegates to dialerEngine.handleAmdResult() which auto-skips machines.
 */
router.post('/amd', async (req: Request, res: Response) => {
  try {
    const { CallSid, AnsweredBy } = req.body;

    logger.info('[Twilio Webhook] /amd', { callSid: CallSid, answeredBy: AnsweredBy });

    if (CallSid && AnsweredBy) {
      await handleAmdResult(CallSid, AnsweredBy);
    }

    res.status(200).send('OK');
  } catch (error: any) {
    logger.error('[Twilio Webhook] /amd error', { error: error.message });
    res.status(200).send('OK'); // Always 200 to prevent Twilio retries
  }
});

/**
 * POST /recording (T051)
 * Recording ready callback — fired when a call recording is available.
 * Creates CallRecording record and enqueues S3 copy + Deepgram submission.
 */
router.post('/recording', async (req: Request, res: Response) => {
  try {
    const { CallSid, RecordingSid, RecordingUrl, RecordingStatus, RecordingDuration } = req.body;

    logger.info('[Twilio Webhook] /recording', {
      callSid: CallSid,
      recordingSid: RecordingSid,
      recordingStatus: RecordingStatus,
      recordingDuration: RecordingDuration,
    });

    if (RecordingStatus === 'completed' && RecordingSid && RecordingUrl && CallSid) {
      await handleRecordingReady(RecordingSid, RecordingUrl, CallSid);
    }

    res.status(200).send('OK');
  } catch (error: any) {
    logger.error('[Twilio Webhook] /recording error', { error: error.message });
    res.status(200).send('OK'); // Always 200 to prevent Twilio retries
  }
});

export { router as twilioWebhookRouter };
