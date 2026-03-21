# Tasks: Platform V2 - Workflow Builder Node Extensions

**Feature Branch**: `9-platform-v2`
**Date**: 2026-03-10
**Total Tasks**: 42

---

## Phase 0: Research & Preparation

### T-001: Finalize research decisions
- **Description**: Review and finalize all research decisions in `research.md`. Confirm HMAC-SHA256 approach, HubSpot API strategy, fuzzy matching algorithm, schema discovery approach, and expression engine design.
- **Dependencies**: None
- **Files**: `specs/9-platform-v2/research.md`
- **Acceptance Criteria**: Research document is complete with all 6 decision areas documented. All alternatives considered and rationale provided.

### T-002: Install new dependencies
- **Description**: Add `jaro-winkler` npm package for fuzzy string matching. Verify no version conflicts.
- **Dependencies**: T-001
- **Files**: `package.json`, `package-lock.json`
- **Acceptance Criteria**: `npm install jaro-winkler` succeeds. Package appears in `dependencies`. TypeScript types resolve correctly (or add `@types/jaro-winkler` if needed).

---

## Phase 1: Webhook Trigger + Infrastructure

### T-003: Prisma schema migration - enums and tables
- **Description**: Add `WEBHOOK` to `WorkflowTriggerType` enum. Add `HUBSPOT`, `PARSER`, `API_CALL` to `WorkflowNodeType` enum. Add `WebhookEndpointStatus` enum. Create `WebhookEndpoint` and `WebhookLog` models. Add `nodeProgress` (JSONB) and `webhookToken` (String) columns to `WorkflowExecution`. Add relations from `WorkflowTemplate` and `WorkflowVersion` to `WebhookEndpoint`, and from `WorkflowExecution` to `WebhookLog`.
- **Dependencies**: T-001
- **Files**:
  - Modify: `prisma/schema.prisma`
- **Acceptance Criteria**: `npx prisma migrate dev` succeeds. `npx prisma generate` produces updated client with new types. All new tables, enums, and columns exist in the database.

### T-004: HMAC validation service
- **Description**: Create utility module for HMAC-SHA256 webhook validation. Functions: `generateHmacSecret()` (crypto.randomBytes), `computeSignature(secret, payload)`, `validateSignature(secret, payload, providedSignature)` using `crypto.timingSafeEqual`. Include proper docstrings and type annotations.
- **Dependencies**: T-003
- **Files**:
  - Create: `src/services/webhook/hmacValidator.ts`
- **Acceptance Criteria**: `generateHmacSecret()` returns a 32-byte hex string. `computeSignature()` produces a valid HMAC-SHA256 hash. `validateSignature()` returns true for matching signatures and false for mismatches. Timing-safe comparison is used.

### T-005: Webhook endpoint management service
- **Description**: Create service for managing webhook endpoints. Functions: `createEndpoint(templateId, versionId, description?)` (generates token + HMAC secret, creates DB record), `deactivateEndpoint(templateId)`, `getEndpointByToken(token)`, `rotateSecret(endpointId)`. Include rate limit tracking (increment `totalCalls`, update `lastCalledAt`).
- **Dependencies**: T-003, T-004
- **Files**:
  - Create: `src/services/webhook/webhookEndpointService.ts`
- **Acceptance Criteria**: `createEndpoint()` persists a new `WebhookEndpoint` with unique token and HMAC secret. `deactivateEndpoint()` sets status to INACTIVE. `getEndpointByToken()` returns the endpoint or null. Rate limit fields are updated on each call.

### T-006: Webhook HTTP route
- **Description**: Create Express route `POST /api/webhooks/workflow/:token`. Use `express.raw({ type: 'application/json' })` middleware to preserve raw body for HMAC computation. Validate HMAC signature from `X-Webhook-Signature` header. On valid: start workflow execution, log to `WebhookLog` with `validated: true`, return 200 with execution ID. On invalid: log to `WebhookLog` with `validated: false`, return 401. Include rate limiting check (60 req/min per endpoint).
- **Dependencies**: T-004, T-005
- **Files**:
  - Create: `src/routes/webhooks/workflow.ts`
- **Acceptance Criteria**: Valid HMAC signature -> 200 response with execution ID. Invalid signature -> 401 response. Missing signature -> 401 response. All requests logged to `WebhookLog` with source IP, validation result, payload hash. Rate-limited requests return 429.

### T-007: Extend workflow types with webhook trigger
- **Description**: Add `'webhook'` to the `TriggerNodeConfig.triggerType` union type. Add `webhookUrl` and `webhookToken` optional fields to `TriggerNodeConfig` for display purposes (populated after publish).
- **Dependencies**: T-003
- **Files**:
  - Modify: `src/services/workflow/types.ts`
- **Acceptance Criteria**: `TriggerNodeConfig.triggerType` accepts `'webhook'`. New fields are optional and typed correctly. `NodeConfig` union still compiles.

