# Feature Specification: Pre-Enrichment Lead Quality Gating

**Feature Branch**: `16-lead-quality-gating`
**Created**: 2026-03-10
**Status**: Draft
**Input**: Gap analysis from sales_engineer_agents_framework.md - Section 6.1 "Hard Gate" recommends rejecting obvious junk before any API enrichment to reduce costs.

## Context

Every enrichment job consumes BuiltWith and Apollo API credits. Currently, ALL rows in an uploaded file are sent through the enrichment pipeline regardless of data quality. Rows with invalid emails, personal domains, competitor companies, duplicate domains, or missing required fields still consume credits but produce no usable output. This feature adds a deterministic pre-enrichment quality gate that filters out low-quality rows before API calls are made, saving credits and improving output quality.

## Clarifications

### Session 2026-03-10

- Q: Should filtered-out rows be silently dropped or reported to the user? -> A: Reported. The user should see a summary of how many rows were filtered and why, with the option to download the filtered-out rows as a separate file for review.
- Q: Should the quality gate be configurable per client/workspace? -> A: Yes. Global defaults apply, but administrators can override settings per workspace (e.g., a client in education might want to allow .edu domains).
- Q: Should the gate run before or after file parsing? -> A: After parsing, before enrichment. The file must be parsed to inspect row data.
- Q: Should personal email domains (gmail, yahoo, etc.) always be rejected? -> A: By default yes, but configurable. Some clients enrich individual consultants who only have personal emails.
- Q: How should competitor/vendor detection work? -> A: Admin maintains a suppression list of domains per workspace. If a row's domain matches, it's filtered out.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Automatic Quality Filtering Before Enrichment (Priority: P1)

As a BDR manager, I need the system to automatically filter out low-quality rows from my uploaded lists before consuming API credits, so that I only pay for enriching rows that will produce useful results.

**Why this priority**: Every filtered row saves API credits. With lists of 1,000+ rows, even a 10% junk rate translates to significant wasted spend on BuiltWith and Apollo calls.

**Independent Test**: Upload a CSV with a mix of valid business emails, personal emails, known competitor domains, and rows with missing company data. Verify that only valid rows proceed to enrichment and a filtering summary is displayed.

**Acceptance Scenarios**:

1. **Given** a user uploads a 500-row CSV for enrichment, **When** the quality gate runs, **Then** rows with personal email domains (gmail.com, yahoo.com, hotmail.com, outlook.com, etc.) are filtered out by default.
2. **Given** a user uploads a CSV, **When** the quality gate detects rows without a company name AND without a domain, **Then** those rows are filtered out as unresolvable.
3. **Given** a workspace has a suppression list containing "competitor.com", **When** a CSV contains rows with @competitor.com emails, **Then** those rows are filtered out.
4. **Given** the quality gate filters 47 rows from a 500-row file, **When** the filtering completes, **Then** the user sees a Slack message: "Quality check: 453 of 500 rows passed. 47 filtered (23 personal email, 15 competitor domain, 9 missing company data). Download filtered rows."
5. **Given** the filtered-out rows, **When** the user clicks "Download filtered rows", **Then** they receive a CSV containing only the filtered rows with an added column "Filter Reason" explaining why each was excluded.
6. **Given** a file where ALL rows pass the quality gate, **When** filtering completes, **Then** enrichment proceeds immediately with no filtering message (no noise).

---

### User Story 2 - Configurable Quality Gate Rules (Priority: P2)

As a platform administrator, I need to configure quality gate rules per workspace so that different clients can have different filtering criteria based on their use case.

**Why this priority**: Not all clients have the same data quality standards. Education clients may need .edu personal domains. Some clients work with freelancers who only have gmail addresses. Flexibility prevents false positives.

**Independent Test**: Configure a workspace to allow personal email domains, upload a CSV with gmail addresses, and verify they pass through to enrichment.

**Acceptance Scenarios**:

1. **Given** the admin dashboard workspace settings, **When** an administrator views the quality gate configuration, **Then** they see toggles for: reject personal emails (default: on), reject missing company (default: on), reject duplicate emails (default: on), deduplicate domains for technographic enrichment (default: on), and a suppression domain list.
2. **Given** a workspace with "reject personal emails" turned off, **When** a CSV with gmail addresses is uploaded, **Then** those rows pass through to enrichment.
3. **Given** a workspace's suppression domain list, **When** an administrator adds "vendor.com" to the list, **Then** future uploads filter out rows with @vendor.com emails.
4. **Given** global default settings, **When** a new workspace is created, **Then** it inherits the global defaults for all quality gate rules.
5. **Given** a workspace override, **When** the administrator resets to defaults, **Then** the workspace reverts to global quality gate settings.

---

### User Story 3 - Duplicate Domain Detection (Priority: P2)

As a BDR manager, I need duplicate domains within the same file to be detected and consolidated so that I don't pay for multiple BuiltWith lookups for the same company.

**Why this priority**: Lists often contain multiple contacts from the same company. BuiltWith charges per domain lookup. Enriching the same domain 10 times wastes 9 lookups worth of credits.

**Independent Test**: Upload a CSV with 20 rows from 5 unique domains. Verify that only 5 BuiltWith domain lookups are made.

**Acceptance Scenarios**:

1. **Given** a CSV with 20 rows containing 5 unique domains, **When** the quality gate runs, **Then** it identifies 15 duplicate domain rows and groups them under 5 unique domains for technographic enrichment.
2. **Given** duplicate domains are detected, **When** the filtering summary is displayed, **Then** it shows: "5 unique domains detected across 20 rows. Technographic enrichment will run for 5 domains."
3. **Given** domain variants (acme.com, www.acme.com, ACME.COM), **When** normalization runs, **Then** they are treated as the same domain.
4. **Given** all 20 rows still need contact enrichment, **When** contact enrichment runs, **Then** all 20 contacts are enriched individually (deduplication applies only to domain-level lookups).

---

### Edge Cases

- What happens when a file has only personal email rows? The quality gate filters all rows and posts: "All 50 rows were filtered out. No rows qualify for enrichment." with a download link for review.
- What happens when a suppression domain matches a subdomain (marketing.competitor.com)? Domain normalization strips subdomains before matching, so marketing.competitor.com matches competitor.com.
- What happens when the same email appears multiple times in a file? The system flags exact email duplicates and keeps only the first occurrence. Duplicate contacts are reported in the summary.
- What happens when a row has a valid email but no company name? If the email has a business domain (not personal), the system proceeds — the domain can be used for company resolution.
- What happens when quality gate rules are changed while a job is queued? Jobs use the rules snapshotted at submission time.

## Requirements _(mandatory)_

### Functional Requirements

**Quality Gate Pipeline**
- **FR-001**: System MUST run a quality gate check on all parsed rows BEFORE any enrichment API calls are made.
- **FR-002**: System MUST filter rows with personal email domains (configurable list, default: gmail.com, yahoo.com, hotmail.com, outlook.com, aol.com, icloud.com, live.com, msn.com, me.com, protonmail.com, ymail.com, mail.com).
- **FR-003**: System MUST filter rows with no company name AND no resolvable domain (email domain or website field).
- **FR-004**: System MUST filter rows whose email domain matches the workspace's suppression list.
- **FR-005**: System MUST detect and group duplicate domains within a file to avoid redundant BuiltWith lookups.
- **FR-006**: System MUST normalize domains before comparison (lowercase, strip protocol, www, subdomains, trailing slashes).
- **FR-007**: System MUST detect exact email duplicates within a file and keep only the first occurrence.
- **FR-008**: System MUST produce a filtering summary showing total rows, passed rows, filtered rows broken down by reason.
- **FR-009**: System MUST generate a downloadable CSV of filtered-out rows with a "Filter Reason" column.
- **FR-010**: System MUST NOT display a filtering message when all rows pass (zero noise for clean files).

**Configuration**
- **FR-011**: System MUST support global default quality gate settings.
- **FR-012**: System MUST support per-workspace overrides of quality gate settings.
- **FR-013**: Quality gate settings MUST include: reject personal emails (boolean), reject missing company (boolean), reject duplicate emails (boolean), deduplicate domains for technographic enrichment (boolean), suppression domain list (array of strings).
- **FR-014**: System MUST snapshot quality gate settings at job submission time so mid-job configuration changes do not affect in-progress jobs.

**Integration**
- **FR-015**: The quality gate MUST integrate into the existing enrichment pipeline between file parsing and the enrichment worker.
- **FR-016**: The domain deduplication MUST reduce the number of BuiltWith domain lookups to unique domains only.
- **FR-017**: Filtered rows and duplicate domain counts MUST be reflected in the job's API usage tracking.

### Key Entities

- **QualityGateConfig**: Per-workspace quality gate settings. Contains: rejectPersonalEmails (boolean), rejectMissingCompany (boolean), rejectDuplicateEmails (boolean), deduplicateDomains (boolean), suppressionDomains (string array), personalDomainOverrides (string array, additions beyond the global default list), allowPersonalDomains (string array, exceptions to allow specific personal domains through).
- **QualityGateResult**: Output of the quality gate for a single job. Contains: totalRows, passedRows, filteredRows, filterBreakdown (by reason), uniqueDomains, duplicateDomains, filteredFileUrl (S3 link to filtered-out rows CSV).

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Quality gate reduces BuiltWith API calls by at least 15% on average across all enrichment jobs (measured by comparing unique domains to total rows).
- **SC-002**: Zero personal email domains reach the enrichment pipeline when the personal email filter is enabled.
- **SC-003**: Quality gate processing adds less than 2 seconds to job startup time for files up to 5,000 rows.
- **SC-004**: Filtering summary is displayed to the user within 5 seconds of file upload.
- **SC-005**: 100% of filtered-out rows are available for download with accurate filter reasons.
- **SC-006**: Suppression domain matching correctly blocks 100% of matching domains including subdomain variants.

## Assumptions

- The quality gate runs in-process during the file parsing phase, not as a separate queue job.
- Domain normalization reuses the existing domainUtils.ts utilities.
- The personal email domain list is seeded with the 12 most common free email providers and can be extended via admin settings.
- Suppression lists are workspace-scoped and managed by administrators via the admin dashboard.
- The filtered-out rows CSV is uploaded to S3 and delivered via presigned URL (same pattern as enrichment results).
- Quality gate does not use any AI/LLM — it is purely deterministic.
