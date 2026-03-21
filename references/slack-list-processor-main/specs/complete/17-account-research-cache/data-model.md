# Data Model: Account-Level Research Cache

**Feature**: 17-account-research-cache
**Date**: 2026-03-11

## New Models

### DomainEnrichmentCache

Domain-keyed cache of BuiltWith enrichment results. Shared across all workspaces.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto-generated | Primary key |
| normalizedDomain | String | UNIQUE, indexed | Cache key — normalized domain (lowercase, no protocol/www) |
| builtwithResponse | JSONB | NOT NULL | Full BuiltWith API response (technologies, vertical, traffic, etc.) |
| technologies | JSONB | NOT NULL | Extracted technology array from response |
| vertical | String | nullable | Industry vertical from BuiltWith |
| trafficRank | Int | nullable | Quantcast/Majestic traffic rank |
| techSpendTier | String | nullable | Calculated tier: HIGH, MID, LOW, UNCLASSIFIED |
| techSpendScore | Int | nullable | Numeric tech spend score |
| companyName | String | nullable | Company name resolved from BuiltWith |
| locationCountry | String | nullable | Company country |
| locationState | String | nullable | Company state/region |
| locationCity | String | nullable | Company city |
| isComplete | Boolean | default: true | Whether the API returned a complete response |
| hitCount | Int | default: 0 | Number of times this entry was reused from cache |
| enrichedAt | DateTime | NOT NULL, default: now() | When the BuiltWith API call was made |
| expiresAt | DateTime | NOT NULL, indexed | When this entry expires (enrichedAt + TTL) |
| createdAt | DateTime | default: now() | Record creation timestamp |
| updatedAt | DateTime | auto-updated | Last modification timestamp |

**Indexes**:
- `normalizedDomain` (unique) — primary lookup key
- `expiresAt` — purge query performance
- `enrichedAt` — metrics queries (hit rate by time window)
- `techSpendTier` — optional analytics queries

**Prisma schema**:

```prisma
/// Domain-keyed cache of BuiltWith enrichment results (FR-001).
/// Shared across all workspaces — BuiltWith data is public, not tenant-specific.
model DomainEnrichmentCache {
  id                String   @id @default(uuid()) @db.Uuid
  normalizedDomain  String   @unique @map("normalized_domain")
  builtwithResponse Json     @map("builtwith_response") @db.JsonB
  technologies      Json     @map("technologies") @db.JsonB
  vertical          String?
  trafficRank       Int?     @map("traffic_rank")
  techSpendTier     String?  @map("tech_spend_tier")
  techSpendScore    Int?     @map("tech_spend_score")
  companyName       String?  @map("company_name")
  locationCountry   String?  @map("location_country")
  locationState     String?  @map("location_state")
  locationCity      String?  @map("location_city")
  isComplete        Boolean  @default(true) @map("is_complete")
  hitCount          Int      @default(0) @map("hit_count")
  enrichedAt        DateTime @default(now()) @map("enriched_at")
  expiresAt         DateTime @map("expires_at")
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  @@index([expiresAt])
  @@index([enrichedAt])
  @@index([techSpendTier])
  @@map("domain_enrichment_cache")
}
```

---

### CacheConfig

Global cache configuration. Single row (singleton pattern).

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto-generated | Primary key |
| ttlDays | Int | NOT NULL, default: 60 | Cache TTL in days (range: 30-90) |
| enabled | Boolean | default: true | Master cache toggle |
| createdAt | DateTime | default: now() | Record creation timestamp |
| updatedAt | DateTime | auto-updated | Last modification timestamp |

**Prisma schema**:

```prisma
/// Global cache configuration (FR-014). Singleton row.
model CacheConfig {
  id        String   @id @default(uuid()) @db.Uuid
  ttlDays   Int      @default(60) @map("ttl_days")
  enabled   Boolean  @default(true)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("cache_config")
}
```

---

## Modified Models

### Job

Add cache-related fields to track per-job cache performance.

| New Field | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| cacheHits | Int | default: 0 | Domains served from cache in this job |
| cacheMisses | Int | default: 0 | Domains that required fresh BuiltWith API calls |
| forceRefresh | Boolean | default: false | Whether user disabled caching for this job |

**Prisma additions**:

```prisma
// Add to existing Job model:
cacheHits       Int      @default(0) @map("cache_hits")
cacheMisses     Int      @default(0) @map("cache_misses")
forceRefresh    Boolean  @default(false) @map("force_refresh")
```

---

## Entity Relationships

```
DomainEnrichmentCache (standalone)
  - No FK relationships — shared across workspaces
  - Referenced by: technographic worker (lookup/upsert)
  - Referenced by: cache purge worker (delete expired)
  - Referenced by: admin cache routes (metrics/config)

CacheConfig (standalone singleton)
  - No FK relationships
  - Read by: technographic worker (get TTL for new entries)
  - Read/written by: admin cache routes (config management)

Job (existing, extended)
  - New fields: cacheHits, cacheMisses, forceRefresh
  - cacheHits + cacheMisses used in job summary Slack message
  - forceRefresh set from Slack enrichment confirmation flow
```

---

## State Transitions

### DomainEnrichmentCache Entry Lifecycle

```
[Not Exists] → CREATED (first enrichment of this domain)
     ↓
[Active] → HIT (hitCount incremented on each cache hit)
     ↓
[Active] → REFRESHED (upsert with fresh API data, expiresAt reset)
     ↓
[Expired] → PURGED (daily purge worker deletes expired entries)
```

- **CREATED**: enrichDomain result stored with `expiresAt = now() + TTL`
- **HIT**: `hitCount` incremented atomically; no other fields change
- **REFRESHED**: On force-refresh or when an incomplete entry is re-enriched; all fields overwritten via upsert, `expiresAt` reset
- **PURGED**: Daily worker deletes entries where `expiresAt < NOW()`

---

## Validation Rules

- `normalizedDomain`: Must be non-empty, lowercase, no protocol prefix, no trailing slashes
- `ttlDays`: Must be integer in range [30, 90]
- `builtwithResponse`: Must be valid JSON object (not null, not empty)
- `expiresAt`: Must be > `enrichedAt`
- `hitCount`: Must be >= 0

---

## Migration Notes

- New tables: `domain_enrichment_cache`, `cache_config`
- New columns on `jobs` table: `cache_hits`, `cache_misses`, `force_refresh`
- Seed a default `CacheConfig` row with `ttlDays: 60, enabled: true`
- No data migration needed — cache starts empty and populates organically
