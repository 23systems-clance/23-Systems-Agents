# Feature Specification: Platform V2 - Workflow Builder Node Extensions

**Feature Branch**: `9-platform-v2`
**Created**: 2026-03-09
**Status**: Draft
**Input**: User description: "Workflow builder extensions - webhook triggers, HubSpot node (import/sync with identity resolution), parser node (transform/map/filter), API call node (dynamic payload discovery), action blocks (assign to campaign, get email, get phone), execution progress tracking"

## Clarifications

### Session 2026-03-09

- Q: Should the HubSpot node handle reading (importing contacts), writing (syncing back), or both? → A: Both - dropdown to select mode (Import from HubSpot / Sync to HubSpot). Evaluate HubSpot Bulk Import/Export APIs for large lists.
- Q: What should the Parsing Node handle? → A: All-in-one - parse incoming payloads (JSON/CSV), map/transform fields (proper case, domain normalization), and filter rows by criteria.
- Q: Where should execution progress be visible? → A: Both admin dashboard (real-time progress bars per node) and Slack (periodic thread updates during batch operations).
- Q: How should incoming webhooks be authenticated? → A: HMAC signature verification (industry standard, matches existing webhook secret pattern).
- Q: Should platform-level features (workspaces, API key rotation, data retention, licensing) remain in this spec? → A: Split - this spec covers workflow builder nodes only. Platform features become spec 10.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Webhook Trigger + HubSpot Node (Priority: P1)

As a BDR manager, I need to trigger workflows via external webhooks and use a HubSpot node that can both import contacts from HubSpot and sync enriched data back with intelligent identity resolution (domain normalization, name normalization, dedupe matching, canonical company matching) - all configured visually in the workflow builder.

**Why this priority**: Webhook triggers enable external systems to initiate workflows automatically, and HubSpot is the primary CRM for mid-market clients. Together they form the core data pipeline: external event triggers workflow, data flows through enrichment, results sync back to HubSpot without creating duplicates.

**Independent Test**: Can be tested by creating a workflow with a WEBHOOK trigger and a HUBSPOT node in Sync mode, POSTing enriched contact data to the webhook URL, and verifying contacts are created/updated in HubSpot with identity resolution applied.

**Acceptance Scenarios**:

1. **Given** a workflow builder canvas, **When** a manager configures a TRIGGER node, **Then** "Webhook" appears as a trigger type option alongside File Upload, Keyword, Slash Command, and Manual.
2. **Given** a TRIGGER node set to Webhook type, **When** the workflow is published, **Then** the system generates a unique secure webhook URL with an HMAC secret and displays both in the node config panel.
3. **Given** a published webhook-triggered workflow, **When** an external system POSTs data to the webhook URL with a valid HMAC signature, **Then** the workflow execution starts with the incoming payload as context.
4. **Given** a published webhook-triggered workflow, **When** a POST arrives with an invalid HMAC signature, **Then** the system returns 401 Unauthorized and logs the rejected request.
5. **Given** a HUBSPOT node on the canvas, **When** a manager opens its config panel, **Then** a mode dropdown offers "Import from HubSpot" and "Sync to HubSpot".
6. **Given** a HUBSPOT node in Import mode, **When** configured with a HubSpot list ID, **Then** the node pulls contacts from HubSpot using Bulk Export APIs and passes them downstream as workflow context.
7. **Given** a HUBSPOT node in Sync mode, **When** it receives enriched contacts from upstream nodes, **Then** it normalizes domains (strips www., protocol, trailing slashes, subdomains) and names (proper case) before matching against existing HubSpot records.
8. **Given** a HUBSPOT node in Sync mode processing a contact that matches an existing HubSpot contact by email, **When** the sync executes, **Then** it updates the existing record rather than creating a duplicate.
9. **Given** a HUBSPOT node in Sync mode processing companies with variant spellings (e.g., "Acme Inc", "Acme, Inc.", "ACME Inc"), **When** canonical matching runs, **Then** they are matched to the same HubSpot company record using fuzzy name comparison.
10. **Given** a HUBSPOT node that completes a sync batch, **When** the sync finishes, **Then** a sync report is produced showing: created, updated, skipped (duplicate), and failed counts.

