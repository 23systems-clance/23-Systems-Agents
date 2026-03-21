# OAuth Installation Flow Contract

## Overview

Multi-workspace distribution uses Slack OAuth v2. The install flow adds two Express endpoints to the existing HTTP server. Socket Mode remains the event delivery mechanism.

## Endpoints

### GET /slack/install

Redirects the user to Slack's OAuth authorization page.

**Query Parameters** (optional):
- `team` — Pre-select a specific workspace

**Response**: 302 redirect to `https://slack.com/oauth/v2/authorize` with:
- `client_id` — App client ID
- `scope` — `assistant:write,chat:write,im:history,channels:history,groups:history,files:read,channels:join`
- `redirect_uri` — `{WEBHOOK_BASE_URL}/slack/oauth_redirect`
- `state` — CSRF token (stored in session)

### GET /slack/oauth_redirect

Handles the OAuth callback from Slack.

**Query Parameters**:
- `code` — Authorization code from Slack
- `state` — CSRF token for validation

**Flow**:
1. Validate `state` matches stored CSRF token
2. Exchange `code` for tokens via `oauth.v2.access`
3. Create/update `WorkspaceInstallation` record
4. Cache bot token in Redis
5. Redirect to success page or Slack deep link

**Response**:
- Success: HTML page with "Installation complete! Return to Slack."
- Error: HTML page with error description and retry link

### POST /slack/events (future — HTTP mode)

Not implemented in initial release. Socket Mode handles all events. Reserved for future Marketplace transition.

## Installation Data

```typescript
interface SlackInstallation {
  team: {
    id: string;      // T012345678
    name: string;    // "Acme Corp"
  };
  enterprise?: {
    id: string;
    name: string;
  };
  bot: {
    token: string;   // xoxb-...
    scopes: string[];
    id: string;      // B012345678
    userId: string;  // U012345678
  };
  appId: string;
  tokenType: 'bot';
  isEnterpriseInstall: boolean;
}
```

## InstallationStore Interface

```typescript
interface InstallationStore {
  storeInstallation: (installation: SlackInstallation) => Promise<void>;
  fetchInstallation: (query: { teamId: string }) => Promise<SlackInstallation>;
  deleteInstallation: (query: { teamId: string }) => Promise<void>;
}
```

**Implementation**: Prisma-backed with Redis caching for fetchInstallation.

## Authorize Function (Socket Mode)

```typescript
// Called on every incoming Slack event
async function authorize({ teamId }: { teamId: string }) {
  // 1. Check Redis cache
  const cached = await redis.get(`install:${teamId}`);
  if (cached) return JSON.parse(cached);

  // 2. Fallback to DB
  const install = await prisma.workspaceInstallation.findUnique({
    where: { slackTeamId: teamId, status: 'ACTIVE' },
  });

  if (!install) throw new Error(`No active installation for team ${teamId}`);

  const authResult = {
    botToken: decrypt(install.botToken),
    botId: install.botId,
    botUserId: install.botUserId,
  };

  // 3. Cache for 1 hour
  await redis.setex(`install:${teamId}`, 3600, JSON.stringify(authResult));

  return authResult;
}
```

## App Uninstall Handling

**Event**: `app_uninstalled` (subscribe in event subscriptions)

**Flow**:
1. Receive `app_uninstalled` event with `team_id`
2. Update `WorkspaceInstallation.status` to `UNINSTALLED`
3. Set `uninstalledAt` to now, `purgeAfter` to now + 90 days
4. Invalidate Redis cache for this team
5. Cancel any running BullMQ jobs for this team
6. Log uninstall to AuditLog

## Environment Variables (New)

```
SLACK_CLIENT_ID        — OAuth client ID (from app settings)
SLACK_CLIENT_SECRET    — OAuth client secret
SLACK_STATE_SECRET     — Random string for CSRF state signing
OAUTH_REDIRECT_URI     — Full callback URL (e.g., https://api.example.com/slack/oauth_redirect)
TOKEN_ENCRYPTION_KEY   — AES-256 key for encrypting stored bot tokens
```

## Security

- Bot tokens encrypted at rest using AES-256-GCM
- CSRF state token validated on callback
- OAuth redirect URI must be pre-registered in Slack app settings
- Token refresh: Slack bot tokens don't expire, but handle `token_revoked` events
- Installation data only accessible to workspace admins (Slack role check)