### T-008: Extend workflow engine for webhook triggers
- **Description**: Modify `startExecution()` to support webhook-triggered workflows. Webhook triggers may not have Slack context (channelId, userId) -- make these optional for webhook executions. Add `webhookToken` to execution record when triggered via webhook. Ensure the `advanceFromNode` TRIGGER case works for webhook triggers.
- **Dependencies**: T-006, T-007
- **Files**:
  - Modify: `src/services/workflow/workflowEngine.ts`
- **Acceptance Criteria**: Webhook-triggered executions are created without requiring Slack context. The execution record includes `webhookToken`. The workflow engine advances correctly from webhook trigger nodes.

### T-009: Extend workflow service for webhook endpoint lifecycle
- **Description**: Modify the publish workflow function to create a `WebhookEndpoint` when the trigger type is WEBHOOK. Modify the archive function to deactivate the associated webhook endpoint. Return the webhook URL and HMAC secret in the publish response.
- **Dependencies**: T-005
- **Files**:
  - Modify: `src/services/workflow/workflowService.ts`
- **Acceptance Criteria**: Publishing a webhook-triggered workflow creates a `WebhookEndpoint`. Archiving deactivates it. The publish response includes the full webhook URL and HMAC secret.

### T-010: Extend workflow validator for webhook triggers
- **Description**: Add validation for webhook trigger nodes in `validateNodeConfigs()`. Webhook triggers require `triggerType: 'webhook'` and no other config (URL/secret are generated on publish, not configured manually).
- **Dependencies**: T-007
- **Files**:
  - Modify: `src/services/workflow/workflowValidator.ts`
- **Acceptance Criteria**: Webhook trigger nodes pass validation with `triggerType: 'webhook'`. Missing trigger type still fails validation. All existing validation rules remain intact.

### T-011: Register webhook route in server
- **Description**: Import and mount the webhook workflow route in the Express server at `/api/webhooks/workflow`.
- **Dependencies**: T-006
- **Files**:
  - Modify: `src/server.ts`
- **Acceptance Criteria**: `POST /api/webhooks/workflow/:token` is accessible. Route is registered before the catch-all 404 handler.

### T-012: Frontend - Trigger node webhook option
- **Description**: Update the TRIGGER node config in `NodeConfigPanel.tsx` to show "Webhook" as a trigger type option. When selected, display a read-only section showing the webhook URL and HMAC secret (populated after publish). Before publish, show a placeholder: "Webhook URL will be generated on publish."
- **Dependencies**: T-007
- **Files**:
  - Modify: `admin-dashboard/src/components/workflow/NodeConfigPanel.tsx`
- **Acceptance Criteria**: "Webhook" appears in the trigger type dropdown. Before publish: placeholder text shown. After publish: webhook URL and secret are displayed with copy buttons.

### T-013: Frontend - Trigger node webhook visual
- **Description**: Update `TriggerNode.tsx` to show a webhook-specific icon (e.g., globe/link icon) when trigger type is `'webhook'`. Update the node's subtitle to show "Webhook" instead of other trigger type labels.
- **Dependencies**: T-012
- **Files**:
  - Modify: `admin-dashboard/src/components/workflow/nodes/TriggerNode.tsx`
- **Acceptance Criteria**: Webhook trigger nodes display a distinct icon. Node subtitle reads "Webhook". Visual is consistent with existing trigger type variants.

---

## Phase 2: HubSpot Node (Import + Sync)

### T-014: Add HubSpotNodeConfig type
- **Description**: Add `HubSpotNodeConfig` interface to workflow types. Include `mode` ('import' | 'sync'), import-specific fields (listId, importProperties), sync-specific fields (syncMatchFields, fuzzyThreshold, createNewRecords, updateExisting, fieldMapping), and common fields (clientId, outputVariable).
- **Dependencies**: T-003
- **Files**:
  - Modify: `src/services/workflow/types.ts`
- **Acceptance Criteria**: `HubSpotNodeConfig` is fully typed. Added to `NodeConfig` union. TypeScript compiles.

### T-015: Domain normalization utility
- **Description**: Create a shared domain normalization function. Steps: remove protocol, remove www prefix, remove trailing slashes, remove common subdomains (blog, app, mail, support), extract root domain + TLD, lowercase. Include docstrings and unit-test-friendly pure function design.
- **Dependencies**: None
- **Files**:
  - Create: `src/services/hubspot/domainNormalizer.ts`
- **Acceptance Criteria**: `"https://www.acme.com/"` -> `"acme.com"`. `"blog.acme.com"` -> `"acme.com"`. `"HTTP://WWW.ACME.COM/page"` -> `"acme.com"`. Empty/null inputs return empty string.