---

### User Story 2 - Parser, API Call & Action Nodes (Priority: P1)

As a BDR manager, I need a Parser node to transform and filter data, an API Call node to make configurable HTTP requests with dynamic response mapping, and enhanced Action blocks (Assign to Campaign, Get Email, Get Phone Numbers) so I can build complete automation pipelines in the workflow builder.

**Why this priority**: These nodes are the connective tissue between triggers, enrichment, and destinations. Without them, data cannot flow between workflow steps in the right shape, external APIs cannot be called dynamically, and enrichment results cannot feed into campaign actions.

**Independent Test**: Can be tested by building a workflow: Webhook trigger -> Parser (map fields) -> Enrichment -> API Call (external service) -> Action (Assign to Campaign), and verifying end-to-end data flow.

**Acceptance Scenarios**:

1. **Given** a PARSER node on the canvas, **When** a manager opens its config panel, **Then** they can configure: parse mode (JSON/CSV), field mapping rules, transformation rules (proper case, domain normalization, custom expressions), and filter criteria (include/exclude rows by field values).
2. **Given** a PARSER node with a domain normalization rule, **When** data passes through, **Then** domains are stripped of protocol, www, trailing slashes, and subdomains.
3. **Given** a PARSER node with filter criteria "email is not empty", **When** data passes through, **Then** only rows with a non-empty email field proceed to the next node.
4. **Given** an API_CALL node on the canvas, **When** a manager opens its config panel, **Then** they can configure: HTTP method (GET/POST/PUT/DELETE), URL (with variable interpolation), headers, body template, and authentication (API key header, Bearer token, or HMAC).
5. **Given** an API_CALL node that has been test-executed once, **When** the response is received, **Then** the system dynamically discovers the response payload structure and presents it as mappable fields for downstream nodes.
6. **Given** an API_CALL node with response field mapping configured, **When** the workflow executes, **Then** mapped response fields are available as variables in subsequent nodes.
7. **Given** an ACTION node configured as "Assign to Campaign", **When** the workflow processes contacts, **Then** matching contacts are assigned to the specified campaign using the existing campaign service.
8. **Given** an ACTION node configured as "Get Email", **When** the workflow processes a contact without an email, **Then** the system triggers an email lookup via the existing enrichment pipeline.
9. **Given** an ACTION node configured as "Get Phone Numbers", **When** the workflow processes a contact without a phone, **Then** the system initiates an async phone number lookup and updates the contact when results arrive via webhook.
10. **Given** an API_CALL node targeting an unreachable URL, **When** the request fails, **Then** the system retries 3 times with exponential backoff, then marks the node as failed and logs the error.

---

### User Story 3 - Execution Progress Tracking (Priority: P2)

As a BDR manager, I need real-time progress tracking for workflow executions so I can see how batch operations (HubSpot syncs, enrichments, API calls) are progressing without guessing or waiting blindly.

**Why this priority**: Batch operations on large lists (500+ contacts) can take minutes. Without progress visibility, managers don't know if the job is running, stuck, or failed. Progress tracking builds confidence and enables proactive issue detection.

**Independent Test**: Can be tested by triggering a workflow with a large contact list and observing real-time progress updates in both the admin dashboard execution detail page and the Slack thread.

**Acceptance Scenarios**:

1. **Given** a workflow execution processing a batch of 500 contacts through a HUBSPOT node, **When** a manager views the execution detail page in the admin dashboard, **Then** a progress bar shows "HubSpot Sync: 230/500 (46%)" with real-time updates.
2. **Given** a workflow execution with multiple batch nodes (HUBSPOT, ENRICHMENT, API_CALL), **When** a manager views the execution detail, **Then** each batch node shows its own progress bar with counts and percentages.
3. **Given** a workflow execution triggered via Slack, **When** a batch node is processing, **Then** the Slack thread receives periodic progress updates (e.g., "Syncing to HubSpot... 46% complete (230/500)").
4. **Given** a batch node that encounters errors during processing, **When** the progress updates, **Then** both the dashboard and Slack show error counts alongside progress (e.g., "230/500 processed, 5 failed").
5. **Given** a completed batch operation, **When** the node finishes, **Then** a final summary is posted to both dashboard and Slack with total counts (created, updated, skipped, failed).
6. **Given** a workflow execution in progress, **When** a manager views the workflow executions list in the admin dashboard, **Then** active executions show an overall progress indicator.

