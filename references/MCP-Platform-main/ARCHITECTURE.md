# BuildWith MCP Server - Architecture Design

**Version:** 1.0
**Status:** Design Phase
**Last Updated:** 2025-01-11

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture Principles](#architecture-principles)
3. [System Architecture](#system-architecture)
4. [Component Design](#component-design)
5. [Data Flow](#data-flow)
6. [Rate Limiting Design](#rate-limiting-design)
7. [Caching Strategy](#caching-strategy)
8. [Error Handling](#error-handling)
9. [Configuration Management](#configuration-management)
10. [Monitoring & Observability](#monitoring--observability)
11. [Security Considerations](#security-considerations)
12. [Technology Stack](#technology-stack)

---

## System Overview

The BuildWith MCP Server is a production-grade implementation of the Model Context Protocol (MCP) that provides AI assistants with access to BuildWith's technology profiling APIs. The server acts as a bridge between MCP clients (like Claude Code) and the BuildWith REST API, handling rate limiting, caching, error recovery, and protocol translation.

### Key Responsibilities

1. **Protocol Translation:** Convert MCP tool calls to BuildWith API requests
2. **Rate Limiting:** Enforce BuildWith API limits (10 req/s, 8 concurrent)
3. **Request Management:** Queue, prioritize, and execute requests efficiently
4. **Caching:** Reduce API calls through intelligent caching
5. **Error Handling:** Graceful degradation and retry logic
6. **Monitoring:** Track metrics, errors, and performance

---

## Architecture Principles

### 1. Layered Architecture
Separation of concerns with clear boundaries between layers:
- **Transport Layer:** MCP protocol handling
- **Application Layer:** Business logic and orchestration
- **Integration Layer:** External API communication
- **Infrastructure Layer:** Cross-cutting concerns (logging, metrics, config)

### 2. Dependency Inversion
- High-level modules don't depend on low-level modules
- Both depend on abstractions (interfaces)
- Enables testing and flexibility

### 3. Single Responsibility
- Each component has one clear purpose
- Easy to test, maintain, and reason about

### 4. Fail-Safe Defaults
- Conservative rate limits
- Graceful degradation
- Default to cached data when available

### 5. Observable by Design
- Structured logging at all layers
- Metrics for all operations
- Distributed tracing support

---

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         MCP Client                               │
│                    (Claude Code / Cursor)                        │
└────────────────────────────┬────────────────────────────────────┘
                             │ stdio (JSON-RPC 2.0)
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                    TRANSPORT LAYER                               │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              MCPServerTransport                             │ │
│  │  - JSON-RPC parser/serializer                              │ │
│  │  - Request routing                                         │ │
│  │  - Response formatting                                     │ │
│  └────────────────────────┬───────────────────────────────────┘ │
└───────────────────────────┼─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│                   APPLICATION LAYER                              │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                 ToolHandlerRegistry                         │ │
│  │  - Tool registration                                       │ │
│  │  - Input validation (Zod)                                  │ │
│  │  - Handler dispatch                                        │ │
│  └────────────────────────┬───────────────────────────────────┘ │
│                           │                                      │
│  ┌────────────────────────▼───────────────────────────────────┐ │
│  │              BuildWithService                               │ │
│  │  - Business logic orchestration                            │ │
│  │  - Response transformation                                 │ │
│  │  - Error handling & recovery                               │ │
│  └────────────────────────┬───────────────────────────────────┘ │
└───────────────────────────┼─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│                   INTEGRATION LAYER                              │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              BuildWithAPIClient                             │ │
│  │  - HTTP request/response                                   │ │
│  │  - Request signing                                         │ │
│  │  - Response parsing                                        │ │
│  └────────────────────────┬───────────────────────────────────┘ │
│                           │                                      │
│  ┌────────────────────────┼───────────────────────────────────┐ │
│  │  RateLimiter  │  CacheManager  │  RetryManager             │ │
│  │  - Token bucket│  - LRU cache   │  - Exp backoff            │ │
│  │  - Concurrent │  - TTL eviction│  - Jitter                 │ │
│  │  - Queuing    │  - Metrics     │  - Circuit breaker        │ │
│  └────────────────────────┬───────────────────────────────────┘ │
└───────────────────────────┼─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│                  INFRASTRUCTURE LAYER                            │
│  ┌──────────────┬──────────────┬─────────────┬───────────────┐ │
│  │   Logger     │  MetricsCol  │  ConfigMgr  │  ErrorHandler │ │
│  │  - Pino      │  - Counters  │  - Env vars │  - Categories │ │
│  │  - Contexts  │  - Gauges    │  - Validation│  - Formatting │ │
│  └──────────────┴──────────────┴─────────────┴───────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
                ┌──────────────────────┐
                │   BuildWith API      │
                │  - Free API          │
                │  - Domain API        │
                │  - Lists API         │
                └──────────────────────┘
```

### Layer Responsibilities

#### Transport Layer
- **Input:** stdio stream from MCP client
- **Output:** JSON-RPC responses
- **Responsibilities:**
  - Parse incoming JSON-RPC requests
  - Validate JSON-RPC structure
  - Route to appropriate handlers
  - Serialize responses
  - Handle protocol errors

#### Application Layer
- **Input:** Validated tool calls with parameters
- **Output:** Formatted tool responses
- **Responsibilities:**
  - Validate tool inputs against schemas
  - Orchestrate business logic
  - Transform API responses for MCP
  - Handle application-level errors
  - Manage tool lifecycle

#### Integration Layer
- **Input:** Service-level requests
- **Output:** Raw API responses
- **Responsibilities:**
  - Execute HTTP requests to BuildWith API
  - Apply rate limiting
  - Manage caching
  - Handle retries and backoff
  - Parse API responses

#### Infrastructure Layer
- **Input:** Events from all layers
- **Output:** Logs, metrics, config
- **Responsibilities:**
  - Structured logging
  - Metrics collection
  - Configuration management
  - Error categorization

---

## Component Design

### 1. MCPServerTransport

**Purpose:** Handle MCP protocol communication via stdio

**Class Definition:**
```typescript
class MCPServerTransport {
  private server: Server;
  private toolRegistry: ToolHandlerRegistry;
  private logger: Logger;

  constructor(
    toolRegistry: ToolHandlerRegistry,
    logger: Logger
  ) {
    this.server = new Server({
      name: "builtwith-mcp-server",
      version: "1.0.0"
    }, {
      capabilities: {
        tools: {}
      }
    });
  }

  async initialize(): Promise<void> {
    // Register MCP handlers
    this.server.setRequestHandler(
      ListToolsRequestSchema,
      this.handleListTools.bind(this)
    );

    this.server.setRequestHandler(
      CallToolRequestSchema,
      this.handleCallTool.bind(this)
    );

    // Connect to stdio
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }

  private async handleListTools(): Promise<ListToolsResult> {
    return {
      tools: this.toolRegistry.getToolDefinitions()
    };
  }

  private async handleCallTool(
    request: CallToolRequest
  ): Promise<CallToolResult> {
    try {
      const result = await this.toolRegistry.executeTool(
        request.params.name,
        request.params.arguments
      );

      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2)
        }]
      };
    } catch (error) {
      this.logger.error("Tool execution failed", { error, request });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: error.message,
            category: error.category,
            isRetryable: error.isRetryable
          })
        }],
        isError: true
      };
    }
  }
}
```

**Key Methods:**
- `initialize()` - Setup MCP server and handlers
- `handleListTools()` - Return available tool definitions
- `handleCallTool()` - Execute tool and return result
- `shutdown()` - Graceful shutdown

---

### 2. ToolHandlerRegistry

**Purpose:** Manage tool registration and validation

**Class Definition:**
```typescript
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodSchema;
  handler: ToolHandler<any, any>;
}

interface ToolHandler<TInput, TOutput> {
  execute(input: TInput): Promise<TOutput>;
}

class ToolHandlerRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private logger: Logger;

  registerTool<TInput, TOutput>(
    definition: ToolDefinition
  ): void {
    this.tools.set(definition.name, definition);
    this.logger.info("Tool registered", { name: definition.name });
  }

  getToolDefinitions(): Array<MCPToolDefinition> {
    return Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: zodToJsonSchema(tool.inputSchema)
    }));
  }

  async executeTool(
    name: string,
    args: unknown
  ): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new ToolNotFoundError(name);
    }

    // Validate input
    const validatedInput = tool.inputSchema.parse(args);

    // Execute handler
    return await tool.handler.execute(validatedInput);
  }
}
```

**Registered Tools:**
1. `builtwith_free_lookup` - Free API
2. `builtwith_domain_lookup` - Domain API
3. `builtwith_list_sites` - Lists API

---

### 3. BuildWithService

**Purpose:** Business logic orchestration for BuildWith operations

**Class Definition:**
```typescript
class BuildWithService {
  constructor(
    private apiClient: BuildWithAPIClient,
    private logger: Logger,
    private metrics: MetricsCollector
  ) {}

