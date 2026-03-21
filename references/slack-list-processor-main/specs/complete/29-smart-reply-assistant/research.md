# Research: Smart Reply Assistant

**Branch**: `29-smart-reply-assistant` | **Date**: 2026-03-17

## R1: AI Draft Generation Model Selection

**Decision**: Claude Haiku 4.5 (`claude-haiku-4-5-20251001`)

**Rationale**: Already used in the platform for intent classification (agent-intent-classifier prompt). Tool Use support enables structured output (intent + draft body). Cost is ~$0.001/draft which keeps SC-006 ($5/month at 100 replies/day) easily achievable. Every draft is human-reviewed so Haiku's quality is sufficient.

**Alternatives considered**:
- Claude Sonnet 4.5: Higher quality but ~10x cost; unnecessary since BDRs edit all drafts
- GPT-4o-mini: Similar tier but would introduce a second AI provider; existing Anthropic SDK already integrated

## R2: Intent Classification Approach

**Decision**: Single Claude call with Tool Use returning `{ intent, should_reply, draft_body, confidence }`

**Rationale**: Classification and draft generation in one call reduces latency and cost vs. two separate calls. The Tool Use pattern matches the existing `agent-intent-classifier` pattern in `defaultPrompts.ts`. The `should_reply` boolean handles the FR-003 logic (no draft for OOO/auto-reply/wrong_person) at the AI level.

**Alternatives considered**:
- Two-step (classify then draft): Doubles latency and cost; the model can classify intent as part of drafting
- Rule-based classification + AI draft: Fragile regex for email classification; AI handles nuance better

## R3: AI Ark People Analysis API

**Decision**: `POST /people/analysis` with `{ url: "<linkedin_url>" }` body, `X-TOKEN` auth header

**Rationale**: Confirmed via live API call. Returns DISC, OCEAN, archetype, communication style, key traits, and email approach guidance. Uses existing `callAIArkWithRetry()` infrastructure with same rate limiting (5 req/s).

**Existing implementation**: `personalityAnalysis()` function already exists in `src/services/aiark/client.ts`. The `PersonalityAnalysis` Prisma model (keyed by LinkedIn URL) already provides caching with 7-day TTL. The `personalityRouter` at `GET /api/v1/bdr/personality/:contactId` already handles on-demand enrichment.

**Alternatives considered**:
- Crystal Knows: Requires separate account/pricing; AI Ark already integrated for phone enrichment

## R4: Personality Data Storage Strategy

**Decision**: Dual storage — `PersonalityAnalysis` cache table (existing) + JSONB on `CampaignContact.personalityData` (new)

**Rationale**: The existing `PersonalityAnalysis` model provides a global cache keyed by LinkedIn URL with 7-day TTL. Adding `personalityData` JSONB to `CampaignContact` avoids joins when building smart reply prompts and allows the contact details page to read personality data without a separate query. When on-demand enrichment runs, data is stored in both places.

**Existing infrastructure**:
- `PersonalityAnalysis` model: `id`, `linkedinUrl` (unique), `contactName`, `rawResponse` (JSON), `archetypeName`, `archetypeScore`, `createdAt`, `updatedAt`
- `personalityRouter` (`src/routes/bdr/personality.ts`): On-demand enrichment with cache check, upsert, and HTML rendering
- `renderPersonalityHtml()` service (`src/services/personality/renderer.js`): V2 Dark Analytics HTML page

**Alternatives considered**:
- Cache table only: Requires joins from CampaignContact; slower for draft generation prompts
- CampaignContact only: Loses cross-campaign deduplication; same contact in two campaigns would need re-enrichment

## R5: On-Demand Enrichment Flow

**Decision**: Two entry points — dashboard "Enrich" button (existing personality route) and `/enrich personality <contactId>` Slack subcommand (new)

**Rationale**: The existing `/enrich` command already has subcommand routing (help, history, stop, report). Adding a `personality` subcommand fits the established pattern. The dashboard route already exists at `GET /api/v1/bdr/personality/:contactId`. Both paths use the same cache-first logic.

**Existing CampaignBdr model**: BDR-campaign assignment already exists via the `CampaignBdr` junction table (fields: `campaignId`, `slackUserId`, `slackTeamId`, `displayName`). No new schema needed for FR-022a.

**Implementation**: Add `personality` subcommand to `src/listeners/commands/enrich.ts`. When triggered, look up contact by ID or search by name/email, call `personalityAnalysis()`, cache result, post Slack message with archetype and contact profile link.

## R6: BullMQ Queue Design for Smart Reply

**Decision**: Dedicated `smart-reply` queue with simple worker (not dispatcher pattern)

