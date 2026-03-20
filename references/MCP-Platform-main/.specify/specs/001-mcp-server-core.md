# Spec 001: BuildWith MCP Server - Core Implementation

**Status:** Draft
**Priority:** P0 (Critical)
**Estimated Effort:** 40 hours
**Dependencies:** None

---

## Overview

Implement a production-ready MCP server for the BuildWith API that provides technology profiling capabilities through the Model Context Protocol. The server must respect API rate limits, implement robust error handling, and provide a reliable interface for AI assistants.

## Goals

1. **Provide MCP-compliant API** access to BuildWith technology profiling services
2. **Respect rate limits** (10 req/s, 8 concurrent) with proper backoff strategies
3. **Implement caching** to minimize API calls and improve response times
4. **Ensure reliability** through comprehensive error handling and monitoring

## Non-Goals

- Premium API support (Financial, Product, Trust) - deferred to Phase 2
- Web UI or dashboard - CLI/MCP interface only
- Multi-tenant support - single API key per instance

---

## Requirements

### Functional Requirements

#### FR-1: MCP Server Implementation
**Priority:** P0

The server must implement the MCP protocol specification:
- **stdio transport** for communication
- **Tool definitions** for BuildWith APIs
- **Resource handling** for cached data
- **Proper error responses** following MCP spec

**Acceptance Criteria:**
- [ ] Server starts and accepts MCP connections
- [ ] Implements tools/list, tools/call endpoints
- [ ] Handles initialize/initialized handshake
- [ ] Returns proper JSON-RPC responses

#### FR-2: BuildWith API Integration
**Priority:** P0

Support for core BuildWith APIs:

**2.1 Free API**
- Endpoint: `/free-api`
- Rate Limit: 1 req/s
- Response: Basic technology counts

**2.2 Domain API**
- Endpoint: `/domain-api`
- Parameters: domain, hideAll, onlyLiveTechnologies, noMetaData
- Response: Comprehensive technology stack
- Rate Limit: 10 req/s, 8 concurrent

**2.3 Lists API**
- Endpoint: `/lists-api`
- Parameters: technology, includeMetaData, offset, since
- Response: List of domains using technology
- Rate Limit: 10 req/s, 8 concurrent

**Acceptance Criteria:**
- [ ] Free API tool implemented and functional
- [ ] Domain API tool with all parameters
- [ ] Lists API tool with pagination support
- [ ] All tools validate parameters
- [ ] All tools return properly formatted responses

#### FR-3: Rate Limiting
**Priority:** P0

Implement comprehensive rate limiting:

**3.1 Request Rate Limiting**
- Maximum 10 requests per second
- Token bucket algorithm
- Per-second sliding window

**3.2 Concurrent Request Limiting**
- Maximum 8 concurrent requests
- Queue excess requests
- FIFO queue with timeout

**3.3 429 Error Handling**
- Detect 429 (Too Many Requests) responses
- Implement exponential backoff with jitter
- Retry with increasing delays: 1s, 2s, 4s, 8s
- Max backoff: 60s
- Add random jitter: 0-1s

**Acceptance Criteria:**
- [ ] Never exceed 10 req/s rate limit
- [ ] Never exceed 8 concurrent requests
- [ ] 429 errors trigger backoff
- [ ] Failed requests retry with backoff
- [ ] Max retry count respected (3 retries)
- [ ] Metrics tracked for rate limit violations

#### FR-4: Caching
**Priority:** P0

Implement in-memory caching to reduce API calls:

**4.1 Cache Strategy**
- Cache key: `${endpoint}:${params_hash}`
- Default TTL: 1 hour (3600s)
- Max cache size: 1000 entries
- Eviction: LRU (Least Recently Used)

**4.2 Cache Configuration**
- Configurable TTL per endpoint
- Configurable max size
- Cache enable/disable per endpoint

**4.3 Cache Invalidation**
- TTL-based expiration
- Manual invalidation API
- Size-based eviction

**Acceptance Criteria:**
- [ ] Cache hits return instantly
- [ ] Cache misses fetch from API
- [ ] TTL expiration works correctly
- [ ] LRU eviction when size exceeded
- [ ] Cache metrics available (hit/miss ratio)

#### FR-5: Error Handling
**Priority:** P0

Comprehensive error handling for all failure modes:

