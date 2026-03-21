# Attio CRM Integration - Research & Parity Analysis vs HubSpot (Spec 14)

**Created**: 2026-03-10
**Purpose**: Evaluate Attio CRM API capabilities against spec 14 (HubSpot Integration) feature-by-feature
**Attio Docs**: https://docs.attio.com/rest-api/overview
**Attio OpenAPI**: https://api.attio.com/openapi/api

---

## 1. OAuth 2.0 Flow

### HubSpot (Spec 14)

- Auth URL: `https://app.hubspot.com/oauth/authorize`
- Token URL: `https://api.hubapi.com/oauth/v1/token`
- Scopes: contacts, lists, properties, deals, engagements (with `optional_scope` fallback)
- Tokens expire every 30 minutes, auto-refresh via refresh_token
- Callback: `/api/hubspot/oauth/callback` on existing ALB

### Attio

- Auth URL: `https://app.attio.com/authorize`
- Token URL: `https://app.attio.com/oauth/token`
- Params: `response_type=code`, `client_id`, `redirect_uri`, `state` (identical pattern)
- Scopes: granular — records, objects, tasks, user_management, etc.
- Token exchange: POST with `client_secret`, `application/x-www-form-urlencoded`
- Refresh tokens: supported (standard OAuth 2.0 refresh_token grant)
- State param: supported for CSRF protection

### Parity: FULL

Same OAuth 2.0 Authorization Code Grant flow. Callback would be `/api/attio/oauth/callback`.

**One caveat**: Attio requires **publication approval** for OAuth apps to work across workspaces. During dev, tokens only work for the workspace hosting the app.

---

## 2. Contact Import & Upsert (Stories 1-2 in Spec 14)

### HubSpot (Spec 14: FR-010 through FR-025)

- Upsert contacts by email: `POST /crm/v3/objects/contacts/batch/create` + `/batch/update`
- Search by email: `POST /crm/v3/objects/contacts/search`
- Fetch properties: `GET /crm/v3/properties/contacts`
- Create custom properties: `POST /crm/v3/properties/contacts`
- Create static list: `POST /crm/v3/lists`
- Add to list: `POST /crm/v3/lists/{listId}/memberships/add`
- Batch size: 100 per API call
- Rate limit: 110 req/10s for OAuth apps

### Attio

- Create person: `POST /v2/people`
- Upsert person (match by email): `POST /v2/people/assert`
- List people: `GET /v2/people`
- Get person: `GET /v2/people/{record}`
- Update person: `PATCH /v2/people/{record}`
- Create company: `POST /v2/companies`
- Upsert company: `POST /v2/companies/assert`
- Create custom attributes: `POST /v2/{target}/{identifier}/attributes` (20+ types)
- Fetch attributes: `GET /v2/{target}/{identifier}/attributes`
- Create list: `POST /v2/lists`
- Add to list: via list entries API
- List entries support full attribute values per entry (more flexible than HubSpot)

### Parity: FULL

| Spec 14 Requirement | HubSpot | Attio | Status |
|---------------------|---------|-------|--------|
| FR-010: Show recent files for import | App logic | App logic | Same |
| FR-011: Collect client/campaign name | App logic | App logic | Same |
| FR-012: Auto-detect column mapping | Properties API | Attributes API | FULL |
| FR-013: Manual column mapping modal | Properties API lists all props | Attributes API lists all attrs | FULL |
| FR-014: Require email mapping | Upsert by email | Assert by email | FULL |
| FR-015: Upsert contacts by email | Batch upsert API | `POST /v2/people/assert` | FULL |
| FR-016: Create static list | Lists API | `POST /v2/lists` | FULL |
| FR-017: Add contacts to list | List membership API | List entries API | FULL |
| FR-018: Batch processing | 100 per batch | Supported | FULL |
| FR-019: Post completion summary | App logic | App logic | Same |
| FR-020: Progress updates | App logic | App logic | Same |
| FR-022: "Import to Attio" button | App logic | App logic | Same |
| FR-024: Create custom properties | Properties API | Attributes API (20+ types) | FULL |
| FR-025: Fetch all properties for mapping | `GET /properties/contacts` | `GET /v2/objects/{obj}/attributes` | FULL |

