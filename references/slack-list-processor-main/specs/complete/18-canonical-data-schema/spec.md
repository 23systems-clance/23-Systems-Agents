# Feature Specification: Canonical Data Schema & CRM Adapter Pattern

**Feature Branch**: `18-canonical-data-schema`
**Created**: 2026-03-10
**Status**: Draft
**Input**: Gap analysis from crm-hygiene-lead-routing-middleware-plan.md - Section 2: "Build a real middleware application with a canonical internal schema and CRM adapter interface, not hardcoded HubSpot fields throughout the product."

## Context

The Slack List Processor currently maps enrichment output columns directly to HubSpot properties during the import flow (spec 14). Adding Attio CRM support (spec 15) or future Salesforce support would require rebuilding the mapping logic from scratch for each CRM. This feature introduces a CRM-agnostic canonical data model as an intermediate layer between enrichment output and CRM push. Each CRM becomes an adapter that translates canonical fields to CRM-specific properties. This is the architectural foundation for multi-CRM support.

## Clarifications

### Session 2026-03-12

- Q: When enrichment is re-run for the same contacts, what happens to existing canonical records? -> A: Upsert by email (contacts) and domain (accounts). Existing canonical records are updated with the latest enrichment data rather than creating duplicates.
- Q: How should the adapter handle partial batch failures during CRM push? -> A: Partial success — commit successful records, report failed ones with per-record error reasons. No rollback of the entire batch.
- Q: What batch size and rate limit strategy for CRM push? -> A: 100 contacts per batch (HubSpot batch API limit), exponential backoff on 429 rate limit responses.
- Q: Should the system track per-record CRM push status on canonical records? -> A: Yes — track lastPushedAt timestamp + crmConnectionId per canonical record to enable incremental imports and prevent re-pushing unchanged records.
- Q: Should the existing HubSpot import flow (spec 14) be refactored or kept alongside the new adapter? -> A: Replace — refactor spec 14 import to use the new HubSpot adapter directly. No parallel code paths.

### Session 2026-03-10

- Q: Should existing enrichment output change to write to canonical tables first? -> A: No. The canonical layer sits between the enrichment output (existing JobCompany/JobContact tables) and the CRM push. Enrichment continues to write to existing tables. The canonical mapping happens when the user triggers a CRM import.
- Q: Should the canonical schema support bidirectional sync (read from CRM back to canonical)? -> A: Not in this spec. Write-only for now (canonical -> CRM). Bidirectional sync is a future enhancement.
- Q: How many CRM adapters should this spec deliver? -> A: One — HubSpot. The adapter interface is the deliverable. Attio becomes a second adapter in spec 15. Salesforce would be a third.
- Q: Should the field mapping be automatic or manual? -> A: Both. Auto-mapping for standard fields (email, name, title, company). Manual mapping UI for custom or non-standard fields. Same as the current HubSpot import spec but abstracted through the canonical layer.
- Q: Where do custom CRM properties (like enrichment_source, tech_spend_tier) live? -> A: In the field mapping configuration per adapter. The canonical schema has standard fields; the adapter's field map tells it which canonical fields map to which CRM-specific properties (standard or custom).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - CRM-Agnostic Contact Import (Priority: P1)

As a BDR manager, I need enriched contacts to be stored in a CRM-agnostic format before being pushed to any CRM, so that the same enrichment results can be imported into HubSpot, Attio, or any future CRM without re-enriching.

**Why this priority**: This is the architectural foundation. Without a canonical layer, every CRM integration requires its own mapping logic, and enrichment results are locked to a single CRM.

**Independent Test**: Enrich a list, verify the results are stored in canonical format, then import to HubSpot through the adapter. Verify the HubSpot contacts match the canonical data.

**Acceptance Scenarios**:

1. **Given** an enrichment job completes, **When** the user triggers a CRM import, **Then** the system converts enrichment results (JobCompany + JobContact rows) into canonical contact/account records.
2. **Given** canonical records exist, **When** the user selects HubSpot as the target CRM, **Then** the HubSpot adapter translates canonical fields to HubSpot properties and imports the contacts.
3. **Given** canonical records exist, **When** the user has both HubSpot and Attio connected (future), **Then** they can import the same enrichment results to either CRM without re-enriching.
4. **Given** a canonical contact with fields (email, firstName, lastName, jobTitle, company, phone, linkedinUrl), **When** the HubSpot adapter maps these, **Then** they map to (email, firstname, lastname, jobtitle, company, phone, hs_linkedin_url).
5. **Given** a canonical contact, **When** the mapping includes a custom field (techSpendTier -> tech_spend_tier), **Then** the adapter creates the custom property in HubSpot if it doesn't exist and maps the value.

