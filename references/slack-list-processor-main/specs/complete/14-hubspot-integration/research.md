# Research: HubSpot OAuth Integration

**Feature**: 14-hubspot-integration | **Date**: 2026-03-10

## 1. HubSpot OAuth 2.0 Authorization Code Flow

### Decision
Use HubSpot's standard OAuth 2.0 Authorization Code grant type with the `@hubspot/api-client` SDK for token management and API calls.

### Rationale
- Industry-standard OAuth flow — well documented and supported
- `@hubspot/api-client` v13.x provides built-in helpers for auth URL generation, token exchange, and refresh
- Replaces the existing raw `hubspotFetch()` approach with a typed SDK, reducing maintenance burden
- Access tokens expire every 30 minutes; refresh tokens are long-lived (until app uninstall or scope change)

### Alternatives Considered
- **Private App tokens (API keys)**: Simpler but single-account only. Cannot support per-client auth. Already used for the global workspace account; being phased out.
- **Raw HTTP client (current pattern)**: Works but requires manual token refresh, error handling, and type definitions. SDK provides these out of the box.

### Key Technical Details
- **Authorization URL**: `https://app.hubspot.com/oauth/authorize?client_id={id}&redirect_uri={uri}&scope={scopes}&state={state}`
- **Token endpoint**: `POST https://api.hubapi.com/oauth/v1/token`
- **Access token TTL**: 30 minutes (1800 seconds)
- **Refresh token TTL**: Indefinite (until app uninstall)
- **Auth code TTL**: 10 minutes
- **State parameter**: Cryptographically signed JWT containing `{ clientId, channelId, slackUserId, nonce }` — validated on callback to prevent CSRF

### Required OAuth Scopes
```
oauth
crm.objects.contacts.read
crm.objects.contacts.write
crm.objects.companies.read
crm.objects.companies.write
crm.objects.owners.read
crm.lists.read
crm.lists.write
crm.schemas.contacts.read
crm.schemas.contacts.write
```

**Note**: `crm.schemas.contacts.write` is needed to create custom property groups/properties. `crm.lists.read/write` replaced the deprecated `contacts` scope for list operations.

---

## 2. Token Storage & Encryption

### Decision
Store encrypted OAuth tokens as new fields on the `ManagedClient` model, reusing the existing `tokenEncryption.ts` utility (AES-256-GCM).

### Rationale
- ManagedClient already stores encrypted API keys (`instantlyApiKey`, `heyreachApiKey`, `hubspotApiKey`) using the same encryption utility
- One-to-one relationship between client and HubSpot connection is natural
- Adding fields to ManagedClient is simpler than creating a separate HubSpotConnection table for this phase
- However, to track connection metadata (status, connected_by, last_sync_at), a separate `HubSpotConnection` model with a 1:1 relation to ManagedClient is cleaner

### Alternatives Considered
- **Fields directly on ManagedClient**: Simpler but clutters the model with 6+ new fields. Harder to track connection lifecycle.
- **Separate HubSpotConnection table**: Chosen. Clean separation, supports connection status tracking, connected_by audit, and future multi-portal if ever needed.
- **External secret store (AWS Secrets Manager)**: Over-engineered for this use case. Current encryption approach is consistent and proven.

### Implementation
- New `HubSpotConnection` model with 1:1 relation to `ManagedClient`
- Tokens encrypted/decrypted using `encrypt()`/`decrypt()` from `src/lib/tokenEncryption.ts`
- Token refresh handled transparently before each HubSpot API call — check `expiresAt`, refresh if within 5-minute window

---

## 3. HubSpot API Client Refactoring

### Decision
Refactor `hubspotClient.ts` to support per-client OAuth tokens while maintaining backward compatibility with the global API key for existing campaign import functionality.

### Rationale
- The existing `hubspotClient.ts` uses a global `HUBSPOT_API_KEY` from config
- New per-client OAuth flow requires passing client-specific access tokens
- Both modes must coexist during the transition period (spec assumption)

### Implementation
- New `HubSpotOAuthClient` class that accepts a `ManagedClient` ID, loads tokens from DB, handles refresh
- Existing `hubspotFetch()` remains for legacy campaign import (global key)
- New client uses `@hubspot/api-client` SDK methods for contacts, lists, properties
- Circuit breaker and rate limiting patterns carried over from existing implementation

### Alternatives Considered
- **Replace global client entirely**: Too risky — existing campaign contact import depends on it. Phased migration preferred.
- **Factory pattern**: Create clients on-demand with `createHubSpotClient(clientId)` that returns a configured SDK instance. Chosen for simplicity.

---

## 4. Contact Import & Batch Processing

### Decision
Use HubSpot's batch upsert API (`/crm/v3/objects/contacts/batch/upsert`) with email as the `idProperty`, processing 100 contacts per batch with rate limit awareness.

