# Data Model: Apollo Enrichment Cache

**Feature**: 22-apollo-enrichment-cache
**Date**: 2026-03-11

## New Models

### ApolloSearchCache

Cached people search result for a normalized domain + filter combination. Shared across all workspaces.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto-generated | Primary key |
| normalizedDomain | String | NOT NULL, indexed | Normalized domain (lowercase, no protocol/www) |
| filterHash | String | NOT NULL | SHA-256 hash of sorted filter arrays |
| contacts | JSONB | NOT NULL | Array of matched contacts: [{apolloPersonId, fullName, jobTitle, seniorityLevel, hasEmail, hasDirectPhone}] |
| resultCount | Int | NOT NULL | Number of contacts returned (can be 0) |
| filterSnapshot | JSONB | NOT NULL | Original filter values for debugging: {personSeniorities, personTitles, personDepartments, personFunctions, perPage} |
| hitCount | Int | default: 0 | Number of times this entry was reused from cache |
| searchedAt | DateTime | NOT NULL, default: now() | When the Apollo API call was made |
| expiresAt | DateTime | NOT NULL, indexed | When this entry expires (searchedAt + TTL) |
| createdAt | DateTime | default: now() | Record creation timestamp |
| updatedAt | DateTime | auto-updated | Last modification timestamp |

**Indexes**:
- `(normalizedDomain, filterHash)` (unique composite) — primary lookup key
- `expiresAt` — purge query performance
- `searchedAt` — metrics queries

**Prisma schema**:

```prisma
/// Cached Apollo people search result for a domain + filter combination (FR-001).
/// Shared across all workspaces — search results are not tenant-specific.
model ApolloSearchCache {
  id               String   @id @default(uuid()) @db.Uuid
  normalizedDomain String   @map("normalized_domain")
  filterHash       String   @map("filter_hash")
  contacts         Json     @db.JsonB
  resultCount      Int      @map("result_count")
  filterSnapshot   Json     @map("filter_snapshot") @db.JsonB
  hitCount         Int      @default(0) @map("hit_count")
  searchedAt       DateTime @default(now()) @map("searched_at")
  expiresAt        DateTime @map("expires_at")
  createdAt        DateTime @default(now()) @map("created_at")
  updatedAt        DateTime @updatedAt @map("updated_at")

  @@unique([normalizedDomain, filterHash])
  @@index([expiresAt])
  @@index([searchedAt])
  @@map("apollo_search_cache")
}
```

---

### ApolloContactCache

Cached bulk enrichment result for an individual contact. Shared across all workspaces.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto-generated | Primary key |
| apolloPersonId | String | UNIQUE, indexed | Apollo's stable person identifier |
| fullName | String | nullable | Full name from enrichment |
| firstName | String | nullable | First name |
| lastName | String | nullable | Last name |
| email | String | nullable | Email address |
| jobTitle | String | nullable | Job title |
| seniorityLevel | String | nullable | Seniority level |
| linkedinUrl | String | nullable | LinkedIn profile URL |
| timezoneUtc | String | nullable | Timezone UTC offset |
| timezoneLabel | String | nullable | Timezone display name |
| hasPhoneData | Boolean | default: false | Whether phone numbers are included in this entry |
| directPhone | String | nullable | Direct dial phone (if revealed) |
| businessPhone | String | nullable | HQ/business phone (if revealed) |
| apolloMetadata | JSONB | nullable | Full bulk_match response for additional fields |
| hitCount | Int | default: 0 | Number of times this entry was reused from cache |
| enrichedAt | DateTime | NOT NULL, default: now() | When the bulk enrichment call was made |
| expiresAt | DateTime | NOT NULL, indexed | When this entry expires (enrichedAt + TTL) |
| createdAt | DateTime | default: now() | Record creation timestamp |
| updatedAt | DateTime | auto-updated | Last modification timestamp |

**Indexes**:
- `apolloPersonId` (unique) — primary lookup key
- `expiresAt` — purge query performance
- `enrichedAt` — metrics queries

**Prisma schema**:

```prisma
/// Cached Apollo bulk enrichment result for an individual contact (FR-008).
/// Shared across all workspaces — contact professional data is not tenant-specific.
model ApolloContactCache {
  id              String   @id @default(uuid()) @db.Uuid
  apolloPersonId  String   @unique @map("apollo_person_id")
  fullName        String?  @map("full_name")
  firstName       String?  @map("first_name")
  lastName        String?  @map("last_name")
  email           String?
  jobTitle        String?  @map("job_title")
  seniorityLevel  String?  @map("seniority_level")
  linkedinUrl     String?  @map("linkedin_url")
  timezoneUtc     String?  @map("timezone_utc")
  timezoneLabel   String?  @map("timezone_label")
  hasPhoneData    Boolean  @default(false) @map("has_phone_data")
  directPhone     String?  @map("direct_phone")
  businessPhone   String?  @map("business_phone")
  apolloMetadata  Json?    @map("apollo_metadata") @db.JsonB
  hitCount        Int      @default(0) @map("hit_count")
  enrichedAt      DateTime @default(now()) @map("enriched_at")
  expiresAt       DateTime @map("expires_at")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@index([expiresAt])
  @@index([enrichedAt])
  @@map("apollo_contact_cache")
}
```

