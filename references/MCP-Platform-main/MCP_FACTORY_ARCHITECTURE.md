# MCP Factory - Complete Architecture Design

**Version:** 1.0
**Status:** Design Phase
**Last Updated:** 2026-01-11

---

## Vision

A platform that auto-generates production-ready MCP servers from API documentation with built-in analytics, traffic management, and composition capabilities.

---

## Core Principles (from Docker MCP Best Practices)

### 1. **Discovery**
Every MCP server is registered in a central catalog with metadata, making them discoverable via UI/API.

### 2. **Composition**
Servers can be combined into custom unified endpoints that route to multiple underlying APIs.

### 3. **Standardization**
All generated servers follow the same high-quality template with:
- Rate limiting (token bucket)
- Caching (LRU with TTL)
- Retry logic (exponential backoff)
- Error handling
- Monitoring & metrics
- Structured logging

### 4. **Observability**
Built-in analytics, traffic management, and performance monitoring for every server.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                 MCP Factory Dashboard (Next.js 14)                   │
│                https://mcp-factory.vercel.app                        │
│                                                                      │
│  Pages:                                                              │
│  ├─ / (Home) - Overview & stats                                    │
│  ├─ /servers - Browse/manage all MCP servers                       │
│  ├─ /generate - Upload API docs, generate new server               │
│  ├─ /compose - Combine servers into custom endpoints               │
│  ├─ /analytics - Traffic, usage, performance dashboards            │
│  └─ /settings - API keys, billing, rate limits                     │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           │ tRPC API (type-safe)
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│              API Layer (Vercel Serverless Functions)                 │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐│
│  │ Server Generator API                                            ││
│  │ - POST /api/generate                                           ││
│  │   - Parse OpenAPI/Swagger docs                                 ││
│  │   - Generate Zod schemas                                       ││
│  │   - Create tool definitions                                    ││
│  │   - Generate TypeScript server code                            ││
│  │   - Apply quality template (rate limit, cache, retry)          ││
│  │   - Store in Supabase                                          ││
│  │   - Deploy as Edge Function                                    ││
│  └────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐│
│  │ Server Composition API                                          ││
│  │ - POST /api/compose                                            ││
│  │   - Select multiple servers                                    ││
│  │   - Define routing rules                                       ││
│  │   - Handle tool name conflicts                                 ││
│  │   - Create unified endpoint                                    ││
│  └────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐│
│  │ Analytics API                                                   ││
│  │ - GET /api/analytics/traffic                                   ││
│  │ - GET /api/analytics/performance                               ││
│  │ - GET /api/analytics/errors                                    ││
│  │ - GET /api/analytics/usage                                     ││
│  └────────────────────────────────────────────────────────────────┘│
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           │ Store/Query
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  Supabase (PostgreSQL + Storage)                     │
│                                                                      │
│  Tables:                                                             │
│  ┌────────────────────────────────────────────────────────────────┐│
│  │ mcp_servers                                                     ││
│  │ - id, name, description, category                              ││
│  │ - api_doc (JSONB), tools (JSONB[])                            ││
│  │ - config (rate_limit, cache, retry)                           ││
│  │ - created_at, updated_at, user_id                             ││
│  └────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐│
│  │ compositions                                                    ││
│  │ - id, name, description                                        ││
│  │ - server_ids[], routing_rules (JSONB)                         ││
│  │ - created_at, user_id                                         ││
│  └────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐│
│  │ api_keys                                                        ││
│  │ - id, user_id, service_name, key_encrypted                    ││
│  │ - rate_limit_override, created_at                             ││
│  └────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐│
│  │ request_logs (Analytics - TimescaleDB extension)               ││
│  │ - timestamp, server_id, tool_name                             ││
│  │ - user_id, status_code, duration_ms                           ││
│  │ - cached, error_category, ip_address                          ││
│  └────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐│
│  │ traffic_metrics (Real-time aggregates)                         ││
│  │ - server_id, interval (hour/day/month)                        ││
│  │ - request_count, error_count, avg_duration                    ││
│  │ - cache_hit_rate, p95_latency, p99_latency                   ││
│  └────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  Storage Buckets:                                                   │
│  - api-docs/ (uploaded OpenAPI/Swagger files)                      │
│  - generated-code/ (TypeScript server code)                        │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           │ Request routing
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│           MCP Server Runtime (Vercel Edge Functions)                 │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐│
│  │ Traffic Manager Middleware                                      ││
│  │ - Authentication (API key validation)                          ││
│  │ - Rate limiting (per user, per server)                        ││
│  │ - Request logging (async to Supabase)                         ││
│  │ - Metrics collection                                           ││
│  └────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  Endpoints:                                                         │
│  ┌────────────────────────────────────────────────────────────────┐│
│  │ /mcp/builtwith           → Generated BuildWith server          ││
│  │ /mcp/stripe              → Generated Stripe server             ││
│  │ /mcp/github              → Generated GitHub server             ││
│  │ /mcp/my-custom-combo     → Composed server (multiple APIs)     ││
│  └────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  Each endpoint includes:                                            │
│  ✅ Rate limiting (token bucket - configurable per server)         │
│  ✅ LRU caching (configurable TTL)                                 │
│  ✅ Retry logic (exponential backoff)                              │
│  ✅ Error handling (categorized errors)                            │
│  ✅ Metrics tracking (request count, latency, errors)              │
│  ✅ Structured logging (Pino)                                      │
└─────────────────────────────────────────────────────────────────────┘
                           │
                           │ External API calls
                           ▼
                    ┌──────────────────┐
                    │  External APIs   │
                    │ - BuildWith      │
                    │ - Stripe         │
                    │ - GitHub         │
                    │ - Custom APIs    │
                    └──────────────────┘