---

### Edge Cases

- What happens when HubSpot API rate limits are hit during a large sync? The system queues remaining records and retries with exponential backoff, updating the progress bar to reflect the pause.
- What happens when domain normalization produces a match but the company names are completely different? The system flags these as "potential false matches" for manual review before syncing.
- What happens when a webhook URL receives a POST with an invalid HMAC signature? The system returns 401 Unauthorized, logs the attempt with source IP, and does NOT trigger the workflow.
- What happens when a webhook trigger receives concurrent requests? Each request is processed independently as separate workflow executions with proper isolation.
- What happens when an API_CALL node's target returns an unexpected payload structure? The system logs a warning and passes the raw response as a single field; the manager can re-map fields.
- What happens when a PARSER node's filter criteria exclude all rows? The workflow execution completes with a "0 records matched filter" warning and skips downstream nodes.
- What happens when a "Get Phone Numbers" action block receives no callback within the expected window? The system marks the lookup as timed out after 24 hours and logs a warning.
- What happens when canonical company matching produces multiple equally-likely matches? The system picks the most recently updated HubSpot record and flags the match for manual review.
- What happens when a HubSpot Bulk Import job exceeds the API's maximum batch size? The system automatically splits into multiple batches and tracks aggregate progress across all batches.

## Requirements _(mandatory)_

### Functional Requirements

**Webhook Trigger (extension of existing TRIGGER node)**
- **FR-001**: System MUST add "Webhook" as a new trigger type on the existing TRIGGER node, alongside FILE_UPLOAD, KEYWORD, SLASH_COMMAND, and MANUAL.
- **FR-002**: System MUST generate a unique, secure webhook URL with an HMAC secret when a webhook-triggered workflow is published.
- **FR-003**: System MUST validate incoming webhook requests using HMAC signature verification and reject invalid signatures with 401.
- **FR-004**: System MUST start a new workflow execution with the incoming webhook payload as initial context when a valid request is received.

**HubSpot Node (new node type: HUBSPOT)**
- **FR-005**: System MUST add a HUBSPOT node to the workflow builder NodePalette.
- **FR-006**: The HUBSPOT node config panel MUST offer a mode dropdown: "Import from HubSpot" and "Sync to HubSpot".
- **FR-007**: In Import mode, the node MUST pull contacts from a configured HubSpot list using Bulk Export APIs for efficient large-list handling.
- **FR-008**: In Sync mode, the node MUST normalize domains (strip protocol, www, trailing slashes, subdomains) before matching.
- **FR-009**: In Sync mode, the node MUST normalize contact names to proper case before matching.
- **FR-010**: In Sync mode, the node MUST perform dedupe matching using email (primary) and normalized domain + name (secondary) before creating new HubSpot records.
- **FR-011**: In Sync mode, the node MUST support canonical company matching using fuzzy name comparison with a configurable similarity threshold.
- **FR-012**: The node MUST produce a sync report after each operation (created, updated, skipped, failed counts).
- **FR-013**: System MUST evaluate and use HubSpot Bulk Import APIs for writing large batches to HubSpot efficiently.

**Parser Node (new node type: PARSER)**
- **FR-014**: System MUST add a PARSER node to the workflow builder NodePalette.
- **FR-015**: The PARSER node MUST support parsing incoming data in JSON and CSV formats.
- **FR-016**: The PARSER node MUST support field mapping (rename, combine, split fields).
- **FR-017**: The PARSER node MUST support transformation rules (proper case, domain normalization, custom expressions).
- **FR-018**: The PARSER node MUST support row filtering with include/exclude criteria based on field values.

