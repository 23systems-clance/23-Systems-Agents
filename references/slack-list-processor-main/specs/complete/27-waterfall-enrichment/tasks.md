# Implementation Tasks: Multi-Provider Waterfall Enrichment

**Feature**: 27-waterfall-enrichment
**Branch**: `27-waterfall-enrichment`
**Date**: 2026-03-14

## Overview

Implementation tasks organized by user story priority. Each user story represents an independently testable increment that delivers value. Complete stories in order, but tasks within each story can often run in parallel.

**MVP Scope**: User Story 1 only (Email Enrichment)
**Full Feature**: Complete all 5 user stories

---

## Task Summary

| Phase | User Story | Task Count | Parallel Opportunities |
|-------|------------|------------|------------------------|
| 1 | Setup | 5 | 2 |
| 2 | Foundational | 8 | 5 |
| 3 | US1: Email Enrichment (P1) | 12 | 8 |
| 4 | US3: Combined Email+Phone (P1) | 10 | 6 |
| 5 | US2: Mobile Phone Only (P2) | 4 | 2 |
| 6 | US4: Cost Tracking (P2) | 6 | 4 |
| 7 | US5: Slack UI Updates (P3) | 5 | 3 |
| 8 | Polish | 9 | 7 |
| **Total** | | **59** | **37** |

---

## Implementation Strategy

### MVP Delivery (User Story 1 Only)

**Goal**: Ship basic email enrichment with multi-provider fallback

**Scope**:
- Phase 1: Setup (tasks T001-T004a) - 5 tasks
- Phase 2: Foundational (tasks T005-T012) - 8 tasks
- Phase 3: User Story 1 (tasks T013-T024) - 12 tasks

**Total MVP Tasks**: 25

**Deliverable**: Users can upload contact lists and get emails via Apollo → Wiza → AI Ark waterfall

**Est. Time**: 2-3 days
**Independent Test**: Upload contacts without emails, verify enrichment via multiple providers, confirm provider attribution

---

### Incremental Delivery

**After MVP** (US1), ship in this order:

1. **US3: Combined Email+Phone** (P1) - Most comprehensive feature, highest user value
2. **US2: Phone-Only** (P2) - Subset of US3, easier after US3 is complete
3. **US4: Cost Tracking** (P2) - Builds on existing provider tracking
4. **US5: Slack UI** (P3) - Polish layer, non-blocking

Each story is independently testable and deployable.

---

## Dependencies

### Story Completion Order

```
Setup (Phase 1)
  ↓
Foundational (Phase 2)
  ↓
┌─────────────────────────────────────┐
│ US1: Email Enrichment (P1)          │ ← MVP
└──────────────┬──────────────────────┘
               ↓
┌──────────────────────────────────────┐
│ US3: Combined Email+Phone (P1)       │
└──────────────┬───────────────────────┘
               ↓
       ┌───────┴────────┐
       ↓                ↓
┌────────────────┐  ┌─────────────────────┐
│ US2: Phone     │  │ US4: Cost Tracking  │
│ Only (P2)      │  │ (P2)                │
└───────┬────────┘  └──────┬──────────────┘
       └────────┬───────────┘
                ↓
        ┌──────────────────┐
        │ US5: Slack UI    │
        │ (P3)             │
        └──────┬───────────┘
               ↓
        ┌──────────────────┐
        │ Polish & Deploy  │
        └──────────────────┘
```

**Notes**:
- US1 must complete before US3 (US3 extends US1)
- US2 and US4 can run in parallel after US3
- US5 requires US3 complete (updates UI for combined flow)
- Each story is independently testable at completion

---

## Phase 1: Setup

**Goal**: Initialize database schema and environment configuration

**Parallel Execution**: Tasks T002 and T003 can run in parallel

### Tasks

- [x] T001 Create Prisma migration for waterfall enrichment schema in prisma/migrations/
- [x] T013 [US1] Implement email waterfall in src/services/enrichment/emailWaterfall.ts
  - Create tables: ProviderAttempt, ProviderWebhook, ProviderCost
  - Extend Job: Add enrichmentMode, providersUsed[], totalCost
  - Extend JobContact: Add emailSource, emailCost, phoneSource, phoneCost, enrichmentAttempts
  - Reference: specs/27-waterfall-enrichment/data-model.md migration SQL

