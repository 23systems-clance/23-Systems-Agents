# Research: Platform V2 - Workflow Builder Node Extensions

**Feature Branch**: `9-platform-v2`
**Date**: 2026-03-10

---

## RD-001: Webhook Validation Approach (HMAC-SHA256)

### Decision
Use HMAC-SHA256 signature verification for incoming webhook requests, matching the existing Apollo/Instantly/HeyReach webhook secret pattern already established in `src/routes/webhooks/`.

### Rationale
- HMAC-SHA256 is the industry standard for webhook authentication (used by GitHub, Stripe, Slack, HubSpot).
- The project already processes incoming webhooks from Apollo (`src/routes/webhooks/apollo.ts`), Instantly (`src/routes/webhooks/instantly.ts`), and HeyReach (`src/routes/webhooks/heyreach.ts`), so the pattern is familiar.
- Each published webhook-triggered workflow gets a unique token (for URL routing) and a unique HMAC secret (for payload validation).
- Signature is computed as `HMAC-SHA256(webhookSecret, rawRequestBody)` and sent in the `X-Webhook-Signature` header.
- The system compares the computed signature against the provided signature using `crypto.timingSafeEqual` to prevent timing attacks.

### Alternatives Considered
- **API key in header**: Simpler but does not verify payload integrity. Rejected because HMAC ensures the body was not tampered with in transit.
- **mTLS**: Too complex for external integrators who just need to POST JSON. Rejected for complexity.
- **OAuth bearer tokens**: Overkill for webhook-style push notifications. Rejected.

### Implementation Notes
- Webhook URL format: `POST /api/webhooks/workflow/:token`
- New Express route: `src/routes/webhooks/workflow.ts`
- The raw body must be preserved before JSON parsing for HMAC computation. Use `express.raw()` middleware on the webhook route.
- Log all webhook attempts (valid and invalid) to `WebhookLog` for auditability.
- Rate limit: 60 requests/minute per webhook endpoint to prevent abuse.

---

## RD-002: HubSpot Bulk Import/Export vs Individual API Calls

### Decision
Use a hybrid approach:
- **Import (read from HubSpot)**: Use the existing CRM v3 Lists API + Batch Read pattern already implemented in `src/services/hubspot/hubspotClient.ts` (getListMemberIds + getContactsByIds with batches of 100). For very large lists (10,000+), evaluate the HubSpot CRM Export API in a future iteration.
- **Sync (write to HubSpot)**: Use the CRM v3 Batch Create/Update APIs for contacts and companies. Batch size of 100 per request (HubSpot limit). For initial release, use the batch APIs directly. If lists exceed 10,000 records, implement the HubSpot Imports API (CSV-based bulk import) as a fallback.

### Rationale
- The existing `hubspotClient.ts` already implements batch read with pagination and circuit breaker. Extending it for batch write follows the same pattern.
- HubSpot Bulk Import API (Imports v3) accepts CSV files and is truly bulk, but it is asynchronous (requires polling for completion) and does not return per-record results. This makes identity resolution harder because we need to know which records were created vs updated.
- The CRM v3 Batch Create/Update endpoints return synchronous per-record results, enabling accurate sync reports (created/updated/failed counts).
- For the P1 release, batch APIs (100 per request) are sufficient for target list sizes (up to 5,000 contacts). The async bulk import can be a P2 optimization.

### HubSpot API Endpoints Used
| Operation | Endpoint | Batch Size |
|-----------|----------|------------|
| Search contacts by email | `POST /crm/v3/objects/contacts/search` | 100 |
| Search companies by domain | `POST /crm/v3/objects/companies/search` | 100 |
| Batch create contacts | `POST /crm/v3/objects/contacts/batch/create` | 100 |
| Batch update contacts | `POST /crm/v3/objects/contacts/batch/update` | 100 |
| Batch create companies | `POST /crm/v3/objects/companies/batch/create` | 100 |
| Batch update companies | `POST /crm/v3/objects/companies/batch/update` | 100 |
| Get list members | `GET /crm/v3/lists/:listId/memberships/join-order` | cursor-paginated |
| Batch read contacts | `POST /crm/v3/objects/contacts/batch/read` | 100 |

