# Research: Pre-Enrichment Lead Quality Gating

**Feature**: 16-lead-quality-gating
**Date**: 2026-03-11
**Status**: Complete

## R1: Quality Gate Insertion Point

**Decision**: Insert quality gate logic between file parsing and BullMQ job enqueue, inside the message handler (`src/listeners/events/message.ts`) and purpose selection handler (`src/listeners/actions/purposeSelection.ts`).

**Rationale**: The gate must run BEFORE any enrichment API calls. The current flow is:
1. File parsed → rows extracted → `JobCompany` records created → BullMQ job enqueued
2. Worker picks up job → calls BuiltWith → calls Apollo

The optimal hook point is after `parseFile()` produces rows but BEFORE `JobCompany` records are persisted and the BullMQ job is enqueued. This way, filtered rows never become `JobCompany` records and never enter the enrichment queue.

**Alternatives considered**:
- **Inside the BullMQ worker (before API calls)**: Rejected — rows already persisted as JobCompany records, harder to generate filtered CSV, and the filtering summary would be delayed until worker picks up the job (could be seconds to minutes).
- **As a separate BullMQ job (pre-enrichment queue)**: Rejected — adds queue hop latency, over-engineered for a synchronous <2s operation. The spec explicitly states the gate runs in-process during file parsing phase.

## R2: Personal Email Domain Detection

**Decision**: Maintain a static default list of 12 common free email providers (per spec FR-002). Store as a constant array. Allow workspace-level additions via the `personalDomainList` config field.

**Rationale**: The list is small, stable, and well-known. No need for external API or dynamic detection. The spec lists: gmail.com, yahoo.com, hotmail.com, outlook.com, aol.com, icloud.com, live.com, msn.com, me.com, protonmail.com, ymail.com, mail.com.

**Alternatives considered**:
- **Disposable email API (e.g., Kickbox)**: Rejected — adds cost and latency for a simple domain check. Not in spec scope.
- **Regex pattern matching**: Rejected — too many false positives. Explicit list is safer.

## R3: Domain Normalization for Suppression Matching

**Decision**: Extend existing `normalizeDomain()` in `domainUtils.ts` with a `stripSubdomain()` helper. Normalization pipeline: lowercase → strip protocol → strip www → strip subdomains → strip trailing slashes/paths → validate TLD.

**Rationale**: Spec FR-006 requires normalization including subdomain stripping for suppression matching (e.g., `marketing.competitor.com` → `competitor.com`). The existing `normalizeDomain()` already handles protocol, www, paths, and lowercase. Only subdomain stripping is missing.

**Alternatives considered**:
- **Use `tldts` library for subdomain extraction**: Considered but rejected for now — adds a dependency for a simple operation. The registered domain can be extracted by taking the last two segments (or three for country-code TLDs like `.co.uk`). If edge cases arise, `tldts` can be added later.
- **Full PSL (Public Suffix List) matching**: Over-engineered for suppression list matching where the admin explicitly enters root domains.

## R4: Duplicate Domain Grouping Strategy

**Decision**: Build a `Map<string, number[]>` mapping normalized domain → array of row indices. First occurrence is the "primary" row; subsequent rows are "duplicates" for BuiltWith purposes. All rows still proceed to contact enrichment (FR spec: "deduplication applies only to domain-level lookups").

**Rationale**: Spec US3 requires that 20 rows across 5 domains result in only 5 BuiltWith lookups, but all 20 contacts are individually enriched via Apollo. The grouping must happen at the quality gate level so the enrichment worker receives deduplicated domain information.

**Implementation approach**: After all other filters run, group remaining rows by normalized domain. Pass both the full row list (for Apollo contact enrichment) and a unique domain list (for BuiltWith technographic enrichment) to the enrichment job data.

**Alternatives considered**:
- **Dedup inside the BuiltWith worker**: Rejected — the worker already iterates per-company. Adding dedup logic there would require the worker to maintain domain-seen state and skip redundant lookups. Doing it at the gate level is cleaner and lets us report dedup stats in the filtering summary.

