import dotenv from 'dotenv';
dotenv.config();

/**
 * Reads an environment variable, throwing if required and missing.
 */
function env(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function envNumber(key: string, fallback?: number): number {
  const raw = process.env[key];
  if (raw !== undefined) return Number(raw);
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable: ${key}`);
}

export const config = {
  nodeEnv: env('NODE_ENV', 'development'),
  logLevel: env('LOG_LEVEL', 'info'),
  httpPort: envNumber('HTTP_PORT', 3000),
  adminDashboardUrl: env('ADMIN_DASHBOARD_URL', ''),

  slack: {
    botToken: env('SLACK_BOT_TOKEN'),
    appToken: env('SLACK_APP_TOKEN'),
    signingSecret: env('SLACK_SIGNING_SECRET'),
  },

  redis: {
    url: env('REDIS_URL', 'redis://localhost:6379'),
  },

  database: {
    url: env('DATABASE_URL'),
  },

  builtwith: {
    apiKey: env('BUILTWITH_API_KEY'),
    costPerCredit: envNumber('BUILTWITH_COST_PER_CREDIT', 0.05),
  },

  apollo: {
    apiKey: env('APOLLO_API_KEY'),
    webhookSecret: env('APOLLO_WEBHOOK_SECRET'),
    costPerCredit: envNumber('APOLLO_COST_PER_CREDIT', 0.05),
  },

  anthropic: {
    apiKey: env('ANTHROPIC_API_KEY'),
    costPer1kInputTokens: envNumber('AI_COST_PER_1K_INPUT_TOKENS', 0.0008),
    costPer1kOutputTokens: envNumber('AI_COST_PER_1K_OUTPUT_TOKENS', 0.004),
    /** Model used for lightweight tasks like intent classification and filter parsing. */
    haikuModel: env('AI_HAIKU_MODEL', 'claude-haiku-4-5-20251001'),
    /** Model used for complex analysis and report narrative generation. */
    sonnetModel: env('AI_SONNET_MODEL', 'claude-sonnet-4-5-20250929'),
    /** Whether at least one test run is required before publishing a prompt version. */
    promptTestRequired: process.env['PROMPT_TEST_REQUIRED'] === 'true',
  },

  s3: {
    bucket: env('S3_BUCKET', 'list-processor-files'),
    region: env('S3_REGION', 'us-east-1'),
    accessKeyId: process.env['S3_ACCESS_KEY_ID'] || undefined,
    secretAccessKey: process.env['S3_SECRET_ACCESS_KEY'] || undefined,
    endpoint: process.env['S3_ENDPOINT'] || undefined,
  },

  doc: {
    /** Maximum raw file upload size in bytes (default: 5 MB). */
    maxFileSize: envNumber('DOC_MAX_FILE_SIZE', 5242880),
    /** Maximum converted markdown size in bytes (default: 500 KB). */
    maxMarkdownSize: envNumber('DOC_MAX_MARKDOWN_SIZE', 524288),
    /** Maximum characters of document content injected as AI context. */
    maxContextChars: envNumber('DOC_MAX_CONTEXT_CHARS', 4000),
    /** Regex pattern for auto-detecting docs channels by name. */
    channelPattern: env('DOC_CHANNEL_PATTERN', '-docs$|-documents$'),
  },

  admin: {
    /** Max requests per minute per admin API key (default: 100). */
    rateLimitRpm: envNumber('ADMIN_RATE_LIMIT_RPM', 100),
  },

  session: {
    /** Secret for signing session cookies. */
    secret: env('SESSION_SECRET', 'dev-session-secret-change-in-production'),
    /** Session TTL in milliseconds (default: 24 hours). */
    ttlMs: envNumber('SESSION_TTL_MS', 86400000),
  },

  oauth: {
    /** Slack app client ID for OAuth install flow. */
    clientId: env('SLACK_CLIENT_ID', ''),
    /** Slack app client secret for OAuth install flow. */
    clientSecret: env('SLACK_CLIENT_SECRET', ''),
    /** Secret for CSRF state parameter during OAuth. */
    stateSecret: env('SLACK_STATE_SECRET', ''),
    /** OAuth redirect URI (e.g. https://yourdomain.com/slack/oauth_redirect). */
    redirectUri: env('OAUTH_REDIRECT_URI', ''),
  },

  encryption: {
    /** AES-256-GCM key for encrypting bot tokens at rest (32-byte hex string). */
    tokenKey: env('TOKEN_ENCRYPTION_KEY', ''),
  },

  hubspot: {
    /** HubSpot private app access token (global fallback). */
    apiKey: env('HUBSPOT_API_KEY', ''),
    /** HubSpot portal/account ID (global fallback). */
    portalId: env('HUBSPOT_PORTAL_ID', ''),
    /** Client secret for validating HubSpot webhook signatures (v3). */
    clientSecret: env('HUBSPOT_CLIENT_SECRET', ''),
  },

  hubspotOAuth: {
    /** HubSpot Developer App OAuth client ID. */
    clientId: env('HUBSPOT_OAUTH_CLIENT_ID', ''),
    /** HubSpot Developer App OAuth client secret. */
    clientSecret: env('HUBSPOT_OAUTH_CLIENT_SECRET', ''),
    /** OAuth callback URL (e.g. https://yourdomain.com/api/hubspot/oauth/callback). */
    redirectUri: env('HUBSPOT_OAUTH_REDIRECT_URI', ''),
  },

  instantly: {
    /** Instantly.ai API v2 key (Bearer auth). */
    apiKey: env('INSTANTLY_API_KEY', ''),
    /** Shared secret for validating inbound Instantly webhooks. */
    webhookSecret: env('INSTANTLY_WEBHOOK_SECRET', ''),
  },

  heyreach: {
    /** HeyReach API key (X-API-KEY header). */
    apiKey: env('HEYREACH_API_KEY', ''),
    /** Shared secret for validating inbound HeyReach webhooks. */
    webhookSecret: env('HEYREACH_WEBHOOK_SECRET', ''),
  },

  dncscrub: {
    /** DNCScrub.com API key (loginId header). Optional -- if empty, DNC scrub step is skipped. */
    apiKey: process.env['DNCSCRUB_API_KEY'] || '',
  },

  findymail: {
    /** Findymail API key (Bearer auth). Optional -- if empty, email verification step is skipped. */
    apiKey: process.env['FINDYMAIL_API_KEY'] || '',
    /** Cost per single email verification call (default: $0.01). */
    costPerVerification: envNumber('FINDYMAIL_COST_PER_VERIFICATION', 0.01),
    /** Max concurrent verification requests (Findymail limit: 300). */
    maxConcurrency: envNumber('FINDYMAIL_MAX_CONCURRENCY', 50),
  },

  bdrManager: {
    /** Hour (UTC) to send daily morning DMs to BDRs (default 13 = 8am EST). */
    morningDmHour: envNumber('BDR_MORNING_DM_HOUR', 13),
    /** Hour (UTC) to send EOD reports (default 22 = 5pm EST). */
    eodReportHour: envNumber('BDR_EOD_REPORT_HOUR', 22),
    /** Hours before a step waiting for webhook is flagged as stuck (default 24). */
    stuckStepTimeoutHours: envNumber('BDR_STUCK_STEP_TIMEOUT_HOURS', 24),
  },

  /** Dashboard URL for constructing upload links. */
  dashboardUrl: env('DASHBOARD_URL', 'https://dt9zhghz3mtx8.cloudfront.net'),

  /** Multi-tenant SaaS licensing config. */
  licensing: {
    /** Slack team ID for the platform owner workspace (all features enabled, billing exempt). */
    platformOwnerTeamId: env('PLATFORM_OWNER_TEAM_ID', ''),
    /** Verified sender email for "Send Copy To" feature. */
    resendFromEmail: env('RESEND_FROM_EMAIL', ''),
    /** Base URL for the client-facing dashboard. */
    clientDashboardUrl: env('CLIENT_DASHBOARD_URL', ''),
  },

  billing: {
    stripeSecretKey: env('STRIPE_SECRET_KEY', ''),
    stripeWebhookSecret: env('STRIPE_WEBHOOK_SECRET', ''),
    resendApiKey: env('RESEND_API_KEY', ''),
    appBaseUrl: env('APP_BASE_URL', ''),
  },

  /** Comma-separated list of allowed CORS origins in production (empty = CORS disabled). */
  corsAllowedOrigins: process.env['CORS_ALLOWED_ORIGINS'] || '',

  apiKey: env('API_KEY'),
  webhookBaseUrl: env('WEBHOOK_BASE_URL'),

  /** Deepgram Nova-2 transcription API key (Feature 22 - Power Dialer). */
  deepgram: {
    apiKey: process.env['DEEPGRAM_API_KEY'] || '',
  },
} as const;
