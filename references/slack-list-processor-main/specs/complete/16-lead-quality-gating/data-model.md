# Data Model: Pre-Enrichment Lead Quality Gating

**Feature**: 16-lead-quality-gating
**Date**: 2026-03-11
**Spec**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

## New Entities

### QualityGateConfig

Per-workspace quality gate configuration. One-to-one relationship with `ManagedClient`.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| id | UUID (PK) | auto | Primary key |
| clientId | UUID (FK → ManagedClient) | required | Unique — one config per client |
| rejectPersonalEmails | Boolean | true | Filter rows with personal email domains |
| rejectMissingCompany | Boolean | true | Filter rows without company name AND without resolvable domain |
| rejectDuplicateEmails | Boolean | true | Remove exact email duplicates (keep first occurrence) |
| deduplicateDomains | Boolean | true | Group duplicate domains for technographic enrichment |
| suppressionDomains | String[] | [] | Workspace-specific blocked domains (root domains, e.g., "competitor.com") |
| personalDomainOverrides | String[] | [] | Additional personal email domains beyond global defaults |
| allowPersonalDomains | String[] | [] | Personal domains to ALLOW (exceptions, e.g., for consultants) |
| createdAt | DateTime | now() | Record creation timestamp |
| updatedAt | DateTime | auto | Last modification timestamp |

**Indexes**:
- Unique index on `clientId`

**Relationships**:
- `QualityGateConfig` → belongs to one `ManagedClient`
- `ManagedClient` → has zero or one `QualityGateConfig`

**Validation Rules**:
- `suppressionDomains`: Each entry must be a valid domain (contains `.`, no protocol, no paths). Normalized on write (lowercase, strip www).
- `personalDomainOverrides`: Same domain validation as suppressionDomains.
- `allowPersonalDomains`: Same domain validation. Must be a subset of the default personal domain list + overrides.

**Notes**:
- When no `QualityGateConfig` exists for a workspace, global defaults apply (all filters ON, empty suppression/override lists).
- Global default personal email domains are defined as a code constant (not a DB row): `gmail.com, yahoo.com, hotmail.com, outlook.com, aol.com, icloud.com, live.com, msn.com, me.com, protonmail.com, ymail.com, mail.com`.

---

## Modified Entities

### Job (existing)

Two new JSONB fields added:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| qualityGateResult | JSONB | null | Full gate output (see schema below). Null if gate not applicable (e.g., tech reports). |
| qualityGateConfigSnapshot | JSONB | null | Frozen copy of the QualityGateConfig at job submission time (FR-014). |

**qualityGateResult JSONB schema**:

```json
{
  "totalRows": 500,
  "passedRows": 453,
  "filteredRows": 47,
  "uniqueDomains": 312,
  "duplicateDomainRows": 141,
  "filterBreakdown": {
    "personalEmail": 23,
    "suppressionDomain": 15,
    "missingCompany": 9,
    "duplicateEmail": 0
  },
  "filteredFileUrl": "https://s3.amazonaws.com/...",
  "filteredFileKey": "jobs/{jobId}/filtered-rows.csv",
  "processingTimeMs": 145
}
```

**qualityGateConfigSnapshot JSONB schema**:

```json
{
  "rejectPersonalEmails": true,
  "rejectMissingCompany": true,
  "rejectDuplicateEmails": true,
  "deduplicateDomains": true,
  "suppressionDomains": ["competitor.com", "vendor.com"],
  "personalDomainOverrides": [],
  "allowPersonalDomains": [],
  "effectivePersonalDomains": ["gmail.com", "yahoo.com", "..."]
}
```

### JobCompany (existing — behavioral change only)

No schema changes. Behavioral change: rows filtered by the quality gate are never persisted as `JobCompany` records. Only rows that PASS the gate become `JobCompany` entries.

### ParsedFile (in-memory type — not a DB entity)

Extended to include detected email column:

| Field | Type | Description |
|-------|------|-------------|
| emailColumn | string \| null | **NEW** — Detected email column header name, or null if none found |

---

## Entity Relationship Diagram

```
ManagedClient (existing)
  │
  ├── 1:0..1 ── QualityGateConfig (NEW)
  │
  └── 1:N ── Job (existing, 2 new JSONB fields)
               │
               └── 1:N ── JobCompany (existing, no schema change)
                            │
                            └── 1:N ── JobContact (existing, no change)
```

## State Transitions

### Quality Gate Processing (in-process, not queued)

```
File Uploaded
  → File Parsed (parseFile)
  → Quality Gate Runs (runQualityGate)
    → Load QualityGateConfig for workspace (or defaults)
    → Snapshot config to job
    → Apply filters in order:
        1. Personal email filter
        2. Missing company filter
        3. Suppression domain filter
        4. Exact email dedup
        5. Domain deduplication (grouping, not removal)
    → Generate filtered-rows CSV (if any filtered)
    → Upload CSV to S3
    → Return QualityGateResult
  → Post filtering summary to Slack (if filteredRows > 0)
  → Create JobCompany records (passed rows only)
  → Enqueue BullMQ enrichment job (with unique domain info)
```

## Migration Notes

- New `QualityGateConfig` table: simple `CREATE TABLE` migration.
- New `Job` columns: `ALTER TABLE jobs ADD COLUMN quality_gate_result JSONB, ADD COLUMN quality_gate_config_snapshot JSONB`. Both nullable, no backfill needed.
- No data migration required for existing jobs — they simply have null gate fields.
- No breaking changes to existing API contracts.