  async getFreeLookup(domain: string): Promise<FreeLookupResult> {
    const startTime = Date.now();
    this.metrics.incrementCounter("builtwith.free_lookup.requests");

    try {
      const result = await this.apiClient.freeLookup(domain);

      this.metrics.recordHistogram(
        "builtwith.free_lookup.duration",
        Date.now() - startTime
      );

      return this.transformFreeLookupResponse(result);
    } catch (error) {
      this.metrics.incrementCounter(
        "builtwith.free_lookup.errors",
        { category: error.category }
      );
      throw error;
    }
  }

  async getDomainLookup(
    domain: string,
    options: DomainLookupOptions
  ): Promise<DomainLookupResult> {
    const startTime = Date.now();
    this.metrics.incrementCounter("builtwith.domain_lookup.requests");

    try {
      const result = await this.apiClient.domainLookup(domain, options);

      this.metrics.recordHistogram(
        "builtwith.domain_lookup.duration",
        Date.now() - startTime
      );

      return this.transformDomainLookupResponse(result);
    } catch (error) {
      this.metrics.incrementCounter(
        "builtwith.domain_lookup.errors",
        { category: error.category }
      );
      throw error;
    }
  }

  async listSites(
    technology: string,
    options: ListSitesOptions
  ): Promise<ListSitesResult> {
    const startTime = Date.now();
    this.metrics.incrementCounter("builtwith.list_sites.requests");

    try {
      const result = await this.apiClient.listSites(technology, options);

      this.metrics.recordHistogram(
        "builtwith.list_sites.duration",
        Date.now() - startTime
      );

      return this.transformListSitesResponse(result);
    } catch (error) {
      this.metrics.incrementCounter(
        "builtwith.list_sites.errors",
        { category: error.category }
      );
      throw error;
    }
  }