- [x] T002 [P] Create ProviderCost seed script in scripts/seed-provider-pricing.ts
- [x] T014 [P] [US1] Implement Apollo email enrichment in src/services/apollo/emailEnrichment.ts
  - Insert Wiza email pricing: $0.05/email (2 credits)
  - Insert Wiza phone pricing: $0.125/phone (5 credits)
  - Insert AI Ark email pricing: $0.14/email (estimate)
  - Insert AI Ark phone pricing: $0.27/phone (estimate)
  - Reference: specs/27-waterfall-enrichment/research.md Section 1 & 2
- [x] T015 [P] [US1] Implement Wiza email enrichment in src/services/wiza/emailEnrichment.ts
- [x] T003 [P] Update .env.example with provider API keys
  - Add WIZA_API_KEY (Bearer token)
  - Add AI_ARK_API_KEY (X-TOKEN header)
  - Add WIZA_WEBHOOK_SECRET
  - Add AI_ARK_WEBHOOK_SECRET
  - Add MAX_CONTACTS_PER_JOB=2000
- [x] T016 [P] [US1] Implement AI Ark email enrichment in src/services/aiark/emailEnrichment.ts

- [ ] T004 Apply migration and run seed script via ECS task
  - Run: npx prisma migrate deploy
  - Run: npx ts-node scripts/seed-provider-pricing.ts
  - Verify tables created in RDS
  - Reference: specs/27-waterfall-enrichment/quickstart.md Database Setup section

- [x] T004a Add contact limit enforcement in src/services/enrichment/contactLimitValidator.ts
  - Validate contact count ≤ MAX_CONTACTS_PER_JOB (2000)
  - Reject jobs exceeding limit with clear error message
  - Log limit violations
  - Reference: spec.md FR-025

- [x] T018 [P] [US1] Create email enrichment worker in src/services/queue/workers/emailEnrichment.ts

## Phase 2: Foundational (Blocking Prerequisites)

**Goal**: Shared infrastructure needed by all user stories

**Parallel Execution**: T005-T009 can run in parallel (different files)

- [x] T019 [P] [US1] Implement skip existing data logic in src/services/enrichment/skipExistingData.ts

- [x] T005 [P] Create provider configuration contract in src/config/providers.ts
  - Define ProviderConfig interface (name, capabilities, auth, endpoints, pricing, waterfall priority)
  - Export apolloConfig, wizaConfig, aiArkConfig
  - Load from environment variables
- [x] T020 [P] [US1] Add provider breakdown notification in src/services/slack/enrichmentNotifications.ts

- [x] T006 [P] Create Wiza API client in src/services/wiza/client.ts
  - Implement individualReveal(contact, enrichmentLevel, callbackUrl)
  - Implement getReveal(revealId)
  - Add Bearer token authentication
  - Add rate limit handling (15 req/s)
  - Reference: specs/27-waterfall-enrichment/research.md Section 1 (Wiza API)

- [x] T007 [P] Create AI Ark API client in src/services/aiark/client.ts
  - Implement mobilePhoneFinder(contact, type)
  - Implement fetchCredits()
  - Add X-TOKEN header authentication
  - Add rate limit handling (5 req/s)
  - Reference: specs/27-waterfall-enrichment/research.md Section 2 (AI Ark API)

- [x] T008 [P] Create provider registry in src/services/enrichment/providerRegistry.ts
  - Implement getProvidersByPriority(dataType: 'email' | 'phone')
  - Implement getProviderConfig(provider: Provider)
  - Implement validateProvider(provider: Provider, dataType: DataType)
  - Reference: specs/27-waterfall-enrichment/contracts/providers.yaml waterfalls section

- [x] T009 [P] Create cost calculator in src/services/enrichment/costCalculator.ts
  - Implement calculateCost(provider: Provider, dataType: DataType, count: number)
  - Implement getCostBreakdown(jobId: string)
  - Query ProviderCost table for current pricing
  - Reference: specs/27-waterfall-enrichment/data-model.md ProviderCost entity

