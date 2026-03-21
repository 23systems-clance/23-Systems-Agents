# Quickstart: HubSpot OAuth Integration

**Feature**: 14-hubspot-integration | **Date**: 2026-03-10

## Prerequisites

### 1. HubSpot Developer App

Create a HubSpot Developer App at [developers.hubspot.com](https://developers.hubspot.com):

1. Go to **Apps** → **Create App**
2. Set app name: "Slack List Processor"
3. Go to **Auth** tab:
   - Copy the **Client ID** and **Client Secret**
   - Add **Redirect URL**: `https://{ALB_DOMAIN}/api/hubspot/oauth/callback`
4. Configure **Scopes** (Required):
   - `oauth`
   - `crm.objects.contacts.read`
   - `crm.objects.contacts.write`
   - `crm.objects.companies.read`
   - `crm.objects.companies.write`
   - `crm.objects.owners.read`
   - `crm.lists.read`
   - `crm.lists.write`
   - `crm.schemas.contacts.read`
   - `crm.schemas.contacts.write`
5. Configure **Optional Scopes** (via `optional_scope` — connection succeeds even if client's plan doesn't support these):
   - `crm.objects.deals.read`
   - `sales-email-read`
   - `crm.objects.engagements.read`
   - `crm.objects.engagements.write`
6. Set up **Webhooks** (one-time, app-level):
   - Go to **Webhooks** tab
   - Set **Target URL**: `https://{ALB_DOMAIN}/api/webhooks/hubspot`
   - Create subscription: Event type `deal.propertyChange`, Property `dealstage`, Active: `true`
   - Note: This is configured once at the app level — all connected portals share this subscription

### 2. Environment Variables

Add to `.env` (used by deploy script for ECS task definition):

```env
# HubSpot OAuth (NEW)
HUBSPOT_OAUTH_CLIENT_ID=your-hubspot-app-client-id
HUBSPOT_OAUTH_CLIENT_SECRET=your-hubspot-app-client-secret
HUBSPOT_OAUTH_REDIRECT_URI=https://{ALB_DOMAIN}/api/hubspot/oauth/callback

# Existing (keep for backward compatibility)
HUBSPOT_API_KEY=existing-global-api-key
HUBSPOT_PORTAL_ID=existing-global-portal-id
HUBSPOT_CLIENT_SECRET=existing-webhook-secret
TOKEN_ENCRYPTION_KEY=existing-64-char-hex-string
```

### 3. Slack App Configuration

Register the `/hubspot` slash command in the Slack App settings:

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → your app
2. **Slash Commands** → **Create New Command**:
   - Command: `/hubspot`
   - Request URL: (handled via Socket Mode, no URL needed)
   - Short Description: "Connect HubSpot and import contacts"
   - Usage Hint: `connect | disconnect | status | import | activity | sync | help`

### 4. Database Migration

```bash
# Generate Prisma migration for new models
npx prisma migrate dev --name add-hubspot-oauth-models
```

This creates:
- `hubspot_connections` table
- `hubspot_import_jobs` table
- `hubspot_contact_mappings` table
- `hubspot_engagement_mappings` table
- `hubspot_sync_logs` table
- `HubSpotConnectionStatus` enum
- `HubSpotImportStatus` enum
- `HubSpotSyncType` enum

### 5. Install New Dependency

```bash
npm install @hubspot/api-client
```

## Deployment

All deployment follows the existing CI/CD pipeline:

1. Push to GitHub on feature branch `14-hubspot-integration`
2. GitHub Actions builds Docker image, pushes to ECR, redeploys ECS
3. New env vars must be added to the ECS task definition via CloudFormation parameters

**New CloudFormation parameters to add:**
- `HubSpotOAuthClientId`
- `HubSpotOAuthClientSecret`
- `HubSpotOAuthRedirectUri`

## Verification

After deployment, verify the integration:

1. **OAuth Flow:**
   - Go to a client channel with a `ChannelClientMapping`
   - Type `/hubspot connect`
   - Click "Connect HubSpot" button
   - Authorize in HubSpot
   - Verify confirmation message appears in Slack
   - Verify `HubSpotConnection` record in database

2. **Contact Import:**
   - Run an enrichment job in the connected channel
   - Click "Import to HubSpot" on the completion message (or use `/hubspot import`)
   - Enter client name and campaign name
   - Confirm column mapping
   - Verify contacts appear in HubSpot
   - Verify static list is created with correct name

3. **Connection Management:**
   - `/hubspot status` — should show connected portal info
   - `/hubspot disconnect` — should remove connection
   - `/hubspot status` — should show "Not connected"

4. **Activity Pull:**
   - `/hubspot activity` — should show date range preset buttons (Today, Last 7 Days, Custom)
   - Select a preset → should return activity summary with counts and conversation notes
   - `/hubspot activity user@example.com` — should scope results to that contact

5. **Webhook Notifications:**
   - Change a deal stage in HubSpot for an imported contact
   - Verify notification appears in the client's Slack channel

## Architecture Notes

- **Token refresh**: Transparent to the user. Access tokens (30-min TTL) are refreshed automatically before each HubSpot API call.
- **Encryption**: OAuth tokens encrypted with AES-256-GCM using the existing `TOKEN_ENCRYPTION_KEY`. Same approach as Instantly/HeyReach API keys.
- **Rate limiting**: HubSpot OAuth apps get 110 requests/10 seconds. The import worker processes batches sequentially with rate limit awareness.
- **Client isolation**: Each `ManagedClient` has its own `HubSpotConnection` with independent tokens. No cross-client access is possible.