  private transformFreeLookupResponse(
    raw: any
  ): FreeLookupResult {
    // Transform raw API response to user-friendly format
    return {
      domain: raw.domain,
      lastUpdated: new Date(raw.last_updated),
      technologies: raw.tech_groups.map(group => ({
        category: group.category,
        count: group.count,
        technologies: group.technologies
      }))
    };
  }

  // ... other transformation methods
}
```

---

### 4. BuildWithAPIClient

**Purpose:** Low-level HTTP client for BuildWith API

**Class Definition:**
```typescript
class BuildWithAPIClient {
  private readonly baseUrl = "https://api.builtwith.com";
  private readonly apiKey: string;
  private rateLimiter: RateLimiter;
  private cacheManager: CacheManager;
  private retryManager: RetryManager;
  private logger: Logger;

  constructor(config: BuildWithClientConfig) {
    this.apiKey = config.apiKey;
    this.rateLimiter = new RateLimiter(config.rateLimit);
    this.cacheManager = new CacheManager(config.cache);
    this.retryManager = new RetryManager(config.retry);
    this.logger = config.logger;
  }

  async freeLookup(domain: string): Promise<any> {
    const cacheKey = `free:${domain}`;

    // Check cache first
    const cached = this.cacheManager.get(cacheKey);
    if (cached) {
      this.logger.debug("Cache hit", { cacheKey });
      return cached;
    }

    // Execute request with rate limiting and retry
    const result = await this.executeRequest(
      "free-api",
      "json",
      { LOOKUP: domain }
    );

    // Cache successful result
    this.cacheManager.set(cacheKey, result);

    return result;
  }

  async domainLookup(
    domain: string,
    options: DomainLookupOptions
  ): Promise<any> {
    const cacheKey = `domain:${domain}:${hashOptions(options)}`;

    const cached = this.cacheManager.get(cacheKey);
    if (cached) {
      this.logger.debug("Cache hit", { cacheKey });
      return cached;
    }

    const params: Record<string, string> = {
      LOOKUP: domain
    };

    if (options.hideMetadata) params.hideAll = "yes";
    if (options.onlyLive) params.onlyLiveTechnologies = "yes";

    const result = await this.executeRequest(
      "domain-api",
      "json",
      params
    );

    this.cacheManager.set(cacheKey, result);

    return result;
  }

