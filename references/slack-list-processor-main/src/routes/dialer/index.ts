/**
 * Dialer API Router
 * Mounts all dialer sub-routes under /api/v1/dialer/.
 * All routes require BDR authentication via magic link JWT.
 */

import { Router } from 'express';
import { bdrAuth } from '../../lib/bdrAuth.js';
import { tokenRouter } from './token.js';
import { sessionsRouter } from './sessions.js';
import { callsRouter } from './calls.js';
import { dispositionRouter } from './disposition.js';
import { callbacksRouter } from './callbacks.js';
import { deviceRouter } from './device.js';
import { recordingsRouter } from './recordings.js';

const router = Router();

// All dialer routes require BDR authentication
router.use(bdrAuth);

// Sub-routes
router.use('/token', tokenRouter);
router.use('/sessions', sessionsRouter);
router.use('/calls', callsRouter);
router.use('/calls', dispositionRouter); // POST /calls/:callSessionId/disposition
router.use('/callbacks', callbacksRouter);
router.use('/device', deviceRouter);
router.use('/recordings', recordingsRouter); // GET /recordings/:callSessionId/audio

export { router as dialerRouter };
