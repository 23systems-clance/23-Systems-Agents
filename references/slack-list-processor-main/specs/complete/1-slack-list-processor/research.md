# Research: Slack List Processor

**Feature Branch**: `1-slack-list-processor`
**Date**: 2026-03-04
**Status**: Complete

## 1. Slack Bot SDK & Connection Mode

### Decision: `@slack/bolt` v4.x with Socket Mode

**Rationale**: Bolt is the official Slack framework with first-class TypeScript support. Socket Mode eliminates the need for a public URL / ingress, uses outbound WebSocket connections, and auto-reconnects on disconnect.

**Alternatives Considered**:
- **HTTP Mode**: Requires public HTTPS endpoint, ALB, and certificate management. Better for horizontal scaling (unlimited connections) but adds infrastructure complexity. Recommended only if the bot exceeds 10 concurrent WebSocket connections or needs to serve >50 workspaces.
- **Raw `@slack/web-api` + `@slack/socket-mode`**: Lower-level, more boilerplate. Bolt wraps both and adds event/action routing.

**Key Packages**:
| Package | Version | Purpose |
|---------|---------|---------|
| `@slack/bolt` | ^4.6.0 | Main framework (includes web-api + socket-mode) |
| `@slack/web-api` | ^7.14.1 | Standalone Web API client (bundled in Bolt) |
| `@slack/types` | latest | Block Kit type definitions |

**Key Technical Notes**:
- **Socket Mode limit**: 10 concurrent WebSocket connections per app. Sufficient for single-workspace deployment.
- **Events needed**: `file_shared` (file upload detection), `message.channels`, `message.groups`, `app_mention`
- **OAuth Scopes**: `channels:history`, `groups:history`, `files:read`, `files:write`, `chat:write`, `im:history`
- **File uploads**: Use `files.uploadV2` (the original `files.upload` is deprecated)
- **Interactive UI**: Block Kit buttons for purpose selection (Cold Calling, Emailing, Just a List, LinkedIn)
- **Thread management**: Store `thread_ts` from initial `file_shared` event; pass to all subsequent `chat.postMessage` and `files.uploadV2` calls to keep conversation threaded

---

## 2. Job Queue System

### Decision: BullMQ + Redis

**Rationale**: BullMQ provides native progress tracking (`job.updateProgress()`), stall detection with heartbeats for long-running jobs (1-60 min), built-in retry with exponential backoff, granular concurrency control, and rate limiting. Active maintenance by Taskforce.sh team.

**Alternatives Considered**:
- **Agenda (MongoDB)**: Declining maintenance since 2023. Weaker stall handling for long-running jobs. Would require adding MongoDB/DocumentDB just for the queue. TypeScript support is second-class.
- **Custom PostgreSQL queue** (`FOR UPDATE SKIP LOCKED`): Would require 2-4 weeks to build what BullMQ provides out of the box. Lacks progress events, stall detection, rate limiting, prioritization, and repeatable jobs. Only advantage is no Redis dependency.

**Key Technical Notes**:
| Feature | BullMQ Capability |
|---------|-------------------|
| Progress tracking | Built-in `job.updateProgress()` with event emission |
| Retry with backoff | Built-in exponential/custom backoff strategies |
| Concurrency | Per-worker + global rate limiting |
| Stall detection | Automatic heartbeat with configurable interval |
| Job status events | completed, failed, progress, stalled, delayed |

**Package**: `bullmq` ^5.70.1
**Infrastructure**: Redis (AWS ElastiCache `cache.t3.micro` ~$12/mo or ElastiCache Serverless)

**Deployment**: ECS Fargate (NOT Lambda - Lambda has 15-min timeout, jobs can run up to 60 min). Workers run as ECS Fargate tasks with auto-scaling based on queue depth.

---

## 3. AI Orchestrator

### Decision: Claude 3.5 Haiku via Tool Use (primary)

**Rationale**: Classification tasks (intent detection, parameter extraction, persona mapping, tech spend estimation) are simple structured extraction problems. Claude 3.5 Haiku provides fast (~300ms) and cheap (~$0.0005/call) responses with guaranteed structured output via `tool_choice: { type: "tool", name: "..." }`. Single-provider simplicity for billing and API key management.