### T-016: Name normalization utility
- **Description**: Create company name normalization function. Steps: lowercase, remove legal suffixes (inc, llc, ltd, corp, corporation, co, company, group, holdings, international, intl), remove punctuation, collapse whitespace, trim. Also create a `properCase()` utility for contact names.
- **Dependencies**: None
- **Files**:
  - Create: `src/services/hubspot/nameNormalizer.ts`
- **Acceptance Criteria**: `"Acme, Inc."` -> `"acme"`. `"ACME Inc"` -> `"acme"`. `"Acme Incorporated"` -> `"acme"`. `properCase("JANE DOE")` -> `"Jane Doe"`. Empty/null inputs handled gracefully.

### T-017: Fuzzy company matching service
- **Description**: Create fuzzy matching service using `jaro-winkler` package. Function `fuzzyMatch(candidateName, targetNames, threshold)` returns the best match above the threshold. Include the name normalization pipeline as a preprocessing step.
- **Dependencies**: T-002, T-016
- **Files**:
  - Create: `src/services/hubspot/fuzzyMatcher.ts`
- **Acceptance Criteria**: `fuzzyMatch("Acme Inc", ["Acme, Inc.", "Beta Corp"], 0.85)` returns `"Acme, Inc."` with score >= 0.85. Names below threshold return null. Empty candidate lists return null.

### T-018: Identity resolution service
- **Description**: Create identity resolution orchestrator. For each incoming contact: (1) exact email match against HubSpot contacts, (2) normalized domain match against HubSpot companies, (3) fuzzy company name match if no domain match. Return match result with confidence level and matched HubSpot record ID. Flag potential false matches for manual review.
- **Dependencies**: T-015, T-016, T-017
- **Files**:
  - Create: `src/services/hubspot/identityResolver.ts`
- **Acceptance Criteria**: Email matches return highest confidence. Domain matches return medium confidence. Fuzzy matches return low confidence with review flag. No match returns null. Multiple equally-likely fuzzy matches pick most recently updated record and flag for review.

### T-019: Extend HubSpot client with write operations
- **Description**: Add methods to `hubspotClient.ts`: `searchContactsByEmail(emails)`, `searchCompaniesByDomain(domains)`, `batchCreateContacts(contacts)`, `batchUpdateContacts(contacts)`, `batchCreateCompanies(companies)`, `batchUpdateCompanies(companies)`. All batch operations use 100-item batches per HubSpot limit. All use existing circuit breaker and retry logic.
- **Dependencies**: T-003
- **Files**:
  - Modify: `src/services/hubspot/hubspotClient.ts`
  - Modify: `src/services/hubspot/types.ts`
- **Acceptance Criteria**: All new methods are typed and documented. Batch operations respect 100-item limit. 429 rate limiting handled with existing retry logic. Circuit breaker wraps all calls.

### T-020: HubSpot sync service
- **Description**: Create orchestrator for HubSpot sync operations. Takes an array of contacts from workflow context, runs identity resolution on each, batches them into create/update groups, executes batch operations, and produces a sync report (created, updated, skipped, failed counts). Supports multi-tenant mode via `clientId` for per-client HubSpot credentials.
- **Dependencies**: T-018, T-019
- **Files**:
  - Create: `src/services/hubspot/hubspotSyncService.ts`
- **Acceptance Criteria**: Correctly separates contacts into create vs update groups based on identity resolution. Batch operations execute within HubSpot rate limits. Sync report accurately reflects operation results. Errors per-contact do not fail the entire batch.

### T-021: HubSpot node executor
- **Description**: Create the workflow engine executor for HUBSPOT nodes. Import mode: call `getContactsFromList()`, set results to context variable. Sync mode: call `hubspotSyncService.sync()`, set report to context. Both modes emit progress events (for Phase 6 integration). Handle errors gracefully with per-contact error capture.
- **Dependencies**: T-020
- **Files**:
  - Create: `src/services/workflow/nodes/hubspotNodeExecutor.ts`
- **Acceptance Criteria**: Import mode fetches contacts and stores in execution context. Sync mode performs identity resolution and batch upsert. Errors are captured per-contact, not as fatal failures. Progress tracking hooks are present (may be no-op until Phase 6).

### T-022: Extend workflow engine with HUBSPOT case
- **Description**: Add `case 'HUBSPOT'` to the `advanceFromNode` switch statement in `workflowEngine.ts`. Call the hubspotNodeExecutor, auto-advance to next node on completion. For large batches, queue to BullMQ and pause execution (similar to ENRICHMENT pattern).
- **Dependencies**: T-021
- **Files**:
  - Modify: `src/services/workflow/workflowEngine.ts`
- **Acceptance Criteria**: HUBSPOT nodes are processed by the engine. Small imports (< 100 contacts) execute inline. Large operations are queued via BullMQ. Execution advances to the next node after completion.