---

### User Story 2 - CRM Adapter Interface (Priority: P1)

As a platform developer, I need a standardized CRM adapter interface so that adding a new CRM requires only implementing the adapter, not modifying the core import logic.

**Why this priority**: The adapter interface is what makes the architecture extensible. Without it, each CRM is a separate integration with duplicated logic.

**Independent Test**: Implement the HubSpot adapter against the interface. Verify that the import service calls only adapter methods and has no HubSpot-specific code.

**Acceptance Scenarios**:

1. **Given** the CRM adapter interface, **When** a developer implements a new CRM adapter, **Then** they only need to implement: connect(), disconnect(), getConnectionStatus(), upsertContacts(), createList(), getProperties(), and ensureCustomProperties().
2. **Given** the import service, **When** it processes a CRM import, **Then** it calls the adapter interface methods without knowing which CRM is being targeted.
3. **Given** a new CRM adapter is registered, **When** a user triggers a CRM import, **Then** the target CRM dropdown includes the newly registered adapter.
4. **Given** an adapter that fails during import, **When** the error is returned, **Then** it is normalized into a standard error format regardless of the underlying CRM's error structure.

---

### User Story 3 - Field Mapping Configuration (Priority: P2)

As a platform administrator, I need to configure field mappings between canonical fields and CRM properties per client, so that each client's CRM schema is respected during import.

**Why this priority**: Every client has different custom fields, picklist values, and naming conventions in their CRM. Field mapping ensures data lands in the right place.

**Independent Test**: Configure a custom field mapping for a client (canonical "techSpendTier" -> HubSpot "custom_tech_tier"), import contacts, and verify the custom field is populated correctly.

**Acceptance Scenarios**:

1. **Given** the admin dashboard, **When** an administrator views a client's CRM configuration, **Then** they see the field mapping table showing: canonical field, CRM property, data type, and transform rule.
2. **Given** a default field mapping, **When** an administrator overrides a mapping (e.g., canonical "phone" -> HubSpot "custom_direct_phone" instead of "phone"), **Then** future imports use the custom mapping.
3. **Given** a canonical field that has no CRM mapping, **When** an import runs, **Then** the field is skipped (not imported) and logged as unmapped.
4. **Given** a new CRM connection, **When** the adapter connects, **Then** it fetches the CRM's property schema and pre-populates the field mapping table with auto-detected matches.
5. **Given** a field mapping with a transform rule (e.g., "proper case"), **When** data is imported, **Then** the transform is applied before pushing to the CRM.

---

### Edge Cases

- What happens when a canonical field has no equivalent in the target CRM? The field is skipped during import and logged. No error is thrown.
- What happens when a CRM property is required but no canonical field maps to it? The adapter reports a validation error before import starts, listing the missing required fields.
- What happens when the same enrichment results are imported to the same CRM twice? The upsert logic (by email) prevents duplicates. Records are updated, not duplicated.
- What happens when a client disconnects their CRM? The canonical data remains intact. Only the adapter connection is removed. The data can be reconnected to a different CRM later.
- What happens when the canonical schema is extended with new fields? Existing adapters ignore unknown fields until their field mappings are updated.
- What happens when some records fail during a CRM batch push? Partial success — successful records are committed, failed records are reported with per-record error reasons. The import result includes counts of succeeded/failed and a downloadable error report.

## Requirements _(mandatory)_

### Functional Requirements

**Canonical Data Model**
- **FR-001**: System MUST define a canonical contact schema with standard fields: email, firstName, lastName, jobTitle, company, domain, phone, mobilePhone, linkedinUrl, city, state, country, enrichmentSource, enrichmentDate, techSpendTier, enrichmentJobId.
- **FR-002**: System MUST define a canonical account schema with standard fields: domain, companyName, industry, employeeCount, annualRevenue, city, state, country, technologies (array), cloudProvider, trafficRank, techSpendTier.
- **FR-003**: The canonical schema MUST be CRM-agnostic (no HubSpot, Salesforce, or Attio-specific concepts).
- **FR-004**: System MUST convert enrichment results (JobCompany + JobContact) to canonical format on-demand when a CRM import is triggered.
- **FR-004a**: System MUST track per-record CRM push status (lastPushedAt, crmConnectionId, crmRecordId) and only push records that are new or updated since the last push to that CRM connection.

