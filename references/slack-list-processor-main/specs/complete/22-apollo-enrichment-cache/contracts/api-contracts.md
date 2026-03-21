# API Contracts: Apollo Enrichment Cache

**Feature**: 22-apollo-enrichment-cache
**Date**: 2026-03-11
**Base Path**: `/api/admin/cache/apollo`

All endpoints require `adminAuth` middleware. These extend the Feature 17 cache admin routes.

---

## GET /api/admin/cache/apollo/metrics

Returns Apollo cache performance metrics.

**Query Parameters**:

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| period | string | No | "30d" | Time window: "7d" or "30d" |

**Response 200**:

```json
{
  "searchCache": {
    "totalEntries": 4520,
    "activeEntries": 4100,
    "expiredEntries": 420,
    "hitRate7d": 0.35,
    "hitRate30d": 0.30,
    "totalHits7d": 840,
    "totalMisses7d": 1560,
    "totalHits30d": 2800,
    "totalMisses30d": 6500,
    "zeroResultEntries": 312,
    "cacheSizeMb": 12.5
  },
  "contactCache": {
    "totalEntries": 18200,
    "activeEntries": 16800,
    "expiredEntries": 1400,
    "withPhoneData": 8900,
    "withoutPhoneData": 7900,
    "hitRate7d": 0.22,
    "hitRate30d": 0.18,
    "totalHits7d": 420,
    "totalMisses7d": 1490,
    "totalHits30d": 1600,
    "totalMisses30d": 7300,
    "estimatedCreditsSaved": 1600,
    "estimatedCostSavedUsd": 80.00,
    "cacheSizeMb": 35.8
  },
  "topSearchedDomains": [
    { "domain": "salesforce.com", "hitCount": 28 },
    { "domain": "microsoft.com", "hitCount": 22 }
  ],
  "topCachedContacts": [
    { "apolloPersonId": "abc123", "fullName": "John Doe", "hitCount": 15 },
    { "apolloPersonId": "def456", "fullName": "Jane Smith", "hitCount": 12 }
  ]
}
```

**Metric calculations**:
- Search hit rates: `SUM(job.apolloSearchCacheHits) / (SUM(hits) + SUM(misses))` for jobs in period
- Contact hit rates: same pattern with `apolloContactCacheHits/Misses`
- `estimatedCreditsSaved`: `SUM(job.apolloContactCacheHits)` × credits per contact (1 or 2 depending on phone)
- `estimatedCostSavedUsd`: `estimatedCreditsSaved × config.apollo.costPerCredit`

---

## GET /api/admin/cache/apollo/config

Returns Apollo cache configuration (reads from CacheConfig singleton).

**Response 200**:

```json
{
  "apolloSearchTtlDays": 14,
  "apolloContactTtlDays": 30,
  "enabled": true,
  "updatedAt": "2026-03-11T12:00:00Z"
}
```

---

## PUT /api/admin/cache/apollo/config

Updates Apollo cache TTL configuration. Logs to AuditLog.

**Request Body**:

```json
{
  "apolloSearchTtlDays": 10,
  "apolloContactTtlDays": 21
}
```

**Validation**:
- `apolloSearchTtlDays`: integer, min 7, max 30
- `apolloContactTtlDays`: integer, min 14, max 60

**Response 200**:

```json
{
  "apolloSearchTtlDays": 10,
  "apolloContactTtlDays": 21,
  "updatedAt": "2026-03-11T14:30:00Z"
}
```

**Side effects**:
- AuditLog entry: `{ action: "APOLLO_CACHE_CONFIG_UPDATED", metadata: { old, new } }`

---

## POST /api/admin/cache/apollo/purge

Purge Apollo cache entries. Supports purging search cache, contact cache, or both.

**Request Body**:

```json
{
  "target": "search",
  "mode": "all"
}
```

**Validation**:
- `target`: "search", "contact", or "both"
- `mode`: "all" or "expired"

**Response 200**:

```json
{
  "purgedCount": 4520,
  "target": "search",
  "mode": "all"
}
```

**Side effects**:
- AuditLog entry: `{ action: "APOLLO_CACHE_PURGED", metadata: { target, mode, purgedCount } }`

---

## GET /api/admin/cache/apollo/search-entries