### T-023: HubSpot BullMQ worker
- **Description**: Create async worker for large HubSpot import/sync operations. Processes batches, updates execution context with results, and resumes workflow execution upon completion. Follows the pattern in `src/services/queue/workers/workflowWorker.ts`.
- **Dependencies**: T-022
- **Files**:
  - Create: `src/services/queue/workers/hubspotWorker.ts`
  - Modify: `src/services/queue/queues.ts` (add hubspot queue)
- **Acceptance Criteria**: Worker processes HubSpot jobs from the queue. Updates execution context with import/sync results. Resumes workflow execution after completion. Handles failures gracefully with error logging.

### T-024: Extend workflow validator for HUBSPOT nodes
- **Description**: Add HUBSPOT validation rules to `validateNodeConfigs()`. Import mode requires `listId`. Sync mode requires at least one `syncMatchField` and at least one `fieldMapping` entry. `fuzzyThreshold` must be between 0 and 100 if provided.
- **Dependencies**: T-014
- **Files**:
  - Modify: `src/services/workflow/workflowValidator.ts`
- **Acceptance Criteria**: Import mode without `listId` -> validation error. Sync mode without `syncMatchFields` -> validation error. Invalid `fuzzyThreshold` -> validation error. Valid configs pass.

### T-025: Frontend - HubSpot node palette entry
- **Description**: Add HUBSPOT to the NodePalette with a HubSpot icon (orange hub icon or CRM icon). Include description text: "Import or sync contacts with HubSpot CRM."
- **Dependencies**: T-003
- **Files**:
  - Modify: `admin-dashboard/src/components/workflow/NodePalette.tsx`
- **Acceptance Criteria**: HUBSPOT node appears in the palette. Drag-and-drop to canvas creates a HUBSPOT node. Icon and description are present.

### T-026: Frontend - HubSpot node component
- **Description**: Create `HubSpotNode.tsx` React Flow custom node. Display mode indicator ("Import" or "Sync") and HubSpot branding. Show list ID for import mode, field mapping count for sync mode.
- **Dependencies**: T-025
- **Files**:
  - Create: `admin-dashboard/src/components/workflow/nodes/HubSpotNode.tsx`
  - Modify: `admin-dashboard/src/components/workflow/nodes/index.ts`
- **Acceptance Criteria**: Node renders correctly on canvas. Mode indicator updates when config changes. Visual is consistent with other node components.

### T-027: Frontend - HubSpot node config panel
- **Description**: Add HUBSPOT config section to `NodeConfigPanel.tsx`. Include: mode dropdown (Import/Sync), list ID input (import mode), field mapping table builder (sync mode), fuzzy threshold slider with value display (sync mode), client selector dropdown (for multi-tenant), sync match fields checkboxes (email, domain, company_name).
- **Dependencies**: T-026
- **Files**:
  - Modify: `admin-dashboard/src/components/workflow/NodeConfigPanel.tsx`
- **Acceptance Criteria**: Mode dropdown toggles between import and sync config sections. Field mapping table allows add/remove/edit of mappings. Fuzzy threshold slider range 0-100 with default 85. All config changes persist to node data.

---

## Phase 3: Parser Node

### T-028: Add ParserNodeConfig type
- **Description**: Add `ParserNodeConfig` interface to workflow types. Include `parseMode` ('json' | 'csv'), JSON-specific fields (jsonRootPath), CSV-specific fields (csvDelimiter, csvHasHeaders), field mappings array, transformations array, filters array with extended operators, and input/output variable names.
- **Dependencies**: T-003
- **Files**:
  - Modify: `src/services/workflow/types.ts`
- **Acceptance Criteria**: `ParserNodeConfig` is fully typed. Added to `NodeConfig` union. TypeScript compiles.

### T-029: Transform engine
- **Description**: Create the predefined transform function library. Implement: `properCase`, `uppercase`, `lowercase`, `trim`, `normalizeDomain`, `normalizePhone`, `split`, `join`, `replace`, `extract` (regex), `default` (fallback), `concat`, `template`. Each function takes a value and optional args, returns transformed value. Include a `applyTransform(functionName, value, args)` dispatcher.
- **Dependencies**: T-015, T-016
- **Files**:
  - Create: `src/services/workflow/nodes/transformEngine.ts`
- **Acceptance Criteria**: All 13 transform functions work correctly. `applyTransform` dispatches to the correct function. Unknown function names throw a descriptive error. `normalizeDomain` reuses the utility from T-015. `properCase` reuses from T-016.

### T-030: Filter engine
- **Description**: Create filter criteria evaluator. Evaluate an array of filter rules against data rows. Support all existing `EdgeCondition` operators plus: `in`, `not_in`, `starts_with`, `ends_with`. Support AND/OR logic between filters (default AND). Return filtered row array.
- **Dependencies**: None
- **Files**:
  - Create: `src/services/workflow/nodes/filterEngine.ts`
- **Acceptance Criteria**: All operators evaluate correctly. AND logic: all filters must pass. OR logic: any filter passes. Mixed AND/OR respects grouping. Empty filter array passes all rows. Empty data returns empty array.