  async listSites(
    technology: string,
    options: ListSitesOptions
  ): Promise<any> {
    const cacheKey = `lists:${technology}:${hashOptions(options)}`;

    const cached = this.cacheManager.get(cacheKey);
    if (cached) {
      this.logger.debug("Cache hit", { cacheKey });
      return cached;
    }

    const params: Record<string, string> = {
      TECH: technology
    };

    if (options.includeMetadata) params.META = "yes";
    if (options.offset) params.OFFSET = options.offset.toString();

    const result = await this.executeRequest(
      "lists-api",
      "json",
      params
    );

    this.cacheManager.set(cacheKey, result);

    return result;
  }

  private async executeRequest(
    endpoint: string,
    format: string,
    params: Record<string, string>
  ): Promise<any> {
    // Acquire rate limit permission
    await this.rateLimiter.acquire();

    // Execute with retry
    return await this.retryManager.execute(async () => {
      const url = this.buildUrl(endpoint, format, params);

      this.logger.debug("API request", { url: url.pathname });

      const response = await fetch(url.toString());

      if (!response.ok) {
        throw this.handleHttpError(response);
      }

      return await response.json();
    });
  }

  private buildUrl(
    endpoint: string,
    format: string,
    params: Record<string, string>
  ): URL {
    const url = new URL(
      `${this.baseUrl}/${endpoint}/api.${format}`
    );

    url.searchParams.set("KEY", this.apiKey);

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    return url;
  }

  private handleHttpError(response: Response): Error {
    switch (response.status) {
      case 429:
        return new RateLimitError("Rate limit exceeded");
      case 401:
      case 403:
        return new AuthenticationError("Invalid API key");
      case 400:
        return new ValidationError("Invalid request parameters");
      case 500:
      case 502:
      case 503:
      case 504:
        return new ServerError("BuildWith API error");
      default:
        return new APIError(`HTTP ${response.status}`);
    }
  }
}
```

---

### 5. RateLimiter (Token Bucket + Concurrent Limiter)

**Purpose:** Enforce BuildWith API rate limits

**Class Definition:**
```typescript
class RateLimiter {
  private tokenBucket: TokenBucketLimiter;
  private concurrentLimiter: ConcurrentLimiter;
  private logger: Logger;
  private metrics: MetricsCollector;

  constructor(config: RateLimitConfig) {
    this.tokenBucket = new TokenBucketLimiter({
      maxTokens: config.requestsPerSecond,
      refillRate: config.requestsPerSecond / 1000, // per ms
    });

    this.concurrentLimiter = new ConcurrentLimiter({
      maxConcurrent: config.maxConcurrent
    });

    this.logger = config.logger;
    this.metrics = config.metrics;
  }

  async acquire(): Promise<void> {
    // Acquire both limits
    await Promise.all([
      this.acquireToken(),
      this.acquireConcurrentSlot()
    ]);
  }

  release(): void {
    this.concurrentLimiter.release();
  }

  private async acquireToken(): Promise<void> {
    const acquired = await this.tokenBucket.tryAcquire();

    if (!acquired) {
      this.metrics.incrementCounter("rate_limiter.token_wait");
      await this.tokenBucket.waitForToken();
    }
  }

  private async acquireConcurrentSlot(): Promise<void> {
    const acquired = this.concurrentLimiter.tryAcquire();

    if (!acquired) {
      this.metrics.incrementCounter("rate_limiter.concurrent_wait");
      await this.concurrentLimiter.waitForSlot();
    }
  }
}

class TokenBucketLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number;

  constructor(config: { maxTokens: number; refillRate: number }) {
    this.maxTokens = config.maxTokens;
    this.refillRate = config.refillRate;
    this.tokens = config.maxTokens;
    this.lastRefill = Date.now();
  }

  async tryAcquire(): Promise<boolean> {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }

    return false;
  }

  async waitForToken(): Promise<void> {
    while (!(await this.tryAcquire())) {
      // Calculate wait time until next token
      const waitMs = Math.ceil(1 / this.refillRate);
      await sleep(waitMs);
    }
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = elapsed * this.refillRate;

    this.tokens = Math.min(
      this.maxTokens,
      this.tokens + tokensToAdd
    );

    this.lastRefill = now;
  }
}

class ConcurrentLimiter {
  private active: number = 0;
  private readonly maxConcurrent: number;
  private queue: Array<() => void> = [];

