/**
 * OAuth Routes Index.
 *
 * Re-exports OAuth install and callback routers for mounting in the main server.
 */

import express from 'express';
import { installRouter } from './install.js';
import { callbackRouter } from './callback.js';

const router = express.Router();

// Mount OAuth routes
router.use('/install', installRouter);
router.use('/oauth_redirect', callbackRouter);

export { router as oauthRouter };