### T-031: Parser node executor
- **Description**: Create the workflow engine executor for PARSER nodes. Steps: (1) Get raw data from input variable in execution context, (2) Parse as JSON or CSV based on parseMode, (3) Apply JSON root path extraction if specified, (4) Apply field mappings (rename/combine/split), (5) Apply transformations per configured rules, (6) Apply filters to exclude non-matching rows, (7) Set filtered/transformed data to output variable in context. Handle errors gracefully: log warnings for individual row failures without failing the entire operation.
- **Dependencies**: T-029, T-030
- **Files**:
  - Create: `src/services/workflow/nodes/parserNodeExecutor.ts`
- **Acceptance Criteria**: JSON parsing with root path extraction works. CSV parsing with header detection works. Field mappings correctly rename/combine/split. Transforms apply correctly. Filters exclude matching rows. Output is set in context. Zero-match filters produce a warning, not a failure.

### T-032: Extend workflow engine with PARSER case
- **Description**: Add `case 'PARSER'` to the `advanceFromNode` switch statement. Call the parserNodeExecutor, auto-advance to next node. Parser nodes are always synchronous (no BullMQ queue needed).
- **Dependencies**: T-031
- **Files**:
  - Modify: `src/services/workflow/workflowEngine.ts`
- **Acceptance Criteria**: PARSER nodes execute inline during workflow advancement. Context is updated with parsed/transformed data. Execution advances to the next node.

### T-033: Extend workflow validator for PARSER nodes
- **Description**: Add PARSER validation rules. Require `parseMode`. If CSV mode, warn if `csvDelimiter` is not set (default to comma). Require at least one of: fieldMappings, transformations, or filters (otherwise the node is a no-op). Validate transform function names against the known function list.
- **Dependencies**: T-028
- **Files**:
  - Modify: `src/services/workflow/workflowValidator.ts`
- **Acceptance Criteria**: Missing `parseMode` -> error. No mappings/transforms/filters -> warning. Unknown transform function -> error. Valid configs pass.

### T-034: Frontend - Parser node (palette + component + config)
- **Description**: Add PARSER to NodePalette with transform/filter icon. Create `ParserNode.tsx` showing parse mode and filter count. Add PARSER config section to `NodeConfigPanel.tsx` with: parse mode selector, JSON root path input, CSV delimiter input, field mapping table, transformation rule builder (field + function dropdown + args), filter criteria builder (field + operator dropdown + value). Register in nodes index.
- **Dependencies**: T-028
- **Files**:
  - Modify: `admin-dashboard/src/components/workflow/NodePalette.tsx`
  - Create: `admin-dashboard/src/components/workflow/nodes/ParserNode.tsx`
  - Modify: `admin-dashboard/src/components/workflow/nodes/index.ts`
  - Modify: `admin-dashboard/src/components/workflow/NodeConfigPanel.tsx`
- **Acceptance Criteria**: PARSER node appears in palette. Drag-and-drop works. Config panel shows correct sections per parse mode. All config fields persist correctly.

---

## Phase 4: API Call Node

### T-035: Add ApiCallNodeConfig type
- **Description**: Add `ApiCallNodeConfig` interface to workflow types. Include `method`, `url` (with interpolation), `headers`, `bodyTemplate`, `authType`/`authConfig`, `responseMapping`, `responseSchema`, retry config (`maxRetries`, `retryDelayMs`, `timeoutMs`), and `outputVariable`.
- **Dependencies**: T-003
- **Files**:
  - Modify: `src/services/workflow/types.ts`
- **Acceptance Criteria**: `ApiCallNodeConfig` is fully typed. Added to `NodeConfig` union. TypeScript compiles.

### T-036: Variable interpolation engine
- **Description**: Create `{{variable}}` interpolation engine. Replace placeholders in strings with values from execution context. Support nested paths (e.g., `{{contact.email}}`). Support array indexing (e.g., `{{contacts[0].name}}`). Handle missing variables gracefully (leave placeholder or use empty string, configurable).
- **Dependencies**: None
- **Files**:
  - Create: `src/services/workflow/nodes/variableInterpolator.ts`
- **Acceptance Criteria**: `"Hello {{name}}"` with context `{name: "Jane"}` -> `"Hello Jane"`. Nested paths work. Missing variables replaced with empty string by default. No regex injection vulnerabilities.

### T-037: Response schema discoverer
- **Description**: Create recursive JSON schema discovery. Given a JSON response object, extract all leaf paths with their types and array flags. Example: `{data: {contacts: [{email: "a@b.com"}]}}` -> `[{path: "data.contacts[].email", type: "string", isArray: true}]`. Limit depth to 10 levels to prevent infinite recursion.
- **Dependencies**: None
- **Files**:
  - Create: `src/services/workflow/nodes/schemaDiscoverer.ts`