  constructor(config: { maxConcurrent: number }) {
    this.maxConcurrent = config.maxConcurrent;
  }

  tryAcquire(): boolean {
    if (this.active < this.maxConcurrent) {
      this.active++;
      return true;
    }
    return false;
  }

  async waitForSlot(): Promise<void> {
    return new Promise(resolve => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    this.active--;

    // Process queue
    const next = this.queue.shift();
    if (next) {
      this.active++;
      next();
    }
  }
}
```

---

### 6. RetryManager (Exponential Backoff)

**Purpose:** Handle retries with exponential backoff and jitter

**Class Definition:**
```typescript
interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterMaxMs: number;
}

class RetryManager {
  private config: RetryConfig;
  private logger: Logger;
  private metrics: MetricsCollector;

  constructor(
    config: RetryConfig,
    logger: Logger,
    metrics: MetricsCollector
  ) {
    this.config = config;
    this.logger = logger;
    this.metrics = metrics;
  }

  async execute<T>(
    fn: () => Promise<T>,
    context?: string
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          this.logger.info("Retry attempt", { attempt, context });
          this.metrics.incrementCounter("retry.attempt", {
            attempt: attempt.toString()
          });
        }

        return await fn();

      } catch (error) {
        lastError = error;

        // Don't retry non-retryable errors
        if (!this.isRetryable(error)) {
          this.logger.warn("Non-retryable error", { error, context });
          throw error;
        }

        // Don't delay on last attempt
        if (attempt === this.config.maxRetries) {
          break;
        }

        // Calculate backoff delay
        const delay = this.calculateDelay(attempt);

        this.logger.info("Backing off", {
          attempt,
          delay,
          error: error.message,
          context
        });

        await sleep(delay);
      }
    }

    this.logger.error("Max retries exceeded", { context });
    this.metrics.incrementCounter("retry.exhausted");

    throw new MaxRetriesError(
      `Max retries (${this.config.maxRetries}) exceeded`,
      lastError
    );
  }

  private isRetryable(error: Error): boolean {
    // Retryable error types
    return (
      error instanceof RateLimitError ||
      error instanceof ServerError ||
      error instanceof NetworkError ||
      error instanceof TimeoutError
    );
  }

  private calculateDelay(attempt: number): number {
    // Exponential backoff: initialDelay * (multiplier ^ attempt)
    const exponentialDelay =
      this.config.initialDelayMs *
      Math.pow(this.config.backoffMultiplier, attempt);

    // Add jitter (random 0 to jitterMaxMs)
    const jitter = Math.random() * this.config.jitterMaxMs;

    // Cap at maxDelayMs
    return Math.min(
      exponentialDelay + jitter,
      this.config.maxDelayMs
    );
  }
}
```

**Retry Behavior Example:**
```
Attempt 1: Immediate (0ms)
Attempt 2: 1000ms + jitter (0-1000ms) = 1000-2000ms
Attempt 3: 2000ms + jitter (0-1000ms) = 2000-3000ms
Attempt 4: 4000ms + jitter (0-1000ms) = 4000-5000ms
Attempt 5: 8000ms + jitter (0-1000ms) = 8000-9000ms (capped at 60000ms)
```

---

### 7. CacheManager (LRU with TTL)

**Purpose:** Reduce API calls through intelligent caching

**Class Definition:**
```typescript
interface CacheEntry<T> {
  value: T;
  expiry: number;
  hits: number;
}

class CacheManager {
  private cache: Map<string, CacheEntry<any>>;
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private logger: Logger;
  private metrics: MetricsCollector;