**API Call Node (new node type: API_CALL)**
- **FR-019**: System MUST add an API_CALL node to the workflow builder NodePalette.
- **FR-020**: The API_CALL node MUST support configurable HTTP method (GET/POST/PUT/DELETE), URL with variable interpolation, headers, body template, and authentication options.
- **FR-021**: The API_CALL node MUST dynamically discover the response payload structure after a test execution and present fields as mappable outputs for downstream nodes.
- **FR-022**: The API_CALL node MUST support retry logic (3 attempts with exponential backoff) for failed requests.

**Enhanced Action Blocks (extension of existing ACTION node)**
- **FR-023**: System MUST add "Assign to Campaign" as an action type on the existing ACTION node.
- **FR-024**: System MUST add "Get Email" as an action type that triggers email lookups via the existing enrichment pipeline.
- **FR-025**: System MUST add "Get Phone Numbers" as an action type that triggers async phone number lookups via the existing enrichment pipeline.

**Execution Progress Tracking**
- **FR-026**: System MUST track per-node batch progress (total, processed, created, updated, skipped, failed) in the workflow execution context.
- **FR-027**: The admin dashboard execution detail page MUST display real-time progress bars for each batch-processing node.
- **FR-028**: Slack-triggered workflows MUST post periodic progress updates to the originating Slack thread during batch operations.
- **FR-029**: Completed batch operations MUST post a final summary with total counts to both dashboard and Slack.

### Key Entities

- **WebhookEndpoint**: A generated webhook URL tied to a workflow's TRIGGER node. Has a unique token, HMAC secret, associated workflow template, and active/inactive status. Created on publish, deactivated on archive.
- **WebhookLog**: Log of incoming webhook requests with source IP, HMAC validation result, payload hash, response status, and associated workflow execution ID.
- **HubSpotSyncReport**: Results of a HUBSPOT node execution. Tracks mode (import/sync), record counts (created, updated, skipped, failed), duration, and associated workflow execution.
- **ExecutionNodeProgress**: Per-node progress tracking within a workflow execution. Stored in the execution context JSONB field. Contains total, processed, succeeded, failed counts and current status.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: HubSpot Sync mode produces zero duplicate contacts when syncing a list that already exists in HubSpot (0% duplicate creation rate).
- **SC-002**: Domain normalization correctly matches 95%+ of common domain variants (www, subdomains, trailing slashes, protocol differences).
- **SC-003**: Webhook triggers process incoming requests and initiate workflow execution within 5 seconds of receipt.
- **SC-004**: API Call nodes deliver payloads to external URLs with 99%+ success rate (excluding target downtime).
- **SC-005**: Parser nodes correctly transform and filter data according to configured rules (100% rule adherence).
- **SC-006**: Progress bars update in the admin dashboard within 3 seconds of each batch increment.
- **SC-007**: Slack progress updates post at least every 30 seconds during batch operations.
- **SC-008**: Invalid HMAC signatures are rejected 100% of the time (zero unauthorized workflow executions).
- **SC-009**: Managers can build a complete webhook-to-HubSpot workflow using only the visual builder (no code required).
- **SC-010**: Workflow executions with 1,000+ contacts complete without timeout or memory issues.

## Assumptions

- HubSpot integration uses the CRM v3 API for individual operations and Bulk Import/Export APIs for large batches.
- The existing enrichment pipeline (Apollo, BuiltWith) and campaign service are reused via the new ACTION node blocks.
- The existing BullMQ queue infrastructure handles batch processing with the existing rate limiting and circuit breaker patterns.
- Fuzzy company name matching uses a configurable similarity threshold (default: 85%).
- HMAC signature verification follows the same pattern as the existing Apollo/Instantly/HeyReach webhook secrets.
- The PARSER node's field mapping UI is a visual table-based interface in the NodeConfigPanel.
- The API_CALL node's dynamic payload discovery requires at least one test execution to detect the response schema.
- Platform-level features (workspaces, API key rotation, data retention, self-hosted licensing, enrichment preset tags/enable-disable) are deferred to spec 10.
- The workflow engine's existing pending actions pattern is extended for the new ACTION node blocks.
- Progress tracking uses the existing execution context JSONB field, not a separate table.
- CRM hygiene features (suppression engine, ICP scoring, routing rules, CRM adapter pattern) are future enhancements that fit naturally as additional workflow nodes but are out of scope for this spec.
