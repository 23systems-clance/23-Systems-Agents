# Feature Specification: CRM Hygiene & Lead Routing Middleware

**Feature Branch**: `11-crm-hygiene`
**Created**: 2026-03-09
**Status**: Draft
**Target Platform**: BDR Management Platform (stackGTM)
**Input**: User description: "CRM Hygiene and Lead Routing Middleware - Canonical prospecting database, CRM adapter pattern for Salesforce, reply-based governance, meeting-booked handoff, full bidirectional HubSpot sync, suppression engine, dedupe engine, intake API"
**Reference**: See `reference/crm-hygiene-lead-routing-middleware-plan.md` for the full architectural plan this spec is derived from.

## Context

This spec covers features that belong in the BDR Management Platform (stackGTM) - the system of record for prospecting. The Slack List Processor enriches and transforms data; these features govern what happens to that data in the CRM layer. The Slack List Processor's API_CALL node (spec 9) serves as the bridge, pushing enriched contacts into the BDR Platform's intake API.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Intake API & Canonical Prospecting Database (Priority: P1)

As a platform operator, I need an intake API that accepts enriched contacts from external tools (Slack List Processor, CSV uploads, webhook sources) and stores them in a canonical prospecting database with normalized fields, so that all prospect data flows through a single system of record before reaching any CRM.

**Why this priority**: Without a canonical intake point, prospect data enters CRMs from multiple sources without deduplication, normalization, or quality checks. This is the foundational layer all other features depend on.

**Independent Test**: Can be tested by POSTing enriched contacts from the Slack List Processor's API_CALL node to the intake API and verifying they are stored in the canonical database with normalized fields.

**Acceptance Scenarios**:

1. **Given** the intake API endpoint, **When** an external tool POSTs a batch of enriched contacts, **Then** each contact is stored in the canonical contacts table with a unique fingerprint.
2. **Given** an incoming contact with a raw domain like "https://www.acme.com/about/", **When** the intake processes it, **Then** the domain is normalized to "acme.com".
3. **Given** an incoming contact with name "JOHN SMITH", **When** the intake processes it, **Then** the name is normalized to "John Smith" (proper case).
4. **Given** an incoming contact whose email already exists in the canonical database, **When** the intake processes it, **Then** the existing record is updated (not duplicated) and a merge audit entry is created.
5. **Given** the intake API, **When** a batch of 1,000+ contacts is submitted, **Then** the system processes them asynchronously and returns a job ID for status tracking.

---

### User Story 2 - Suppression Engine (Priority: P1)

As a campaign manager, I need the system to automatically suppress contacts that should not be prospected (existing customers, active opportunities, prior negative replies, competitors, do-not-contact) so that outreach is directed only at valid prospects.

**Why this priority**: Prospecting existing customers or contacts who have explicitly opted out damages client relationships and violates compliance expectations. Suppression must be in place before any outreach automation.

**Independent Test**: Can be tested by creating suppression rules (existing customer domain, DNC email), submitting contacts matching those rules via intake, and verifying they are flagged as suppressed and excluded from outreach queues.

**Acceptance Scenarios**:

1. **Given** a suppression rule for domain "existingcustomer.com", **When** a contact with that domain enters the intake, **Then** the contact is flagged as suppressed with reason "existing_customer" and is not routed to outreach.
2. **Given** a contact on the do-not-contact list, **When** they appear in any new intake batch, **Then** they are automatically suppressed regardless of the source.
3. **Given** a contact associated with an active opportunity in the CRM, **When** they enter the intake, **Then** they are suppressed with reason "active_opportunity".
4. **Given** a suppression rule management page, **When** an administrator creates a rule, **Then** they can specify: rule type (domain, email, company name, industry), match criteria, and reason.
5. **Given** suppressed contacts, **When** a manager views the suppression log, **Then** they can see who was suppressed, when, by which rule, and optionally override the suppression.

---

### User Story 3 - Dedupe Engine (Priority: P1)

