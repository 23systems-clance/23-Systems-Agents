# Data Model: Slack List Processor

**Feature Branch**: `1-slack-list-processor`
**Date**: 2026-03-04
**Database**: PostgreSQL (via Prisma ORM)

## Entity Relationship Diagram

```
Job (1) ----< (N) JobCompany
Job (1) ----< (N) JobContact
Job (1) ----< (N) ApiUsageLog
Job (1) ----< (N) PendingPhoneLookup
JobCompany (1) ----< (N) JobContact
JobCompany (1) ----< (N) CompanyTechnology
TechReportCache (1) ----< (N) TechReportCacheEntry
AuditLog (standalone, append-only)
```

## Entities

### Job

The central entity representing a processing request initiated by a Slack user.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto-generated | Unique job identifier |
| slack_channel_id | String | NOT NULL | Originating Slack channel |
| slack_thread_ts | String | NOT NULL | Thread timestamp for threaded replies |
| slack_user_id | String | NOT NULL | Requesting Slack user |
| slack_team_id | String | NOT NULL | Slack workspace/team ID |
| job_type | Enum | NOT NULL | `TECHNOGRAPHIC`, `CONTACT`, `COMBINED`, `TECH_REPORT` |
| status | Enum | NOT NULL, default `PENDING` | `PENDING`, `PROCESSING`, `AWAITING_PHONES`, `COMPLETED`, `FAILED` |
| progress | Integer | default 0 | 0-100 progress percentage |
| source_file_name | String | NULLABLE | Original uploaded filename |
| source_file_url | String | NULLABLE | Slack file URL (private) |
| source_file_type | Enum | NULLABLE | `CSV`, `XLSX` |
| source_row_count | Integer | NULLABLE | Number of rows in uploaded file |
| result_file_url | String | NULLABLE | Stored result file URL |
| result_file_name | String | NULLABLE | Generated result filename |
| purpose | Enum | NULLABLE | `COLD_CALLING`, `EMAILING`, `JUST_A_LIST`, `LINKEDIN` |
| is_cosell | Boolean | default false | Whether this is a co-sell list |
| cosell_provider | String | NULLABLE | Cloud provider for co-sell (AWS, Azure, GCP, Other) |
| list_owner | String | NULLABLE | Who owns this list |
| additional_context | Text | NULLABLE | Free-text notes from user |
| enrich_instruction | Text | NULLABLE | Raw "ENRICH ..." message from user |
| parsed_intent | JSONB | NULLABLE | AI-parsed intent and parameters |
| error_message | Text | NULLABLE | Error details if job failed |
| companies_processed | Integer | default 0 | Count of successfully processed companies |
| companies_failed | Integer | default 0 | Count of failed companies |
| contacts_found | Integer | default 0 | Count of contacts found |
| started_at | Timestamp | NULLABLE | When processing began |
| completed_at | Timestamp | NULLABLE | When processing finished |
| created_at | Timestamp | NOT NULL, auto | Record creation time |
| updated_at | Timestamp | NOT NULL, auto | Last update time |

**Indexes**: `slack_channel_id`, `slack_user_id`, `status`, `job_type`, `created_at`

**State Transitions**:
```
PENDING -> PROCESSING -> COMPLETED
PENDING -> PROCESSING -> AWAITING_PHONES -> COMPLETED
PENDING -> PROCESSING -> FAILED
PENDING -> FAILED (validation error)
```

---

### JobCompany

A company record within a specific job. Stores enriched technographic data.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto-generated | |
| job_id | UUID | FK -> Job, NOT NULL | Parent job |
| row_index | Integer | NOT NULL | Original row position in uploaded file |
| domain | String | NULLABLE | Company domain (may be resolved from name) |
| company_name | String | NULLABLE | Company name from input |
| resolved_domain | String | NULLABLE | Domain resolved from company name (FR-014) |
| location_country | String | NULLABLE | Country |
| location_state | String | NULLABLE | State/region |
| location_city | String | NULLABLE | City |
| traffic_rank | Integer | NULLABLE | Quantcast or Majestic rank |
| cloud_provider_primary | String | NULLABLE | Primary cloud hosting provider |
| cloud_providers_all | String | NULLABLE | Comma-separated all detected providers |
| tech_spend_tier | Enum | NULLABLE | `TIER_1`, `TIER_2`, `TIER_3`, `UNCLASSIFIED` |
| tech_spend_score | Integer | NULLABLE | Raw score for debugging/calibration |
| technology_count | Integer | default 0 | Total technologies detected |
| enterprise_tech_count | Integer | default 0 | Enterprise-tier technologies detected |
| enrichment_status | Enum | NOT NULL, default `PENDING` | `PENDING`, `SUCCESS`, `FAILED`, `SKIPPED` |
| error_message | String | NULLABLE | Error if enrichment failed |
| raw_builtwith_response | JSONB | NULLABLE | Full BuiltWith API response (for debugging) |
| created_at | Timestamp | NOT NULL, auto | |
| updated_at | Timestamp | NOT NULL, auto | |