**5.1 Error Categories**
```typescript
enum ErrorCategory {
  RATE_LIMIT = 'RATE_LIMIT',      // 429
  AUTHENTICATION = 'AUTH',         // 401, 403
  VALIDATION = 'VALIDATION',       // 400
  SERVER_ERROR = 'SERVER',         // 500+
  NETWORK = 'NETWORK',             // Connection failures
  CLIENT = 'CLIENT'                // Client errors
}
```

**5.2 Error Responses**
- Include error category
- Include actionable message
- Include request ID for tracking
- Include retry-ability flag

**5.3 Error Logging**
- Log all errors with context
- Include request/response details (sanitized)
- Track error rates by category

**Acceptance Criteria:**
- [ ] All error types properly categorized
- [ ] Error messages are clear and actionable
- [ ] Errors logged with full context
- [ ] No sensitive data in logs
- [ ] Error metrics tracked

#### FR-6: Configuration
**Priority:** P0

Support configuration via environment variables:

```bash
# Required
BUILTWITH_API_KEY=xxx           # API key

# Optional with defaults
MCP_CACHE_TTL=3600              # Cache TTL (seconds)
MCP_CACHE_SIZE=1000             # Max cache entries
MCP_RATE_LIMIT_RPS=10           # Requests per second
MCP_MAX_CONCURRENT=8            # Max concurrent requests
MCP_LOG_LEVEL=info              # debug|info|warn|error
MCP_RETRY_MAX=3                 # Max retry attempts
MCP_RETRY_BACKOFF_MS=1000       # Initial backoff delay
```

**Acceptance Criteria:**
- [ ] All config loaded from environment
- [ ] Defaults applied when not specified
- [ ] Config validation on startup
- [ ] Invalid config prevents startup with clear error

---

### Non-Functional Requirements

#### NFR-1: Performance
- **Latency:** P95 < 500ms for cached requests
- **Latency:** P95 < 2s for API requests
- **Throughput:** Support full 10 req/s rate
- **Memory:** < 500MB RAM usage

#### NFR-2: Reliability
- **Availability:** Server uptime > 99.9%
- **Error Rate:** < 0.1% non-user errors
- **Recovery:** Auto-recover from transient failures

#### NFR-3: Maintainability
- **Test Coverage:** > 80%
- **Type Coverage:** > 95%
- **Documentation:** All public APIs documented
- **Code Style:** ESLint + Prettier enforced

#### NFR-4: Security
- **API Key:** Secure storage, no logging
- **Input Validation:** All inputs validated
- **Dependencies:** No known vulnerabilities
- **Audit:** Request logging (sanitized)

---

## Technical Design

### Architecture

```
┌─────────────────────────────────────────┐
│         MCP Client (Claude Code)         │
└────────────────┬────────────────────────┘
                 │ stdio/JSON-RPC
┌────────────────▼────────────────────────┐
│           MCP Server Layer               │
│  ┌────────────────────────────────────┐ │
│  │  Transport (stdio)                  │ │
│  │  - JSON-RPC handler                 │ │
│  │  - Tool routing                     │ │
│  └────────────┬───────────────────────┘ │
└───────────────┼─────────────────────────┘
                │
┌───────────────▼─────────────────────────┐
│          Service Layer                   │
│  ┌────────────────────────────────────┐ │
│  │  BuildWith Service                  │ │
│  │  - API call orchestration           │ │
│  │  - Response formatting              │ │
│  └────────────┬───────────────────────┘ │
└───────────────┼─────────────────────────┘
                │
┌───────────────▼─────────────────────────┐
│         API Client Layer                 │
│  ┌────────────────────────────────────┐ │
│  │  Rate Limiter                       │ │
│  │  - Token bucket (10 req/s)          │ │
│  │  - Concurrent limiter (8 max)       │ │
│  ├────────────────────────────────────┤ │
│  │  HTTP Client                        │ │
│  │  - Request/response handling        │ │
│  │  - Retry with backoff               │ │
│  ├────────────────────────────────────┤ │
│  │  Cache Manager                      │ │
│  │  - In-memory LRU cache              │ │
│  │  - TTL management                   │ │
│  └────────────┬───────────────────────┘ │
└───────────────┼─────────────────────────┘
                │
┌───────────────▼─────────────────────────┐
│       BuildWith API                      │
│  - Free API                              │
│  - Domain API                            │
│  - Lists API                             │
└──────────────────────────────────────────┘
```

