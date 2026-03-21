# Quickstart: Pre-Enrichment Lead Quality Gating

**Feature**: 16-lead-quality-gating
**Date**: 2026-03-11

## Overview

This feature adds a deterministic quality gate between file parsing and enrichment that filters out junk rows before any API credits are consumed. It consists of:

1. **Quality gate service** — filters rows by personal email, missing data, suppression lists, and duplicates
2. **Filtered CSV generator** — produces a downloadable file of rejected rows with reasons
3. **Per-workspace configuration** — admin dashboard settings for gate rules and suppression lists
4. **Job integration** — gate results stored on the Job record and displayed in Slack

## Prerequisites

- Existing enrichment pipeline operational (file upload → parse → enqueue → BuiltWith/Apollo)
- Prisma schema access for migration
- S3 bucket access for filtered CSV uploads
- Admin dashboard deployed

## Implementation Order

### Phase 1: Core Quality Gate (no config, global defaults only)

1. **Prisma migration**: Add `qualityGateResult` and `qualityGateConfigSnapshot` JSONB columns to `Job` table. Create `QualityGateConfig` table.

2. **Domain utils extension**: Add `stripSubdomain()` and `isPersonalDomain()` to `src/services/file/domainUtils.ts`.

3. **Email column detection**: Extend `parseFile()` to detect email columns.

4. **Filter modules**: Create individual filter functions in `src/services/qualityGate/filters/`:
   - `filterPersonalEmails(rows, emailColumn, personalDomains)` → `{passed, filtered}`
   - `filterMissingCompany(rows, domainColumn, companyColumn)` → `{passed, filtered}`
   - `filterSuppressionDomains(rows, emailColumn, domainColumn, suppressionList)` → `{passed, filtered}`
   - `filterDuplicateEmails(rows, emailColumn)` → `{passed, filtered}`
   - `groupDuplicateDomains(rows, domainColumn)` → `{uniqueDomains, groups}`

5. **Orchestrator**: Create `runQualityGate(rows, config, columns)` in `src/services/qualityGate/qualityGate.ts` that chains all filters and returns `QualityGateResult`.

6. **Filtered CSV**: Create `generateFilteredCsv(filteredRows, headers)` and upload to S3.

7. **Pipeline integration**: Call `runQualityGate()` in `src/listeners/events/message.ts` after `parseFile()` and before `JobCompany` creation / BullMQ enqueue.

8. **Slack summary**: Post filtering summary message in thread (when filteredRows > 0).

### Phase 2: Per-Workspace Configuration

9. **Admin API**: Create CRUD routes at `/api/v1/admin/quality-gate-config/:clientId`.

10. **Config loading**: Create `loadQualityGateConfig(clientId)` that merges workspace overrides with global defaults.

11. **Config snapshot**: Snapshot effective config on job creation (FR-014).

### Phase 3: Admin Dashboard UI

12. **Frontend service**: Create `qualityGateConfig.ts` API client in admin dashboard.

13. **Settings UI**: Add quality gate settings section to client detail page.

14. **Job detail extension**: Show quality gate results in job detail view.

### Phase 4: Testing

15. **Unit tests**: Filter modules, domain utils, config merging.

16. **Integration verification**: Upload test files via Slack, verify filtering summary, download filtered CSV, check job records.

## Key Files to Modify

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `QualityGateConfig` model, extend `Job` with 2 JSONB fields |
| `src/services/file/domainUtils.ts` | Add `stripSubdomain()`, `isPersonalDomain()` |
| `src/services/file/parser.ts` | Add email column detection |
| `src/listeners/events/message.ts` | Insert quality gate call before enqueue |
| `src/listeners/actions/purposeSelection.ts` | Insert quality gate call for contact-only flows |
| `src/routes/admin/index.ts` | Register quality gate config routes |
| `admin-dashboard/src/pages/clients/` | Add quality gate settings UI |

## Key Files to Create

| File | Purpose |
|------|---------|
| `src/services/qualityGate/qualityGate.ts` | Orchestrator: `runQualityGate()` |
| `src/services/qualityGate/types.ts` | Shared types |
| `src/services/qualityGate/config.ts` | Config loading + defaults |
| `src/services/qualityGate/filteredCsv.ts` | CSV generation + S3 upload |
| `src/services/qualityGate/filters/personalEmail.ts` | Personal email filter |
| `src/services/qualityGate/filters/missingCompany.ts` | Missing company filter |
| `src/services/qualityGate/filters/suppression.ts` | Suppression domain filter |
| `src/services/qualityGate/filters/duplicateDomain.ts` | Domain dedup |
| `src/services/qualityGate/filters/duplicateEmail.ts` | Email dedup |
| `src/routes/admin/qualityGateConfig.ts` | Admin CRUD API |
| `admin-dashboard/src/services/qualityGateConfig.ts` | Frontend API client |

## Testing Strategy

- **Unit tests** for each filter module with edge cases (empty rows, null values, Unicode domains)
- **Unit tests** for domain normalization (subdomain stripping, case sensitivity, protocol handling)
- **Unit tests** for config merging (defaults + overrides + allow exceptions)
- **Integration**: Deploy to ECS, upload test CSV via Slack, verify full flow end-to-end