- **Acceptance Criteria**: Flat objects produce simple paths. Nested objects produce dot-separated paths. Arrays produce `[]` markers. Depth limit prevents stack overflow. Sample values are captured for display.

### T-038: API Call node executor
- **Description**: Create the workflow engine executor for API_CALL nodes. Steps: (1) Interpolate variables in URL, headers, body, (2) Make HTTP request with timeout, (3) On failure: retry up to `maxRetries` with exponential backoff, (4) On success: extract fields per responseMapping and set in context, (5) Set raw response to output variable. Use `fetch` API (already available in Node.js 18+). Wrap in circuit breaker for external URL protection.
- **Dependencies**: T-036
- **Files**:
  - Create: `src/services/workflow/nodes/apiCallNodeExecutor.ts`
- **Acceptance Criteria**: HTTP requests execute correctly with interpolated values. Retry logic works with exponential backoff. Response mapping extracts fields to context. Timeout is enforced. Errors are captured without crashing the workflow.

### T-039: Test API Call admin route
- **Description**: Add `POST /api/admin/workflows/test-api-call` endpoint. Accepts the API_CALL node config and mock context, makes the actual HTTP request, returns the response body and discovered schema. Used by the frontend config panel's "Test Request" button.
- **Dependencies**: T-037, T-038
- **Files**:
  - Modify: `src/routes/admin/workflows.ts`
- **Acceptance Criteria**: Endpoint makes the configured HTTP request. Returns response body, status code, headers, and discovered schema. Errors return a descriptive error message, not a 500.

### T-040: Extend workflow engine with API_CALL case
- **Description**: Add `case 'API_CALL'` to the `advanceFromNode` switch statement. Call the apiCallNodeExecutor. For single requests: execute inline. For batch operations (when input is an array): queue to BullMQ and pause.
- **Dependencies**: T-038
- **Files**:
  - Modify: `src/services/workflow/workflowEngine.ts`
- **Acceptance Criteria**: API_CALL nodes execute inline for single requests. Context is updated with response data. Execution advances to next node.

### T-041: Extend workflow validator for API_CALL nodes
- **Description**: Add API_CALL validation rules. Require `method` and `url`. URL must be a valid URL pattern (allow `{{variable}}` placeholders). If auth type is set, require corresponding auth config fields. Warn if `maxRetries` > 5.
- **Dependencies**: T-035
- **Files**:
  - Modify: `src/services/workflow/workflowValidator.ts`
- **Acceptance Criteria**: Missing method/URL -> error. Invalid URL pattern -> error. Auth type without config -> error. Valid configs pass. Excessive retries produce a warning.

### T-042: Frontend - API Call node (palette + component + config)
- **Description**: Add API_CALL to NodePalette with HTTP/globe icon. Create `ApiCallNode.tsx` showing method badge (GET/POST/PUT/DELETE) and URL preview. Add API_CALL config section to `NodeConfigPanel.tsx` with: method selector, URL input with variable autocomplete hints, headers key-value editor (add/remove rows), body template editor (textarea with variable hints), auth type selector + config fields, "Test Request" button that calls the test endpoint, response JSON viewer, schema browser with checkboxes for field selection, response mapping table. Register in nodes index.
- **Dependencies**: T-035
- **Files**:
  - Modify: `admin-dashboard/src/components/workflow/NodePalette.tsx`
  - Create: `admin-dashboard/src/components/workflow/nodes/ApiCallNode.tsx`
  - Modify: `admin-dashboard/src/components/workflow/nodes/index.ts`
  - Modify: `admin-dashboard/src/components/workflow/NodeConfigPanel.tsx`
- **Acceptance Criteria**: API_CALL node appears in palette. Method badge shows correct color per method. Config panel has all required fields. Test button triggers API call and shows response. Schema discovery populates field list after test. All config persists correctly.

---

## Phase 5: Enhanced Action Blocks

### T-043: Assign to Campaign action executor
- **Description**: Create executor for ASSIGN_TO_CAMPAIGN action type. Takes campaign ID from action params and contacts from execution context. Creates `CampaignContact` records for each contact. Uses the existing campaign service patterns. Validates campaign exists and is in DRAFT or ACTIVE status.
- **Dependencies**: T-022
- **Files**:
  - Create: `src/services/workflow/nodes/actionExecutors/assignToCampaign.ts`
- **Acceptance Criteria**: Contacts from workflow context are assigned to the specified campaign. `CampaignContact` records are created with correct field mappings. Invalid campaign ID returns an error. Duplicate assignments are skipped.

### T-044: Get Email action executor
- **Description**: Create executor for GET_EMAIL action type. For contacts in the workflow context that lack an email, trigger an email lookup via the existing enrichment pipeline (Apollo contact search). Queue enrichment jobs using existing BullMQ patterns. Store pending lookup references in context.
- **Dependencies**: T-022
- **Files**:
  - Create: `src/services/workflow/nodes/actionExecutors/getEmail.ts`
