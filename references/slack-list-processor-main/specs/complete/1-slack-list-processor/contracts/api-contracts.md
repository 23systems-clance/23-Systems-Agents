# API Contracts: Slack List Processor

**Feature Branch**: `1-slack-list-processor`
**Date**: 2026-03-04
**API Style**: Internal REST API (consumed by Slack event handlers and BullMQ workers)

> Note: This service is primarily event-driven via Slack events and BullMQ jobs. The REST API serves internal administration, webhook reception, and health monitoring. The primary "user interface" is Slack itself.

---

## 1. Slack Event Handlers (Internal, not HTTP endpoints)

These are Bolt event listeners, not REST endpoints. Documented here for contract completeness.

### 1.1 File Upload Detection

**Event**: `file_shared`
**Trigger**: User uploads CSV/XLSX to a channel the bot is in
**Behavior**:
1. Validate file type (CSV or XLSX)
2. Respond in thread: "What would you like me to do with this list? Use ENRICH at the beginning of your sentence so I know you're talking to me."
3. Store pending file reference in conversation state (Redis key, TTL 1 hour)

**Response Blocks** (Block Kit):
```json
{
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "I detected your file! What would you like me to do with this list?\n\nUse *ENRICH* at the beginning of your sentence so I know you're talking to me."
      }
    }
  ]
}
```

### 1.2 ENRICH Message Handler

**Event**: `message` (filtered for messages starting with "ENRICH")
**Trigger**: User replies with "ENRICH [instruction]" in a thread with a pending file
**Behavior**:
1. Match to pending file reference via thread_ts
2. Send instruction to AI orchestrator for intent classification
3. Based on intent:
   - `TECHNOGRAPHIC`: Ask contextual questions (co-sell, owner) -> create Job
   - `CONTACT`: Ask purpose (Cold Calling, etc.) + contextual questions -> create Job
   - `COMBINED`: Ask purpose + contextual questions -> create Job
   - `TECH_REPORT`: Ask filtering questions -> create Job
4. Acknowledge within 3 seconds: "Got it! Processing your request..."
5. Enqueue BullMQ job

### 1.3 Interactive Action Handlers

**Action: Purpose Selection** (`action_id: select_purpose_*`)
```json
{
  "blocks": [
    {
      "type": "section",
      "text": { "type": "mrkdwn", "text": "What is this list for?" }
    },
    {
      "type": "actions",
      "block_id": "purpose_selection",
      "elements": [
        { "type": "button", "text": { "type": "plain_text", "text": "Cold Calling" }, "action_id": "select_purpose_cold_calling", "value": "COLD_CALLING" },
        { "type": "button", "text": { "type": "plain_text", "text": "Emailing" }, "action_id": "select_purpose_emailing", "value": "EMAILING" },
        { "type": "button", "text": { "type": "plain_text", "text": "Just a List" }, "action_id": "select_purpose_just_a_list", "value": "JUST_A_LIST" },
        { "type": "button", "text": { "type": "plain_text", "text": "LinkedIn" }, "action_id": "select_purpose_linkedin", "value": "LINKEDIN" }
      ]
    }
  ]
}
```

**Action: Co-Sell Confirmation** (`action_id: cosell_*`)
```json
{
  "blocks": [
    {
      "type": "section",
      "text": { "type": "mrkdwn", "text": "Is this a co-sell list with a cloud provider?" }
    },
    {
      "type": "actions",
      "block_id": "cosell_check",
      "elements": [
        { "type": "button", "text": { "type": "plain_text", "text": "Yes" }, "action_id": "cosell_yes", "value": "yes", "style": "primary" },
        { "type": "button", "text": { "type": "plain_text", "text": "No" }, "action_id": "cosell_no", "value": "no" }
      ]
    }
  ]
}
```

**Action: Cloud Provider Selection** (`action_id: select_cloud_provider_*`)
```json
{
  "elements": [
    { "type": "button", "text": { "type": "plain_text", "text": "AWS" }, "action_id": "select_cloud_provider_aws", "value": "AWS" },
    { "type": "button", "text": { "type": "plain_text", "text": "Azure" }, "action_id": "select_cloud_provider_azure", "value": "Azure" },
    { "type": "button", "text": { "type": "plain_text", "text": "GCP" }, "action_id": "select_cloud_provider_gcp", "value": "GCP" },
    { "type": "button", "text": { "type": "plain_text", "text": "Other" }, "action_id": "select_cloud_provider_other", "value": "Other" }
  ]
}
```