## R5: Filtered Rows CSV Generation

**Decision**: Generate a CSV in-memory using `csv-stringify` (already a transitive dependency via `csv-parse`), add a `Filter Reason` column, upload to S3 using the existing `uploadFile()` pattern from `src/lib/storage.ts`, and deliver via presigned URL.

**Rationale**: Follows the exact same pattern as enrichment result files (S3 upload → presigned URL → Slack message with download link). The filtered CSV is small (subset of original file) and can be generated in-memory without streaming.

**Alternatives considered**:
- **Return filtered rows inline in Slack message**: Rejected — Slack messages have character limits. CSV download is more practical for review.
- **Store filtered rows in database**: Rejected — transient data, only useful for immediate review. S3 with 30-day expiry is sufficient.

## R6: Configuration Storage Model

**Decision**: Create a new `QualityGateConfig` Prisma model linked to `ManagedClient` (one-to-one). Stores: `rejectPersonalEmails`, `rejectMissingCompany`, `rejectDuplicates`, `suppressionDomains[]`, `personalDomainOverrides[]`. Global defaults are defined as constants in code (not a database row).

**Rationale**: Per-workspace config is a first-class entity that deserves its own table rather than being crammed into the `WorkspaceInstallation.settings` JSONB field. Benefits:
- Type-safe Prisma model with proper validation
- Easy to query, index, and audit
- Clear schema evolution path
- Follows the pattern of `EnrichmentPreset` as a separate config table

**Alternatives considered**:
- **JSONB in `WorkspaceInstallation.settings`**: Rejected — no type safety, no schema validation, harder to query for admin reporting.
- **JSONB in `ManagedClient` (new column)**: Rejected — same JSONB drawbacks, and quality gate config is complex enough to warrant its own table.

## R7: Job Record Integration

**Decision**: Add the following fields to the `Job` model:
- `qualityGateResult` (JSONB): Stores the full gate result (total, passed, filtered, breakdown by reason, unique domains, filtered file URL).
- `qualityGateConfigSnapshot` (JSONB): Snapshot of the config at job submission time (FR-014).

**Rationale**: Spec FR-014 requires snapshotting config at submission time. JSONB is appropriate for snapshots since the schema may evolve and we don't need to query individual fields. This follows the existing pattern of `parsedIntent`, `settingsOverrides`, and `creditRateSnapshot` — all JSONB snapshots on the Job model.

## R8: Slack Message Format for Filtering Summary

**Decision**: Post a Slack Block Kit message in the enrichment thread showing the filtering summary. Format:

```
Quality check: 453 of 500 rows passed. 47 filtered.
- 23 personal email domains
- 15 suppression list matches
- 9 missing company data
[Download filtered rows]
```

If all rows pass (FR-010), no message is posted — zero noise for clean files.

**Rationale**: Matches the spec's example message (US1, scenario 4). Uses existing Block Kit patterns from the codebase. The "Download filtered rows" button links to the S3 presigned URL.

## R9: Admin Dashboard UI Placement

**Decision**: Add quality gate settings as a new tab/section on the existing client detail page (`/clients/:id`), alongside existing workspace settings (spend caps, API limits). Not a separate page.

**Rationale**: Quality gate configuration is workspace-scoped and naturally groups with other workspace settings. The admin dashboard already has a client detail page with workspace settings management. Adding a new section follows the existing UI pattern.

## R10: Email Column Detection for Personal Domain Filtering

**Decision**: Extend `parseFile()` to also detect an email column using keywords: "email", "e-mail", "email_address", "contact_email". The quality gate uses this column to check for personal email domains. If no email column is found, the personal email filter is skipped for that file (graceful degradation).

**Rationale**: The existing parser detects domain and company name columns. Email column detection is the same pattern. Personal email filtering requires knowing which column contains email addresses. Not all files have an email column (some only have domains), so the filter must be optional.