**CRM Adapter Interface**
- **FR-005**: System MUST define a CrmAdapter interface with methods: connect(), disconnect(), getConnectionStatus(), upsertContacts(canonicalContacts), createList(name), addContactsToList(listId, contactIds), getProperties(), ensureCustomProperties(properties).
- **FR-006**: Each CRM adapter MUST normalize errors into a standard error format.
- **FR-006a**: The upsertContacts method MUST support partial success — committing successful records and returning per-record error details for failures.
- **FR-007**: The import service MUST interact only with the CrmAdapter interface, never with CRM-specific APIs directly.
- **FR-008**: System MUST support registering multiple CRM adapters.

**HubSpot Adapter**
- **FR-009**: System MUST implement a HubSpot adapter conforming to the CrmAdapter interface.
- **FR-010**: The HubSpot adapter MUST reuse the existing OAuth connection, token management, and API client from spec 14.
- **FR-011**: The HubSpot adapter MUST translate canonical fields to HubSpot properties using the configured field mapping.
- **FR-011a**: The HubSpot adapter MUST batch upserts at 100 contacts per API call and implement exponential backoff on 429 rate limit responses.

**Field Mapping**
- **FR-012**: System MUST maintain a field mapping table per CRM connection per client, defining: canonical field, CRM property name, data type, transform rule (optional), and sync direction.
- **FR-013**: System MUST auto-populate default field mappings when a CRM is connected, based on standard field name matching.
- **FR-014**: Administrators MUST be able to override, add, or remove field mappings via the admin dashboard.
- **FR-015**: System MUST fetch the CRM's property schema during connection setup to enable mapping autocomplete.

### Key Entities

- **CanonicalContact**: CRM-agnostic contact record. Contains the 16 standard contact fields. Linked to a JobContact and Job. Unique key: email. Upserted on re-enrichment.
- **CanonicalAccount**: CRM-agnostic account record. Contains the 12 standard account fields. Linked to a JobCompany and Job. Unique key: domain. Upserted on re-enrichment.
- **CrmConnection**: Represents a client's connection to a specific CRM. Contains: crmType (enum: HUBSPOT, ATTIO, SALESFORCE), connectionStatus, clientId, adapterConfig (JSONB). Extends the existing HubSpotConnection model concept.
- **CrmFieldMapping**: Per-connection field mapping. Contains: crmConnectionId, canonicalField, crmProperty, dataType, transformRule (optional), isRequired, syncDirection (TO_CRM, FROM_CRM, BIDIRECTIONAL).
- **CrmPushRecord**: Tracks per-record push status. Contains: canonicalContactId (or canonicalAccountId), crmConnectionId, lastPushedAt, crmRecordId (external ID returned by CRM), pushStatus (SUCCESS, FAILED, PENDING). Enables incremental imports by skipping unchanged records.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: The HubSpot import flow works identically through the adapter as it does through the direct implementation (zero functional regression).
- **SC-002**: Adding a new CRM adapter requires implementing only the CrmAdapter interface (7 methods) with no changes to the import service.
- **SC-003**: Auto-detected field mappings correctly match at least 80% of standard fields for a typical CRM setup.
- **SC-004**: Custom field mappings are respected 100% of the time during import.
- **SC-005**: Canonical data persists independently of CRM connections — disconnecting a CRM does not delete canonical records.

## Assumptions

- The canonical layer does NOT replace the existing enrichment tables (JobCompany, JobContact). It sits alongside them as a translation layer for CRM import.
- Canonical records are created on-demand when a CRM import is triggered, not during enrichment. This keeps the enrichment pipeline unchanged.
- The CrmAdapter interface is defined as a TypeScript interface/abstract class. Adapters are concrete implementations.
- This spec delivers one adapter (HubSpot). Attio is spec 15. Salesforce is future.
- Bidirectional sync (CRM -> canonical) is deferred. This spec is write-only (canonical -> CRM).
- The field mapping table is managed per CRM connection, not per workspace globally. Two clients with HubSpot may have different mappings.
- The existing spec 14 HubSpot import flow will be refactored to use the new HubSpot adapter. No parallel code paths — the adapter fully replaces direct HubSpot API calls in the import service.