  constructor(config: CacheConfig) {
    this.cache = new Map();
    this.maxSize = config.maxSize;
    this.ttlMs = config.ttlMs;
    this.logger = config.logger;
    this.metrics = config.metrics;

    // Cleanup expired entries periodically
    setInterval(() => this.cleanup(), 60000); // Every minute
  }

  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.metrics.incrementCounter("cache.miss");
      return undefined;
    }

    // Check expiry
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      this.metrics.incrementCounter("cache.expired");
      return undefined;
    }

    // Update access (LRU)
    entry.hits++;
    this.cache.delete(key);
    this.cache.set(key, entry);

    this.metrics.incrementCounter("cache.hit");
    return entry.value as T;
  }

  set<T>(key: string, value: T): void {
    // Evict if at capacity
    if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    this.cache.set(key, {
      value,
      expiry: Date.now() + this.ttlMs,
      hits: 0
    });

    this.metrics.setGauge("cache.size", this.cache.size);
  }

  invalidate(key: string): void {
    this.cache.delete(key);
    this.metrics.incrementCounter("cache.invalidated");
  }

  clear(): void {
    this.cache.clear();
    this.metrics.incrementCounter("cache.cleared");
  }

  getStats(): CacheStats {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: this.calculateHitRate()
    };
  }

  private evictLRU(): void {
    // First entry is least recently used
    const firstKey = this.cache.keys().next().value;

    if (firstKey) {
      this.cache.delete(firstKey);
      this.metrics.incrementCounter("cache.evicted");
      this.logger.debug("LRU eviction", { key: firstKey });
    }
  }

  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiry) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug("Cache cleanup", { cleaned });
      this.metrics.incrementCounter("cache.cleanup", {
        count: cleaned.toString()
      });
    }
  }

  private calculateHitRate(): number {
    // Implementation would track hits/misses over time
    return 0; // Placeholder
  }
}
```

---

## Data Flow

### Request Flow Diagram

```
┌───────┐
│Client │
└───┬───┘
    │ 1. Tool call (builtwith_domain_lookup)
    │    { domain: "example.com" }
    ▼
┌───────────────────┐
│ MCPTransport      │
│ - Parse JSON-RPC  │
└───┬───────────────┘
    │ 2. Validated request
    ▼
┌───────────────────┐
│ToolRegistry       │
│ - Validate input  │
└───┬───────────────┘
    │ 3. Execute handler
    ▼
┌───────────────────┐
│BuildWithService   │
│ - Business logic  │
└───┬───────────────┘
    │ 4. API request
    ▼
┌───────────────────┐
│BuildWithClient    │
│ - Check cache     │────► Cache hit? Return cached
└───┬───────────────┘
    │ 5. Cache miss
    ▼
┌───────────────────┐
│ RateLimiter       │
│ - Acquire token   │────► Wait if necessary
│ - Acquire slot    │
└───┬───────────────┘
    │ 6. Permission granted
    ▼
┌───────────────────┐
│ RetryManager      │
└───┬───────────────┘
    │ 7. Execute HTTP request
    ▼
┌───────────────────┐
│ BuildWith API     │
└───┬───────────────┘
    │ 8. Response (200 or error)
    ▼
┌───────────────────┐
│ Error handling    │
│ - 429? Retry      │
│ - 5xx? Retry      │
│ - 4xx? Fail       │
└───┬───────────────┘
    │ 9. Success
    ▼
┌───────────────────┐
│ CacheManager      │
│ - Store result    │
└───┬───────────────┘
    │ 10. Cached result
    ▼
┌───────────────────┐
│BuildWithService   │
│ - Transform data  │
└───┬───────────────┘
    │ 11. Formatted response
    ▼
┌───────────────────┐
│ToolRegistry       │
└───┬───────────────┘
    │ 12. Tool result
    ▼
┌───────────────────┐
│ MCPTransport      │
│ - Serialize       │
└───┬───────────────┘
    │ 13. JSON-RPC response
    ▼