**Action: Tech Report Filter Questions** (`action_id: report_filter_*`)
- Country selection (static_select with common countries)
- State/region (plain_text_input)
- Company size range (static_select: Any, 1-50, 51-200, 201-1000, 1001-10000, 10000+)
- Traffic level (static_select: Any, Top 10K, Top 100K, Top 500K, All)

**Action: Cache Decision** (`action_id: cache_*`)
```json
{
  "blocks": [
    {
      "type": "section",
      "text": { "type": "mrkdwn", "text": "I found a cached result for this query from *2026-02-15*. Would you like to use it or run a fresh query?" }
    },
    {
      "type": "actions",
      "elements": [
        { "type": "button", "text": { "type": "plain_text", "text": "Use Cached" }, "action_id": "cache_use", "value": "use_cached", "style": "primary" },
        { "type": "button", "text": { "type": "plain_text", "text": "Fresh Query" }, "action_id": "cache_fresh", "value": "fresh_query" }
      ]
    }
  ]
}
```

---

## 2. REST API Endpoints

Base path: `/api/v1`

**Authentication**: All endpoints except health check require an `X-API-Key` header matching the server's configured API_KEY. Returns `401 Unauthorized` if missing or invalid.

### 2.1 Health Check

```
GET /api/v1/health
```