**Rationale**: Only two job types (generate-draft, regenerate-draft) with identical processing logic (difference is tone parameter). Doesn't justify the dispatcher routing table pattern used by the campaign queue. Concurrency of 3 allows parallel draft generation without overwhelming Claude API.

**Alternatives considered**:
- Add to campaign queue: Mixes concerns; smart reply jobs are independent of campaign lifecycle
- No queue (inline): Violates FR-010 (draft generation must not block webhook processing)

## R7: Slack Notification Targeting

**Decision**: DM to assigned BDRs via `CampaignBdr` + post to originating campaign channel

**Rationale**: The `CampaignBdr` junction table already tracks BDR-campaign assignments. The campaign model tracks `slackChannelId`. Both are already populated by existing campaign management flows.

**Implementation**: In the Instantly webhook handler (`reply_received`), after creating UniboxReply and enqueuing smart reply, send Slack notifications: query `CampaignBdr` for all assigned BDRs → DM each; post to `campaign.slackChannelId` if set.

## R8: HubSpot Custom Property Creation

**Decision**: Auto-create custom properties with `aiark_` prefix using HubSpot Properties API

**Rationale**: The existing `@hubspot/api-client` package includes the Properties API. Custom properties are created idempotently (check existence first, create if missing). Prefix avoids naming conflicts.

**Properties to create** (mapped from AI Ark response):
- `aiark_archetype` (string)
- `aiark_disc_dominance`, `aiark_disc_influence`, `aiark_disc_steadiness`, `aiark_disc_calculativeness` (number)
- `aiark_ocean_openness`, `aiark_ocean_conscientiousness`, `aiark_ocean_extraversion`, `aiark_ocean_agreeableness`, `aiark_ocean_emotional_stability` (number)
- `aiark_communication_types` (string)
- `aiark_communication_adjectives` (string)
- `aiark_key_traits_risk` (string)
- `aiark_key_traits_decision_drivers` (string)
- `aiark_email_tone` (string)
- `aiark_email_length` (string)

## R9: CSV Export Format

**Decision**: Server-side CSV generation with download via admin API endpoint

**Rationale**: Simple endpoint that queries campaign contacts with personality data, formats as CSV rows, and streams the response with `Content-Type: text/csv`. No need for a queue job since the dataset is bounded (max 5,000 contacts per campaign).

**CSV columns**: firstName, lastName, email, companyName, jobTitle, linkedinUrl, archetype, disc_dominance, disc_influence, disc_steadiness, disc_calculativeness, ocean_openness, ocean_conscientiousness, ocean_extraversion, ocean_agreeableness, ocean_emotional_stability, communication_types, communication_adjectives, what_to_say, what_to_avoid, key_traits_risk, key_traits_decision_drivers, email_tone, email_length

## R10: Email Attachment Support

**Decision**: Extend the reply mechanism to support file uploads via multipart form data

**Rationale**: FR-010c requires attachment support. The Instantly API reply endpoint supports attachments. The frontend sends files as `FormData`, the backend forwards to Instantly via `multer` middleware. Stored in memory (not S3, since files are immediately forwarded).

## R11: Contact Detail Page Architecture

**Decision**: New React page within authenticated admin layout, reusing personality HTML renderer

**Rationale**: BDRs are already logged into the dashboard daily for UniBox. The existing `renderPersonalityHtml()` returns a self-contained HTML page, but for the dashboard we need React components instead. We'll create a new React page that fetches personality data as JSON and renders it with React components (bar charts for DISC/OCEAN, badges for archetype, lists for guidance).

**URL pattern**: `/contacts/:contactId` — simpler than campaign-scoped since contacts may appear in multiple campaigns. The contact detail API returns personality + conversation history in one call.

## R12: Existing Infrastructure Summary

**Already built (reuse as-is)**:
- `PersonalityAnalysis` Prisma model (cache table)
- `personalityAnalysis()` AI Ark client function
- `CampaignBdr` junction table (BDR assignment)
- `/enrich` Slack command with subcommand routing
- `personalityRouter` at `/api/v1/bdr/personality/:contactId`
- `renderPersonalityHtml()` personality page renderer

**Needs extension**:
- `UniboxReply` model: Add smart reply draft fields
- `CampaignContact` model: Add `personalityData` JSONB + `personalityEnrichedAt`
- Instantly webhook handler: Enqueue smart reply job + Slack notifications
- UniBox routes: Add draft accept/dismiss/regenerate endpoints
- `/enrich` command: Add `personality` subcommand
- Admin campaign routes: Add CRM sync + CSV export endpoints