```

---

## Server Generation Template

Every generated MCP server follows this structure:

```typescript
// Generated: /mcp/[server-id]/route.ts

import { RateLimiter } from '@/lib/infrastructure/rate-limiter';
import { CacheManager } from '@/lib/infrastructure/cache-manager';
import { RetryManager } from '@/lib/infrastructure/retry-manager';
import { Logger } from '@/lib/infrastructure/logger';
import { MetricsCollector } from '@/lib/infrastructure/metrics';

export async function POST(req: Request) {
  const logger = Logger.create({ serverId });
  const metrics = new MetricsCollector(serverId);

  // 1. Traffic Management
  const rateLimiter = new RateLimiter(serverConfig.rateLimit);
  await rateLimiter.acquire();

  // 2. Parse MCP request
  const mcpRequest = await parseMCPRequest(req);

  // 3. Validate & authenticate
  const user = await authenticate(mcpRequest.apiKey);

  // 4. Log request
  await logRequest({
    serverId,
    userId: user.id,
    toolName: mcpRequest.tool,
    timestamp: new Date(),
  });

  // 5. Execute tool with caching & retry
  const cache = new CacheManager(serverConfig.cache);
  const retry = new RetryManager(serverConfig.retry);

  try {
    const result = await cache.getOrSet(
      mcpRequest.cacheKey,
      () => retry.execute(() => callExternalAPI(mcpRequest))
    );

    // 6. Track metrics
    metrics.track({
      tool: mcpRequest.tool,
      duration: Date.now() - startTime,
      cached: result.fromCache,
      status: 'success',
    });

    return mcpResponse(result);

  } catch (error) {
    // 7. Error handling
    metrics.trackError(error);
    logger.error(error);

    return mcpErrorResponse(error);
  }
}
```

---

## Analytics & Traffic Management

### Real-time Metrics Dashboard

```typescript
// Components:
interface AnalyticsDashboard {
  overview: {
    totalRequests: number;
    activeServers: number;
    avgLatency: number;
    errorRate: number;
  };

  traffic: {
    requestsPerMinute: TimeSeriesData[];
    topServers: ServerUsage[];
    topTools: ToolUsage[];
  };

  performance: {
    p50Latency: number;
    p95Latency: number;
    p99Latency: number;
    cacheHitRate: number;
  };

  errors: {
    errorsByCategory: ErrorBreakdown[];
    recentErrors: ErrorLog[];
    errorRate: TimeSeriesData[];
  };
}
```

### Traffic Management Features

1. **Per-User Rate Limiting**
   ```typescript
   const rateLimits = {
     free: { rps: 1, concurrent: 2 },
     pro: { rps: 10, concurrent: 8 },
     enterprise: { rps: 100, concurrent: 50 }
   };
   ```

2. **Per-Server Rate Limiting**
   - Each generated server has configurable limits
   - Inherits from source API limits
   - Can be overridden by user tier

3. **Cost Tracking**
   - Track API credits consumed
   - Estimate costs per request
   - Billing/usage reports

4. **IP-based Throttling**
   - Prevent abuse
   - DDOS protection

---

## MCP Server Quality Standards

Every generated server MUST include:

### 1. Rate Limiting
```typescript
interface RateLimitConfig {
  requestsPerSecond: number;
  maxConcurrent: number;
  burstSize?: number;
}
```

### 2. Caching
```typescript
interface CacheConfig {
  enabled: boolean;
  maxSize: number;
  ttlMs: number;
  strategy: 'LRU' | 'LFU';
}
```

### 3. Retry Logic
```typescript
interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterMaxMs: number;
}
```

### 4. Error Handling
```typescript
enum ErrorCategory {
  RATE_LIMIT = 'RATE_LIMIT',
  AUTHENTICATION = 'AUTH',
  VALIDATION = 'VALIDATION',
  SERVER_ERROR = 'SERVER',
  NETWORK = 'NETWORK',
  TIMEOUT = 'TIMEOUT',
}
```

### 5. Monitoring
```typescript
interface Metrics {
  requestCount: Counter;
  errorCount: Counter;
  latency: Histogram;
  cacheHitRate: Gauge;
}
```

### 6. Logging
```typescript
interface LogEntry {
  timestamp: Date;
  level: 'debug' | 'info' | 'warn' | 'error';
  serverId: string;
  userId: string;
  toolName: string;
  duration: number;
  cached: boolean;
  error?: Error;
}
```

---

## Server Discovery & Catalog

### Server Registry Schema
```typescript
interface MCPServerMetadata {
  id: string;
  name: string;
  description: string;
  category: 'payment' | 'analytics' | 'crm' | 'custom';
  tags: string[];