---

## Modified Models

### CacheConfig (from Feature 17)

Add Apollo-specific TTL fields to the existing singleton.

| New Field | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| apolloSearchTtlDays | Int | default: 14 | Apollo search cache TTL (range: 7-30 days) |
| apolloContactTtlDays | Int | default: 30 | Apollo contact cache TTL (range: 14-60 days) |

**Prisma additions**:

```prisma
// Add to existing CacheConfig model (from Feature 17):
apolloSearchTtlDays  Int @default(14) @map("apollo_search_ttl_days")
apolloContactTtlDays Int @default(30) @map("apollo_contact_ttl_days")
```

---

### Job (existing, extended)

Add Apollo cache tracking fields alongside Feature 17's BuiltWith cache fields.

| New Field | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| apolloSearchCacheHits | Int | default: 0 | Companies served from search cache |
| apolloSearchCacheMisses | Int | default: 0 | Companies that required fresh Apollo search |
| apolloContactCacheHits | Int | default: 0 | Contacts served from enrichment cache |
| apolloContactCacheMisses | Int | default: 0 | Contacts that required fresh bulk enrichment |

**Prisma additions**:

```prisma
// Add to existing Job model:
apolloSearchCacheHits    Int @default(0) @map("apollo_search_cache_hits")
apolloSearchCacheMisses  Int @default(0) @map("apollo_search_cache_misses")
apolloContactCacheHits   Int @default(0) @map("apollo_contact_cache_hits")
apolloContactCacheMisses Int @default(0) @map("apollo_contact_cache_misses")
```

---

## Entity Relationships

```
ApolloSearchCache (standalone)
  - No FK relationships — shared across workspaces
  - Composite unique: (normalizedDomain, filterHash)
  - Referenced by: contact/combined workers (batch lookup/upsert)
  - Referenced by: cache purge worker (delete expired)
  - Referenced by: admin cache routes (metrics/config)

ApolloContactCache (standalone)
  - No FK relationships — shared across workspaces
  - Unique: apolloPersonId
  - Referenced by: contact/combined workers (batch lookup/upsert)
  - Referenced by: cache purge worker (delete expired)
  - Referenced by: admin cache routes (metrics/config)

CacheConfig (singleton, extended)
  - New fields: apolloSearchTtlDays, apolloContactTtlDays
  - Read by: contact/combined workers (get TTLs for new entries)
  - Read/written by: admin cache routes (config management)

Job (existing, extended)
  - New fields: 4 Apollo cache counters
  - Used in Slack job summary message
  - Used in admin dashboard metrics aggregation
```

---

## State Transitions

### ApolloSearchCache Entry Lifecycle

```
[Not Exists] → CREATED (first search for this domain + filter combo)
     ↓
[Active] → HIT (hitCount incremented on each reuse)
     ↓
[Active] → REFRESHED (upsert on force-refresh or re-search with updated results)
     ↓
[Expired] → PURGED (daily purge worker)
```

### ApolloContactCache Entry Lifecycle

```
[Not Exists] → CREATED (first enrichment of this person, hasPhoneData=false)
     ↓
[Active, no phone] → HIT (reused for non-phone jobs)
     ↓
[Active, no phone] → UPGRADED (re-enriched with phone reveal → hasPhoneData=true)
     ↓
[Active, with phone] → HIT (reused for all jobs including phone-required)
     ↓
[Expired] → PURGED (daily purge worker)
```

---

## Validation Rules

- `normalizedDomain`: Must be non-empty, lowercase, no protocol prefix (use Feature 17 domainNormalizer)
- `filterHash`: Must be non-empty, 64-character hex string (SHA-256)
- `apolloPersonId`: Must be non-empty string
- `apolloSearchTtlDays`: Integer in range [7, 30]
- `apolloContactTtlDays`: Integer in range [14, 60]
- `contacts` (JSONB): Must be valid JSON array (can be empty for zero-result searches)
- `expiresAt`: Must be > `searchedAt` / `enrichedAt`
- `hitCount`: Must be >= 0

---

## Migration Notes

- New tables: `apollo_search_cache`, `apollo_contact_cache`
- New columns on `cache_config`: `apollo_search_ttl_days`, `apollo_contact_ttl_days`
- New columns on `jobs`: 4 Apollo cache counter fields
- Update seed/migration for CacheConfig to include default Apollo TTL values
- No data migration needed — caches start empty and populate organically
- Feature 17 must be deployed first (CacheConfig table and base columns must exist)