### Rationale
- Batch upsert handles create-or-update in a single call, eliminating the need for separate existence checks
- 100 is HubSpot's max batch size for upsert
- At 110 req/10s rate limit for OAuth apps, theoretical throughput is ~1,100 contacts/second
- For 5,000 contacts: 50 batches = ~5 seconds of API time (well within 5-minute target)

### Key API Endpoints
| Operation | Method | Endpoint |
|-----------|--------|----------|
| Batch upsert contacts | `POST` | `/crm/v3/objects/contacts/batch/upsert` |
| Create static list | `POST` | `/crm/v3/lists` |
| Add contacts to list | `PUT` | `/crm/v3/lists/{listId}/memberships/add` |
| Get contact properties | `GET` | `/crm/v3/properties/contacts` |
| Create property group | `POST` | `/crm/v3/properties/contacts/groups` |
| Create property | `POST` | `/crm/v3/properties/contacts` |

### Batch Processing Flow
1. Parse CSV/XLSX file → extract rows with column mapping
2. Chunk into batches of 100
3. For each batch: call batch upsert, collect results (created/updated/failed)
4. After all contacts upserted: create static list
5. Add all successfully upserted contact IDs to the list (100 per call)
6. Post summary to Slack thread

### Alternatives Considered
- **HubSpot native import API**: Asynchronous, harder to track per-contact results, and doesn't return individual contact IDs for list membership.
- **Individual contact creates**: Too many API calls; would exhaust rate limits for large imports.
- **Batch create + batch update (separate)**: Requires pre-checking existence; batch upsert is simpler.

---

## 5. Column Auto-Detection

### Decision
Use a fuzzy mapping dictionary matching CSV column headers to HubSpot internal property names, with a confidence threshold.

### Rationale
- Enrichment output files have consistent column names (e.g., "Contact First Name", "Email", "Job Title")
- A static mapping table covers 90%+ of standard files
- Manual mapping fallback handles non-standard files

### Mapping Table (Standard Enrichment Output)
| CSV Column Name | HubSpot Property |
|-----------------|------------------|
| Email | `email` |
| Contact First Name | `firstname` |
| Contact Last Name | `lastname` |
| Job Title | `jobtitle` |
| Company Name / Company | `company` |
| Mobile Number | `mobilephone` |
| Business Phone / Direct Phone | `phone` |
| LinkedIn URL / LinkedIn | `hs_linkedin_url` |
| Contact City / City | `city` |
| Contact State / State | `state` |
| Contact Country / Country | `country` |
| Website / Domain | `website` |

### Implementation
- Normalize column headers: lowercase, trim, remove special characters
- Match against mapping dictionary (exact match + common aliases)
- Unmatched columns shown as "Unmapped" in preview
- User can override any mapping or ignore columns
- Properties dropdown fetched from client's HubSpot (standard + custom) via Properties API

---

## 6. Static List Creation

### Decision
Use HubSpot Lists API v3 to create STATIC (manual) lists and add member contacts by record ID.

### Rationale
- Static lists support manual membership management (add/remove contacts)
- Dynamic lists use filters and cannot have members added directly
- List naming convention `LIST : MMDD [CLIENT] Campaign Name / Target List` is a display-only format

### Key Details
- **List type**: `STATIC` (HubSpot `processingType: "MANUAL"`)
- **List creation**: `POST /crm/v3/lists` with `{ name, processingType: "MANUAL", objectTypeId: "0-1" }`
- **Add members**: `PUT /crm/v3/lists/{listId}/memberships/add` with `{ recordIdsToAdd: [id1, id2, ...] }` (max 100 per call)
- **Duplicate names**: HubSpot allows duplicate list names; each list has a unique ID
- **List URL**: `https://app.hubspot.com/contacts/{portalId}/objects/0-1/views/{listId}/list`

---

## 7. Custom Property Management

### Decision
Create a custom property group "Enrichment Data" and four custom properties on first import (idempotent — skip if already exists).

### Properties
| Property Name | Label | Type | Group |
|---------------|-------|------|-------|
| `enrichment_source` | Enrichment Source | `string` | Enrichment Data |
| `enrichment_date` | Enrichment Date | `date` | Enrichment Data |
| `tech_spend_tier` | Tech Spend Tier | `enumeration` (Tier 1, Tier 2, Tier 3, Unclassified) | Enrichment Data |
| `enrichment_job_id` | Enrichment Job ID | `string` | Enrichment Data |

### Implementation
- On first import for a client, attempt to create the property group and properties
- Use try/catch — if 409 Conflict (already exists), skip silently
- Properties are created in the client's HubSpot portal, not globally

---

## 8. OAuth State Parameter Security

### Decision
Use a signed JWT as the OAuth state parameter, containing client context and a nonce, validated on callback.