As a platform operator, I need intelligent deduplication that matches contacts and companies using fuzzy name comparison, domain normalization, and email matching so that the canonical database and CRM stay clean.

**Why this priority**: Duplicate records are the most common CRM data quality issue. Without deduplication, every import creates noise that compounds over time.

**Independent Test**: Can be tested by importing contacts with variant company names ("Acme Inc", "ACME, Inc.", "Acme Incorporated") and verifying they are matched to the same canonical company record.

**Acceptance Scenarios**:

1. **Given** two contacts with the same email address, **When** the second contact is imported, **Then** the system matches them as duplicates and merges the records (newer data wins for empty fields).
2. **Given** two companies with names "Acme Inc" and "ACME, Inc.", **When** fuzzy matching runs, **Then** they are identified as the same company with a confidence score above the threshold (default: 85%).
3. **Given** two contacts at the same normalized domain with the same first name and last name, **When** dedupe matching runs, **Then** they are flagged as potential duplicates for review.
4. **Given** a duplicate match below the confidence threshold, **When** the system processes it, **Then** the match is flagged for manual review rather than auto-merged.
5. **Given** a merge operation, **When** two records are merged, **Then** an audit trail captures both original records, the merge decision, and which fields were retained.

---

### User Story 4 - Bidirectional HubSpot Sync (Priority: P2)

As a campaign manager, I need the platform to sync qualified prospects to HubSpot and read back CRM data (ownership, lifecycle stage, opportunity status) so that the canonical database and HubSpot stay aligned without manual data entry.

**Why this priority**: Without sync, enriched and qualified prospects must be manually exported and imported into HubSpot. Bidirectional sync also enables suppression (reading active opportunities) and accurate routing (reading ownership).

**Independent Test**: Can be tested by qualifying a prospect in the canonical database, verifying it creates/updates a HubSpot contact, then changing the lifecycle stage in HubSpot and verifying the change is reflected back.

**Acceptance Scenarios**:

1. **Given** a prospect marked as qualified in the canonical database, **When** the outbound sync runs, **Then** the prospect is created or updated in HubSpot using the configured field mappings.
2. **Given** the field mapping configuration, **When** an administrator maps canonical fields to HubSpot properties, **Then** each mapping includes: canonical field, HubSpot property, data type, transform rule, and sync direction (outbound, inbound, or bidirectional).
3. **Given** a HubSpot contact whose lifecycle stage changes, **When** the inbound sync runs, **Then** the canonical database reflects the updated lifecycle stage.
4. **Given** a HubSpot contact with an active opportunity, **When** the inbound sync detects it, **Then** the canonical database flags the contact for suppression.
5. **Given** a sync conflict (both sides changed the same field), **When** the sync detects the conflict, **Then** the system uses a last-writer-wins strategy with the conflict logged for review.
6. **Given** a large sync batch (1,000+ contacts), **When** the sync runs, **Then** it uses HubSpot Bulk Import/Export APIs for efficiency rather than individual API calls.

---

### User Story 5 - CRM Adapter Pattern for Salesforce (Priority: P2)

As a platform operator, I need a Salesforce adapter that follows the same pattern as HubSpot so that clients using Salesforce can connect their CRM without rebuilding the sync logic.

**Why this priority**: Salesforce is the enterprise CRM standard. Supporting it expands the addressable market significantly. However, it depends on the HubSpot adapter being proven first.

**Independent Test**: Can be tested by configuring a Salesforce connection, mapping canonical fields to Salesforce objects (Lead/Contact/Account), and verifying contacts sync correctly.

**Acceptance Scenarios**:

