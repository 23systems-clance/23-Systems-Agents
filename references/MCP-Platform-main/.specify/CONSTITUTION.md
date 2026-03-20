# BuildWith MCP Server - Project Constitution

## Project Vision
Build a robust, production-ready Model Context Protocol (MCP) server for the BuildWith API that provides comprehensive technology profiling capabilities while respecting API rate limits and implementing industry-standard reliability patterns.

## Core Principles

### 1. Reliability First
- **Rate Limit Respect:** Never exceed BuildWith API limits (10 req/s, 8 concurrent)
- **Backoff Strategy:** Implement exponential backoff with jitter for all retries
- **Circuit Breaker:** Prevent cascading failures with circuit breaker pattern
- **Error Handling:** Comprehensive error handling and graceful degradation

### 2. Performance & Efficiency
- **Caching:** Implement intelligent caching to minimize API calls
- **Request Queuing:** Smart request queue management for optimal throughput
- **Resource Management:** Efficient memory and connection pooling
- **Monitoring:** Built-in metrics and observability

### 3. Developer Experience
- **Type Safety:** Full TypeScript implementation with comprehensive types
- **Documentation:** Clear, comprehensive documentation for all APIs
- **Testing:** High test coverage with unit, integration, and E2E tests
- **Error Messages:** Actionable, clear error messages for debugging

### 4. Security & Privacy
- **API Key Management:** Secure storage and handling of API credentials
- **Input Validation:** Strict validation of all inputs
- **Data Privacy:** No logging of sensitive data
- **Audit Trail:** Request logging for debugging (sanitized)

### 5. MCP Protocol Compliance
- **Standard Compliance:** Full adherence to MCP specification
- **Tool Definitions:** Clear, well-documented tool schemas
- **Resource Handling:** Proper resource lifecycle management
- **SSE/HTTP Support:** Support for both stdio and HTTP transports

## Technical Standards

### Code Quality
- **Linting:** ESLint with strict TypeScript rules
- **Formatting:** Prettier for consistent code style
- **Type Coverage:** Minimum 95% type coverage
- **Test Coverage:** Minimum 80% code coverage

### Architecture Patterns
- **Layered Architecture:**
  - Transport Layer (MCP Protocol)
  - Service Layer (Business Logic)
  - API Layer (BuildWith Integration)
  - Data Layer (Caching & Persistence)

- **Dependency Injection:** For testability and flexibility
- **Strategy Pattern:** For different API endpoints and retry strategies
- **Observer Pattern:** For monitoring and metrics

### Error Handling Strategy
```typescript
// All errors must be categorized:
enum ErrorCategory {
  RATE_LIMIT = 'RATE_LIMIT',        // 429 errors
  AUTHENTICATION = 'AUTH',           // 401/403 errors
  VALIDATION = 'VALIDATION',         // 400 errors
  SERVER_ERROR = 'SERVER',           // 500+ errors
  NETWORK = 'NETWORK',               // Connection errors
  CLIENT = 'CLIENT'                  // Client-side errors
}
```

### Rate Limiting Implementation
```typescript
// Required rate limiting configuration:
const RATE_LIMITS = {
  maxRequestsPerSecond: 10,
  maxConcurrentRequests: 8,
  retryAfter429: 60000,  // 60 seconds
  maxRetries: 3,
  backoffMultiplier: 2,
  maxBackoff: 60000,
  jitterMax: 1000
};
```

## Feature Requirements

### Must Have (MVP)
1. **Core API Support:**
   - Free API
   - Domain API
   - Lists API

2. **Rate Limiting:**
   - Token bucket algorithm
   - Concurrent request limiting
   - 429 error handling with backoff

3. **Caching:**
   - In-memory cache with TTL
   - Configurable cache size
   - Cache invalidation

4. **MCP Integration:**
   - stdio transport
   - Tool definitions for core APIs
   - Proper error responses

5. **Configuration:**
   - API key management
   - Rate limit configuration
   - Cache settings

### Should Have (Phase 2)
1. **Extended API Support:**
   - Keywords API
   - Trends API
   - Relationships API