**Alternatives Considered**:
- **GPT-4o-mini**: Slightly cheaper ($0.15/1M input vs $0.80/1M). OpenAI Structured Outputs guarantees JSON schema conformance. Quality difference for classification is negligible. Valid budget alternative.
- **Claude 3.5 Sonnet / GPT-4o**: Overkill for classification tasks. 5-10x more expensive with no meaningful quality improvement for this use case.

**Package**: `@anthropic-ai/sdk` ^0.78.0

**Classification Tasks**:
1. **Intent classification**: "ENRICH get me tech stacks" -> `{ intent: "technographic" }`
2. **Parameter extraction**: "Find companies using OpenAI in the US" -> `{ technology: "OpenAI", country: "US" }`
3. **Persona type classification**: "VP of Engineering" -> `"Engineering Leader"`
4. **Technology spend estimation**: List of techs -> spend tier (hybrid: lookup table + LLM fallback)

**Cost Projections** (1,000 calls/day):
| Model | Daily Cost | Monthly Cost |
|-------|-----------|--------------|
| Claude 3.5 Haiku | ~$0.50 | ~$15 |
| GPT-4o-mini | ~$0.12 | ~$3.60 |

**Optimization**: For job title -> persona type classification, build a lookup table of ~200 common titles with fuzzy matching (fuse.js). Fall back to LLM only for unmatched titles. Reduces LLM calls by 80-90%.

---

## 4. Technology Spend Tier Classification

### Decision: Point-based scoring algorithm with lookup tables + traffic rank multiplier

**Rationale**: BuiltWith's own spend estimate is only available on Enterprise/Custom plans (not Pro/Team API). A custom scoring algorithm using category-weighted points, enterprise/free tech lookup tables, and traffic rank as a company size proxy provides a practical Tier 1/2/3 classification.

**Algorithm Overview**:
1. Parse BuiltWith API response -> extract `technologies[]` and `traffic_rank`
2. For each technology: classify as enterprise / paid / free using lookup tables
3. Score by category using weighted point values (CRM: 15pts enterprise, Marketing Automation: 15pts, etc.)
4. Add bonuses for category diversity (3/5/7+ paid categories) and enterprise technology density (1/3/5+ enterprise tools)
5. Apply traffic rank multiplier (1.0x to 2.5x based on Quantcast/Majestic rank)
6. Bucket: >= 120 = Tier 1, >= 50 = Tier 2, >= 1 = Tier 3, 0 = Unclassified

**Enterprise Technology Signals** (strong spend indicators):
- CRM: Salesforce, Microsoft Dynamics 365, SAP CRM, Oracle CRM
- Marketing Automation: Marketo, Pardot, Eloqua, HubSpot Enterprise
- Analytics: Adobe Analytics, Mixpanel, Amplitude, Heap
- CDN: Akamai, Fastly, Cloudflare Enterprise
- A/B Testing: Optimizely, Adobe Target, VWO
- Tag Management: Tealium, Ensighten, Adobe Launch

**Traffic Rank as Size Proxy**:
| Rank Range | Expected Tier |
|-----------|---------------|
| Top 1,000 | Tier 1 (2.5x multiplier) |
| 1,001 - 10,000 | Tier 1-2 (2.0x) |
| 10,001 - 100,000 | Tier 2 (1.5x) |
| 100,001 - 500,000 | Tier 2-3 (1.2x) |
| 500,000+ or no rank | Tier 3 (1.0x) |

**Limitations**:
- BuiltWith only sees web-facing technologies (backend tools like Jira, Confluence invisible)
- Cannot always distinguish paid vs free tiers of same product
- Enterprise technology lookup table needs quarterly maintenance
- Traffic rank may be missing for B2B companies with low web traffic

**Recommendation**: Run against 50-100 known companies to calibrate thresholds before production use.

---

## 5. Cloud Hosting Provider Extraction

### Decision: Keyword matching with weighted signal scoring from BuiltWith technology data

**Rationale**: BuiltWith categorizes hosting/infrastructure technologies under Hosting, CDN, Name Server, SSL Certificate, and Web Server categories. Cloud providers can be extracted by matching technology Name/Tag fields against provider-specific keyword lists with weighted signal scores (compute indicators weighted higher than storage).