- **Acceptance Criteria**: Contacts without emails have enrichment jobs queued. Contacts with emails are skipped. Pending action references are stored in context for the Slack listener to process. Follows existing enrichment pipeline patterns.

### T-045: Get Phone action executor
- **Description**: Create executor for GET_PHONE action type. For contacts without phone numbers, initiate async phone lookup via the existing Apollo phone request pipeline. Create `PendingPhoneLookup` records. The phone data arrives asynchronously via the Apollo webhook (`src/routes/webhooks/apollo.ts`).
- **Dependencies**: T-022
- **Files**:
  - Create: `src/services/workflow/nodes/actionExecutors/getPhone.ts`
- **Acceptance Criteria**: Contacts without phones have phone lookup requests initiated. `PendingPhoneLookup` records are created. Follows existing async phone lookup pattern. 24-hour timeout is set on lookups.

### T-046: Extend workflow engine for new action types
- **Description**: Modify the ACTION case in `advanceFromNode` to dispatch to the new action executors based on `actionType`. Route `ASSIGN_TO_CAMPAIGN` -> assignToCampaign executor, `GET_EMAIL` -> getEmail executor, `GET_PHONE` -> getPhone executor. Preserve existing action type handling.
- **Dependencies**: T-043, T-044, T-045
- **Files**:
  - Modify: `src/services/workflow/workflowEngine.ts`
- **Acceptance Criteria**: New action types dispatch to correct executors. Existing action types continue to work. Unknown action types fall through to existing generic handler. Pending actions are correctly appended to context.

### T-047: Extend workflow validator for new action types
- **Description**: Add validation for new action types. `ASSIGN_TO_CAMPAIGN` requires `params.campaignId`. `GET_EMAIL` and `GET_PHONE` have no required params (they operate on all contacts in context). Warn if GET_PHONE is used without a downstream DELAY node (phones arrive async).
- **Dependencies**: T-046
- **Files**:
  - Modify: `src/services/workflow/workflowValidator.ts`
- **Acceptance Criteria**: ASSIGN_TO_CAMPAIGN without campaignId -> error. GET_PHONE without downstream DELAY -> warning. Valid configs pass.

### T-048: Frontend - Enhanced action node config and visual
- **Description**: Update ACTION node config in `NodeConfigPanel.tsx` to show new action types: "Assign to Campaign" (with campaign selector dropdown), "Get Email" (minimal config), "Get Phone Numbers" (minimal config). Update `ActionNode.tsx` to show distinct icons per action type (campaign icon, email icon, phone icon).
- **Dependencies**: T-046
- **Files**:
  - Modify: `admin-dashboard/src/components/workflow/NodeConfigPanel.tsx`
  - Modify: `admin-dashboard/src/components/workflow/nodes/ActionNode.tsx`
- **Acceptance Criteria**: New action types appear in the type dropdown. Campaign selector loads and displays available campaigns. Icons update based on selected action type. Config persists correctly.

---

## Phase 6: Execution Progress Tracking

### T-049: Progress tracker utility
- **Description**: Create `progressTracker.ts` with functions: `initNodeProgress(executionId, nodeId, nodeType, total)`, `updateNodeProgress(executionId, nodeId, processed, succeeded, failed, skipped)`, `completeNodeProgress(executionId, nodeId)`. Each function: (1) updates the `nodeProgress` JSONB field in `WorkflowExecution`, (2) publishes update to Redis channel `workflow:progress:${executionId}`. Use efficient Prisma JSON update (not full read-modify-write).
- **Dependencies**: T-003
- **Files**:
  - Create: `src/services/workflow/progressTracker.ts`
- **Acceptance Criteria**: Progress updates are persisted to `nodeProgress` JSONB. Redis pub/sub events are published. Updates are efficient (partial JSON update, not full overwrite). Handles concurrent updates safely.

### T-050: SSE endpoint for execution progress
- **Description**: Add `GET /api/admin/workflows/executions/:id/progress` SSE endpoint. Subscribe to Redis channel `workflow:progress:${executionId}`. Push `NodeProgress` events to connected clients as `data:` lines. Include heartbeat every 15 seconds to keep connection alive. Clean up Redis subscription on client disconnect.
- **Dependencies**: T-049
- **Files**:
  - Modify: `src/routes/admin/workflows.ts`
- **Acceptance Criteria**: SSE endpoint sends events when progress updates are published. Heartbeat keeps connection alive. Subscription is cleaned up on disconnect. Auth middleware is applied. Events include the full `NodeProgress` object as JSON.

### T-051: Slack progress reporter
- **Description**: Create `slackProgressReporter.ts` with function `reportProgress(executionId, nodeProgress, slackChannelId, slackThreadTs)`. Posts formatted Slack message to the thread with progress counts and percentage. Throttles to max one update per 30 seconds per execution. Posts a final summary on node completion with total counts.
- **Dependencies**: T-049
- **Files**:
  - Create: `src/services/workflow/slackProgressReporter.ts`