2. **Advanced Caching:**
   - Redis support
   - Distributed caching
   - Smart cache warming

3. **Monitoring:**
   - Prometheus metrics
   - Request/error tracking
   - Performance metrics

4. **HTTP Transport:**
   - SSE support
   - WebSocket support

### Could Have (Future)
1. **Premium APIs:**
   - Financial API
   - Product API
   - Trust API

2. **Advanced Features:**
   - Batch request optimization
   - Request deduplication
   - Smart retry strategies per endpoint

3. **Developer Tools:**
   - CLI for testing
   - Debug dashboard
   - Request replay

## Testing Requirements

### Test Coverage Targets
- **Unit Tests:** 90% coverage
- **Integration Tests:** Key workflows covered
- **E2E Tests:** Critical paths validated
- **Load Tests:** Rate limit scenarios tested

### Required Test Scenarios
1. **Rate Limiting:**
   - Verify 10 req/s limit respected
   - Verify 8 concurrent limit respected
   - Test 429 backoff behavior
   - Test retry exhaustion

2. **Error Handling:**
   - All error categories covered
   - Proper error propagation
   - Graceful degradation

3. **Caching:**
   - Cache hit/miss scenarios
   - TTL expiration
   - Cache invalidation

4. **API Integration:**
   - All supported endpoints
   - Parameter validation
   - Response parsing

## Documentation Standards

### Required Documentation
1. **README.md** - Project overview, quick start, installation
2. **API.md** - Complete API reference
3. **ARCHITECTURE.md** - System architecture and design decisions
4. **CONTRIBUTING.md** - Contribution guidelines
5. **CHANGELOG.md** - Version history

### Code Documentation
- JSDoc for all public APIs
- Inline comments for complex logic
- Type definitions for all interfaces
- Example usage in documentation

## Deployment & Operations

### Environment Configuration
```bash
# Required environment variables
BUILTWITH_API_KEY=xxx           # BuildWith API key
MCP_CACHE_TTL=3600              # Cache TTL in seconds
MCP_CACHE_SIZE=1000             # Max cache entries
MCP_RATE_LIMIT_RPS=10           # Requests per second
MCP_MAX_CONCURRENT=8            # Max concurrent requests
MCP_LOG_LEVEL=info              # Logging level
```

### Monitoring Requirements
- Request count and rate metrics
- Error rate by category
- Cache hit ratio
- API response times
- Credit consumption tracking

## Success Criteria

### Performance Metrics
- **Latency:** P95 < 500ms for cached requests
- **Throughput:** Support full 10 req/s throughput
- **Availability:** 99.9% uptime for MCP server
- **Error Rate:** < 0.1% client errors (excluding user input errors)

### Quality Metrics
- **Test Coverage:** > 80%
- **Type Coverage:** > 95%
- **Documentation Coverage:** 100% of public APIs
- **Zero Security Vulnerabilities:** In dependencies

## Version Control & Release

### Branching Strategy
- **main** - Production-ready code
- **develop** - Integration branch
- **feature/** - Feature branches
- **hotfix/** - Urgent fixes

### Commit Convention
Follow Conventional Commits:
```
feat: add Domain API support
fix: correct rate limit calculation
docs: update API documentation
test: add rate limiter tests
refactor: extract cache logic
```

### Release Process
1. Version bump following SemVer
2. Update CHANGELOG.md
3. Tag release
4. Publish to npm (future)

## Dependencies Policy

### Allowed Dependencies
- **Runtime:** Minimize runtime dependencies
- **Dev:** Unlimited dev dependencies for tooling
- **Security:** Regular dependency audits
- **Licensing:** Only MIT, Apache 2.0, or compatible licenses

### Preferred Libraries
- **MCP SDK:** @modelcontextprotocol/sdk
- **HTTP Client:** undici (Node.js built-in)
- **Caching:** node-cache or ioredis
- **Testing:** vitest
- **Validation:** zod

---

**Document Owner:** Development Team
**Last Updated:** 2025-01-11
**Status:** Active
**Review Cycle:** Quarterly
