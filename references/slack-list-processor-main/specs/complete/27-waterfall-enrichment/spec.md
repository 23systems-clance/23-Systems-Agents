# Feature Specification: Multi-Provider Waterfall Enrichment

**Feature Branch**: `27-waterfall-enrichment`
**Created**: 2026-03-14
**Status**: Draft
**Input**: User description: "Multi-provider waterfall enrichment for emails and phone numbers using Apollo, Wiza, and AI Ark with cost tracking and async webhook support"

## Clarifications

### Session 2026-03-14

- Q: What JSON structure do Wiza and AI Ark send in their webhook callbacks? → A: Identical to Apollo format: `{request_id, person_id, email, phone_numbers:[{type,number}]}` - enables reuse of existing webhook handler patterns
- Q: When phone numbers arrive asynchronously and file is regenerated, should original file be replaced or new file uploaded? → A: Replace original file in-place - keeps thread clean with single latest version, Slack shows "File updated" indicator
- Q: Should max contacts per job be adjusted for waterfall enrichment (up to 3 providers tried per contact)? → A: Reduce to 2,000 contacts max (from 5,000) to limit worst-case API calls to 6,000 (2,000 × 3 providers)
- Q: When contact already has email/phone, should waterfall enrichment skip that field or attempt to find additional data? → A: Skip contacts with existing data - if contact has email don't enrich email, if has phone don't enrich phone (saves credits, respects existing data)
- Q: How should provider status be displayed in Slack during waterfall enrichment? → A: Update single message in-place - one message updates live showing "Apollo: ✓ 60 | Wiza: ⏳ processing | AI Ark: ⏸ standby" (keeps thread clean)
- Q: Should all providers use same authentication method? → A: Provider-specific auth - Apollo uses `X-Api-Key`, Wiza uses `Authorization: Bearer`, AI Ark uses `X-TOKEN` (per actual API docs)

### Session 2026-03-15

- Q: When "All" mode triggers both quality gates (email verification + DNC scrub), what is the ordering? → A: Sequential by data type — email verification runs immediately after email waterfall completes (before phones arrive), DNC scrub runs after phone enrichment completes. Each gate is scoped to its own data type with no cross-dependency.
- Q: Should Findymail verification costs be included in the cost breakdown (US4) or tracked separately? → A: Include verification costs in the existing cost breakdown alongside enrichment costs — show "Findymail Verification: 95 @ $X.XX = $Y.YY" in the same report for full cost visibility.
- Q: Should verification results be cached and reused for repeat enrichments of the same contact? → A: Always verify fresh — email deliverability changes frequently (mailboxes deactivated, domains expire), so cached verification results could be stale and misleading. Each verification opt-in runs fresh against the current email list.

## User Scenarios & Testing

### User Story 1 - Email Enrichment with Multi-Provider Fallback (Priority: P1)

Users upload contact lists and receive email addresses by automatically trying multiple providers in sequence until an email is found for each contact.

**Why this priority**: Email enrichment is the most common use case and delivers immediate value. Without emails, contacts cannot be reached for outreach campaigns.

**Independent Test**: Upload a contact list with domains/names but no emails. Verify that contacts receive email addresses and the system reports which provider found each email (Apollo, Wiza, or AI Ark).

**Acceptance Scenarios**:

1. **Given** a contact list with 100 contacts without emails, **When** user selects "Email" enrichment, **Then** system tries Apollo first, then Wiza for any remaining contacts without emails, then AI Ark for final gaps
2. **Given** Apollo finds 60 emails, Wiza finds 25 more, AI Ark finds 10 more, **When** enrichment completes, **Then** user receives a file with 95 emails and a breakdown showing: "60 via Apollo, 25 via Wiza, 10 via AI Ark, 5 not found"
3. **Given** a contact already has an email from a previous enrichment, **When** user runs enrichment again, **Then** system skips that contact (doesn't charge credits for already-enriched data)

---

### User Story 2 - Mobile Phone Enrichment with Provider Fallback (Priority: P2)

Users request phone numbers for contacts and receive them via a two-provider waterfall (Wiza → AI Ark) with async delivery.

**Why this priority**: Phone enrichment is valuable for cold calling campaigns but less common than email. Wiza is prioritized as primary phone provider.

**Independent Test**: Upload a contact list and select "Mobile Number" enrichment. Verify phones are enriched via Wiza first, then AI Ark for gaps, and user is notified when phone data arrives.

**Acceptance Scenarios**:

1. **Given** a contact list with emails but no phones, **When** user selects "Mobile Number" enrichment, **Then** system tries Wiza first for all contacts, then AI Ark for any without phones
2. **Given** Wiza finds 40 phones and AI Ark finds 15 more, **When** async enrichment completes, **Then** user receives updated file with breakdown: "40 via Wiza, 15 via AI Ark, 45 not available"
3. **Given** phone enrichment is requested, **When** user receives the initial file, **Then** email/contact data is delivered immediately with a message: "Phone numbers are being processed (5-15 minutes)"
4. **Given** phone webhooks arrive from Wiza, **When** phone data is ready, **Then** system regenerates file and uploads with notification: "Phone numbers received! Updated with 40 phones via Wiza"

---

###User Story 3 - Combined Enrichment (Email + Phone) (Priority: P1)

Users select "All" and receive both emails (immediate) and phones (async) using optimal provider for each data type.

**Why this priority**: "All" is the most comprehensive option and users expect both data types. Must handle async phone delivery gracefully while providing immediate access to emails.

**Independent Test**: Upload contacts, select "All", verify emails delivered in 2-3 minutes via multi-provider waterfall, phones delivered 5-20 minutes later with provider breakdown.

**Acceptance Scenarios**:

1. **Given** user selects "All" enrichment, **When** processing starts, **Then** email waterfall runs (Apollo→Wiza→AI Ark) and delivers immediately, phone waterfall (Wiza→AI Ark) processes async
2. **Given** email enrichment completes first, **When** emails are ready, **Then** user receives file with emails immediately (phone columns empty with note "Phone numbers pending")
3. **Given** phone data arrives later from Wiza and AI Ark, **When** phones are ready, **Then** system updates the same file and notifies user: "Phone numbers received! 40 via Wiza, 15 via AI Ark"

---

### User Story 4 - Cost Tracking and Reporting (Priority: P2)

Users see accurate cost breakdowns showing which provider was used for each contact and the associated credit costs.

**Why this priority**: Cost transparency is critical for budgeting and understanding ROI. Users need to know which providers are most effective.

**Independent Test**: Run enrichment, verify cost report shows: "Emails: Apollo (60 @ $0.05 = $3.00), Wiza (25 @ $0.05 = $1.25), AI Ark (10 @ $0.14 = $1.40) | Phones: Wiza (40 @ $0.125 = $5.00), AI Ark (15 @ $0.27 = $4.05) | Total: $14.70"

**Acceptance Scenarios**:

1. **Given** enrichment uses multiple providers, **When** job completes, **Then** system shows cost breakdown by provider and data type in Slack notification
2. **Given** a contact email was found via Wiza (second provider), **When** calculating costs, **Then** system charges only Wiza's rate, not Apollo's (no double charging for failed attempts)
3. **Given** user views job history in admin dashboard, **When** viewing cost details, **Then** each job shows itemized breakdown: Provider, Data Type, Count, Rate, Subtotal

---

### User Story 5 - Slack Workflow Integration (Priority: P3)

Slack workflow UI reflects the new multi-provider waterfall approach with clear status indicators for each provider.

**Why this priority**: Users need visibility into which providers are being tried and which succeeded, but this is a polish feature after core functionality works.

**Independent Test**: Trigger enrichment from Slack, verify UI shows provider status: "Trying Apollo... ✓ Found 60 emails | Trying Wiza... ✓ Found 25 more | Trying AI Ark... ✓ Found 10 more"

**Acceptance Scenarios**:

1. **Given** enrichment is in progress, **When** viewing Slack thread, **Then** user sees real-time provider status updates: "Apollo: 60 emails found | Wiza: processing..."
2. **Given** a provider fails (API error), **When** system falls back to next provider, **Then** user sees notification: "Apollo unavailable, trying Wiza..."
3. **Given** phone enrichment is async, **When** waiting for phones, **Then** user sees: "Emails delivered | Phones: Wiza processing (5-15 mins)..."

---

### User Story 6 - Email Verification Quality Gate via Findymail (Priority: P2)

Users are offered the option to verify enriched email addresses for deliverability before receiving their final results file, improving outreach quality and reducing bounce rates.

**Why this priority**: Email verification is a quality gate that adds significant value by filtering out undeliverable emails before campaigns. Similar to the DNC scrub quality gate for phone numbers, this step is optional but recommended.

**Independent Test**: Complete an email enrichment, verify that the system prompts "Verify Emails" / "Do Not Verify" buttons. Select "Verify Emails" and confirm each email receives a verified status (true/false) and email provider label in the output file.

**Acceptance Scenarios**:

1. **Given** email enrichment completes with 95 emails found, **When** the system finishes the email waterfall, **Then** the system presents two buttons in the Slack thread: "Verify Emails" and "Do Not Verify"
2. **Given** user clicks "Verify Emails", **When** verification runs, **Then** the system checks each enriched email address for deliverability and adds "Email Verified" (true/false) and "Email Provider" (e.g., Google, Microsoft) columns to the output file
3. **Given** user clicks "Do Not Verify", **When** the user skips verification, **Then** the system proceeds directly to file generation without verification columns (no "Email Verified" or "Email Provider" columns added)
4. **Given** verification is in progress for 200 emails, **When** the user is waiting, **Then** the system shows a progress message: "Verifying emails... 120/200 complete" updating in real-time
5. **Given** the Findymail API returns verified=false for an email, **When** the file is generated, **Then** the email is still included in the file but marked as "false" in the "Email Verified" column (not removed, so the user can decide)
6. **Given** the enrichment mode is "Phone Only" (no emails enriched), **When** phone enrichment completes, **Then** the email verification prompt is NOT shown (only relevant when emails are present)

---

### Edge Cases

- What happens if Findymail API key is not configured? Skip the verification prompt entirely (same as "Do Not Verify"), proceed directly to file generation
- What if the Findymail API is down or returns errors during verification? Complete verification for successful responses, mark failed verifications as "unknown" in the Email Verified column, notify user of partial verification results
- What if a contact has no email (enrichment failed to find one)? Skip verification for that contact, leave Email Verified column empty for contacts without emails
- What if the Findymail API rate limit is exceeded? Process verifications in batches respecting the 300 concurrent request limit, queue remaining verifications

- What happens when ALL providers fail to find an email/phone for a contact? System marks as "not available", doesn't charge credits, includes in "not found" count
- How does the system handle provider API outages? Skip failed provider, continue waterfall to next provider, log error, notify user of provider failure
- What if a provider returns an invalid email/phone format? Validate format, reject invalid data, try next provider, log validation failure
- How are duplicate contacts handled across providers? Deduplicate before enrichment, use first valid result, don't enrich same contact twice
- What if phone webhooks from multiple providers arrive simultaneously? Queue them, process sequentially, update contacts atomically, avoid race conditions
- How does caching work with multiple providers? Cache includes provider source metadata, reuse if data fresh regardless of provider, invalidate on force-refresh
- What if Wiza/AI Ark webhooks fail to arrive within timeout? 5-minute timeout per provider, mark as timed out, try next provider in waterfall, notify user of partial results
- What if a provider's API key is invalid/expired? Skip that provider with error log, continue to next provider, notify admin of API key issue
- How are costs calculated when waterfall uses multiple providers for same contact? Sum costs from all providers used (e.g., Apollo for email + Wiza for phone = both costs added)

## Requirements

### Functional Requirements

- **FR-001**: System MUST attempt email enrichment using providers in this sequence: Apollo, then Wiza, then AI Ark, stopping when a valid email is found for each contact
- **FR-002**: System MUST attempt phone enrichment using providers in this sequence: Wiza, then AI Ark, stopping when a valid phone is found for each contact
- **FR-003**: System MUST NOT charge credits for providers that were not attempted (e.g., if Apollo finds email, don't call Wiza or AI Ark for that contact's email)
- **FR-004**: System MUST track which provider found each piece of data (email source provider, phone source provider) for accurate cost attribution
- **FR-005**: System MUST deliver email enrichment results immediately (within 2-5 minutes) without waiting for phone data
- **FR-006**: System MUST handle async phone delivery from Wiza and AI Ark via webhooks
- **FR-007**: System MUST provide separate webhook endpoints for each provider: `/api/webhooks/wiza/enrichment-results` and `/api/webhooks/aiark/enrichment-results`, expecting Apollo-compatible payload format: `{request_id, person_id, email, phone_numbers: [{type, number}]}`
- **FR-008**: System MUST regenerate and re-upload the result file when phone data arrives from any provider, replacing the original file in-place (same filename) to maintain single source of truth
- **FR-009**: System MUST notify users when phone enrichment completes with provider-specific breakdown: "Phone numbers received! 40 via Wiza, 15 via AI Ark"
- **FR-010**: System MUST calculate and display cost breakdowns showing: provider name, data type (email/phone/verification), count, per-unit cost, subtotal, grand total — including Findymail verification costs when verification was performed
- **FR-011**: System MUST store per-provider pricing rates in configuration for: Apollo email, Wiza email, Wiza phone, AI Ark email, AI Ark phone, Findymail email verification
- **FR-012**: System MUST validate email addresses using RFC 5322 format check before accepting them from any provider
- **FR-013**: System MUST validate phone numbers using E.164 format check before accepting them from any provider
- **FR-014**: System MUST implement 5-minute timeout for each provider's webhook, continuing to next provider if timeout occurs
- **FR-015**: System MUST cache enriched data with provider metadata (source, cost, timestamp) to avoid re-enriching same contacts
- **FR-026**: System MUST skip enrichment for contacts that already have valid email (for email enrichment) or valid phone (for phone enrichment) to avoid unnecessary API costs - only enrich missing data fields
- **FR-016**: System MUST handle provider API failures gracefully by skipping to next provider in waterfall without failing entire job
- **FR-017**: System MUST log all provider API calls with request/response details, credits consumed, and errors for debugging and audit
- **FR-018**: System MUST support three enrichment modes: "Email Only" (Apollo→Wiza→AI Ark), "Phone Only" (Wiza→AI Ark), "All" (both waterfalls)
- **FR-019**: System MUST deduplicate contacts before enrichment using email/domain/name matching to avoid charging for same contact multiple times
- **FR-025**: System MUST enforce maximum of 2,000 contacts per waterfall enrichment job to limit API call volume (worst case: 2,000 contacts × 3 providers = 6,000 calls)
- **FR-020**: System MUST update Slack workflow UI to show provider status in real-time by updating a single message in-place with format: "Apollo: ✓ 60 | Wiza: ⏳ processing | AI Ark: ⏸ standby" (message updates as each provider completes)
- **FR-021**: System MUST store provider-specific API credentials securely in environment configuration (Apollo: X-Api-Key header, Wiza: Authorization Bearer header, AI Ark: X-TOKEN header)
- **FR-022**: System MUST track enrichment attempts per provider per contact to prevent infinite retry loops
- **FR-023**: System MUST prioritize cached data over new API calls when data is fresh (within cache TTL) regardless of provider source
- **FR-024**: System MUST handle partial webhook failures where some phone numbers arrive but others timeout by updating available data and continuing to next provider for gaps
- **FR-027**: System MUST present an email verification quality gate immediately after the email waterfall completes (for "Email Only", "All", or any flow that produces emails), showing "Verify Emails" and "Do Not Verify" buttons in the Slack thread. In "All" mode, email verification runs before phone data arrives; the DNC scrub gate runs separately after phone enrichment completes. Each quality gate is scoped to its own data type.
- **FR-028**: System MUST NOT show the email verification prompt when no emails were enriched (e.g., "Phone Only" mode or when all email enrichment attempts failed)
- **FR-029**: When user selects "Verify Emails", system MUST verify each enriched email address for deliverability and add "Email Verified" (true/false) and "Email Provider" (e.g., Google, Microsoft) columns to the output file
- **FR-030**: When user selects "Do Not Verify", system MUST skip verification and proceed directly to file generation without adding verification columns
- **FR-031**: System MUST process email verifications in batches respecting the verification service's concurrency limits (300 concurrent requests)
- **FR-032**: System MUST NOT remove emails that fail verification — unverified emails remain in the file marked as "false" so users can make their own decisions
- **FR-033**: System MUST set job status to "AWAITING_EMAIL_VERIFICATION" while waiting for the user's verification decision, pausing the workflow until a button is clicked
- **FR-034**: If the verification service API key is not configured, system MUST skip the verification prompt entirely and proceed directly to file generation (same behavior as "Do Not Verify")
- **FR-035**: System MUST show real-time verification progress in Slack: "Verifying emails... X/Y complete" updating as batches finish

### Key Entities

- **EnrichmentProvider**: Represents a data enrichment service with attributes: provider name (Apollo/Wiza/AI Ark), supported data types (email and/or phone), webhook endpoint path, priority order for email waterfall, priority order for phone waterfall, API credential reference

- **ProviderCost**: Configuration storing pricing for each provider-datatype combination: provider identifier, data type (email/phone), cost per successful enrichment, currency (USD), effective date, notes

- **ProviderAttempt**: Tracks each enrichment attempt linking: contact identifier, provider used, data type requested (email/phone), result status (success/failure/timeout/skipped), data value returned (if successful), cost incurred, timestamp, error message (if failed)

- **ContactEnrichmentSummary**: Aggregated enrichment result for a contact showing: email value, email source provider, email cost, phone value, phone source provider, phone cost, total enrichment cost, last enrichment timestamp

- **JobProviderBreakdown**: Summary of provider usage for an enrichment job: job identifier, provider name, emails found count, phones found count, total credits consumed, total cost, success rate percentage

- **EmailVerificationResult**: Stores verification outcome for each contact: contact identifier, email address, verified status (true/false/unknown), email provider name (e.g., Google, Microsoft), verification timestamp

### Provider API Cost Rates (Reference)

**Apollo.io**:
- Email enrichment: $0.05 per email (1 credit @ $0.05/credit)
- Phone enrichment: Not used (webhook delivery issues)

**Wiza.co** (Source: [Wiza API Documentation](https://docs.wiza.co/)):
- Email enrichment: $0.05 per email (2 credits × $0.025/credit)
- Phone enrichment: $0.125 per phone (5 credits × $0.025/credit)
- Credit system: $0.025 per credit, minimum purchase 2,000 credits ($50)

**AI Ark** (Source: [AI Ark Pricing](https://ai-ark.com/pricing/)):
- Email enrichment: 0.5 credits per email × $0.27/credit = **$0.14 per email**
- Phone enrichment: ~1 credit per phone × $0.27/credit = **$0.27 per phone** (estimated)
- Starter plan: $27/month for 100 credits = $0.27 per credit
- Note: Actual costs may vary; confirm exact rates from AI Ark account/support

**Findymail** (Email Verification):
- Email verification: Cost per verification TBD (confirm from Findymail account/pricing page)
- Concurrency limit: 300 concurrent requests
- Note: Verification is optional — only charged when user selects "Verify Emails"

**Estimated Waterfall Costs** (per 1000 contacts):
- Email waterfall (Apollo→Wiza→AI Ark): ~$50-$80 depending on success rates (avg $0.065/email with 80% Apollo, 15% Wiza, 5% AI Ark distribution)
- Phone waterfall (Wiza→AI Ark): ~$125-$180 depending on success rates (avg $0.15/phone with 70% Wiza, 30% AI Ark distribution)
- Combined ("All"): ~$175-$260 for comprehensive enrichment (both email and phone waterfalls)

## Success Criteria

### Measurable Outcomes

- **SC-001**: Email enrichment completes and delivers results to users within 2-5 minutes, regardless of phone enrichment status
- **SC-002**: Email waterfall achieves 90%+ coverage rate by trying all three providers (Apollo → Wiza → AI Ark) compared to 60-70% with single provider
- **SC-003**: Phone enrichment coverage improves by 40% compared to Apollo-only approach (measured over 1000-contact sample)
- **SC-004**: Cost reporting shows 100% accurate provider attribution (every contact's cost traced to correct provider with zero discrepancies)
- **SC-005**: System maintains 99%+ job completion rate even when individual providers fail (jobs complete with partial data)
- **SC-006**: Users receive file with emails within 5 minutes of starting enrichment in 95% of jobs
- **SC-007**: Zero jobs remain stuck indefinitely (all jobs complete or timeout within 30 minutes with clear status)
- **SC-008**: Credit costs match actual provider usage with 100% accuracy (no double-charging, no charging for failed provider attempts)
- **SC-009**: Phone webhook delivery completes within 15 minutes for 90% of jobs (Wiza + AI Ark combined)
- **SC-010**: Cost per successfully enriched contact reduces by 20% through smart provider selection (vs. always using most expensive provider)
- **SC-011**: Email verification completes within 2 minutes for jobs with up to 2,000 emails
- **SC-012**: Users who opt into email verification see bounce rates reduced by 50%+ compared to unverified lists (measured over 10+ campaigns)

## Assumptions

- Apollo.io phone webhooks are unreliable/non-functional, hence Apollo excluded from phone waterfall
- Wiza and AI Ark webhook systems deliver within 5-15 minutes with 95%+ reliability
- Each provider has fixed per-unit pricing (no volume discounts or tiered pricing to model initially)
- Provider APIs support bulk enrichment (multiple contacts per request)
- Email enrichment from all providers returns results synchronously (immediate response)
- Phone enrichment from Wiza and AI Ark requires asynchronous webhook delivery
- Wiza and AI Ark support HTTPS webhooks with no pre-registration or whitelist requirements
- Users prefer faster partial results over waiting for complete data from all providers
- Phone number quality is comparable across Wiza and AI Ark
- Provider waterfalls run sequentially (try provider 1, if gaps try provider 2, etc.) not in parallel
- Caching strategy treats all providers equally (cached email is reused regardless of which provider found it)
- Contact uniqueness is determined by email address or domain+name combination
- Findymail API returns results synchronously (immediate response per email, no webhook needed)
- Findymail verification is optional and does not block enrichment — emails are delivered regardless of verification status
- Email verification quality gate only appears when emails were successfully enriched (at least 1 email found)
- Email verification always runs fresh (no caching of verification results) because email deliverability status changes frequently

## Dependencies

- **Wiza.co API Integration**: Requires API key (Bearer token auth), webhook configuration, API documentation at https://docs.wiza.co/
- **AI Ark API Integration**: Requires API key (X-TOKEN header auth), webhook configuration, Mobile Phone Finder API (https://docs.ai-ark.com/reference/people-mobile-phone-finder), Credit Fetch API (https://docs.ai-ark.com/reference/fetch-credit). MCP server available but not used for bulk automation (see Out of Scope)
- **Existing Apollo Integration**: Continue using for email enrichment (first in waterfall)
- **Redis Cache**: For provider-aware contact caching with metadata
- **PostgreSQL**: For enrichment attempt tracking, cost attribution, and provider breakdown storage
- **Slack Workflow System**: Must be updated to show provider status and multi-provider UI
- **Webhook Infrastructure**: Separate endpoints for Wiza and AI Ark (reuse existing Apollo webhook handler pattern)
- **ALB/CloudFront**: HTTPS endpoints for webhook delivery from Wiza and AI Ark
- **Findymail API Integration**: Requires API key (Bearer token auth), POST /api/verify endpoint, returns verification status and email provider. Documentation at https://app.findymail.com/docs/

## Out of Scope

- **Manual provider selection**: Users cannot choose which specific providers to use; waterfall order is system-determined
- **Synchronous phone enrichment**: All phone enrichment is async via webhooks; no immediate phone delivery option
- **Provider performance dashboard**: No real-time monitoring of provider uptime, response times, or success rates
- **Dynamic provider ordering**: Waterfall sequence is static (not automatically adjusted based on historical success rates or costs)
- **Volume-based pricing**: No support for provider volume discounts or tiered pricing structures
- **Provider fallback for technographic data**: Waterfall only applies to contact enrichment (email/phone), not company technographics
- **Retry logic for transient failures**: If a provider returns a transient error (rate limit, timeout), system skips to next provider (no retry same provider)
- **Provider health checks**: No pre-flight checks to verify provider availability before attempting enrichment
- **Custom waterfall configuration per user/channel**: All users use the same fixed provider waterfall order
- **Personality analysis enrichment**: AI Ark offers personality analysis API but this feature is deferred to future implementation (focus on email/phone first)
- **Auto-removal of unverified emails**: Emails that fail verification are kept in the file (marked false) — automatic removal is out of scope; users decide what to do with unverified emails
- **Cached verification results**: Verification results are not cached or reused across jobs; each verification runs fresh
- **Bulk verification API**: Using Findymail's single-email verification endpoint only; no bulk/batch endpoint integration
- **MCP server integration for bulk automation**: MCP servers are available for all three providers (Apollo: https://github.com/lkm1developer/apollo-io-mcp-server, Wiza: https://composio.dev/toolkits/wiza, AI Ark: official MCP server) but are designed for interactive/manual queries, not production bulk automation. This feature requires direct API integration for bulk enrichment (2000 contacts), async webhook handling, and BullMQ job queue orchestration. MCP servers are better suited for future manual enrichment features (e.g., "enrich this contact" from Slack)