### Key Components

#### 1. Rate Limiter (Token Bucket)
```typescript
class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per ms

  async acquire(): Promise<void> {
    // Refill tokens based on time elapsed
    // Wait if no tokens available
    // Consume token when available
  }
}
```

#### 2. Concurrent Request Limiter
```typescript
class ConcurrentLimiter {
  private active: number = 0;
  private readonly max: number;
  private queue: Array<() => void> = [];

  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    // Queue request
    await new Promise(resolve => this.queue.push(resolve));
  }

  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}
```

#### 3. Retry with Backoff
```typescript
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  for (let i = 0; i < options.maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (!isRetryable(error)) throw error;

      const delay = Math.min(
        options.initialDelay * Math.pow(2, i) + Math.random() * 1000,
        options.maxDelay
      );

      await sleep(delay);
    }
  }
  throw new Error('Max retries exceeded');
}
```

#### 4. Cache Manager
```typescript
class LRUCache<K, V> {
  private cache: Map<K, CacheEntry<V>>;
  private readonly maxSize: number;
  private readonly ttl: number;

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return undefined;
    }
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    this.cache.set(key, {
      value,
      expiry: Date.now() + this.ttl
    });
  }
}
```

### MCP Tool Definitions

#### Tool: builtwith_free_lookup
```typescript
{
  name: "builtwith_free_lookup",
  description: "Get basic technology information for a domain (Free API)",
  inputSchema: {
    type: "object",
    properties: {
      domain: {
        type: "string",
        description: "Domain to lookup (e.g., example.com)"
      }
    },
    required: ["domain"]
  }
}
```

#### Tool: builtwith_domain_lookup
```typescript
{
  name: "builtwith_domain_lookup",
  description: "Get comprehensive technology stack for a domain",
  inputSchema: {
    type: "object",
    properties: {
      domain: {
        type: "string",
        description: "Domain to analyze"
      },
      hideMetadata: {
        type: "boolean",
        description: "Hide descriptions, links, tags, categories",
        default: false
      },
      onlyLive: {
        type: "boolean",
        description: "Return only currently active technologies",
        default: false
      }
    },
    required: ["domain"]
  }
}
```

#### Tool: builtwith_list_sites
```typescript
{
  name: "builtwith_list_sites",
  description: "Find websites using specific technology",
  inputSchema: {
    type: "object",
    properties: {
      technology: {
        type: "string",
        description: "Technology identifier (e.g., 'WordPress', 'React')"
      },
      limit: {
        type: "number",
        description: "Maximum number of results",
        default: 100
      },
      includeMetadata: {
        type: "boolean",
        description: "Include contact and company information",
        default: false
      }
    },
    required: ["technology"]
  }
}
```

---

## Implementation Plan

### Phase 1: Foundation (8 hours)
**Deliverables:**
- [ ] Project setup (TypeScript, ESLint, Prettier, vitest)
- [ ] MCP SDK integration
- [ ] Basic server structure
- [ ] Configuration loading
- [ ] Logger setup

**Tasks:**
1. Initialize Node.js project with TypeScript
2. Install dependencies (@modelcontextprotocol/sdk, zod, etc.)
3. Setup build configuration (tsconfig.json)
4. Configure linting and formatting
5. Setup test framework (vitest)
6. Create configuration loader with validation
7. Setup structured logging

### Phase 2: Core Infrastructure (12 hours)
**Deliverables:**
- [ ] Rate limiter (token bucket)
- [ ] Concurrent request limiter
- [ ] Retry with backoff
- [ ] Cache manager (LRU)
- [ ] HTTP client wrapper

**Tasks:**
1. Implement TokenBucketRateLimiter class
2. Implement ConcurrentLimiter class
3. Implement retry with exponential backoff
4. Implement LRUCache class
5. Create HTTP client with rate limiting
6. Add comprehensive unit tests (90% coverage)

### Phase 3: BuildWith API Client (10 hours)
**Deliverables:**
- [ ] BuildWith API client
- [ ] Free API integration
- [ ] Domain API integration
- [ ] Lists API integration
- [ ] Request/response validation

**Tasks:**
1. Create BuildWithClient class
2. Implement Free API method
3. Implement Domain API method
4. Implement Lists API method
5. Add parameter validation (zod schemas)
6. Add response parsing and validation
7. Add integration tests