---

## 3. Activity Pull (Story 6 in Spec 14)

### HubSpot (Spec 14: FR-026 through FR-028)

- `GET /crm/v3/objects/contacts/{id}/associations/engagements` to get engagement IDs
- `GET /crm/v3/objects/engagements/{id}` to get engagement details
- Engagement types: CALL, EMAIL, MEETING, NOTE, TASK
- Each engagement has typed metadata (duration, outcome, subject, etc.)

### Attio

- `GET /v2/notes` — list/filter notes attached to a record (full CRUD)
- `GET /v2/tasks` — list/filter tasks attached to a record (full CRUD)
- `GET /v2/threads` — list comment threads on records
- **Meetings**: Beta — **read-only** via API
- **Call recordings**: Beta — **read-only** via API
- **Emails**: No direct API — tracked via `interactions` attribute type (read-only aggregation)

### Parity: PARTIAL

| Activity Type | HubSpot | Attio | Status |
|---------------|---------|-------|--------|
| Notes | Engagements API | `GET /v2/notes` | FULL |
| Tasks | Engagements API | `GET /v2/tasks` | FULL |
| Meetings | Engagements API | Beta read-only | PARTIAL — can read but limited |
| Calls | Engagements API | Beta read-only | PARTIAL — can read but limited |
| Emails | Engagements API | Interactions attribute only | GAP — no per-email query |

**Impact**: `/attio activity user@example.com` could show notes and tasks fully, meetings partially. Email activity visibility is limited.

---

## 4. Activity Push (Story 7 in Spec 14)

### HubSpot (Spec 14: FR-029 through FR-035)

- `POST /crm/v3/objects/engagements` with type=CALL, EMAIL, or MEETING
- Associate engagement to contact via Associations API
- Full typed metadata (duration, outcome, subject, attendees, etc.)
- Idempotency via stored engagement IDs

### Attio

- **Notes**: `POST /v2/notes` — full CRUD, can attach to person records
- **Tasks**: `POST /v2/tasks` — full CRUD, can attach to person records
- **Meetings**: NO create API (beta read-only)
- **Calls**: NO create API (beta read-only)
- **Emails**: NO create API

### Parity: PARTIAL — Requires Workaround

| Spec 14 Requirement | HubSpot | Attio | Status |
|---------------------|---------|-------|--------|
| FR-029: Push call completions | Create CALL engagement | **No call API** — use Note | WORKAROUND |
| FR-030: Push email delivery | Create EMAIL engagement | **No email API** — use Note | WORKAROUND |
| FR-031: Push meeting bookings | Create MEETING engagement | **No meeting create API** — use Note | WORKAROUND |
| FR-032: Idempotency tracking | Engagement ID stored | Note ID stored | FULL (same pattern) |
| FR-033: Upsert contact first | Contact upsert before engagement | Person assert before note | FULL |
| FR-034: BullMQ async queue | Queue job | Queue job | FULL (app logic) |

### Recommended Workaround

Use **Notes** with structured, typed content to log all activity types:

```
Title: [Call] Outreach to John Smith
Content: Duration: 5 min | Outcome: Connected | Notes: Interested in demo

Title: [Email] Campaign: Q1 Outreach - Subject: Intro to Our Platform
Content: Sent via Instantly | Delivered: 2026-03-10 14:30 UTC

Title: [Meeting] Discovery Call with Jane Doe
Content: Start: 2026-03-15 10:00 | End: 2026-03-15 10:30 | Attendees: jane@co.com, rep@us.com
```

Prefix convention enables filtering: `[Call]`, `[Email]`, `[Meeting]`, `[Activity]`

### Activity Note Templates

Since Attio Notes are the primary mechanism for logging CRM activity, each type needs a structured, scannable template that stands out visually when browsing a person's record.

#### CALL Template