### Rationale
- Prevents CSRF attacks — only callbacks with valid state are processed
- Encodes context (clientId, channelId, userId) so the callback knows which client and channel to update
- JWT signed with `SLACK_STATE_SECRET` (already in config for Slack OAuth)
- Nonce stored in Redis with 15-minute TTL to prevent replay attacks

### Implementation
```
state = jwt.sign({ clientId, channelId, userId, nonce }, STATE_SECRET, { expiresIn: '15m' })
```
On callback:
1. Verify JWT signature
2. Check nonce exists in Redis (and delete it — single use)
3. Exchange auth code for tokens
4. Store tokens on the client's HubSpotConnection
5. Post confirmation to the originating Slack channel

---

## 9. BullMQ Queue for Async Import

### Decision
Create a dedicated `hubspotImportQueue` with a worker that processes import jobs asynchronously, posting progress updates to the Slack thread.

### Rationale
- Large imports (5,000 contacts) take 1-3 minutes — too long for a synchronous Slack interaction
- BullMQ provides retry, progress tracking, and failure handling out of the box
- Follows the existing pattern (enrichmentQueue, fileGenerationQueue, etc.)

### Queue Configuration
- **Queue name**: `hubspot-import`
- **Concurrency**: 1 (per client — avoid rate limit conflicts)
- **Attempts**: 3 with exponential backoff (5s base)
- **Job data**: `{ importJobId, clientId, channelId, threadTs }`

---

## 10. NPM Package: @hubspot/api-client

### Decision
Add `@hubspot/api-client` v13.x as a new dependency.

### Rationale
- Official HubSpot SDK for Node.js
- Provides typed methods for all CRM APIs (contacts, lists, properties)
- Built-in OAuth helpers (auth URL generation, token exchange, refresh)
- Reduces boilerplate compared to raw `fetch()` calls

### Alternatives Considered
- **Continue with raw fetch**: More maintenance, no types, manual retry logic. SDK provides all this.
- **hubspot-api-nodejs (community)**: Less maintained than the official SDK.

### Impact
- Single new dependency: `@hubspot/api-client`
- No conflicts with existing dependencies
- Docker image size increase: minimal (~2MB)

---

## 11. Activity Pull: Date Range Presets & Batch Query

### Decision
`/hubspot activity` shows preset buttons ("Today", "Last 7 Days", "Custom") instead of using hardcoded time windows. Activity data is fetched via HubSpot's Search API in batch (filtering by associated contact IDs) rather than per-contact API calls.

### Rationale
- Preset buttons provide a quick UX with "Custom" for flexibility — no ambiguity about what time range is being queried
- HubSpot's Search API (`POST /crm/v3/objects/engagements/search`) supports filtering by `hs_timestamp` range and pagination
- Batch query avoids N+1 per-contact calls when a client has hundreds of synced contacts
- Results filtered client-side to include only engagements associated with contacts in our `HubSpotContactMapping`

### Alternatives Considered
- **Hardcoded "last 7 days" or "last 30 days"**: Less flexible, doesn't serve all use cases
- **Per-contact API calls**: O(N) calls for N contacts; hits rate limits for clients with many contacts
- **Background sync job with local cache**: Over-engineered for on-demand activity queries; adds database storage and staleness concerns

---

## 12. Activity Push: Event Source Integration

### Decision
HubSpot activity push hooks into existing per-client webhook receivers that already capture all campaign activity events (Instantly, HeyReach, etc.) via API endpoints. No new webhook infrastructure required.

### Rationale
- Existing webhook receivers per client already capture call completions, email delivery events, and meeting bookings
- HubSpot activity push is an additional subscriber to these existing event flows
- Adding a HubSpot sync step to the existing event handlers is minimal scope

### Implementation
- In existing webhook handlers (Instantly delivery, HeyReach activity, campaign call completion), add a check for active HubSpot connection
- If connected, enqueue a `hubspot-activity-sync` BullMQ job with the event data
- If not connected, skip silently (no error)

---

## 13. HubSpot Webhook Subscriptions: App-Level Model

### Decision
Webhook subscriptions for deal stage changes are configured once at the HubSpot Developer App level during initial setup. Events are routed to the correct client by `portalId` at runtime. No per-client subscription registration on connect/disconnect.

### Rationale
- HubSpot webhook subscriptions are inherently app-level — all portals share the same subscription endpoint
- Registering subscriptions per client on connect would be redundant since the app-level subscription already delivers events for all connected portals
- Simplifies connect/disconnect flows (no webhook API calls needed)
- `webhookSubscriptionId` removed from `HubSpotConnection` model (not needed per-client)

### Implementation
- One-time setup: `POST /webhooks/v3/{appId}/subscriptions` during Developer App configuration
- Runtime: Webhook handler looks up `HubSpotConnection` by `portalId` from event payload
- Unrecognized portals (no active connection) → respond 200, skip processing
- Documented in quickstart.md as a deployment prerequisite