### Rate Limiting Strategy
- HubSpot private app rate limits: 100 requests per 10 seconds.
- Implement a token bucket rate limiter in the HubSpot client (10 requests/second sustained).
- On 429 responses, respect `Retry-After` header (already implemented in `hubspotClient.ts`).

---

## RD-003: Fuzzy Company Matching Algorithm

### Decision
Use a two-stage matching approach for identity resolution:
1. **Exact match on normalized domain** (primary): Strip protocol, www, trailing slashes, subdomains, and compare.
2. **Fuzzy match on normalized company name** (secondary): Use Jaro-Winkler string similarity with a configurable threshold (default 85%).

### Rationale
- Domain matching is the most reliable signal. If two records share the same normalized domain, they are almost certainly the same company.
- Company name matching is needed as a fallback for records without domains, or where domain variants exist.
- Jaro-Winkler was chosen over Levenshtein because it gives higher scores to strings that share a common prefix, which is the most common pattern for company name variants ("Acme Inc" vs "Acme, Inc." vs "Acme Incorporated").
- The `string-similarity` npm package provides a Dice coefficient implementation. However, Jaro-Winkler is more appropriate for names. Use the `jaro-winkler` npm package (lightweight, zero dependencies).

### Name Normalization Pipeline
Before fuzzy comparison, normalize company names:
1. Convert to lowercase.
2. Remove legal suffixes: `inc`, `inc.`, `llc`, `ltd`, `corp`, `corporation`, `co`, `company`, `group`, `holdings`, `international`, `intl`.
3. Remove punctuation (commas, periods, dashes).
4. Collapse whitespace.
5. Trim.

Example: `"Acme, Inc."` -> `"acme"`, `"ACME Inc"` -> `"acme"`, `"Acme Incorporated"` -> `"acme"`

### Domain Normalization Pipeline
Reuse the existing pattern from the enrichment pipeline:
1. Remove protocol (`http://`, `https://`).
2. Remove `www.` prefix.
3. Remove trailing slashes.
4. Remove common subdomains (`blog.`, `app.`, `mail.`, `support.`).
5. Extract root domain + TLD only.
6. Lowercase.

Example: `"https://www.acme.com/"` -> `"acme.com"`, `"blog.acme.com"` -> `"acme.com"`

### Match Resolution Priority
1. Email exact match (highest confidence).
2. Normalized domain exact match.
3. Fuzzy company name match above threshold (85% default).
4. No match -> create new record.

When multiple fuzzy matches exist with equal scores, pick the most recently updated HubSpot record and flag for manual review.

---

## RD-004: API Call Node Response Schema Discovery

### Decision
Implement dynamic response schema discovery using JSON path introspection after a test execution. The system recursively traverses the JSON response, extracting all leaf-level paths, and presents them as mappable output fields.

### Rationale
- External APIs return diverse response structures. Pre-defining schemas is impractical.
- After a test execution, the actual response body is available. Recursively walking the JSON object and extracting all paths (e.g., `data.contacts[0].email`, `metadata.total`) provides a complete field map.
- Array items are collapsed to `[0]` for the path but flagged as array fields so the engine knows to iterate.
- The discovered schema is stored in the node's config (`responseSchema` field) and used for downstream variable interpolation.

### Implementation Approach
1. User configures the API_CALL node with URL, method, headers, body.
2. User clicks "Test Request" in the NodeConfigPanel.
3. Backend makes the actual HTTP request via a dedicated test endpoint (`POST /api/admin/workflows/test-api-call`).
4. Response body is returned to the frontend.
5. Frontend recursively traverses the JSON, building a path list with types.
6. User selects which paths to expose as output variables.
7. Selected paths are saved in the node's `responseMapping` config.

### Schema Discovery Algorithm
```
function discoverPaths(obj, prefix = '') -> Array<{path, type, isArray}>:
  for each key in obj:
    fullPath = prefix ? `${prefix}.${key}` : key
    if value is array:
      yield { path: `${fullPath}[]`, type: typeof value[0], isArray: true }
      if value[0] is object:
        yield* discoverPaths(value[0], `${fullPath}[]`)
    else if value is object:
      yield* discoverPaths(value, fullPath)
    else:
      yield { path: fullPath, type: typeof value, isArray: false }
```

### Variable Interpolation
- API_CALL node URLs and body templates support `{{variable_name}}` interpolation.
- Variables come from the execution context (outputs of upstream nodes).
- The interpolation engine is shared with the existing MESSAGE node text interpolation.