1. **Given** a Salesforce integration setup, **When** an administrator connects their Salesforce org, **Then** the system authenticates via OAuth and discovers the org's object schemas (Lead, Contact, Account, Opportunity).
2. **Given** a discovered Salesforce schema, **When** the administrator opens field mapping, **Then** they can map canonical fields to Salesforce fields with type validation.
3. **Given** a configured Salesforce adapter, **When** a qualified prospect syncs outbound, **Then** it creates or updates the appropriate Salesforce object (Lead or Contact) with associated Account.
4. **Given** Salesforce-specific features (Lead conversion, RecordTypes), **When** the adapter encounters them, **Then** it handles them according to the org's configuration without errors.
5. **Given** Salesforce API rate limits, **When** the sync approaches limits, **Then** the adapter throttles and queues remaining operations for retry.

---

### User Story 6 - Reply-Based Governance (Priority: P3)

As a campaign manager, I need the system to detect prospect replies (email and LinkedIn) and automatically pause all other sequences targeting that prospect, create a follow-up task, and log the interaction so that prospects are not bombarded after engaging.

**Why this priority**: Reply governance prevents the most embarrassing outreach failures (prospect replies, gets ignored, receives another automated message). Important but depends on Unibox integration and sequence management being stable.

**Independent Test**: Can be tested by simulating an email reply webhook for a prospect who is enrolled in two sequences, and verifying both sequences pause and a follow-up task is created.

**Acceptance Scenarios**:

1. **Given** a prospect enrolled in an email sequence, **When** the prospect replies to an email, **Then** all active sequences for that prospect are immediately paused.
2. **Given** a prospect enrolled in a LinkedIn sequence, **When** the prospect responds on LinkedIn, **Then** all active sequences (including email) for that prospect are paused.
3. **Given** a paused sequence due to reply, **When** the reply is detected, **Then** a follow-up task is created for the assigned BDR with the reply content as context.
4. **Given** a reply event, **When** the system processes it, **Then** the interaction is logged in the canonical activity timeline with channel, timestamp, and content summary.
5. **Given** a prospect whose sequences were paused by reply, **When** the BDR completes follow-up, **Then** the BDR can manually re-enable or permanently pause the sequences.

---

### User Story 7 - Meeting-Booked Handoff (Priority: P3)

As a BDR manager, I need the system to detect when a meeting is booked and automatically transition the prospect to the AE workflow - creating handoff context, opening a do-not-prospect window, and associating all activity history - so that AEs have full context and prospects are not prospected during active sales conversations.

**Why this priority**: The BDR-to-AE handoff is where deals are won or lost. Bad handoffs (missing context, continued prospecting) undermine the entire pipeline. Lower priority because it requires meeting detection integration.

**Independent Test**: Can be tested by triggering a meeting-booked event for a prospect, verifying all sequences stop, a handoff record is created with activity context, and the prospect enters a do-not-prospect window.

**Acceptance Scenarios**:

1. **Given** a meeting is booked for a prospect, **When** the meeting event is detected, **Then** the prospect's status transitions to "qualified" and all active sequences are stopped (not paused - permanently ended).
2. **Given** a qualified prospect with a meeting booked, **When** the handoff is triggered, **Then** a handoff record is created containing: full activity timeline, enrichment data, ICP score, campaign context, and meeting details.
3. **Given** a handoff record, **When** an AE views it, **Then** they see a complete pre-meeting brief with all prospect context in one view.
4. **Given** a meeting-booked prospect, **When** the handoff completes, **Then** a do-not-prospect window opens (default: 90 days) preventing any new sequence enrollment.
5. **Given** a meeting-booked prospect, **When** any tool (Slack List Processor, CSV import) attempts to add them to a new campaign, **Then** the suppression engine blocks enrollment with reason "active_handoff".

---

### Edge Cases