### Phase 4: MCP Server Implementation (10 hours)
**Deliverables:**
- [ ] MCP server with stdio transport
- [ ] Tool definitions
- [ ] Tool handlers
- [ ] Error handling
- [ ] Request logging

**Tasks:**
1. Create MCP server using SDK
2. Define tool schemas
3. Implement tool handlers
4. Wire up BuildWith client
5. Add error handling and formatting
6. Add request/response logging
7. Add E2E tests

---

## Testing Strategy

### Unit Tests (Target: 90% coverage)
**Components:**
- Rate limiter logic
- Concurrent limiter logic
- Retry with backoff
- Cache operations
- Configuration loading
- Input validation

**Test Cases:**
- Token bucket refill logic
- Concurrent request queueing
- Backoff delay calculation
- Cache hit/miss scenarios
- TTL expiration
- LRU eviction

### Integration Tests
**Scenarios:**
- BuildWith API calls (mocked)
- Rate limiting enforcement
- Cache integration
- Error handling flows

**Test Cases:**
- Successful API calls
- Rate limit exceeded scenarios
- 429 error handling
- Network failures
- Invalid API responses

### E2E Tests
**Scenarios:**
- Full MCP tool calls
- Multi-request scenarios
- Cache warming and hits

**Test Cases:**
- Free lookup tool
- Domain lookup tool
- Lists tool
- Concurrent requests
- Cache effectiveness

### Load Tests
**Scenarios:**
- Rate limit verification
- Concurrent limit verification
- Memory usage under load

**Test Cases:**
- Sustain 10 req/s for 5 minutes
- Max 8 concurrent requests
- Memory stays under 500MB

---

## Success Metrics

### Functional Metrics
- [ ] All 3 core APIs functional
- [ ] Rate limiting never exceeded
- [ ] Cache hit ratio > 30%
- [ ] Zero API key leaks in logs

### Performance Metrics
- [ ] P95 latency < 500ms (cached)
- [ ] P95 latency < 2s (API calls)
- [ ] Memory usage < 500MB
- [ ] CPU usage < 50% at max throughput

### Quality Metrics
- [ ] Test coverage > 80%
- [ ] Type coverage > 95%
- [ ] Zero lint errors
- [ ] Zero security vulnerabilities

---

## Risks & Mitigation

### Risk 1: Rate Limit Violations
**Impact:** High - Could result in API key suspension
**Probability:** Medium
**Mitigation:**
- Conservative rate limits (9 req/s instead of 10)
- Comprehensive testing of rate limiter
- Monitoring and alerts
- Circuit breaker for repeated violations

### Risk 2: Memory Leaks
**Impact:** High - Could crash server
**Probability:** Low
**Mitigation:**
- Strict cache size limits
- Regular memory profiling
- Load testing
- Monitoring memory usage

### Risk 3: API Changes
**Impact:** Medium - Could break integration
**Probability:** Low
**Mitigation:**
- Version API requests
- Comprehensive response validation
- Graceful degradation
- Regular API compatibility testing

---

## Documentation

### Required Documentation
1. **README.md**
   - Installation instructions
   - Quick start guide
   - Configuration reference
   - Tool usage examples

2. **API.md**
   - Complete tool reference
   - Parameter documentation
   - Response schemas
   - Error codes

3. **ARCHITECTURE.md**
   - System design
   - Component descriptions
   - Data flow diagrams
   - Design decisions

4. **CONTRIBUTING.md**
   - Development setup
   - Testing guide
   - Code style guide
   - PR process

---

## Acceptance Criteria

### Must Have
- [ ] All 3 core APIs (Free, Domain, Lists) functional
- [ ] Rate limiting enforced (10 req/s, 8 concurrent)
- [ ] 429 errors handled with backoff
- [ ] Caching implemented with configurable TTL
- [ ] MCP protocol compliant
- [ ] Test coverage > 80%
- [ ] Documentation complete
- [ ] No security vulnerabilities

### Should Have
- [ ] Metrics endpoint for monitoring
- [ ] Request tracing with IDs
- [ ] Graceful shutdown handling
- [ ] Health check endpoint

### Could Have
- [ ] Prometheus metrics export
- [ ] Structured logging (JSON)
- [ ] Debug mode with request/response dumps
- [ ] Cache statistics endpoint

---

**Spec Author:** Development Team
**Created:** 2025-01-11
**Status:** Ready for Implementation