- **Acceptance Criteria**: Progress updates post to Slack thread. Updates are throttled to 30-second intervals. Final summary includes all counts (created, updated, skipped, failed). Message formatting uses Block Kit for visual clarity.

### T-052: Integrate progress tracking into batch nodes
- **Description**: Update HUBSPOT, ENRICHMENT, and API_CALL node executors to call `progressTracker.initNodeProgress()` before processing and `progressTracker.updateNodeProgress()` after each batch. Also call `slackProgressReporter.reportProgress()` when the execution has Slack context. Update the HubSpot worker to emit progress during async batch processing.
- **Dependencies**: T-049, T-051, T-021, T-038
- **Files**:
  - Modify: `src/services/workflow/nodes/hubspotNodeExecutor.ts`
  - Modify: `src/services/workflow/nodes/apiCallNodeExecutor.ts`
  - Modify: `src/services/queue/workers/hubspotWorker.ts`
  - Modify: `src/services/workflow/workflowEngine.ts` (ENRICHMENT case)
- **Acceptance Criteria**: All batch-processing nodes emit progress events. Progress is visible in `nodeProgress` JSONB after each batch. Redis pub/sub events are published. Slack threads receive progress updates for Slack-triggered workflows.

### T-053: Frontend - Execution progress bar component
- **Description**: Create `ExecutionProgress.tsx` React component. Displays per-node progress bars with: node label, progress bar (processed/total), percentage, and count breakdown (succeeded, failed, skipped). Uses animated progress bar. Handles multiple concurrent node progress objects.
- **Dependencies**: T-050
- **Files**:
  - Create: `admin-dashboard/src/components/workflow/ExecutionProgress.tsx`
- **Acceptance Criteria**: Progress bars render for each node in the `nodeProgress` object. Animation is smooth. Counts are accurate. Failed items show in red. Completed nodes show a checkmark.

### T-054: Frontend - SSE hook for execution progress
- **Description**: Create `useExecutionProgress(executionId)` React hook. Connects to the SSE endpoint, parses incoming events, and returns the current `NodeProgress` map. Handles reconnection on disconnect. Cleans up EventSource on unmount.
- **Dependencies**: T-050
- **Files**:
  - Create: `admin-dashboard/src/hooks/useExecutionProgress.ts`
- **Acceptance Criteria**: Hook connects to SSE endpoint with auth token. Updates state on each event. Reconnects on connection loss (with backoff). Cleans up on unmount. Returns typed `NodeProgress` map.

### T-055: Frontend - Wire progress into execution detail page
- **Description**: Integrate `ExecutionProgress` component and `useExecutionProgress` hook into the workflow execution detail page. Show progress bars for active executions. Show final results for completed executions. Add overall progress indicator to the executions list view.
- **Dependencies**: T-053, T-054
- **Files**:
  - Modify: Existing workflow execution pages/components
- **Acceptance Criteria**: Active executions show real-time progress bars. Progress updates within 3 seconds. Completed executions show final summary. Execution list shows overall progress for active items.

---

## Task Dependency Graph

```
T-001 -> T-002 -> T-017
T-001 -> T-003 -> T-004 -> T-005 -> T-006 -> T-008, T-011
                   T-003 -> T-007 -> T-008, T-010, T-012, T-013
                   T-003 -> T-009
                   T-003 -> T-014 -> T-024, T-025
                   T-003 -> T-028 -> T-033, T-034
                   T-003 -> T-035 -> T-041, T-042
                   T-003 -> T-049 -> T-050, T-051, T-052

T-015 -> T-018, T-029
T-016 -> T-017 -> T-018
T-018 -> T-020 -> T-021 -> T-022 -> T-023, T-046
T-019 -> T-020
T-025 -> T-026 -> T-027

T-029 -> T-031 -> T-032
T-030 -> T-031

T-036 -> T-038 -> T-039, T-040
T-037 -> T-039

T-043, T-044, T-045 -> T-046 -> T-047, T-048

T-049 -> T-050 -> T-054 -> T-055
T-049 -> T-051 -> T-052
T-053 -> T-055
```

## Summary

| Phase | Task Range | Count | Key Output |
|-------|-----------|-------|------------|
| 0 | T-001 - T-002 | 2 | Research finalized, dependencies installed |
| 1 | T-003 - T-013 | 11 | Webhook trigger fully functional |
| 2 | T-014 - T-027 | 14 | HubSpot import/sync with identity resolution |
| 3 | T-028 - T-034 | 7 | Parser node (parse/transform/filter) |
| 4 | T-035 - T-042 | 8 | API Call node with response discovery |
| 5 | T-043 - T-048 | 6 | Enhanced action blocks |
| 6 | T-049 - T-055 | 7 | Progress tracking (dashboard + Slack) |
| **Total** | | **42** | |