- What happens when a contact matches multiple suppression rules simultaneously? All matching rules are recorded, and the contact is suppressed with the highest-priority reason.
- What happens when fuzzy company matching produces multiple equally-likely matches above threshold? The system picks the most recently updated record and flags the match for manual review.
- What happens when HubSpot API rate limits are hit during a large sync? The system queues remaining records and retries with exponential backoff, updating progress tracking.
- What happens when a Salesforce org has custom required fields the adapter doesn't know about? The sync fails gracefully for that record, logs the missing field error, and continues with remaining records.
- What happens when a reply is detected but the prospect is already in a do-not-prospect window? The reply is logged in the activity timeline but no sequence action is taken (sequences already stopped).
- What happens when the intake API receives malformed data? The system validates required fields (at minimum: email OR domain + name), rejects invalid records with specific error messages, and processes valid records in the same batch.
- What happens when a merge operation would lose data? The merge preserves all non-empty fields from both records. If both records have different values for the same field, the newer value wins and the older value is stored in the audit trail.
- What happens when a meeting is cancelled after handoff? The do-not-prospect window remains active (conservative approach). The AE or manager can manually close the window if appropriate.

## Requirements _(mandatory)_

### Functional Requirements

**Intake API & Canonical Database**
- **FR-001**: System MUST provide an intake API that accepts enriched contacts from external sources (Slack List Processor, CSV uploads, webhooks).
- **FR-002**: System MUST normalize all incoming data (domain stripping, name proper casing, email lowercasing) before storage.
- **FR-003**: System MUST generate a dedupe fingerprint for each contact (based on email, normalized domain + name).
- **FR-004**: System MUST process large batches (1,000+ contacts) asynchronously and return a job ID for status tracking.
- **FR-005**: System MUST maintain a canonical contacts table and a canonical accounts/companies table as the system of record.

**Suppression Engine**
- **FR-006**: System MUST support configurable suppression rules by type: domain, email, company name, industry, and custom criteria.
- **FR-007**: System MUST automatically check all incoming contacts against active suppression rules during intake processing.
- **FR-008**: System MUST flag suppressed contacts with the triggering rule and reason, preventing them from entering outreach queues.
- **FR-009**: System MUST support reading active opportunity status from connected CRMs to auto-suppress contacts with open deals.
- **FR-010**: System MUST provide a suppression log viewable by administrators with override capability.

**Dedupe Engine**
- **FR-011**: System MUST match contacts by email (exact match) as the primary dedupe key.
- **FR-012**: System MUST match contacts by normalized domain + normalized name as a secondary dedupe key.
- **FR-013**: System MUST match companies using fuzzy name comparison with a configurable similarity threshold (default: 85%).
- **FR-014**: System MUST auto-merge high-confidence matches and flag low-confidence matches for manual review.
- **FR-015**: System MUST maintain a complete audit trail for all merge operations.

**Bidirectional HubSpot Sync**
- **FR-016**: System MUST sync qualified prospects from the canonical database to HubSpot contacts/companies.
- **FR-017**: System MUST read CRM data (ownership, lifecycle stage, opportunity status) from HubSpot back to the canonical database.
- **FR-018**: System MUST support configurable field mappings with per-field sync direction (outbound, inbound, bidirectional).
- **FR-019**: System MUST use HubSpot Bulk Import/Export APIs for batches of 100+ contacts.
- **FR-020**: System MUST handle sync conflicts with a last-writer-wins strategy and conflict logging.

**Salesforce Adapter**
- **FR-021**: System MUST support Salesforce OAuth authentication and schema discovery (Lead, Contact, Account, Opportunity objects).
- **FR-022**: System MUST support field mapping between canonical fields and Salesforce fields with type validation.
- **FR-023**: System MUST handle Salesforce-specific concepts (Lead conversion, RecordTypes, required fields) without errors.
- **FR-024**: System MUST respect Salesforce API rate limits with throttling and retry queuing.

**Reply-Based Governance**
- **FR-025**: System MUST detect reply events from email (via Instantly webhooks) and LinkedIn (via HeyReach webhooks).
- **FR-026**: System MUST automatically pause all active sequences for a prospect when a reply is detected from any channel.
- **FR-027**: System MUST create a follow-up task for the assigned BDR with reply context when a reply is detected.
- **FR-028**: System MUST log all reply events in the canonical activity timeline.