**Response** `200 OK`:
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime_seconds": 3600,
  "redis_connected": true,
  "database_connected": true,
  "slack_connected": true
}
```

### 2.2 Jobs

#### List Jobs

```
GET /api/v1/jobs
```

**Query Parameters**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| status | string | all | Filter by status |
| job_type | string | all | Filter by job type |
| slack_user_id | string | - | Filter by requesting user |
| slack_channel_id | string | - | Filter by channel |
| limit | integer | 20 | Max results (1-100) |
| offset | integer | 0 | Pagination offset |
| sort | string | created_at:desc | Sort field and direction |

**Response** `200 OK`:
```json
{
  "jobs": [
    {
      "id": "uuid",
      "job_type": "TECHNOGRAPHIC",
      "status": "COMPLETED",
      "source_file_name": "companies.csv",
      "source_row_count": 150,
      "companies_processed": 148,
      "companies_failed": 2,
      "contacts_found": 0,
      "purpose": null,
      "list_owner": "John Smith",
      "created_at": "2026-03-04T10:00:00Z",
      "completed_at": "2026-03-04T10:03:45Z"
    }
  ],
  "total": 42,
  "limit": 20,
  "offset": 0
}
```

#### Get Job Details

```
GET /api/v1/jobs/:id
```

**Response** `200 OK`:
```json
{
  "id": "uuid",
  "job_type": "COMBINED",
  "status": "COMPLETED",
  "progress": 100,
  "source_file_name": "leads.xlsx",
  "source_row_count": 50,
  "result_file_url": "/storage/results/uuid.xlsx",
  "purpose": "COLD_CALLING",
  "is_cosell": true,
  "cosell_provider": "AWS",
  "list_owner": "Jane Doe",
  "additional_context": "Q1 campaign for fintech",
  "enrich_instruction": "ENRICH this list with tech stacks and find me decision makers",
  "parsed_intent": { "intent": "combined", "confidence": 0.95 },
  "companies_processed": 48,
  "companies_failed": 2,
  "contacts_found": 92,
  "started_at": "2026-03-04T10:00:05Z",
  "completed_at": "2026-03-04T10:04:30Z",
  "created_at": "2026-03-04T10:00:00Z",
  "api_usage": {
    "builtwith": { "calls": 50, "credits": 50, "estimated_cost_usd": 2.50 },
    "apollo": { "calls": 100, "credits": 96, "estimated_cost_usd": 4.80 },
    "ai_orchestrator": { "calls": 55, "tokens_input": 22000, "tokens_output": 5500, "estimated_cost_usd": 0.04 }
  }
}
```

#### Download Job Result

```
GET /api/v1/jobs/:id/result
```

**Response** `200 OK`: File download (CSV or XLSX, matches input format)
**Response** `404 Not Found`: Job not found or result not available

### 2.3 Job Companies

```
GET /api/v1/jobs/:id/companies
```

**Query Parameters**: `limit`, `offset`, `enrichment_status`

**Response** `200 OK`:
```json
{
  "companies": [
    {
      "id": "uuid",
      "domain": "example.com",
      "company_name": "Example Inc",
      "cloud_provider_primary": "AWS",
      "tech_spend_tier": "TIER_1",
      "technology_count": 45,
      "enrichment_status": "SUCCESS"
    }
  ],
  "total": 50,
  "limit": 20,
  "offset": 0
}
```

### 2.4 Job Contacts

```
GET /api/v1/jobs/:id/contacts
```

**Query Parameters**: `limit`, `offset`, `persona_type`

**Response** `200 OK`:
```json
{
  "contacts": [
    {
      "id": "uuid",
      "full_name": "John Smith",
      "email": "john@example.com",
      "direct_phone": "+1-555-0100",
      "business_phone": "+1-555-0000",
      "job_title": "VP of Engineering",
      "persona_type": "ENGINEERING_LEADER",
      "seniority_level": "VP",
      "timezone_utc": "UTC-5",
      "timezone_label": "Eastern",
      "company_domain": "example.com",
      "company_name": "Example Inc"
    }
  ],
  "total": 92,
  "limit": 20,
  "offset": 0
}
```

---

## 3. Webhook Endpoints

### 3.1 Apollo.io Phone Webhook

```
POST /api/webhooks/apollo/phone-results
```

**Headers**:
- `X-Apollo-Webhook-Secret`: Shared secret for authentication

**Request Body** (from Apollo.io):
```json
{
  "request_id": "apollo-req-uuid",
  "person_id": "apollo-person-id",
  "phone_numbers": [
    {
      "type": "direct_dial",
      "number": "+1-555-0100",
      "status": "verified"
    },
    {
      "type": "hq",
      "number": "+1-555-0000",
      "status": "verified"
    }
  ]
}
```

**Response** `200 OK`:
```json
{ "received": true }
```

**Behavior**:
1. Validate `X-Apollo-Webhook-Secret` header
2. Return 200 immediately
3. Asynchronously: look up `pending_phone_lookups` by `request_id`
4. Update contact with phone numbers (filter out mobile type)
5. If all phone lookups for the parent job are complete, trigger job finalization

---

## 4. BullMQ Job Definitions

### 4.1 Queue: `enrichment`

**Job Types**:

#### `technographic-enrichment`
```typescript
interface TechnographicJobData {
  jobId: string;        // Database Job ID
  companies: Array<{
    rowIndex: number;
    domain?: string;
    companyName?: string;
  }>;
}
```

#### `contact-enrichment`
```typescript
interface ContactJobData {
  jobId: string;
  companies: Array<{
    jobCompanyId: string;
    domain: string;
    companyName?: string;
  }>;
  purpose: 'COLD_CALLING' | 'EMAILING' | 'JUST_A_LIST' | 'LINKEDIN';
}
```

#### `combined-enrichment`
```typescript
interface CombinedJobData {
  jobId: string;
  companies: Array<{
    rowIndex: number;
    domain?: string;
    companyName?: string;
  }>;
  purpose: 'COLD_CALLING' | 'EMAILING' | 'JUST_A_LIST' | 'LINKEDIN';
}
```

#### `tech-report`
```typescript
interface TechReportJobData {
  jobId: string;
  technology: string;
  filters: {
    country?: string;
    stateRegion?: string;
    companySize?: string;
    trafficLevel?: string;
  };
  useCachedResult?: string; // cache ID if using cached data
}
```

### 4.2 Queue: `phone-data`

#### `phones-ready`
```typescript
interface PhonesReadyData {
  jobId: string;  // Trigger job finalization
}
```

### 4.3 Queue: `file-generation`

#### `generate-result-file`
```typescript
interface FileGenerationData {
  jobId: string;
  outputFormat: 'CSV' | 'XLSX';
  channelId: string;
  threadTs: string;
}
```

---

## 5. AI Orchestrator Contracts

### 5.1 Intent Classification

**Tool Definition** (Claude Tool Use):
```json
{
  "name": "classify_intent",
  "description": "Classify the user's enrichment intent from their ENRICH message",
  "input_schema": {
    "type": "object",
    "properties": {
      "intent": {
        "type": "string",
        "enum": ["technographic", "contact", "combined", "tech_report", "unknown"]
      },
      "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
      "technology": { "type": "string", "description": "For tech_report: technology name" },
      "country": { "type": "string", "description": "For tech_report: country filter" },
      "additional_filters": { "type": "object" }
    },
    "required": ["intent", "confidence"]
  }
}
```

### 5.2 Persona Type Classification

**Tool Definition**:
```json
{
  "name": "classify_persona",
  "description": "Classify a job title into a persona type",
  "input_schema": {
    "type": "object",
    "properties": {
      "persona_type": {
        "type": "string",
        "enum": [
          "IT_LEADER", "ENGINEERING_LEADER", "FINANCE_LEADER",
          "SALES_LEADER", "FOUNDER_OWNER", "CEO",
          "OPERATIONS_LEADER", "HR_LEADER", "CUSTOMER_SUCCESS_LEADER",
          "MARKETING_LEADER", "PRODUCT_LEADER", "COMPLIANCE_LEADER",
          "RESEARCH_LEADER", "NON_LEADER"
        ]
      },
      "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
    },
    "required": ["persona_type", "confidence"]
  }
}
```

### 5.3 Batch Persona Classification

For efficiency, classify multiple titles in a single API call:
```json
{
  "name": "classify_personas_batch",
  "description": "Classify multiple job titles into persona types",
  "input_schema": {
    "type": "object",
    "properties": {
      "classifications": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "index": { "type": "integer" },
            "persona_type": { "type": "string" },
            "confidence": { "type": "number" }
          },
          "required": ["index", "persona_type", "confidence"]
        }
      }
    },
    "required": ["classifications"]
  }
}
```

---

## 6. External API Integration Contracts

### 6.1 BuiltWith Domain API

**Endpoint**: `GET https://api.builtwith.com/v22/api.json`
**Auth**: API key as query parameter
**Rate Limits**: Varies by plan (Pro: 50 req/min, Team: 100 req/min)