- [x] T010 Create ProviderAttempt types in src/types/providers.ts
  - Define ProviderAttemptInput, ProviderAttemptResult
  - Define WaterfallResult, ProviderResponse
  - Export type guards for provider responses
  - Reference: specs/27-waterfall-enrichment/data-model.md ProviderAttempt schema

- [x] T011 Create enrichment cache utilities in src/services/enrichment/cache.ts
  - Implement cacheEmailResult(contact, email, provider, cost)
  - Implement cachePhoneResult(contact, phone, provider, cost)
  - Implement getCachedEmail(contact)
  - Implement getCachedPhone(contact)
  - Use Redis with 30-day TTL
  - Reference: specs/27-waterfall-enrichment/data-model.md Cache Schema section

- [x] T012 Create waterfall orchestrator base in src/services/enrichment/waterfall.ts
  - Implement enrichWithWaterfall(contacts, dataType, providers)
  - Implement recordProviderAttempt(contact, provider, dataType, result)
  - Implement skipExistingData(contacts, dataType)
  - Reference: specs/27-waterfall-enrichment/research.md Section 4 (Waterfall Orchestration)

---

## Phase 3: User Story 1 - Email Enrichment with Multi-Provider Fallback (P1)

**Goal**: Enable email enrichment using Apollo → Wiza → AI Ark waterfall

**Independent Test**: Upload contact list without emails, verify emails enriched via multiple providers, confirm provider attribution

**Parallel Execution**: T014-T021 can run in parallel (different services/files)

### Tasks

- [x] T013 [US1] Implement email waterfall in src/services/enrichment/emailWaterfall.ts
  - Implement enrichEmail(contact): string | null
  - Try Apollo first, then Wiza, then AI Ark
  - Stop on first success, skip if cached
  - Return email and provider source
  - Reference: spec.md US1 Acceptance Scenario 1

- [x] T014 [P] [US1] Implement Apollo email enrichment in src/services/apollo/emailEnrichment.ts
  - Extend existing bulkMatch to support waterfall mode
  - Return standardized ProviderResponse
  - Track attempt in ProviderAttempt table
  - Reference: research.md Section 1 (Apollo API existing)

- [x] T015 [P] [US1] Implement Wiza email enrichment in src/services/wiza/emailEnrichment.ts
  - Call client.individualReveal with enrichmentLevel: 'partial'
  - Poll for results or wait for webhook
  - Track attempt in ProviderAttempt table
  - Return standardized ProviderResponse
  - Reference: research.md Section 1 (Wiza API - Email Enrichment)

- [x] T016 [P] [US1] Implement AI Ark email enrichment in src/services/aiark/emailEnrichment.ts
  - Call client.exportEmail for batch
  - Wait for webhook or poll results
  - Track attempt in ProviderAttempt table
  - Return standardized ProviderResponse
  - Reference: research.md Section 2 (AI Ark API - Email Enrichment)

- [ ] T017 [P] [US1] Update JobContact model in src/models/index.ts
  - Add emailSource field (Provider enum)
  - Add emailCost field (Float)
  - Add enrichmentAttempts counter
  - Reference: data-model.md JobContact extensions

- [ ] T018 [P] [US1] Create email enrichment worker in src/services/queue/workers/emailEnrichment.ts
  - Listen on 'email-enrichment' queue
  - Process contacts in batches
  - Call enrichEmail for each contact
  - Update JobContact with results
  - Track progress
  - Reference: plan.md BullMQ Workers section

- [ ] T019 [P] [US1] Implement skip existing data logic in src/services/enrichment/skipExistingData.ts
  - Filter contacts WHERE email IS NULL
  - Skip contacts with valid existing emails
  - Log skipped count
  - Reference: spec.md FR-026

- [ ] T020 [P] [US1] Add provider breakdown notification in src/services/slack/enrichmentNotifications.ts
  - Format message: "60 via Apollo, 25 via Wiza, 10 via AI Ark, 5 not found"
  - Post to Slack thread on completion
  - Reference: spec.md US1 Acceptance Scenario 2

- [ ] T021 [P] [US1] Update file generation to include provider sources in src/services/queue/workers/fileGeneration.ts
  - Add "Email Source" column to output CSV/XLSX
  - Show provider name (Apollo, Wiza, AI Ark) for each contact
  - Reference: spec.md US1 Independent Test