---

## RD-005: Parser Node Expression Engine

### Decision
Use a simple, safe expression syntax for field transformations -- not arbitrary JavaScript execution. The parser node supports a predefined set of transform functions that can be composed.

### Rationale
- Arbitrary code execution (eval, new Function) is a security risk and debugging nightmare.
- A predefined function set covers 95%+ of BDR data transformation needs.
- The same functions are useful across PARSER node and other nodes (e.g., HubSpot field mapping).

### Supported Transform Functions

| Function | Syntax | Description |
|----------|--------|-------------|
| `properCase` | `properCase(field)` | Capitalize first letter of each word |
| `uppercase` | `uppercase(field)` | Convert to uppercase |
| `lowercase` | `lowercase(field)` | Convert to lowercase |
| `trim` | `trim(field)` | Remove leading/trailing whitespace |
| `normalizeDomain` | `normalizeDomain(field)` | Apply domain normalization pipeline |
| `normalizePhone` | `normalizePhone(field)` | Format phone to E.164 |
| `split` | `split(field, delimiter)` | Split string into array |
| `join` | `join(field, delimiter)` | Join array into string |
| `replace` | `replace(field, search, replacement)` | String replacement |
| `extract` | `extract(field, regex)` | Extract first regex match |
| `default` | `default(field, fallbackValue)` | Use fallback if field is empty |
| `concat` | `concat(field1, separator, field2)` | Concatenate two fields |
| `template` | `template("Hello {{first_name}}")` | String template with variable interpolation |

### Filter Criteria Syntax
Filters use a declarative JSON structure matching the existing `EdgeCondition` pattern:
```json
{
  "field": "email",
  "operator": "is_not_empty"
}
```

Supported operators (reuse from `EdgeCondition`): `equals`, `not_equals`, `contains`, `greater_than`, `less_than`, `is_empty`, `is_not_empty`, `regex`.

Additional operators for the PARSER node:
- `in`: Value is in a list of values.
- `not_in`: Value is not in a list of values.
- `starts_with`: String starts with prefix.
- `ends_with`: String ends with suffix.

### Parsing Modes
- **JSON**: Parse raw JSON string/object from upstream context. Optionally specify a root path (e.g., `data.contacts`) to extract a nested array.
- **CSV**: Parse CSV string using `csv-parse` (already a project dependency). Configurable delimiter, quote character, and header row detection.

---

## RD-006: Execution Progress Tracking Architecture

### Decision
Extend the existing `WorkflowExecution.context` JSONB field with a `_nodeProgress` key containing per-node progress objects. Push real-time updates via Server-Sent Events (SSE) to the admin dashboard and periodic Slack thread messages for Slack-triggered workflows.

### Rationale
- The spec states "Progress tracking uses the existing execution context JSONB field, not a separate table." This keeps the data model simple and avoids additional DB writes for progress updates.
- SSE is simpler than WebSockets for unidirectional push, and the admin dashboard only needs to receive progress updates (not send them).
- Redis pub/sub is used as the event bus between the BullMQ worker (producing progress updates) and the Express SSE endpoint (consuming them for connected dashboard clients).

### Progress Data Structure
```typescript
interface NodeProgress {
  nodeId: string;
  nodeType: string;
  label?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  startedAt?: string;
  completedAt?: string;
  lastUpdatedAt: string;
  errorSample?: string[];   // First 5 error messages
}
```

### Update Flow
1. Batch-processing node (HUBSPOT, ENRICHMENT, API_CALL) updates `_nodeProgress` in the execution context after each batch.
2. Worker publishes update to Redis channel `workflow:progress:${executionId}`.
3. Admin dashboard SSE endpoint subscribes to the Redis channel and pushes events to connected clients.
4. For Slack-triggered workflows, a progress reporter checks elapsed time since last Slack update. If > 30 seconds, posts a thread update.

### Slack Progress Update Format
```
:hourglass_flowing_sand: *HubSpot Sync Progress*
230/500 contacts processed (46%)
- Created: 150 | Updated: 75 | Skipped: 3 | Failed: 2
```

### Dashboard SSE Endpoint
`GET /api/admin/workflows/executions/:executionId/progress` - Returns an SSE stream of `NodeProgress` events.