**Meeting-Booked Handoff**
- **FR-029**: System MUST detect meeting-booked events and transition the prospect status to "qualified".
- **FR-030**: System MUST create a handoff record containing full activity timeline, enrichment data, ICP score, and meeting details.
- **FR-031**: System MUST open a configurable do-not-prospect window (default: 90 days) upon meeting booking.
- **FR-032**: System MUST enforce the do-not-prospect window across all intake sources (API, CSV, webhook, Slack).

### Key Entities

- **CanonicalContact**: The system-of-record contact with normalized fields, dedupe fingerprint, suppression status, enrichment snapshots, and CRM sync state. Linked to a CanonicalAccount.
- **CanonicalAccount**: The system-of-record company with normalized domain, fuzzy-matchable name, firmographics, and CRM sync state.
- **SuppressionRule**: A configurable rule that prevents contacts from entering outreach. Has type, match criteria, reason, priority, and active/inactive status.
- **SuppressionLog**: Record of each suppression event with contact reference, matched rule, timestamp, and optional override.
- **MergeAuditEntry**: Record of a dedupe merge operation with both original records, merge decision, retained fields, and operator (auto or manual).
- **CrmSyncState**: Per-contact/per-account tracking of sync status with each connected CRM. Includes last sync timestamp, sync direction, and any errors.
- **FieldMapping**: Per-integration mapping between canonical fields and CRM properties. Includes data type, transform rule, fallback, sync direction, and required flag.
- **HandoffRecord**: A BDR-to-AE transition record with prospect context, activity timeline, meeting details, and do-not-prospect window dates.
- **IntakeJob**: An async batch processing job with source, record count, status (queued/processing/complete/failed), and progress tracking.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Intake API processes 1,000-contact batches within 60 seconds (queued, not necessarily fully processed).
- **SC-002**: Suppression engine catches 100% of contacts matching active suppression rules (zero false negatives on exact-match rules).
- **SC-003**: Dedupe engine produces zero duplicate contacts when importing a list that already exists in the canonical database (email-based matching).
- **SC-004**: Fuzzy company name matching correctly identifies 90%+ of common company name variants (abbreviations, punctuation, case differences).
- **SC-005**: HubSpot sync maintains canonical-to-CRM data consistency with less than 5-minute lag for outbound syncs.
- **SC-006**: Reply-based governance pauses all sequences within 30 seconds of reply detection.
- **SC-007**: Meeting-booked handoff produces a complete context record that AEs can use without asking the BDR for additional information.
- **SC-008**: Salesforce adapter handles standard Lead/Contact/Account CRUD without errors on orgs with default configuration.
- **SC-009**: All merge, suppression, and sync operations produce auditable records (100% traceability).
- **SC-010**: Do-not-prospect windows are enforced across all intake sources with zero unauthorized enrollments.

## Assumptions

- This spec is designed for the BDR Management Platform (stackGTM), not the Slack List Processor. The Slack List Processor feeds data into this system via the intake API.
- The BDR Management Platform already has: contacts table, accounts table, activity tracking, Unibox (Instantly + HeyReach), sequence management, meetings management, outcomes tracking, and routing-rules API routes.
- HubSpot integration uses the CRM v3 API for individual operations and Bulk Import/Export APIs for large batches.
- Salesforce integration depends on the HubSpot adapter being proven stable first. The CRM adapter interface is designed once and reused.
- Reply detection relies on existing Instantly and HeyReach webhook integrations already in the BDR Platform's plugin system.
- Meeting detection relies on the existing Cal.com or calendar integration already in the BDR Platform.
- Fuzzy company name matching uses a configurable similarity threshold (default: 85%) with standard string similarity algorithms.
- The canonical data model is an extension of the existing contacts/accounts tables, not a replacement.
- Field mapping configuration is managed per-integration per-workspace via the admin dashboard.
- The intake API authenticates callers using API keys scoped to workspaces (leveraging the existing credential model).