**Indexes**: `job_id`, `domain`, `enrichment_status`
**Unique**: `(job_id, row_index)`

---

### CompanyTechnology

Individual technology detected for a company. Stored separately for queryability.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto-generated | |
| job_company_id | UUID | FK -> JobCompany, NOT NULL | Parent company record |
| name | String | NOT NULL | Technology name (e.g., "Salesforce") |
| tag | String | NULLABLE | BuiltWith tag identifier |
| categories | String[] | NULLABLE | Array of category strings |
| first_detected | Timestamp | NULLABLE | BuiltWith first detection date |
| last_detected | Timestamp | NULLABLE | BuiltWith last detection date |
| is_enterprise | Boolean | default false | Classified as enterprise technology |

**Indexes**: `job_company_id`, `name`

---

### JobContact

A contact (decision maker) found for a company within a job.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto-generated | |
| job_id | UUID | FK -> Job, NOT NULL | Parent job |
| job_company_id | UUID | FK -> JobCompany, NOT NULL | Associated company |
| full_name | String | NULLABLE | Contact full name |
| first_name | String | NULLABLE | First name |
| last_name | String | NULLABLE | Last name |
| email | String | NULLABLE | Email address |
| direct_phone | String | NULLABLE | Direct phone number (NOT mobile) |
| business_phone | String | NULLABLE | Business/HQ phone number |
| job_title | String | NULLABLE | Original job title from Apollo |
| persona_type | Enum | NOT NULL | See Persona Type enum below |
| seniority_level | String | NULLABLE | C-suite, VP, Director, Manager, etc. |
| linkedin_url | String | NULLABLE | LinkedIn profile URL |
| apollo_person_id | String | NULLABLE | Apollo.io person identifier |
| is_decision_maker | Boolean | NOT NULL, default true | Whether this contact is classified as a decision maker (aligns with constitution persona classification requirement) |
| timezone_utc | String | NULLABLE | UTC offset (e.g., "UTC-5", "UTC-8") derived from contact location |
| timezone_label | String | NULLABLE | Layman's label (e.g., "Eastern", "Pacific" for U.S.; IANA region for non-U.S.) |
| enrichment_status | Enum | NOT NULL, default `PENDING` | `PENDING`, `ENRICHED`, `PHONE_PENDING`, `COMPLETE`, `FAILED` |
| phone_received_at | Timestamp | NULLABLE | When async phone data was received |
| created_at | Timestamp | NOT NULL, auto | |
| updated_at | Timestamp | NOT NULL, auto | |

**Indexes**: `job_id`, `job_company_id`, `persona_type`, `enrichment_status`

---

### PendingPhoneLookup

Correlation table for Apollo.io async phone webhook delivery.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto-generated | |
| job_id | UUID | FK -> Job, NOT NULL | Parent job |
| job_contact_id | UUID | FK -> JobContact, NOT NULL | Associated contact |
| apollo_request_id | String | NOT NULL, UNIQUE | Apollo's request/correlation ID |
| status | Enum | NOT NULL, default `PENDING` | `PENDING`, `RECEIVED`, `TIMED_OUT` |
| phone_data | JSONB | NULLABLE | Raw phone data from webhook |
| expires_at | Timestamp | NOT NULL | TTL - default 30 min from creation |
| received_at | Timestamp | NULLABLE | When webhook was received |
| created_at | Timestamp | NOT NULL, auto | |

**Indexes**: `apollo_request_id` (UNIQUE), `job_id`, `status`

---

### TechReportCache

Cached technology report results to avoid duplicate API charges (FR-018).

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto-generated | |
| query_hash | String | NOT NULL, UNIQUE | SHA-256 hash of normalized query parameters |
| technology | String | NOT NULL | Technology name searched |
| country | String | NULLABLE | Country filter |
| state_region | String | NULLABLE | State/region filter |
| company_size | String | NULLABLE | Company size filter |
| traffic_level | String | NULLABLE | Traffic level filter |
| result_count | Integer | NOT NULL | Number of companies in result |
| result_file_url | String | NOT NULL | Stored CSV file URL |
| requested_by_user_id | String | NOT NULL | Slack user who first ran this query |
| requested_in_channel | String | NOT NULL | Channel where first requested |
| created_at | Timestamp | NOT NULL, auto | When the report was generated |

**Indexes**: `query_hash` (UNIQUE), `technology`, `created_at`

---

### TechReportCacheEntry

Individual company entry within a cached tech report.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto-generated | |
| cache_id | UUID | FK -> TechReportCache, NOT NULL | Parent cache record |
| domain | String | NOT NULL | Company domain |
| company_name | String | NULLABLE | Company name |
| country | String | NULLABLE | Country |
| state_region | String | NULLABLE | State/region |
| city | String | NULLABLE | City |
| traffic_rank | Integer | NULLABLE | Traffic ranking |
| technology_detected | String | NOT NULL | Specific technology variant detected |

**Indexes**: `cache_id`, `domain`

---

### ApiUsageLog

