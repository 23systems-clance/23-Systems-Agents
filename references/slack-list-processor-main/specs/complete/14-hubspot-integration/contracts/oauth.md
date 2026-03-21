# API Contract: HubSpot OAuth

**Feature**: 14-hubspot-integration | **Date**: 2026-03-10

## Endpoints

### 1. OAuth Callback

Receives the authorization code from HubSpot after user approves permissions.

```
GET /api/hubspot/oauth/callback
```

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `code` | string | Yes | Authorization code from HubSpot (valid for 10 minutes) |
| `state` | string | Yes | Signed JWT containing `{ clientId, channelId, slackUserId, nonce }` |

**Success Response (302 Redirect):**

Redirects to a success HTML page (or Slack deep link) after processing.

```
HTTP/1.1 302 Found
Location: /api/hubspot/oauth/success?client={clientName}
```

**Side Effects on Success:**
1. Exchanges `code` for access + refresh tokens via HubSpot token endpoint
2. Encrypts tokens and creates `HubSpotConnection` record linked to `ManagedClient`
3. Posts confirmation message to originating Slack channel:
   ```
   HubSpot connected for {clientName} (Portal: {portalId}).
   Use /hubspot import to import contacts.
   ```

**Error Response (400):**

```json
{
  "error": "invalid_state",
  "message": "Invalid or expired authorization state. Please try /hubspot connect again."
}
```

**Error Conditions:**

| Condition | HTTP Status | Error Code |
|-----------|-------------|------------|
| Invalid/expired JWT state | 400 | `invalid_state` |
| Nonce already used (replay) | 400 | `replay_detected` |
| Auth code exchange fails | 400 | `token_exchange_failed` |
| Client already connected | 409 | `already_connected` |
| Internal error | 500 | `internal_error` |

**Security:**
- State parameter validated via JWT signature verification using `SLACK_STATE_SECRET`
- Nonce checked against Redis (single-use, 15-minute TTL)
- No authentication required (public endpoint — security via state parameter)

---

### 2. OAuth Success Page

Simple HTML page shown after successful OAuth completion.

```
GET /api/hubspot/oauth/success
```

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `client` | string | No | Client name for display |

**Response (200 HTML):**

```html
<html>
  <body>
    <h1>HubSpot Connected!</h1>
    <p>You can close this window and return to Slack.</p>
  </body>
</html>
```

---

## Slash Command Contract: `/hubspot`

### Subcommands

#### `/hubspot connect`

**Preconditions:**
- Channel must have a `ChannelClientMapping` (error if not)
- Client must NOT already have an active `HubSpotConnection` (warn if connected)

**Flow:**
1. Acknowledge command (`ack()`)
2. Look up `ManagedClient` via `ChannelClientMapping`
3. Generate OAuth state JWT: `{ clientId, channelId, userId, nonce }`
4. Store nonce in Redis with 15-minute TTL
5. Build HubSpot authorization URL with required scopes, `optional_scope` (deals, engagements), and state
6. Post ephemeral message with "Connect HubSpot" button linking to auth URL

**Slack Message (Block Kit):**
```json
{
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "Connect your HubSpot account to enable contact imports and list creation."
      }
    },
    {
      "type": "actions",
      "elements": [
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "Connect HubSpot" },
          "url": "https://app.hubspot.com/oauth/authorize?client_id=...&scope=...&optional_scope=...&state=...",
          "style": "primary",
          "action_id": "hubspot_oauth_link"
        }
      ]
    }
  ]
}
```

---

#### `/hubspot disconnect`

**Preconditions:**
- Channel must have a client with an active HubSpot connection

**Flow:**
1. Acknowledge command
2. Post confirmation prompt with "Disconnect" and "Cancel" buttons
3. On "Disconnect" confirmation:
   - Delete `HubSpotConnection` record (tokens removed)
   - Post confirmation: "HubSpot disconnected for {clientName}."

---

#### `/hubspot status`

**Preconditions:** None (shows appropriate message for any state)

**Response Variants:**

| State | Response |
|-------|----------|
| Connected | Portal name, portal ID, connection date, connected by, import count |
| Not connected | "Not connected. Use `/hubspot connect` to set up." |
| Token expired | "Connection expired. Use `/hubspot connect` to reconnect." |
| No client mapping | "No client assigned to this channel." |

---

#### `/hubspot help`

**Response:**
```
/hubspot connect    — Connect your HubSpot account via OAuth
/hubspot disconnect — Remove the HubSpot connection
/hubspot status     — Check connection status
/hubspot import     — Import contacts and create a HubSpot list
/hubspot activity   — View HubSpot engagement activity
/hubspot sync       — Re-sync failed activity to HubSpot
/hubspot help       — Show this help message
```

---

## Internal Service Contracts

### HubSpotOAuthService

```typescript
interface HubSpotOAuthService {
  /** Generate the HubSpot OAuth authorization URL with state parameter */
  generateAuthUrl(clientId: string, channelId: string, userId: string): Promise<string>;

  /** Exchange authorization code for tokens, store encrypted on HubSpotConnection */
  handleCallback(code: string, state: string): Promise<HubSpotConnection>;

  /** Get a valid access token for a client (auto-refreshes if expired) */
  getAccessToken(clientId: string): Promise<string>;

  /** Disconnect: delete tokens and mark connection as disconnected */
  disconnect(clientId: string): Promise<void>;

  /** Get connection status for a client */
  getConnectionStatus(clientId: string): Promise<HubSpotConnection | null>;
}
```

### Token Refresh Flow

```
1. getAccessToken(clientId)
2. Load HubSpotConnection from DB
3. If tokenExpiresAt > now + 5min → return decrypt(accessToken)
4. Else → call HubSpot refresh endpoint
5. Update accessToken, refreshToken, tokenExpiresAt, lastRefreshedAt
6. Return new decrypted accessToken
7. On BAD_REFRESH_TOKEN error → set status = TOKEN_EXPIRED, notify Slack channel
```