- [ ] T022 [US1] Update enrichment data selection to support "Email Only" mode in src/listeners/actions/enrichmentDataSelection.ts
  - Map 'email' enrichDataType → EnrichmentMode.EMAIL_ONLY
  - Set job.enrichmentMode = EMAIL_ONLY
  - Enqueue email-enrichment job
  - Reference: spec.md US1 flow

- [ ] T023 [US1] Integrate email waterfall into contact enrichment flow in src/services/queue/workers/contact.ts
  - Check if enrichmentMode === EMAIL_ONLY
  - Call emailWaterfall.enrichEmail for each contact
  - Update job status to COMPLETED when done
  - Reference: plan.md Phase 3 workflow

- [ ] T024 [US1] Deploy and test US1 on ECS
  - Push to branch
  - Verify GitHub Actions deploy
  - Test: Upload contacts, select "Email Only", verify waterfall
  - Verify provider breakdown in Slack
  - Reference: quickstart.md Testing Section 1

---

## Phase 4: User Story 3 - Combined Enrichment (Email + Phone) (P1)

**Goal**: Enable "All" mode with emails immediate, phones async

**Independent Test**: Select "All", verify emails in 2-3 mins, phones 5-20 mins later with provider breakdown

**Parallel Execution**: T026-T031 can run in parallel

### Tasks

- [ ] T025 [US3] Create phone waterfall in src/services/enrichment/phoneWaterfall.ts
  - Implement enrichPhone(contact): Promise<string | null>
  - Try Wiza first, then AI Ark
  - Support async webhook delivery
  - Return phone and provider source
  - Reference: spec.md US3 Acceptance Scenario 1

- [ ] T026 [P] [US3] Implement Wiza phone enrichment in src/services/wiza/phoneEnrichment.ts
  - Call client.individualReveal with enrichmentLevel: 'phone' or 'full'
  - Register webhook callback URL
  - Track attempt with requestId in ProviderAttempt
  - Reference: research.md Section 1 (Wiza API - Phone Enrichment)

- [ ] T027 [P] [US3] Implement AI Ark phone enrichment in src/services/aiark/phoneEnrichment.ts
  - Call client.mobilePhoneFinder with type: 'mobile'
  - Register webhook callback URL
  - Track attempt with requestId in ProviderAttempt
  - Reference: research.md Section 2 (AI Ark API - Mobile Phone Finder)

- [ ] T028 [P] [US3] Create Wiza webhook handler in src/routes/webhooks/wiza.ts
  - POST /api/webhooks/wiza/enrichment-results
  - Verify SHA256 signature (x-auth-key header)
  - Parse Wiza payload format
  - Create ProviderWebhook record
  - Enqueue webhook processing job
  - Reference: contracts/webhooks.yaml Wiza endpoint

- [ ] T029 [P] [US3] Create AI Ark webhook handler in src/routes/webhooks/aiark.ts
  - POST /api/webhooks/aiark/enrichment-results
  - Verify HMAC-SHA256 signature (x-webhook-signature header)
  - Parse AI Ark payload format
  - Create ProviderWebhook record
  - Enqueue webhook processing job
  - Reference: contracts/webhooks.yaml AI Ark endpoint

- [ ] T030 [P] [US3] Create webhook processor worker in src/services/queue/workers/webhookProcessor.ts
  - Listen on 'webhook-processing' queue
  - Correlate webhook to ProviderAttempt via requestId
  - Update JobContact with phone data
  - Mark ProviderWebhook as PROCESSED
  - Trigger file regeneration
  - Reference: data-model.md ProviderWebhook lifecycle

- [ ] T031 [P] [US3] Update JobContact model for phone sources in src/models/index.ts
  - Add phoneSource field (Provider enum)
  - Add phoneCost field (Float)
  - Update enrichmentAttempts counter
  - Reference: data-model.md JobContact extensions

- [ ] T032 [US3] Implement combined enrichment mode in src/services/queue/workers/combinedEnrichment.ts
  - Run email waterfall synchronously
  - Run phone waterfall asynchronously
  - Set job status to AWAITING_PHONES after emails complete
  - Generate initial file with emails, empty phone columns
  - Reference: spec.md US3 Acceptance Scenario 2