**Provider Detection Keywords**:
- **AWS**: Amazon-EC2, Amazon-CloudFront, Amazon-S3, Amazon-ELB, Amazon-ALB, Amazon-Route-53, AWS-Lambda, Amazon-ECS, Amazon-RDS, AWS-WAF, etc.
- **Azure**: Azure-Websites, Azure-CDN, Azure-Front-Door, Azure-Application-Gateway, Azure-Blob-Storage, etc.
- **GCP**: Google-Cloud, Google-App-Engine, Firebase, Firebase-Hosting, Google-Cloud-Functions, Google-Cloud-Run, etc.
- **Oracle Cloud**: Oracle-Cloud, Oracle-Cloud-Infrastructure, Dyn
- **IBM Cloud**: IBM-Cloud, SoftLayer, IBM-Cloud-Internet-Services

**Signal Weights** (higher = stronger hosting indicator):
- Compute (10): Amazon-EC2, Azure-Websites, Google-App-Engine, Amazon-ECS
- Serverless (9): AWS-Lambda, Google-Cloud-Functions
- Load Balancer (8): Amazon-ELB, Amazon-ALB, Azure-Application-Gateway
- CDN (5): Amazon-CloudFront, Azure-CDN, Google-Cloud-CDN (can be multi-cloud)
- DNS (4): Amazon-Route-53, Azure-DNS
- Storage (3): Amazon-S3, Azure-Blob-Storage, Google-Cloud-Storage (often used alongside different primary host)

**Output Format**: Two columns:
- `Cloud Provider (Primary)`: Single value - AWS, Azure, GCP, Oracle Cloud, IBM Cloud, Other, Unknown
- `Cloud Providers (All)`: Comma-separated list of all detected providers

**Multi-Cloud Handling**: Primary provider = highest weighted signal score. If tied, prioritize by signal strength (compute > CDN > storage > DNS).

---

## 6. Apollo.io Webhook for Async Phone Delivery

### Decision: Integrated webhook route in main ECS service

**Rationale**: A separate webhook microservice adds deployment, networking, and service discovery complexity not justified for a single endpoint. An integrated route shares database access and BullMQ connection.

**Pattern**:
1. During enrichment, send phone request to Apollo with `webhook_url`
2. Store correlation record in `pending_phone_lookups` table (enrichment_job_id, apollo_request_id, status: pending)
3. Apollo POSTs to webhook endpoint when phones are ready
4. Webhook handler: validate signature, respond 200 immediately, then match by `apollo_request_id` and update phone data
5. When all phone lookups for a job are received, trigger a "phones-ready" BullMQ event to finalize the job

**Important Considerations**:
- **Idempotency**: Apollo may retry delivery. Check if `request_id` was already processed.
- **Timeout**: Set TTL on pending lookups (30 min). If no callback, mark as `timed_out` and continue without phone data.
- **Security**: Verify webhook authenticity via shared secret in headers.
- **Response time**: Return 200 immediately; process asynchronously. Apollo retries if handler takes >5 seconds.

---

## 7. File Parsing Libraries

### Decision: SheetJS (xlsx) for XLSX, csv-parse for CSV

**Packages**:
- `xlsx` (SheetJS): ^0.18.x - XLSX read/write, widely used
- `csv-parse`: ^5.5.x - Streaming CSV parser from the csv-parse ecosystem
- `exceljs`: ^4.4.x - Alternative XLSX library with better streaming support for large files

**Rationale**: SheetJS handles both read and write for XLSX with good performance. csv-parse provides a streaming parser for CSV files. For files approaching 5,000 rows, exceljs's streaming API may be preferred.

---

## 8. Infrastructure Cost Estimate (Monthly, Moderate Load)

| Component | Service | Estimated Cost |
|-----------|---------|---------------|
| Job Queue | ElastiCache Redis (cache.t3.micro) | ~$12 |
| Workers | ECS Fargate (1 vCPU, 2GB, always-on) | ~$35 |
| Load Balancer | ALB (for webhook endpoint) | ~$16 |
| AI Orchestrator | Claude 3.5 Haiku (1K calls/day) | ~$15 |
| Database | RDS PostgreSQL (db.t3.micro) or Supabase | ~$15-25 |
| **Total** | | **~$93-103/mo** |

Note: BuiltWith and Apollo.io API costs are separate (subscription-based, not infrastructure).