  // Capabilities
  tools: ToolDefinition[];
  supportedProtocols: ('stdio' | 'http' | 'sse')[];

  // Quality metrics
  uptime: number;
  avgLatency: number;
  errorRate: number;

  // Usage
  totalRequests: number;
  activeUsers: number;

  // Config
  rateLimit: RateLimitConfig;
  cache: CacheConfig;
  retry: RetryConfig;

  // Metadata
  createdAt: Date;
  updatedAt: Date;
  author: string;
  version: string;
}
```

---

## Composition Engine

### How It Works:

```typescript
// User creates composition:
{
  name: "My Payment Stack",
  servers: [
    { id: "builtwith", prefix: "tech_" },
    { id: "stripe", prefix: "payment_" }
  ],
  routing: {
    "tech_*": "builtwith",
    "payment_*": "stripe"
  }
}

// Generated endpoint: /mcp/my-payment-stack
// Available tools:
// - tech_free_lookup (→ builtwith)
// - tech_domain_lookup (→ builtwith)
// - payment_create_charge (→ stripe)
// - payment_list_customers (→ stripe)
```

### Conflict Resolution:
- Tool name prefixing
- Priority routing
- Custom mappings

---

## Technology Stack

### Frontend
- **Framework:** Next.js 14 (App Router, Server Components)
- **UI:** shadcn/ui + Tailwind CSS
- **State:** Zustand (client state), tRPC (server state)
- **Charts:** Recharts / Tremor
- **Forms:** React Hook Form + Zod validation

### Backend
- **API:** Vercel Edge Functions
- **Type Safety:** tRPC (end-to-end TypeScript)
- **Auth:** Supabase Auth
- **Database:** Supabase PostgreSQL (with TimescaleDB for analytics)
- **Storage:** Supabase Storage
- **Queue:** Vercel Cron + Upstash (for background jobs)

### Infrastructure
- **Hosting:** Vercel
- **Database:** Supabase
- **Analytics:** Custom (Supabase + TimescaleDB)
- **Monitoring:** Sentry + Custom metrics
- **Logging:** Pino → Supabase logs table

---

## Implementation Phases

### Phase 1: Foundation (Week 1-2)
- [ ] Setup Next.js 14 project
- [ ] Supabase schema & auth
- [ ] Basic dashboard UI
- [ ] Server registry CRUD

### Phase 2: Generator (Week 3-4)
- [ ] OpenAPI parser
- [ ] MCP tool generator
- [ ] Quality template application
- [ ] Code generation engine

### Phase 3: Runtime (Week 5-6)
- [ ] MCP server edge functions
- [ ] Traffic manager middleware
- [ ] Rate limiting implementation
- [ ] Caching layer

### Phase 4: Analytics (Week 7-8)
- [ ] Request logging
- [ ] Metrics collection
- [ ] Analytics dashboard
- [ ] Real-time monitoring

### Phase 5: Composition (Week 9-10)
- [ ] Composition engine
- [ ] Routing logic
- [ ] Conflict resolution
- [ ] Testing & deployment

---

## Success Metrics

1. **Generation Quality**
   - Generated servers pass 80%+ test coverage
   - Meet same standards as hand-built servers

2. **Performance**
   - P95 latency < 500ms (cached)
   - P95 latency < 2s (API calls)
   - Cache hit rate > 30%

3. **Reliability**
   - 99.9% uptime
   - < 0.1% error rate

4. **Adoption**
   - 100+ generated servers
   - 1000+ daily requests
   - 10+ active users

---

**Status:** Ready for implementation
**Next Step:** Create SpecKit specifications