- [ ] T033 [US3] Update file generation for in-place replacement in src/services/queue/workers/fileGeneration.ts
  - Support file replacement (same S3 key)
  - Add "Phone Source" column
  - Regenerate when phone data arrives
  - Reference: spec.md FR-008

- [ ] T034 [US3] Deploy and test US3 on ECS
  - Test: Select "All", verify emails immediate, phones async
  - Verify webhook delivery from Wiza and AI Ark
  - Verify file regeneration with phones
  - Reference: quickstart.md Testing Section 2

---

## Phase 5: User Story 2 - Mobile Phone Enrichment (P2)

**Goal**: Enable "Mobile Number" only mode

**Independent Test**: Select "Mobile Number", verify phone enrichment via Wiza → AI Ark

**Parallel Execution**: T035 and T036 can run in parallel

### Tasks

- [ ] T035 [P] [US2] Implement phone-only enrichment mode in src/services/queue/workers/phoneOnlyEnrichment.ts
  - Skip email waterfall
  - Run phone waterfall only (Wiza → AI Ark)
  - Set job status to AWAITING_PHONES
  - Reference: spec.md US2 Acceptance Scenario 1

- [ ] T036 [P] [US2] Update enrichment data selection for "Mobile Number" mode in src/listeners/actions/enrichmentDataSelection.ts
  - Map 'mobile' enrichDataType → EnrichmentMode.PHONE_ONLY
  - Set job.enrichmentMode = PHONE_ONLY
  - Enqueue phone-only-enrichment job
  - Reference: spec.md US2 flow

- [ ] T037 [US2] Add phone-only notification in src/services/slack/enrichmentNotifications.ts
  - Message: "Phone enrichment started (5-15 minutes)"
  - Update when phones arrive: "40 via Wiza, 15 via AI Ark"
  - Reference: spec.md US2 Acceptance Scenario 4

- [ ] T038 [US2] Deploy and test US2 on ECS
  - Test: Select "Mobile Number" only
  - Verify phones from Wiza and AI Ark
  - Verify no email enrichment occurs
  - Reference: quickstart.md Testing

---

## Phase 6: User Story 4 - Cost Tracking and Reporting (P2)

**Goal**: Display accurate cost breakdowns per provider

**Independent Test**: Verify cost report shows itemized breakdown by provider and data type

**Parallel Execution**: T039-T042 can run in parallel

### Tasks

- [ ] T039 [P] [US4] Implement cost aggregation in src/services/enrichment/costAggregator.ts
  - Query ProviderAttempt table grouped by provider and dataType
  - Calculate subtotals per provider
  - Calculate grand total
  - Format cost breakdown
  - Reference: spec.md US4 Acceptance Scenario 1

- [ ] T040 [P] [US4] Add cost breakdown to Slack notification in src/services/slack/costNotifications.ts
  - Format: "Emails: Apollo (60 @ $0.05), Wiza (25 @ $0.05) | Phones: Wiza (40 @ $0.125) | Total: $14.75"
  - Post after job completion
  - Reference: spec.md US4 Acceptance Scenario 1

- [ ] T041 [P] [US4] Update Job model with totalCost in src/models/index.ts
  - Calculate totalCost from ProviderAttempt records
  - Store on job completion
  - Reference: data-model.md Job extensions

- [ ] T042 [P] [US4] Create cost validation logic in src/services/enrichment/costValidator.ts
  - Ensure no double charging (FR-003)
  - Validate cost calculations
  - Log discrepancies
  - Reference: spec.md US4 Acceptance Scenario 2

- [ ] T043 [US4] Add cost breakdown to file generation in src/services/queue/workers/fileGeneration.ts
  - Add "Email Cost" and "Phone Cost" columns
  - Show per-contact costs
  - Reference: spec.md US4 Independent Test

- [ ] T044 [US4] Deploy and test US4 on ECS
  - Verify cost breakdown in Slack
  - Verify no double charging
  - Verify totals match itemized costs
  - Reference: quickstart.md Testing Section 3

---

## Phase 7: User Story 5 - Slack Workflow Integration (P3)

**Goal**: Update Slack UI with real-time provider status