┌───────┐
│Client │
└───────┘
```

### Error Flow

```
┌───────────────┐
│  HTTP Error   │
└───────┬───────┘
        │
        ▼
    ┌───────┐
    │ 429?  │─── Yes ──► RetryManager (exponential backoff)
    └───┬───┘
        │ No
        ▼
    ┌───────┐
    │ 5xx?  │─── Yes ──► RetryManager (exponential backoff)
    └───┬───┘
        │ No
        ▼
    ┌───────┐
    │ 401/  │─── Yes ──► AuthenticationError (don't retry)
    │ 403?  │
    └───┬───┘
        │ No
        ▼
    ┌───────┐
    │ 400?  │─── Yes ──► ValidationError (don't retry)
    └───┬───┘
        │ No
        ▼
┌───────────────┐
│ Generic Error │
└───────────────┘
```

---

## Configuration Management

### Configuration Schema

```typescript
interface ServerConfig {
  // BuildWith API
  builtwith: {
    apiKey: string;
  };

  // Rate limiting
  rateLimit: {
    requestsPerSecond: number;     // Default: 10
    maxConcurrent: number;          // Default: 8
  };

  // Caching
  cache: {
    enabled: boolean;               // Default: true
    maxSize: number;                // Default: 1000
    ttlMs: number;                  // Default: 3600000 (1 hour)
  };

  // Retry
  retry: {
    maxRetries: number;             // Default: 3
    initialDelayMs: number;         // Default: 1000
    maxDelayMs: number;             // Default: 60000
    backoffMultiplier: number;      // Default: 2
    jitterMaxMs: number;            // Default: 1000
  };

  // Logging
  logging: {
    level: "debug" | "info" | "warn" | "error";  // Default: info
    pretty: boolean;                              // Default: false
  };

  // Metrics
  metrics: {
    enabled: boolean;               // Default: true
  };
}
```

### Environment Variable Mapping

```bash
BUILTWITH_API_KEY                 → builtwith.apiKey

MCP_RATE_LIMIT_RPS                → rateLimit.requestsPerSecond
MCP_MAX_CONCURRENT                → rateLimit.maxConcurrent

MCP_CACHE_ENABLED                 → cache.enabled
MCP_CACHE_SIZE                    → cache.maxSize
MCP_CACHE_TTL                     → cache.ttlMs

MCP_RETRY_MAX                     → retry.maxRetries
MCP_RETRY_INITIAL_DELAY           → retry.initialDelayMs
MCP_RETRY_MAX_DELAY               → retry.maxDelayMs
MCP_RETRY_BACKOFF_MULTIPLIER      → retry.backoffMultiplier
MCP_RETRY_JITTER_MAX              → retry.jitterMaxMs

MCP_LOG_LEVEL                     → logging.level
MCP_LOG_PRETTY                    → logging.pretty

MCP_METRICS_ENABLED               → metrics.enabled
```

---

## Monitoring & Observability

### Metrics

**Counter Metrics:**
```typescript
// Request metrics
builtwith.free_lookup.requests
builtwith.domain_lookup.requests
builtwith.list_sites.requests

// Error metrics
builtwith.free_lookup.errors{category}
builtwith.domain_lookup.errors{category}
builtwith.list_sites.errors{category}

// Cache metrics
cache.hit
cache.miss
cache.expired
cache.evicted
cache.invalidated

// Rate limiter metrics
rate_limiter.token_wait
rate_limiter.concurrent_wait

// Retry metrics
retry.attempt{attempt}
retry.exhausted
```

**Histogram Metrics:**
```typescript
// Latency metrics
builtwith.free_lookup.duration
builtwith.domain_lookup.duration
builtwith.list_sites.duration

// Backoff metrics
retry.backoff_delay
```

**Gauge Metrics:**
```typescript
// Cache metrics
cache.size

// Rate limiter metrics
rate_limiter.active_requests
rate_limiter.queued_requests
rate_limiter.available_tokens
```

### Logging

**Log Levels:**
- **DEBUG:** Detailed flow information (cache hits, token acquisition)
- **INFO:** Normal operations (requests, retries, backoffs)
- **WARN:** Recoverable issues (rate limits, retries)
- **ERROR:** Failures (max retries, auth errors)

**Log Structure:**
```typescript
{
  timestamp: "2025-01-11T10:30:00.000Z",
  level: "info",
  message: "API request",
  context: {
    endpoint: "domain-api",
    domain: "example.com",
    cached: false,
    requestId: "req_abc123"
  }
}
```

---

## Security Considerations

### API Key Security
- **Storage:** Environment variable only, never in code
- **Logging:** API key sanitized from all logs
- **Transport:** HTTPS only for API requests
- **Rotation:** Support for key refresh without restart

### Input Validation
- **Zod schemas:** All inputs validated before processing
- **Domain validation:** Ensure valid domain format
- **SQL injection:** N/A (no database)
- **XSS:** JSON responses only

### Error Information Disclosure
- **Production:** Generic error messages to client
- **Logs:** Detailed errors in logs only
- **Stack traces:** Never sent to client

---

## Technology Stack

### Core Dependencies
- **@modelcontextprotocol/sdk** - MCP protocol implementation
- **zod** - Schema validation
- **pino** - Structured logging
- **undici** - HTTP client (Node.js native)

### Development Dependencies
- **TypeScript** - Type safety
- **vitest** - Testing framework
- **eslint** - Linting
- **prettier** - Code formatting
- **tsx** - TypeScript execution

### Runtime
- **Node.js** 20+ LTS
- **Platform:** Cross-platform (macOS, Linux, Windows)

---

**Architecture Version:** 1.0
**Next Review:** Before implementation start
**Status:** Ready for implementation