**Request**: `?KEY={api_key}&LOOKUP={domain}`
**Response fields used**: `Results[].Result.Paths[].Technologies[]` (Name, Tag, Categories, FirstDetected, LastDetected), `Meta.Quantcast`, `Meta.Majestic`

### 6.2 BuiltWith Lists API

**Endpoint**: `GET https://api.builtwith.com/lists4/api.json`
**Auth**: API key as query parameter

**Request**: `?KEY={api_key}&TECH={technology}&META={country_code}`
**Response**: List of domains using the specified technology in the specified region

### 6.3 BuiltWith Company to URL API

**Endpoint**: `GET https://api.builtwith.com/ctu2/api.json`
**Auth**: API key as query parameter
**Purpose**: Resolve company names to domains (FR-014)

**Request**: `?KEY={api_key}&COMPANY={company_name}`

### 6.4 Apollo.io People Search API

**Endpoint**: `POST https://api.apollo.io/v1/mixed_people/search`
**Auth**: API key in header
**Cost**: FREE (no credits consumed)

**Request Body**:
```json
{
  "q_organization_domains": ["example.com"],
  "person_seniorities": ["c_suite", "vp", "director", "manager"],
  "page": 1,
  "per_page": 2
}
```

### 6.5 Apollo.io People Enrichment API

**Endpoint**: `POST https://api.apollo.io/v1/people/match`
**Auth**: API key in header
**Cost**: 1 credit per enrichment

**Request Body**:
```json
{
  "email": "john@example.com",
  "reveal_phone_number": true,
  "webhook_url": "https://your-domain.com/api/webhooks/apollo/phone-results"
}
```

### 6.6 Apollo.io Bulk People Enrichment

**Endpoint**: `POST https://api.apollo.io/v1/people/bulk_match`
**Auth**: API key in header
**Cost**: 1 credit per person, max 10 per request

**Request Body**:
```json
{
  "details": [
    { "email": "john@example.com" },
    { "email": "jane@example.com" }
  ],
  "reveal_phone_number": true,
  "webhook_url": "https://your-domain.com/api/webhooks/apollo/phone-results"
}
```