**Independent Test**: Verify UI shows "Trying Apollo... ✓ Found 60 | Trying Wiza... ✓ Found 25"

**Parallel Execution**: T045-T047 can run in parallel

### Tasks

- [ ] T045 [P] [US5] Create provider status updater in src/services/slack/providerStatusUpdater.ts
  - Implement updateProviderStatus(jobId, provider, status, count)
  - Use chat.update to modify single message in-place
  - Format: "Apollo: ✓ 60 | Wiza: ⏳ processing | AI Ark: ⏸ standby"
  - Reference: spec.md US5 Acceptance Scenario 1

- [ ] T046 [P] [US5] Integrate provider status into email waterfall in src/services/enrichment/emailWaterfall.ts
  - Call updateProviderStatus before each provider attempt
  - Update status after each provider completes
  - Reference: spec.md FR-020

- [ ] T047 [P] [US5] Integrate provider status into phone waterfall in src/services/enrichment/phoneWaterfall.ts
  - Show "Wiza: processing (5-15 mins)" while waiting
  - Update when webhook arrives: "Wiza: ✓ 40 phones"
  - Reference: spec.md US5 Acceptance Scenario 3

- [ ] T048 [US5] Add provider failure notifications in src/services/slack/providerStatusUpdater.ts
  - Show "Apollo unavailable, trying Wiza..." on API errors
  - Reference: spec.md US5 Acceptance Scenario 2

- [ ] T049 [US5] Deploy and test US5 on ECS
  - Verify real-time status updates in Slack
  - Verify provider failure messaging
  - Verify async phone status updates
  - Reference: quickstart.md Monitoring section

---

## Phase 8: Polish & Cross-Cutting Concerns

**Goal**: Production readiness, documentation, deployment

**Parallel Execution**: T050, T051, T051a, T051b, T052, T053, T054a can run in parallel (7 tasks)

### Tasks

- [ ] T050 [P] Add comprehensive logging in src/lib/logger.ts
  - Log all provider API calls (FR-017)
  - Log webhook receptions
  - Log cost calculations
  - Use structured JSON format
  - Reference: research.md Section 3 (Monitoring & Logging)

- [ ] T051 [P] Implement error handling for edge cases in src/services/enrichment/errorHandler.ts
  - Handle all providers failing (spec.md Edge Cases)
  - Handle provider API outages (spec.md Edge Cases)
  - Reference: spec.md Edge Cases section

- [ ] T051a [P] Implement email RFC 5322 validator in src/lib/validators/email.ts
  - Validate email format per RFC 5322 standard
  - Reject invalid emails from providers
  - Return validation result with error details
  - Reference: spec.md FR-012

- [ ] T051b [P] Implement phone E.164 validator in src/lib/validators/phone.ts
  - Validate phone format per E.164 standard
  - Normalize phone numbers to E.164 format
  - Reject invalid phones from providers
  - Return validation result with error details
  - Reference: spec.md FR-013

- [ ] T052 [P] Add deduplication logic in src/services/enrichment/deduplicator.ts
  - Deduplicate by email OR domain+name
  - Run before enrichment starts
  - Reference: spec.md FR-019

- [ ] T053 [P] Update ECS task definition with new environment variables in infra/ecs-task-definition.json
  - Add WIZA_API_KEY
  - Add AI_ARK_API_KEY
  - Add webhook secrets
  - Add MAX_CONTACTS_PER_JOB=2000
  - Reference: quickstart.md Environment Variables

- [ ] T054 Create integration tests in tests/integration/waterfall-enrichment.test.ts
  - Test email waterfall end-to-end
  - Test phone waterfall with webhook simulation
  - Test cost calculations
  - Reference: quickstart.md Testing section

- [ ] T054a Test webhook timeout and fallback behavior in tests/integration/webhook-timeout.test.ts
  - Simulate Wiza webhook timeout (5-minute limit)
  - Verify system falls back to AI Ark for remaining contacts
  - Verify partial results updated and user notified
  - Reference: spec.md FR-014

- [ ] T055 Update project documentation in README.md
  - Document waterfall enrichment feature
  - Document provider configuration
  - Document webhook setup
  - Reference: quickstart.md

---

## Parallel Execution Examples

### Setup Phase (Phase 1)

