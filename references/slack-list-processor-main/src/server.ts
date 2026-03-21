/**
 * Express HTTP server factory.
 *
 * Creates and configures an Express application with standard middleware
 * (JSON parsing, CORS, session, request logging). Route mounting is deferred to
 * the caller (app.ts) so this module stays focused on server setup.
 */

import express from 'express';
import type { Express } from 'express';
import cors from 'cors';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import pg from 'pg';
import { config } from './config/index.js';
import { apolloWebhookRouter } from './routes/webhooks/apollo.js';
import { healthRouter } from './routes/health.js';
import { jobsRouter } from './routes/jobs.js';
import { apiKeyAuth } from './lib/apiAuth.js';
import { adminRouter } from './routes/admin/index.js';
import { campaignRouter } from './routes/campaigns.js';
import { instantlyWebhookRouter } from './routes/webhooks/instantly.js';
import { heyreachWebhookRouter } from './routes/webhooks/heyreach.js';
import { hubspotWebhookRouter } from './routes/webhooks/hubspot.js';
import { workflowWebhookRouter } from './routes/webhooks/workflow.js';
import { bdrRouter } from './routes/bdr/index.js';
import { oauthRouter } from './routes/oauth/index.js';
import { uploadRouter } from './routes/upload/index.js';
import { stripeWebhookRouter } from './routes/admin/stripeWebhook.js';
import { billingSetupRouter } from './routes/billingSetup.js';
import { hubspotOAuthRouter } from './routes/hubspot/oauth.js';
import { initCrmAdapters } from './services/crm/registerAdapters.js';
import { dialerRouter } from './routes/dialer/index.js';
import { twilioWebhookRouter } from './routes/webhooks/twilio.js';
import { deepgramWebhookRouter } from './routes/webhooks/deepgram.js';
import { clientRouter } from './routes/client/index.js';

/**
 * Create and return a configured Express application.
 *
 * Middleware applied (in order):
 * 1. JSON body parsing via `express.json()`
 * 2. CORS via the `cors` package (with credentials)
 * 3. Session via `express-session` + PostgreSQL store
 * 4. Simple request logger (method + path to stdout)
 *
 * The returned app is **not** listening yet -- the caller is responsible
 * for calling `app.listen()` when ready.
 */
export function createHttpServer(): Express {
  const app: Express = express();

  // Register CRM adapters (HubSpot, etc.) for the adapter registry
  initCrmAdapters();

  // Trust the first proxy (ALB) so req.protocol reflects X-Forwarded-Proto.
  app.set('trust proxy', 1);

  /* ---- Middleware ---- */

  // Stripe webhook needs raw body for signature verification -- mount BEFORE json parser.
  app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhookRouter);

  app.use(express.json());
  app.use(express.urlencoded({ extended: false })); // Twilio webhooks send form-encoded data

  // In production, restrict CORS (all primary consumers are server-to-server:
  // Slack Socket Mode, Apollo webhooks, admin dashboard). In development,
  // allow all origins for local testing.
  if (config.nodeEnv === 'production') {
    const allowedOrigins = config.corsAllowedOrigins
      ? config.corsAllowedOrigins.split(',').map((o: string) => o.trim())
      : [];
    app.use(cors({
      origin: allowedOrigins.length > 0 ? allowedOrigins : false,
      credentials: true,
    }));
  } else {
    app.use(cors({
      origin: true,
      credentials: true,
    }));
  }

  // Session middleware backed by PostgreSQL.
  const PgStore = connectPgSimple(session);
  const sessionPool = new pg.Pool({ connectionString: config.database.url });

  app.use(session({
    store: new PgStore({
      pool: sessionPool,
      tableName: 'session',
      createTableIfMissing: true,
    }),
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: 'auto',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: config.session.ttlMs,
    },
  }));

  // Request logging -- prints HTTP method and path for every request.
  app.use((req, _res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });

  /* ---- Routes ---- */

  // OAuth install/callback (no auth required)
  app.use('/slack', oauthRouter);

  // Health check (no auth required)
  app.use('/api/v1/health', healthRouter);

  // Config doc upload API (upload token auth, before admin middleware)
  app.use('/api/v1/upload', uploadRouter);

  // Job management API (API key required)
  app.use('/api/v1/jobs', apiKeyAuth, jobsRouter);

  // Admin dashboard API (admin key auth + rate limiting applied in router)
  app.use('/api/v1/admin', adminRouter);


  // Campaign management API (API key required)
  app.use('/api/v1/campaigns', apiKeyAuth, campaignRouter);

  // BDR task UI API (magic link / session auth)
  app.use('/api/v1/bdr', bdrRouter);

  // Apollo.io phone webhook
  app.use('/api/webhooks/apollo', apolloWebhookRouter);

  // Instantly.ai email webhook
  app.use('/api/webhooks/instantly', instantlyWebhookRouter);

  // HeyReach LinkedIn webhook
  app.use('/api/webhooks/heyreach', heyreachWebhookRouter);

  // HubSpot OAuth callback (no auth — security via signed state JWT)
  app.use('/api/hubspot/oauth', hubspotOAuthRouter);

  // HubSpot call completion webhook (per-client, routes by portalId)
  app.use('/api/webhooks/hubspot', hubspotWebhookRouter);

  // Workflow trigger webhooks (no auth -- uses per-endpoint HMAC)
  app.use('/api/webhooks/workflow', workflowWebhookRouter);

  // Twilio voice webhooks (signature-verified, no session auth)
  app.use('/api/webhooks/twilio', twilioWebhookRouter);

  // Deepgram transcription webhooks (no auth — callback URL includes recording ID)
  app.use('/api/webhooks/deepgram', deepgramWebhookRouter);

  // Power Dialer API (BDR magic link / session auth)
  app.use('/api/v1/dialer', dialerRouter);

  // Client dashboard API (cookie session auth, Feature 35)
  app.use('/api/v1/client', clientRouter);

  // Billing setup (magic link redirect -- public, no auth)
  app.use('/billing/setup', billingSetupRouter);

  return app;
}

export type { Express } from 'express';