Lists search cache entries with pagination.

**Query Parameters**:

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| page | number | No | 1 | Page number |
| limit | number | No | 50 | Entries per page (max 100) |
| search | string | No | - | Filter by domain (partial match) |
| sortBy | string | No | "searchedAt" | Sort: "searchedAt", "hitCount", "resultCount" |
| sortOrder | string | No | "desc" | Sort direction |

**Response 200**:

```json
{
  "entries": [
    {
      "id": "uuid",
      "normalizedDomain": "acme.com",
      "resultCount": 4,
      "hitCount": 8,
      "filterSnapshot": { "personSeniorities": ["c_suite", "vp"] },
      "searchedAt": "2026-03-05T10:00:00Z",
      "expiresAt": "2026-03-19T10:00:00Z"
    }
  ],
  "pagination": { "page": 1, "limit": 50, "total": 4520, "totalPages": 91 }
}
```

---

## GET /api/admin/cache/apollo/contact-entries

Lists contact cache entries with pagination.

**Query Parameters**: Same as search-entries, plus `hasPhoneData` boolean filter.

**Response 200**:

```json
{
  "entries": [
    {
      "id": "uuid",
      "apolloPersonId": "abc123",
      "fullName": "John Doe",
      "email": "john@acme.com",
      "jobTitle": "CTO",
      "hasPhoneData": true,
      "hitCount": 15,
      "enrichedAt": "2026-03-01T10:00:00Z",
      "expiresAt": "2026-03-31T10:00:00Z"
    }
  ],
  "pagination": { "page": 1, "limit": 50, "total": 18200, "totalPages": 364 }
}
```

---

## DELETE /api/admin/cache/apollo/entries/:id

Deletes a single cache entry (search or contact) by ID.

**Query Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| type | string | Yes | "search" or "contact" |

**Response 200**:

```json
{ "deleted": true, "type": "contact", "identifier": "abc123" }
```

**Side effects**:
- AuditLog entry: `{ action: "APOLLO_CACHE_ENTRY_DELETED", metadata: { type, identifier } }`

---

## Internal Service Interfaces (not HTTP)

### ApolloSearchCacheService

```typescript
interface ApolloSearchCacheService {
  /** Batch lookup cached search results for multiple domains with a single filter hash. */
  batchLookup(domains: string[], filterHash: string): Promise<Map<string, ApolloSearchCache>>;

  /** Store or update a search cache entry. Upsert on (normalizedDomain, filterHash). */
  store(entry: SearchCacheStoreInput): Promise<ApolloSearchCache>;

  /** Increment hit count for a cached search entry. */
  recordHit(normalizedDomain: string, filterHash: string): Promise<void>;

  /** Purge expired entries. */
  purgeExpired(): Promise<number>;

  /** Purge all entries. */
  purgeAll(): Promise<number>;
}

interface SearchCacheStoreInput {
  normalizedDomain: string;
  filterHash: string;
  contacts: object[];
  resultCount: number;
  filterSnapshot: object;
  ttlDays: number;
}
```

### ApolloContactCacheService

```typescript
interface ApolloContactCacheService {
  /** Batch lookup cached enrichment data for multiple person IDs. */
  batchLookup(personIds: string[], requirePhone: boolean): Promise<Map<string, ApolloContactCache>>;

  /** Store or update a contact cache entry. Upsert on apolloPersonId. */
  store(entry: ContactCacheStoreInput): Promise<ApolloContactCache>;

  /** Increment hit count for a cached contact. */
  recordHit(apolloPersonId: string): Promise<void>;

  /** Purge expired entries. */
  purgeExpired(): Promise<number>;

  /** Purge all entries. */
  purgeAll(): Promise<number>;
}

interface ContactCacheStoreInput {
  apolloPersonId: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  jobTitle: string | null;
  seniorityLevel: string | null;
  linkedinUrl: string | null;
  timezoneUtc: string | null;
  timezoneLabel: string | null;
  hasPhoneData: boolean;
  directPhone: string | null;
  businessPhone: string | null;
  apolloMetadata: object | null;
  ttlDays: number;
}
```

### FilterHasher

```typescript
/** Compute a deterministic SHA-256 hash of Apollo filter parameters. */
function computeFilterHash(filters: ApolloContactFilters): string;
```