```bash
# Run in parallel after T001 completes:
T002: Create provider pricing seed script
T003: Update environment variables
```

### Foundational Phase (Phase 2)

```bash
# Run in parallel:
T005: Provider config
T006: Wiza client
T007: AI Ark client
T008: Provider registry
T009: Cost calculator
```

### User Story 1 (Phase 3)

```bash
# Run in parallel after T013 completes:
T014: Apollo email enrichment
T015: Wiza email enrichment
T016: AI Ark email enrichment
T017: JobContact model updates
T018: Email enrichment worker
T019: Skip existing data logic
T020: Provider breakdown notification
T021: File generation updates
```

### User Story 3 (Phase 4)

```bash
# Run in parallel after T025 completes:
T026: Wiza phone enrichment
T027: AI Ark phone enrichment
T028: Wiza webhook handler
T029: AI Ark webhook handler
T030: Webhook processor worker
T031: JobContact phone fields
```

---

## Testing Strategy

### Per User Story Testing

**US1 (Email Enrichment)**:
- Upload contacts.csv with domains/names, no emails
- Select "Email Only" enrichment
- Expected: Emails from Apollo (60%), Wiza (25%), AI Ark (10%)
- Verify: Provider breakdown in Slack, email source column in file

**US3 (Combined Email+Phone)**:
- Upload contacts.csv
- Select "All" enrichment
- Expected: Emails in 2-3 mins, phones 5-20 mins later
- Verify: File regenerates with phones, webhook delivery from Wiza/AI Ark

**US2 (Phone Only)**:
- Upload contacts.csv with emails
- Select "Mobile Number" enrichment
- Expected: Phone numbers from Wiza and AI Ark
- Verify: No email enrichment, phone-only workflow

**US4 (Cost Tracking)**:
- Run any enrichment
- Expected: Cost breakdown in Slack notification
- Verify: Itemized costs per provider, no double charging, total matches sum

**US5 (Slack UI)**:
- Run any enrichment
- Expected: Real-time provider status updates
- Verify: "Apollo: ✓ 60 | Wiza: ⏳ processing | AI Ark: ⏸ standby"

---

## Deployment Checklist

**Before Deployment**:
- [ ] All Phase 1 (Setup) tasks complete
- [ ] All Phase 2 (Foundational) tasks complete
- [ ] At minimum US1 (Email Enrichment) complete for MVP

**Configuration**:
- [ ] Wiza API key configured in ECS
- [ ] AI Ark API key configured in ECS
- [ ] Webhook URLs configured in Wiza and AI Ark accounts
- [ ] ProviderCost table seeded with pricing
- [ ] MAX_CONTACTS_PER_JOB set to 2000

**Validation**:
- [ ] Database migration applied successfully
- [ ] Webhook endpoints accessible via HTTPS
- [ ] Provider API keys valid
- [ ] CloudWatch logs flowing

**Rollback Plan**:
- [ ] Previous ECS task definition ARN saved
- [ ] Database migration rollback script ready
- [ ] Can revert to pre-waterfall enrichment behavior

---

## Success Criteria

**MVP (US1 Complete)**:
- ✅ Users can upload contacts and get emails via multi-provider waterfall
- ✅ Provider breakdown shows which provider found each email
- ✅ System skips contacts with existing emails
- ✅ Cost tracking works for email enrichment

**Full Feature (All Stories Complete)**:
- ✅ All enrichment modes work (Email, Phone, All)
- ✅ Async phone delivery via webhooks functions correctly
- ✅ Cost breakdown displays accurately for all providers
- ✅ Slack UI shows real-time provider status
- ✅ System handles provider failures gracefully
- ✅ 2,000 contact limit enforced

---

## Notes

- **AWS-Only Testing**: All tests run against deployed ECS service (no local dev)
- **Webhook Testing**: Use actual Wiza/AI Ark webhooks (no mocks for integration tests)
- **Cost Estimates**: Confirm AI Ark pricing with sales before production deployment
- **Pricing Correction**: Wiza costs $0.05/email (not $0.15), $0.125/phone (not $0.35) per research findings
- **Incremental Delivery**: Ship US1 first as MVP, then add US3, US2, US4, US5 incrementally