```
Title: CALL | {Contact Name} | {Outcome}

---
Type:        Outbound Call
Date:        {YYYY-MM-DD HH:MM} UTC
Duration:    {X} min
Outcome:     {Connected / Voicemail / No Answer / Busy / Wrong Number}
Disposition: {Interested / Not Interested / Follow Up / Qualified}
---

Campaign:    {Campaign Name}
BDR:         {Rep Name}
Source:       {Platform — e.g. "Slack List Processor"}

Notes:
{Free-text call notes from the BDR}
```

#### EMAIL Template

```
Title: EMAIL | {Contact Name} | {Subject Line}

---
Type:        Outbound Email
Date:        {YYYY-MM-DD HH:MM} UTC
Status:      {Delivered / Opened / Replied / Bounced}
Platform:    {Instantly / HeyReach}
---

Campaign:    {Campaign Name}
Sequence:    {Sequence Name} — Step {N}
Subject:     {Full subject line}

Preview:
{First 200 chars of email body}
```

#### MEETING Template

```
Title: MEETING | {Contact Name} | {Meeting Title}

---
Type:        Meeting Booked
Date:        {YYYY-MM-DD}
Start:       {HH:MM} UTC
End:         {HH:MM} UTC
Duration:    {X} min
Location:    {Zoom / Google Meet / In-Person / Phone}
---

Attendees:
- {contact@company.com} (Contact)
- {rep@ouragency.com} (BDR)

Campaign:    {Campaign Name}
Booked Via:  {Calendly / HubSpot Meetings / Manual}

Agenda:
{Meeting agenda or notes if available}
```

#### Template Implementation Notes

- **Title prefix** (`CALL |`, `EMAIL |`, `MEETING |`) makes the activity type immediately scannable in Attio's notes timeline
- The `---` separator lines create visual structure in Attio's note renderer (supports markdown)
- **Key fields are label-aligned** for quick scanning without reading full text
- All templates include `Campaign` and `Source` fields to tie activity back to the enrichment pipeline
- The title format `{TYPE} | {Contact} | {Key Detail}` gives maximum info at a glance in list views
- Templates are rendered server-side before pushing to Attio — the BDR never writes these manually
- **Filtering**: Query notes by title prefix (`CALL |`, `EMAIL |`, `MEETING |`) to pull activity by type
- **Idempotency key**: Stored in AttioActivityMapping as `{eventType}:{eventId}:{eventSource}` — same pattern as HubSpot engagement mapping

---

## 5. Webhooks (Story 8 in Spec 14)

### HubSpot (Spec 14: FR-036 through FR-040)

- Webhook subscriptions for `deal.propertyChange` (dealstage)
- Signature validation via X-HubSpot-Signature
- Batch events (up to 100), respond within 5s
- Register on connect, deactivate on disconnect

### Attio

- Webhooks for record changes (people, companies, deals)
- Webhooks for task modifications
- Webhooks for comment events
- Webhooks for list entry updates
- Subscription management via API

### Parity: FULL

Attio webhooks can cover deal record changes (equivalent to deal stage changes). Attio actually supports **more** webhook event types than HubSpot (comments, list updates).

Signature validation mechanism needs verification in Attio docs, but webhook infrastructure is present.

---

## 6. Connection Management (Stories 3-4 in Spec 14)

### HubSpot (Spec 14: FR-006, FR-007)

- `/hubspot status` — show portal name, ID, connection date
- `/hubspot disconnect` — delete stored tokens
- `/hubspot help` — list subcommands

### Attio

- Same pattern applies. Workspace info available via API.
- Token deletion on disconnect (same approach — Attio likely has no revocation endpoint either)

### Parity: FULL

All connection management is app logic, not CRM-specific. Identical patterns apply.

---

## 7. Data Model Comparison

The spec 14 data model can be **directly reused** with naming changes:

| Spec 14 Model | Attio Equivalent | Changes Needed |
|----------------|------------------|----------------|
| HubSpotConnection | AttioConnection | Rename fields: `hubspotPortalId` → `attioWorkspaceId`, `hubspotPortalName` → `attioWorkspaceName` |
| HubSpotImportJob | AttioImportJob | Rename: `hubspotListId` → `attioListId` |
| HubSpotContactMapping | AttioContactMapping | Rename: `hubspotContactId` → `attioRecordId` |
| HubSpotEngagementMapping | AttioActivityMapping | Rename: `hubspotEngagementId` → `attioNoteId` (since activities stored as Notes) |
| HubSpotSyncLog | AttioSyncLog | Rename only |

---

## 8. Full Feature Parity Matrix

| # | Spec 14 Feature | Attio Support | Parity Level |
|---|----------------|---------------|--------------|
| 1 | OAuth connect via `/hubspot connect` | OAuth 2.0 Auth Code Grant | FULL |
| 2 | Token refresh (30min expiry) | Standard refresh_token grant | FULL |
| 3 | Encrypted token storage | App logic (same approach) | FULL |
| 4 | `/hubspot status` | Workspace info API | FULL |
| 5 | `/hubspot disconnect` | Delete tokens locally | FULL |
| 6 | `/hubspot import` — file selection | App logic | FULL |
| 7 | Column auto-detection | Attributes API | FULL |
| 8 | Manual column mapping modal | Attributes API (all types) | FULL |
| 9 | Contact upsert by email | `POST /v2/people/assert` | FULL |
| 10 | Create static list | `POST /v2/lists` | FULL |
| 11 | Add contacts to list | List entries API | FULL |
| 12 | Custom properties (enrichment metadata) | Custom attributes (20+ types) | FULL |
| 13 | "Import to Attio" button on enrichment completion | App logic | FULL |
| 14 | Batch processing + rate limiting | Supported | FULL |
| 15 | Pull activity: notes | `GET /v2/notes` | FULL |
| 16 | Pull activity: tasks | `GET /v2/tasks` | FULL |
| 17 | Pull activity: meetings | Beta read-only | PARTIAL |
| 18 | Pull activity: calls | Beta read-only | PARTIAL |
| 19 | Pull activity: emails | No direct API | GAP |
| 20 | Push activity: call logs | No call engagement API — use Notes | WORKAROUND |
| 21 | Push activity: email logs | No email engagement API — use Notes | WORKAROUND |
| 22 | Push activity: meeting logs | No meeting create API — use Notes | WORKAROUND |
| 23 | Idempotency (dedup activities) | Same pattern with Note IDs | FULL |
| 24 | Webhooks: deal stage changes | Record change webhooks | FULL |
| 25 | Webhook signature validation | TBD (needs verification) | TBD |
| 26 | BullMQ async processing | App logic | FULL |
| 27 | Client isolation (per-client tokens) | App logic | FULL |
| 28 | Progress updates in Slack | App logic | FULL |

**Summary**: 22/28 FULL, 4/28 PARTIAL/WORKAROUND, 1/28 GAP, 1/28 TBD

---

## 9. Conclusion & Recommendation

Attio provides **strong parity** for the core value proposition of spec 14:
- OAuth login and per-client workspace connections
- Contact/company import with upsert and list creation
- Custom attributes for enrichment metadata
- Webhooks for CRM event notifications

The **main gap** is the lack of a unified Engagements API for logging typed activities (calls, emails, meetings). The workaround of using Notes with structured prefixes is functional but loses the typed engagement model HubSpot provides.

**Recommendation**: Build the Attio integration with the same architecture as spec 14, using:
- `/attio connect|disconnect|status|import|activity|help` slash command
- Same data model (renamed)
- Same BullMQ queue pattern
- Notes-based activity logging with `[Call]`, `[Email]`, `[Meeting]` prefixes

This gives clients who use Attio the same workflow they'd get with HubSpot.

---

## Sources

- [Attio OAuth Tutorial](https://docs.attio.com/rest-api/tutorials/connect-an-app-through-oauth)
- [Attio REST API Overview](https://docs.attio.com/rest-api/overview)
- [Attio Developer Platform](https://attio.com/platform/developers)
- [Attio OpenAPI Spec](https://api.attio.com/openapi/api)