Tracks API usage per job for cost attribution (FR-019).

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto-generated | |
| job_id | UUID | FK -> Job, NOT NULL | Associated job |
| service | Enum | NOT NULL | `BUILTWITH`, `APOLLO`, `AI_ORCHESTRATOR` |
| endpoint | String | NOT NULL | Specific API endpoint called |
| request_count | Integer | NOT NULL, default 1 | Number of API calls |
| credits_consumed | Decimal | NULLABLE | Credits/units consumed (BuiltWith/Apollo) |
| tokens_input | Integer | NULLABLE | AI input tokens (for AI_ORCHESTRATOR) |
| tokens_output | Integer | NULLABLE | AI output tokens (for AI_ORCHESTRATOR) |
| estimated_cost_usd | Decimal | NULLABLE | Estimated cost in USD |
| response_status | Integer | NULLABLE | HTTP response status code |
| duration_ms | Integer | NULLABLE | Request duration in milliseconds |
| created_at | Timestamp | NOT NULL, auto | |

**Indexes**: `job_id`, `service`, `created_at`

---

### AuditLog

Immutable audit trail for all user-facing actions (Constitution Principle V - SOC 2).

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto-generated | |
| action | String | NOT NULL | Action type: `file_upload`, `enrich_request`, `button_click`, `job_download`, `purpose_selected`, `cosell_answered`, `cache_decision`, `filter_submitted` |
| actor_user_id | String | NOT NULL | Slack user ID who performed the action |
| actor_team_id | String | NOT NULL | Slack workspace/team ID |
| channel_id | String | NULLABLE | Slack channel where action occurred |
| thread_ts | String | NULLABLE | Slack thread timestamp |
| target_entity | String | NULLABLE | Entity type affected (e.g., `Job`, `File`) |
| target_id | String | NULLABLE | ID of affected entity |
| metadata | JSONB | NULLABLE | Action-specific details (e.g., button value, intent classification result, file info) |
| created_at | Timestamp | NOT NULL, auto | Immutable timestamp |

**Indexes**: `actor_user_id`, `action`, `target_entity + target_id`, `created_at`

**Rules**:
- Records are append-only (no UPDATE or DELETE)
- No application-level soft delete
- Retention: permanent (aligned with FR-016 and Constitution Principle V minimum 1-year requirement)

---

## Enums

### JobType
```
TECHNOGRAPHIC    - BuiltWith enrichment only
CONTACT          - Apollo.io decision maker lookup only
COMBINED         - Both technographic + contact enrichment
TECH_REPORT      - Technology report generation (BuiltWith Lists API)
```

### JobStatus
```
PENDING          - Job created, awaiting processing
PROCESSING       - Currently being processed
AWAITING_PHONES  - Contact enrichment done, waiting for async phone webhooks
COMPLETED        - Job finished successfully
FAILED           - Job failed with error
```

### PersonaType
```
IT_LEADER
ENGINEERING_LEADER
FINANCE_LEADER
SALES_LEADER
FOUNDER_OWNER
CEO
OPERATIONS_LEADER
HR_LEADER
CUSTOMER_SUCCESS_LEADER
MARKETING_LEADER
PRODUCT_LEADER
COMPLIANCE_LEADER
RESEARCH_LEADER
NON_LEADER
```

### TechSpendTier
```
TIER_1           - High technology spend
TIER_2           - Mid technology spend
TIER_3           - Low technology spend
UNCLASSIFIED     - Cannot be reliably estimated
```

### SourceFileType
```
CSV
XLSX
```

### ListPurpose
```
COLD_CALLING
EMAILING
JUST_A_LIST
LINKEDIN
```

### ApiService
```
BUILTWITH
APOLLO
AI_ORCHESTRATOR
```

### EnrichmentStatus (Company)
```
PENDING
SUCCESS
FAILED
SKIPPED
```

### ContactEnrichmentStatus
```
PENDING
ENRICHED
PHONE_PENDING
COMPLETE
FAILED
```

### PhoneLookupStatus
```
PENDING
RECEIVED
TIMED_OUT
```

## Validation Rules

1. **Job**:
   - `source_row_count` must be <= 5,000 (FR-015 hard max)
   - `job_type` of `TECH_REPORT` does not require `source_file_url`
   - `purpose` is required for `CONTACT` and `COMBINED` job types

2. **JobCompany**:
   - Must have either `domain` or `company_name` (at least one)
   - `row_index` must be unique within a job

3. **JobContact**:
   - `direct_phone` and `business_phone` must NOT contain mobile numbers (validation at application layer)
   - Maximum 2 contacts per `job_company_id` (FR-004 default)

4. **TechReportCache**:
   - `query_hash` computed from normalized, lowercased: `technology + country + state_region + company_size + traffic_level`
   - Cache entries have no automatic expiry (permanent storage per FR-016)

5. **PendingPhoneLookup**:
   - `expires_at` defaults to `created_at + 30 minutes`
   - Background job marks expired lookups as `TIMED_OUT`

## Data Retention

Per FR-016 (permanent job storage): All job metadata, source files, and result files are stored indefinitely. No automatic purging or archival. Users can search and retrieve past job results via Slack.
