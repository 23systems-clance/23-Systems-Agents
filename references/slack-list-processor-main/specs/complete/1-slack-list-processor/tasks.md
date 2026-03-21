# Tasks: Slack List Processor

**Input**: Design documents from `/specs/1-slack-list-processor/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api-contracts.md, quickstart.md

**Tests**: Unit tests for critical scoring/classification logic are included in Phase 8 (Polish).

**Organization**: Tasks grouped by user story. US5 (Export & Delivery) is folded into US1 since it is the delivery mechanism first needed there.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Project Initialization)

**Purpose**: Initialize the TypeScript project, install dependencies, configure tooling

- [x] T001 Initialize Node.js project with package.json, install production dependencies (@slack/bolt, bullmq, @anthropic-ai/sdk, xlsx, csv-parse, ioredis, @prisma/client, uuid, dotenv, express, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner) and dev dependencies (typescript, @types/node, @types/uuid, @types/express, prisma, tsx, vitest) per quickstart.md
- [x] T002 Create tsconfig.json with strict mode, ES2022 target, NodeNext module resolution, rootDir src/, outDir dist/ per quickstart.md
- [x] T003 [P] Create .env.example with all required environment variables (SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_SIGNING_SECRET, REDIS_URL, DATABASE_URL, BUILTWITH_API_KEY, APOLLO_API_KEY, APOLLO_WEBHOOK_SECRET, ANTHROPIC_API_KEY, NODE_ENV, LOG_LEVEL, WEBHOOK_BASE_URL, S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_ENDPOINT, API_KEY, BUILTWITH_COST_PER_CREDIT, APOLLO_COST_PER_CREDIT, AI_COST_PER_1K_INPUT_TOKENS, AI_COST_PER_1K_OUTPUT_TOKENS) per quickstart.md
- [x] T004 [P] Create .gitignore with node_modules, dist, .env, prisma/*.db entries
- [x] T005 [P] Create src/config/index.ts - environment config loader that reads all env vars with validation for required keys
- [x] T006 Create the full directory structure per plan.md: src/{listeners/events, listeners/actions, services/ai, services/builtwith, services/apollo, services/file, services/queue/workers, services/state, routes/webhooks, models, lib, data}, tests/{unit/services, unit/data, integration, contract}, prisma/

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**CRITICAL**: No user story work can begin until this phase is complete

- [x] T007 Create prisma/schema.prisma with all entities from data-model.md: Job, JobCompany, CompanyTechnology, JobContact, PendingPhoneLookup, TechReportCache, TechReportCacheEntry, ApiUsageLog, AuditLog with all enums (JobType, JobStatus, PersonaType, TechSpendTier, SourceFileType, ListPurpose, ApiService, EnrichmentStatus, ContactEnrichmentStatus, PhoneLookupStatus) and run initial migration
- [x] T008 Create src/models/index.ts - Prisma client singleton export with connection management and type re-exports for all entities
- [x] T009 [P] Create src/lib/redis.ts - IORedis connection factory using REDIS_URL from config, with reconnect strategy and error logging
- [x] T010 [P] Create src/lib/logger.ts - structured JSON logger (console-based for now) with log levels, job context injection (jobId, channelId), and timestamp formatting
- [x] T011 [P] Create src/lib/errors.ts - custom error classes: AppError (base), ValidationError, ApiError (with service name, status code), FileParsingError, SlackDeliveryError
- [x] T011a [P] Create src/lib/storage.ts - S3-compatible object storage client using @aws-sdk/client-s3. Provide uploadFile(key, buffer, contentType), downloadFile(key), getPresignedUrl(key, expiresIn) methods. Use S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_ENDPOINT from config. Support any S3-compatible provider (AWS S3, MinIO for local dev) per FR-020
- [x] T012 [P] Create src/server.ts - Express HTTP server factory for REST API routes and webhooks (required because Socket Mode does not expose HTTP endpoints). Export a createHttpServer(port) function that initializes Express with JSON body parsing, CORS, and mounts route modules from src/routes/. This runs alongside Bolt's Socket Mode connection. Add HTTP_PORT to src/config/index.ts (default 3000)
- [x] T013 Create src/services/queue/queues.ts - BullMQ queue definitions for 'enrichment', 'phone-data', 'file-generation' queues with Redis connection, default job options (attempts: 3, backoff: exponential), and TypeScript interfaces for all job data types per contracts
- [x] T014 Create src/services/state/conversationStore.ts - Redis-backed conversation state store with set/get/delete operations, TTL of 1 hour, keyed by channelId:threadTs, storing fileId, fileName, fileType, userId, status
- [x] T015 Create src/services/file/parser.ts - CSV and XLSX file parser that accepts a Buffer, detects format by MIME type, extracts rows as array of objects, identifies domain/company name columns (auto-detect or ask user), returns parsed data with column headers. Handle encoding detection (UTF-8, Latin-1, Windows-1252) and delimiter sniffing for CSV (comma, semicolon, tab). Basic row count check only (full tiered validation in T065)
- [x] T016 Create src/services/file/slackFile.ts - Slack file download (using Bearer token auth against url_private) and upload (using files.uploadV2 with channel_id and thread_ts) helper functions
- [x] T017 Create src/services/ai/orchestrator.ts - AI intent classifier using @anthropic-ai/sdk with Claude 3.5 Haiku, tool_choice forced to classify_intent tool, extracts intent (technographic/contact/combined/tech_report/unknown), confidence, and optional parameters (technology, country). Include system prompt and tool definition per contracts section 5.1
- [x] T018 Create src/listeners/events/fileShared.ts - Bolt file_shared event handler: validate file type (CSV/XLSX by mimetype), post Block Kit message in thread asking user to use ENRICH prefix, store pending file reference in conversationStore with fileId, channelId, threadTs, userId
- [x] T019 Create src/listeners/events/message.ts - Bolt message event handler: filter for messages starting with "ENRICH" (case-insensitive), look up pending file from conversationStore by threadTs, send instruction to AI orchestrator for classification, route to appropriate flow based on intent, handle edge case of "ENRICH" without pending file (check if tech report request, otherwise show usage instructions)
- [x] T020 Create src/app.ts - Bolt app initialization with Socket Mode AND a parallel Express HTTP server for REST API routes and webhooks (Socket Mode does not expose HTTP endpoints). Use createHttpServer from src/server.ts (T012) on a configurable HTTP_PORT (default 3000) to serve routes from src/routes/ (health, jobs, Apollo webhook). Register fileShared and message event listeners on Bolt, import action listeners (placeholder registrations for now), start BullMQ workers, start both Bolt (Socket Mode) and Express (HTTP) servers per quickstart.md

**Checkpoint**: Foundation ready - Slack bot connects, detects files, parses ENRICH messages, classifies intent. No enrichment processing yet.

---

## Phase 3: User Story 1 + User Story 5 - Technographic Enrichment & Delivery (Priority: P1) MVP

**Goal**: User uploads a CSV/XLSX of company domains, bot enriches with BuiltWith technographic data (including Cloud Hosting Provider and Technology Spend Tier columns), generates output file, and delivers back to Slack thread with summary statistics.

**Independent Test**: Upload a CSV with 5 company domains to Slack, reply with "ENRICH this list with tech stacks", verify enriched CSV is returned with technology columns, Cloud Hosting Provider column, and Technology Spend Tier column populated.

### Implementation

- [x] T021 [P] [US1] Create src/data/enterpriseTechs.ts - Set of ~100 enterprise technology names (Salesforce, Marketo, Pardot, Adobe Analytics, Akamai, Optimizely, Tealium, etc.) per research.md section 4
- [x] T022 [P] [US1] Create src/data/freeTechs.ts - Set of ~50 free/open-source technology names (Google Analytics, jQuery, Bootstrap, React, WordPress.org, Let's Encrypt, etc.) per research.md section 4
- [x] T023 [P] [US1] Create src/data/cloudProviderKeywords.ts - Cloud provider keyword mappings with signal weights (AWS keywords + weights, Azure keywords + weights, GCP keywords + weights, Oracle Cloud keywords, IBM Cloud keywords) per research.md section 5
- [x] T024 [US1] Create src/services/builtwith/client.ts - BuiltWith API client with API key auth, rate limiting (respect plan limits), retry with exponential backoff, request/response logging for ApiUsageLog, methods: lookupDomain(domain), resolveCompanyName(name), searchTechnology(tech, filters)
- [x] T025 [US1] Create src/services/builtwith/domainEnricher.ts - Takes a domain, calls BuiltWith Domain API (v22), parses response to extract technologies array (name, tag, categories, firstDetected, lastDetected), traffic rank (Quantcast/Majestic), returns structured enrichment result. Handle missing/error domains gracefully (FR edge case: include row with error status, not silently dropped)
- [x] T026 [US1] Create src/services/builtwith/cloudExtractor.ts - Takes BuiltWith technologies array, matches against cloudProviderKeywords with signal weights, returns { primaryProvider, allProviders } per research.md section 5. Handle no cloud provider detected -> "Unknown"
- [x] T027 [US1] Create src/services/builtwith/techSpendScorer.ts - Takes technologies array and traffic rank, classifies each tech as enterprise/paid/free using lookup tables, scores by category weights, adds diversity and density bonuses, applies traffic rank multiplier, buckets into TIER_1/TIER_2/TIER_3/UNCLASSIFIED per research.md section 4 algorithm
- [x] T028 [US1] Create src/services/builtwith/companyResolver.ts - Takes a company name, calls BuiltWith Company to URL API (ctu2), returns resolved domain or null. Used when uploaded list has company names instead of domains (FR-014)
- [x] T029 [US1] Create src/services/file/generator.ts - Result file generator that takes job data (companies with enrichment results, optionally contacts), produces CSV or XLSX buffer matching input format. For technographic output: include original columns + Technology Stack (comma-separated), Cloud Hosting Provider, Technology Spend Tier, Technology Count, Error Status columns. Include summary row or metadata sheet with processing statistics (FR-009)
- [x] T030 [US1] Create src/services/queue/workers/technographic.ts - BullMQ worker for 'technographic-enrichment' jobs: iterate companies, resolve company names to domains if needed (T028), enrich each via domainEnricher (T025), extract cloud provider (T026), score tech spend (T027), save CompanyTechnology records, update JobCompany records, update job progress via job.updateProgress(), handle API rate limits with backoff (FR-011), log API usage to ApiUsageLog
- [x] T031 [US1] Create src/services/queue/workers/fileGeneration.ts - BullMQ worker for 'generate-result-file' jobs: load job and all company/contact data from DB, generate output file via generator (T029), persist file to S3 via storage.ts (T011a), upload to Slack via slackFile.uploadV2 (T016) with summary message including stats (companies processed/failed, contacts found), update job status to COMPLETED with result_file_url (S3 key). If file exceeds Slack's 1 GB limit, post a pre-signed S3 download link (7-day expiry) instead of uploading to Slack
- [x] T032 [US1] Wire up the full technographic flow in src/listeners/events/message.ts: when AI orchestrator returns intent=technographic, create Job record (type=TECHNOGRAPHIC, status=PENDING), parse uploaded file, create JobCompany records for each row, acknowledge within 3 seconds (FR-010), enqueue 'technographic-enrichment' BullMQ job, on worker completion enqueue 'generate-result-file' job
- [x] T033 [US1] Add progress update mechanism: BullMQ QueueEvents listener that watches for progress events on enrichment queue and posts Slack thread updates (e.g., "Processing... 50/150 companies enriched") for long-running jobs (FR-010). When a new job is enqueued and the queue is not empty, notify the user of their queue position (e.g., "Your job is #3 in the queue") per edge case 7

**Checkpoint**: User Story 1 + 5 complete. Upload a CSV -> get back enriched CSV with tech stack, cloud provider, and tech spend tier columns. File delivered to Slack thread with summary.

---

## Phase 4: User Story 2 - Decision Maker Lookup (Priority: P1)

**Goal**: User uploads a company list, bot finds 2 decision makers per company using Apollo.io, classifies persona types, collects email + direct phone + business phone (no mobile), and delivers enriched contact list.

**Independent Test**: Upload a 10-company CSV, answer purpose prompt (Cold Calling), verify 2 contacts per company returned with email, direct phone, business phone, persona type classification.

### Implementation

- [x] T033a [P] [US2] Create src/data/timezoneMap.ts - Mapping of U.S. states to timezone UTC offsets and layman's labels: Eastern (UTC-5), Central (UTC-6), Mountain (UTC-7), Pacific (UTC-8), Alaska (UTC-9), Hawaii (UTC-10). Include all 50 states + DC + territories. For non-U.S. locations, map country/region to IANA timezone labels. Provide function getTimezone(state, country): { utcOffset: string, label: string }
- [x] T034 [P] [US2] Create src/data/personaLookup.ts - Lookup table mapping ~200 common job titles to persona types (e.g., "CTO" -> IT_LEADER, "VP Engineering" -> ENGINEERING_LEADER, "CFO" -> FINANCE_LEADER, "CEO" -> CEO, "Marketing Director" -> MARKETING_LEADER, etc.) with fuzzy matching support using normalized lowercase comparison. Include all 14 persona types per spec FR-006
- [x] T035 [P] [US2] Create src/services/ai/personaClassifier.ts - Hybrid persona classifier: first check personaLookup table (T034) with fuzzy matching, if no match found then call Claude 3.5 Haiku with classify_persona tool (per contracts section 5.2) or classify_personas_batch for multiple titles. Return PersonaType enum value. Default to NON_LEADER for unclassifiable titles (edge case)
- [x] T036 [US2] Create src/services/apollo/client.ts - Apollo.io API client with API key in header auth, rate limiting, retry with backoff, request/response logging for ApiUsageLog. Base URL, common headers, error handling for 4xx/5xx responses
- [x] T037 [US2] Create src/services/apollo/peopleSearch.ts - Free people search using POST /v1/mixed_people/search. Takes domain, returns up to 2 contacts prioritized by seniority (c_suite, vp, director, manager) per FR-004. Extract name, email, job title, seniority, LinkedIn URL. No credits consumed
- [x] T038 [US2] Create src/services/apollo/peopleEnrich.ts - People enrichment using POST /v1/people/match. Takes email, requests phone number reveal with webhook_url for async delivery. Creates PendingPhoneLookup record for correlation. Consumes 1 credit per call
- [x] T039 [US2] Create src/services/apollo/bulkEnrich.ts - Bulk enrichment using POST /v1/people/bulk_match. Takes up to 10 emails per request, requests phone reveal with webhook_url. Creates PendingPhoneLookup records for each. Consumes 1 credit per person
- [x] T040 [US2] Create src/routes/webhooks/apollo.ts - Apollo phone webhook handler (served by Express HTTP server from T012): validate X-Apollo-Webhook-Secret header, respond 200 immediately, look up PendingPhoneLookup by request_id, filter out mobile phone types (FR-005), update JobContact with direct_phone and business_phone, mark lookup as RECEIVED. Check if all lookups for job are complete -> enqueue 'phones-ready' job. Handle idempotency (skip if already RECEIVED)
- [x] T041 [US2] Create src/services/queue/workers/contact.ts - BullMQ worker for 'contact-enrichment' jobs: iterate companies, search for decision makers via peopleSearch (T037), create JobContact records with is_decision_maker flag (true for C-suite/VP/Director seniority, false otherwise), classify persona type via personaClassifier (T035), resolve contact timezone from Apollo location data using timezoneMap (T033a) and store timezone_utc + timezone_label on JobContact, bulk enrich contacts via bulkEnrich (T039) for phone numbers, update job status to AWAITING_PHONES, log API usage. If no phone requests pending, go directly to file generation
- [x] T042 [US2] Create phones-ready queue worker in src/services/queue/workers/phonesReady.ts - handles 'phones-ready' queue jobs: load all contacts for job, verify all phone data received, enqueue 'file-generation' job. Handle partial phone data (some timed out) gracefully
- [x] T043 [US2] Create src/listeners/actions/purposeSelection.ts - Bolt action handler for select_purpose_* buttons (Cold Calling, Emailing, Just a List, LinkedIn): acknowledge, update original message to show selection, store purpose in conversation state, proceed with job creation
- [x] T044 [US2] Wire up the full contact flow in src/listeners/events/message.ts: when AI orchestrator returns intent=contact, post purpose selection buttons (T043), on purpose selection create Job record (type=CONTACT, purpose from selection), parse file, create JobCompany records, acknowledge (FR-010), enqueue 'contact-enrichment' job
- [x] T045 [US2] Update src/services/file/generator.ts to handle contact output format: include original company columns + Contact 1 (Name, Email, Direct Phone, Business Phone, Title, Persona Type, Timezone UTC, Timezone Label) + Contact 2 (same fields) columns per company row. Ensure no mobile numbers in output (FR-005, SC-006). Timezone columns per FR-021

**Checkpoint**: User Story 2 complete. Upload CSV -> select purpose -> get back contact list with 2 decision makers per company, persona types, email + phones (no mobile).

---

## Phase 5: User Story 3 - Technology Report Generation (Priority: P2)

**Goal**: User types a natural language query like "ENRICH find companies using OpenAI in the US", bot asks filtering questions, checks cache, queries BuiltWith Lists API, delivers CSV of matching companies.

**Independent Test**: Type "ENRICH find companies using Shopify in the United States" in Slack, answer filter questions, verify CSV with domain, company name, location, and traffic rank returned.

### Implementation

- [x] T046 [P] [US3] Create src/services/builtwith/listsClient.ts - BuiltWith Lists API client (lists4 endpoint). Takes technology name and filters (country code, etc.), paginates through all results, returns array of company entries (domain, company name, location, traffic rank, technology detected). Log API usage
- [x] T047 [P] [US3] Create src/listeners/actions/reportFilters.ts - Bolt action handlers for tech report filter inputs: country selection (static_select), state/region (plain_text_input), company size (static_select with options: Any, 1-50, 51-200, 201-1000, 1001-10000, 10000+), traffic level (static_select with options: Any, Top 10K, Top 100K, Top 500K, All). Collect all filters, store in conversation state, trigger job creation
- [x] T048 [P] [US3] Create src/listeners/actions/cacheDecision.ts - Bolt action handler for cache_use / cache_fresh buttons. If cache_use: retrieve cached result file and deliver to Slack. If cache_fresh: proceed with fresh BuiltWith Lists API query
- [x] T049 [US3] Create src/services/queue/workers/techReport.ts - BullMQ worker for 'tech-report' jobs: if useCachedResult is set, load from TechReportCache and generate file; otherwise call listsClient (T046), save results to TechReportCache and TechReportCacheEntry records (compute query_hash from normalized filters per data-model.md), enqueue 'file-generation' job. Log API usage
- [x] T050 [US3] Wire up tech report flow in src/listeners/events/message.ts: when AI orchestrator returns intent=tech_report, extract technology and initial parameters, check TechReportCache for matching query_hash. If cached result found, present cache decision buttons (T048) with generation date. If no cache, post filter question blocks (T047). On filter submission, create Job (type=TECH_REPORT), enqueue 'tech-report' job
- [x] T051 [US3] Update src/services/file/generator.ts to handle tech report output format: CSV with Domain, Company Name, Country, State/Region, City, Traffic Rank, Technology Detected columns per US3 acceptance scenario 4
- [x] T052 [US3] Handle ambiguous tech report requests: when AI orchestrator returns intent=tech_report with low confidence or missing technology name, post a clarification message asking user to specify the technology (US3 acceptance scenario 5)

**Checkpoint**: User Story 3 complete. Type tech report query -> answer filters -> get CSV of matching companies. Cached results offered when available.

---

## Phase 6: User Story 4 - Contextual Questions & Metadata (Priority: P2)

**Goal**: When a user uploads a list, the system asks contextual follow-up questions (co-sell status, list owner, additional context) and stores metadata with the job and in the output file.

**Independent Test**: Upload a list, answer co-sell prompt (Yes -> AWS), provide list owner name, verify metadata appears in output file summary sheet.

### Implementation

- [x] T053 [P] [US4] Create src/listeners/actions/cosellCheck.ts - Bolt action handler for cosell_yes / cosell_no buttons. On yes: present cloud provider selection (T054). On no: set is_cosell=false, proceed to next question (list owner)
- [x] T054 [P] [US4] Create src/listeners/actions/cloudProvider.ts - Bolt action handler for select_cloud_provider_* buttons (AWS, Azure, GCP, Other). Store selected provider in conversation state
- [x] T055 [US4] Integrate contextual questions into the ENRICH flow in src/listeners/events/message.ts: after intent classification, before job creation, post co-sell question (T053), then ask "Who is the owner of this list and is there any additional details?" via plain text collection in thread. Store all metadata (purpose, is_cosell, cosell_provider, list_owner, additional_context) on the Job record
- [x] T056 [US4] Update src/services/file/generator.ts to include metadata in output: add a "Metadata" sheet (XLSX) or header rows (CSV) with Job ID, Purpose, Co-sell Status, Cloud Provider, List Owner, Additional Context, Processing Date, Companies Processed/Failed per US4 acceptance scenario 4

**Checkpoint**: User Story 4 complete. All list uploads now prompt for contextual metadata. Metadata stored on job and visible in output file.

---

## Phase 7: Combined Workflow (FR-017)

**Goal**: Single upload triggers both technographic enrichment (BuiltWith) and decision maker lookup (Apollo.io), producing one merged output file.

**Requires**: US1 and US2 both complete.

- [x] T057 [US1+US2] Create src/services/queue/workers/combined.ts - BullMQ worker for 'combined-enrichment' jobs: run technographic enrichment for all companies first (reuse domainEnricher, cloudExtractor, techSpendScorer logic), then run contact enrichment (reuse peopleSearch, bulkEnrich, personaClassifier logic), update progress throughout, handle phone webhooks via same AWAITING_PHONES flow, on completion enqueue file generation
- [x] T058 [US1+US2] Update src/services/file/generator.ts to handle combined output format: company columns + technology columns + Cloud Provider + Tech Spend Tier + Contact 1 fields (including Timezone UTC, Timezone Label) + Contact 2 fields (including Timezone UTC, Timezone Label) per company row, all in a single merged file
- [x] T059 [US1+US2] Wire up combined flow in src/listeners/events/message.ts: when AI orchestrator returns intent=combined, show purpose selection buttons, ask contextual questions, create Job (type=COMBINED), enqueue 'combined-enrichment' job

**Checkpoint**: Combined workflow complete. Single upload produces merged file with tech stack + contacts.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: API usage logging, job history, health check, edge cases, error handling, tests for critical logic

### API Usage Logging (FR-019)

- [x] T060 Create API usage logging utility in src/lib/apiUsageLogger.ts - helper function that creates ApiUsageLog records with service, endpoint, credits_consumed, tokens_input/output, estimated_cost_usd, duration_ms. Integrate into BuiltWith client (T024), Apollo client (T036), and AI orchestrator (T017)

### Audit Logging (Constitution Principle V - SOC 2)

- [x] T061 Create src/lib/auditLogger.ts - structured audit logging for all user-facing Slack interactions. Log: user action (file_upload, enrich_request, button_click, job_download), actor (slack_user_id, slack_team_id), target entity (job_id, file_id), timestamp, channel_id, and action-specific metadata. Store as AuditLog records in PostgreSQL (add AuditLog entity to Prisma schema). Integrate into event listeners (T018, T019) and action handlers

### Job History & Search (FR-016)

- [x] T062 Create src/routes/jobs.ts - REST API endpoints (served by Express HTTP server from T012, protected by apiAuth middleware from T064a): GET /api/v1/jobs (list with filters: status, job_type, slack_user_id, channel_id, pagination), GET /api/v1/jobs/:id (detail with api_usage aggregation), GET /api/v1/jobs/:id/result (serve file from S3 via pre-signed URL redirect) per contracts section 2.2-2.4
- [x] T063 Add Slack command handler for job history search: user can type "ENRICH history" or "ENRICH jobs" to get a list of recent jobs with status and re-download links (FR-016)

### REST API Authentication (Constitution Principle III)

- [x] T064a Create src/lib/apiAuth.ts - Express middleware that validates `X-API-Key` header against API_KEY environment variable. Return 401 for missing/invalid key. Apply to all `/api/v1/*` routes. Health check endpoint is exempt (no auth required)

### Health Check

- [x] T064 [P] Create src/routes/health.ts - GET /api/v1/health endpoint (served by Express HTTP server from T012) returning status, version, uptime, redis_connected, database_connected, slack_connected per contracts section 2.1

### Row Limit Enforcement (FR-015)

- [x] T065 Update src/services/file/parser.ts to add tiered row limit enforcement: reject files > 5,000 rows with error message (suggest splitting), warn for 1,001-5,000 rows (will take longer), standard processing for <= 1,000 rows

### Phone Lookup Timeout (data-model.md PendingPhoneLookup)

- [x] T066 Create a repeatable BullMQ job (scheduled every 5 min) that scans PendingPhoneLookup for records where status=PENDING and expires_at < now(), marks them as TIMED_OUT, and checks if all lookups for the parent job are resolved (all RECEIVED or TIMED_OUT). If so, enqueue 'phones-ready' job to finalize with available data

### Edge Cases & Error Handling

- [x] T067 [P] Handle no recognizable domain column: when file parser cannot auto-detect domain/company column, post a Slack message asking user to identify which column contains domains (edge case 1)
- [x] T068 [P] Handle API downtime: when BuiltWith or Apollo returns 5xx or connection timeout, queue the job with delay and notify user of the delay (edge case 2). Implement circuit breaker pattern in API clients
- [x] T069 [P] Handle file without ENRICH reply: ensure conversation state TTL (1 hour) causes pending file references to expire silently (edge case 10). No action taken by bot
- [x] T070 Handle "ENRICH" without file context: in message.ts, when no pending file found and intent is not tech_report, respond with usage instructions explaining how to use the bot (edge case 11)

### Unit Tests for Critical Logic

- [x] T071 [P] Create tests/unit/services/techSpendScorer.test.ts - test tier scoring with known company profiles: enterprise (Tier 1), mid-market (Tier 2), small business (Tier 3), empty/no techs (Unclassified), test traffic rank multipliers
- [x] T072 [P] Create tests/unit/services/cloudExtractor.test.ts - test cloud provider extraction: AWS-dominant, Azure-dominant, multi-cloud, no cloud provider (Unknown), test signal weight priority
- [x] T073 [P] Create tests/unit/services/personaClassifier.test.ts - test persona classification: exact title matches from lookup table, fuzzy matches, LLM fallback for unknown titles, NON_LEADER default
- [x] T074 [P] Create tests/unit/services/fileParser.test.ts - test CSV and XLSX parsing, auto-detection of domain/company columns, row count validation (reject > 5000, warn > 1000)

### Performance Validation (Success Criteria)

- [x] T075a [P] Create tests/integration/performance.test.ts - Smoke test validating SC-001: upload a 100-company CSV and assert enriched file is returned within 5 minutes (use test timeout). Validate SC-005: submit 10 jobs concurrently and assert all complete without cross-contamination (check each result file matches its input)
- [x] T075b [P] Create tests/integration/fileParser.test.ts - Test CSV encoding edge cases: UTF-8 BOM, Latin-1, Windows-1252 encoded files; semicolon and tab delimiters; mixed line endings (CRLF/LF)

### Quickstart Validation

- [x] T075 Run full quickstart.md verification: start Redis, start S3-compatible storage (MinIO for local dev), run migrations, start app (both Bolt Socket Mode + Express HTTP), invite bot to channel, upload test CSV, verify end-to-end flow per quickstart.md section 7

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 completion - BLOCKS all user stories
- **US1+US5 (Phase 3)**: Depends on Phase 2 - first MVP deliverable
- **US2 (Phase 4)**: Depends on Phase 2 - can run in parallel with Phase 3
- **US3 (Phase 5)**: Depends on Phase 2 - can run in parallel with Phases 3-4
- **US4 (Phase 6)**: Depends on Phase 2 - can run in parallel with Phases 3-5
- **Combined (Phase 7)**: Depends on Phase 3 AND Phase 4 completion (needs both BuiltWith and Apollo enrichment working)
- **Polish (Phase 8)**: Can start partially after Phase 2, full completion after all stories done

### User Story Dependencies

```
Phase 1 (Setup) ──> Phase 2 (Foundational) ──┬──> Phase 3 (US1+US5) ──┐
                                              ├──> Phase 4 (US2) ──────┤──> Phase 7 (Combined)
                                              ├──> Phase 5 (US3)       │
                                              └──> Phase 6 (US4)       └──> Phase 8 (Polish)
```

- **US1 (P1)**: Independent after Foundational. First story to implement.
- **US2 (P1)**: Independent after Foundational. Can run parallel with US1.
- **US3 (P2)**: Independent after Foundational. Can run parallel with US1/US2.
- **US4 (P2)**: Independent after Foundational. Enhances all other stories but not blocking.
- **Combined (FR-017)**: Requires US1 AND US2 both complete.

### Within Each User Story

- Data lookup tables before services that use them
- API clients before enrichment services
- Enrichment services before queue workers
- Queue workers before flow wiring in listeners
- File generator updates after worker completion logic

### Parallel Opportunities per Phase

**Phase 1**: T003, T004, T005 all parallel
**Phase 2**: T009, T010, T011, T012 parallel; T015, T016 parallel after T009
**Phase 3**: T021, T022, T023 parallel (data files); T025-T028 sequential (depend on client)
**Phase 4**: T034, T035 parallel; T037-T039 sequential after T036
**Phase 5**: T046, T047, T048 parallel
**Phase 6**: T053, T054 parallel
**Phase 8**: T064, T067-T074 mostly parallel

---

## Implementation Strategy

### MVP First (Phase 1 + 2 + 3 = User Story 1 + 5)

1. Complete Phase 1: Setup (~6 tasks)
2. Complete Phase 2: Foundational (~14 tasks)
3. Complete Phase 3: US1+US5 (~13 tasks)
4. **STOP and VALIDATE**: Upload a CSV with 5 domains, verify enriched file returned with Cloud Provider and Tech Spend columns
5. Deploy/demo if ready - this is the core value proposition

### Incremental Delivery

1. **MVP**: Setup + Foundational + US1/US5 = Technographic enrichment working end-to-end
2. **+US2**: Add decision maker lookup = Both core workflows operational
3. **+Combined**: Merge US1+US2 into single workflow = Full enrichment pipeline
4. **+US3**: Add tech reports = Prospecting capability added
5. **+US4**: Add metadata questions = Organizational context for every job
6. **+Polish**: API logging, tests, edge cases = Production-ready

### Task Count Summary

| Phase | Story | Tasks | Parallel Tasks |
|-------|-------|-------|----------------|
| Phase 1: Setup | - | 6 | 3 |
| Phase 2: Foundational | - | 15 | 7 |
| Phase 3: US1+US5 | US1, US5 | 13 | 3 |
| Phase 4: US2 | US2 | 13 | 3 |
| Phase 5: US3 | US3 | 7 | 3 |
| Phase 6: US4 | US4 | 4 | 2 |
| Phase 7: Combined | US1+US2 | 3 | 0 |
| Phase 8: Polish | - | 20 | 11 |
| **Total** | | **81** | **32** |
