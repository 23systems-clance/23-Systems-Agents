# MCP Factory - User Management & API Key System

**Version:** 1.0
**Status:** Design Phase
**Last Updated:** 2026-01-11

---

## Overview

API key-based authentication and authorization system for MCP Factory. This system operates at the **API level** (not login level), where each API key represents a user/agent with specific roles, permissions, and rate limits.

---

## Core Concepts

### 1. API Key = Identity

Each API key uniquely identifies:
- **User/Organization**: Who owns the key
- **Agent**: Optional AI agent assigned to this key
- **Role**: Access tier (free, pro, enterprise)
- **Permissions**: Which MCP servers/tools are accessible
- **Rate Limits**: Request quotas based on role

### 2. No Traditional Login Required

- Users generate API keys from the dashboard
- Keys are used directly in HTTP headers or MCP client config
- Authentication happens per-request via API key validation
- Dashboard uses Supabase Auth for key management UI only

---

## Database Schema

### Users Table
```sql
create table users (
  id uuid primary key default uuid_generate_v4(),
  email text unique not null,
  name text,
  organization text,
  role text not null default 'free', -- free, pro, enterprise
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

### API Keys Table
```sql
create table api_keys (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references users(id) on delete cascade,
  key_hash text unique not null, -- bcrypt hash of the key
  key_prefix text not null, -- First 8 chars for display (e.g., "mcp_1234...")
  name text not null, -- User-friendly name (e.g., "Claude Code Key")

  -- Role & Permissions
  role text not null, -- Inherits from user, but can be overridden
  permissions jsonb default '{}', -- Custom permissions object

  -- Agent Assignment
  agent_id uuid references agents(id) on delete set null,
  agent_name text, -- Denormalized for quick lookups

  -- Rate Limiting
  rate_limit_override jsonb, -- Override default role limits
  -- Example: {"requestsPerSecond": 20, "maxConcurrent": 10}

  -- Metadata
  enabled boolean default true,
  last_used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz default now(),

  -- Indexes
  constraint unique_key_prefix unique(key_prefix)
);

create index idx_api_keys_user_id on api_keys(user_id);
create index idx_api_keys_enabled on api_keys(enabled) where enabled = true;
create index idx_api_keys_agent_id on api_keys(agent_id);
```

### Agents Table
```sql
create table agents (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references users(id) on delete cascade,
  name text not null,
  description text,

  -- Access Control
  allowed_servers text[], -- Array of server IDs this agent can access
  allowed_tools text[], -- Optional: specific tools within servers

  -- Rate Limits
  rate_limit jsonb, -- Agent-specific rate limits

  -- Metadata
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_agents_user_id on agents(user_id);
```

### Roles Table
```sql
create table roles (
  name text primary key, -- free, pro, enterprise
  display_name text not null,

  -- Rate Limits
  rate_limit jsonb not null,
  -- Example: {
  --   "requestsPerSecond": 10,
  --   "maxConcurrent": 8,
  --   "dailyQuota": 1000,
  --   "burstSize": 20
  -- }

  -- Permissions
  max_api_keys int not null,
  max_agents int not null,
  access_level text not null, -- basic, advanced, full

  -- Features
  features jsonb default '[]',
  -- Example: ["analytics", "composition", "custom_rate_limits"]

  created_at timestamptz default now()
);

-- Seed default roles
insert into roles (name, display_name, rate_limit, max_api_keys, max_agents, access_level, features) values
  ('free', 'Free', '{"requestsPerSecond": 1, "maxConcurrent": 2, "dailyQuota": 100}', 1, 0, 'basic', '[]'),
  ('pro', 'Pro', '{"requestsPerSecond": 10, "maxConcurrent": 8, "dailyQuota": 10000}', 5, 3, 'advanced', '["analytics", "custom_rate_limits"]'),
  ('enterprise', 'Enterprise', '{"requestsPerSecond": 100, "maxConcurrent": 50, "dailyQuota": -1}', -1, -1, 'full', '["analytics", "composition", "custom_rate_limits", "priority_support"]');
```

### Request Logs Table (for analytics)
```sql
create table request_logs (
  id uuid primary key default uuid_generate_v4(),
  timestamp timestamptz not null default now(),

  -- Request Info
  user_id uuid references users(id) on delete set null,
  api_key_id uuid references api_keys(id) on delete set null,
  agent_id uuid references agents(id) on delete set null,

  -- MCP Info
  server_id text not null,
  tool_name text not null,

  -- Response Info
  status_code int not null,
  duration_ms int not null,
  cached boolean default false,
  error_category text,

  -- Metadata
  ip_address inet,
  user_agent text
);

-- Create hypertable for time-series data (TimescaleDB)
select create_hypertable('request_logs', 'timestamp');

-- Indexes
create index idx_request_logs_user_id on request_logs(user_id, timestamp desc);
create index idx_request_logs_api_key_id on request_logs(api_key_id, timestamp desc);
create index idx_request_logs_server_tool on request_logs(server_id, tool_name, timestamp desc);
```

---

## Authentication Flow

### 1. API Key Generation

```typescript
// User creates API key from dashboard
POST /api/keys/create
{
  "name": "Claude Code Key",
  "role": "pro", // Optional override
  "agentId": "uuid", // Optional agent assignment
  "expiresAt": "2027-01-01", // Optional expiration
  "rateLimitOverride": { // Optional custom limits
    "requestsPerSecond": 15
  }
}

// Response
{
  "id": "uuid",
  "key": "mcp_1234567890abcdef...full-key-here", // Only shown once
  "keyPrefix": "mcp_12345678",
  "name": "Claude Code Key",
  "role": "pro",
  "createdAt": "2026-01-11T12:00:00Z"
}
```

### 2. API Request with Key

```typescript
// HTTP Request
POST /mcp/builtwith/tools/call
Headers:
  Authorization: Bearer mcp_1234567890abcdef...
  Content-Type: application/json

Body:
{
  "name": "builtwith_free_lookup",
  "arguments": {"domain": "github.com"}
}
```

### 3. Authentication Middleware

```typescript
// Middleware validates API key on every request
async function authenticateAPIKey(req: Request): Promise<AuthContext> {
  // 1. Extract key from Authorization header
  const apiKey = extractBearerToken(req);
  if (!apiKey) throw new UnauthorizedError('API key required');

  // 2. Hash and lookup key in database
  const keyHash = await bcrypt.hash(apiKey, 10);
  const keyRecord = await db.apiKeys.findByHash(keyHash);

  if (!keyRecord || !keyRecord.enabled) {
    throw new UnauthorizedError('Invalid or disabled API key');
  }

  // 3. Check expiration
  if (keyRecord.expiresAt && new Date() > keyRecord.expiresAt) {
    throw new UnauthorizedError('API key expired');
  }

  // 4. Load user, role, and agent
  const user = await db.users.findById(keyRecord.userId);
  const role = await db.roles.findByName(keyRecord.role);
  const agent = keyRecord.agentId ? await db.agents.findById(keyRecord.agentId) : null;

  // 5. Update last used timestamp (async, don't await)
  db.apiKeys.updateLastUsed(keyRecord.id).catch(console.error);

  // 6. Return auth context
  return {
    user,
    apiKey: keyRecord,
    role,
    agent,
    rateLimits: keyRecord.rateLimitOverride || role.rateLimit,
  };
}
```

### 4. Authorization Middleware

```typescript
async function authorize(ctx: AuthContext, serverId: string, toolName: string) {
  // 1. Check if agent has access to this server
  if (ctx.agent) {
    const allowedServers = ctx.agent.allowedServers;
    if (allowedServers && !allowedServers.includes(serverId)) {
      throw new ForbiddenError(`Agent not authorized for server: ${serverId}`);
    }

    const allowedTools = ctx.agent.allowedTools;
    if (allowedTools && !allowedTools.includes(toolName)) {
      throw new ForbiddenError(`Agent not authorized for tool: ${toolName}`);
    }
  }

  // 2. Check role-based access level
  const server = await db.servers.findById(serverId);
  if (server.requiredAccessLevel > ctx.role.accessLevel) {
    throw new ForbiddenError(`Requires ${server.requiredAccessLevel} access level`);
  }

  // 3. Check daily quota
  const today = new Date().toISOString().split('T')[0];
  const usageToday = await db.requestLogs.countByUser(ctx.user.id, today);

  if (ctx.role.rateLimit.dailyQuota > 0 && usageToday >= ctx.role.rateLimit.dailyQuota) {
    throw new RateLimitError('Daily quota exceeded');
  }

  return true;
}
```

---

## Agent Management

### Why Agents?

Agents allow users to:
1. **Isolate access**: Different agents have access to different servers/tools
2. **Track usage**: See which agent is making which requests
3. **Manage workflows**: Assign specific agents to specific tasks
4. **Control costs**: Set per-agent rate limits

### Agent Workflow

```typescript
// 1. Create an agent
POST /api/agents/create
{
  "name": "Code Analysis Agent",
  "description": "Analyzes code repositories",
  "allowedServers": ["builtwith", "github"],
  "allowedTools": ["builtwith_domain_lookup", "github_get_repo"],
  "rateLimit": {
    "requestsPerSecond": 5,
    "maxConcurrent": 3
  }
}

// 2. Assign agent to API key
POST /api/keys/uuid/assign-agent
{
  "agentId": "agent-uuid"
}

// 3. Agent makes requests using the API key
POST /mcp/builtwith/tools/call
Headers:
  Authorization: Bearer mcp_key_with_agent_assigned
```

---

## Rate Limiting Strategy

### Hierarchy (most specific wins)

1. **API Key Override** (highest priority)
2. **Agent Rate Limit** (if agent assigned)
3. **Role Rate Limit** (default)

### Implementation

```typescript
function getRateLimits(ctx: AuthContext): RateLimitConfig {
  // 1. Check API key override
  if (ctx.apiKey.rateLimitOverride) {
    return ctx.apiKey.rateLimitOverride;
  }

  // 2. Check agent rate limit
  if (ctx.agent?.rateLimit) {
    return ctx.agent.rateLimit;
  }

  // 3. Fall back to role rate limit
  return ctx.role.rateLimit;
}

// Apply to existing rate limiter
const rateLimits = getRateLimits(authContext);
const rateLimiter = new TokenBucketRateLimiter(rateLimits);
await rateLimiter.acquire();
```

---

## Security Best Practices

### 1. API Key Storage

- **Never store plain-text keys**: Use bcrypt with salt
- **Show key once**: After generation, only show prefix
- **Key rotation**: Allow users to regenerate keys
- **Revocation**: Disable keys immediately when compromised

### 2. Key Format

```
mcp_[environment]_[random_32_chars]

Examples:
- mcp_prod_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
- mcp_test_x9y8z7w6v5u4t3s2r1q0p9o8n7m6l5k4
```

### 3. Rate Limiting

- **Per-key rate limiting**: Prevent single key abuse
- **Per-user rate limiting**: Prevent multi-key abuse
- **IP-based throttling**: Additional layer of protection

---

## Analytics & Monitoring

### Dashboard Metrics

```typescript
interface UserAnalytics {
  overview: {
    totalRequests: number;
    successRate: number;
    avgLatency: number;
    costEstimate: number;
  };

  byAPIKey: {
    keyName: string;
    keyPrefix: string;
    requests: number;
    lastUsed: Date;
  }[];

  byAgent: {
    agentName: string;
    requests: number;
    topTools: string[];
  }[];

  byServer: {
    serverName: string;
    requests: number;
    avgLatency: number;
  }[];

  usage: {
    dailyQuota: number;
    quotaUsed: number;
    quotaRemaining: number;
    resetAt: Date;
  };
}
```

---

## Integration with MCP Factory

### HTTP Server Transport (Updated)

```typescript
export class HTTPServerTransport {
  async initialize(port: number): Promise<void> {
    // 1. Authentication middleware
    this.fastify.addHook('preHandler', async (request, reply) => {
      try {
        request.authContext = await authenticateAPIKey(request);
      } catch (error) {
        reply.code(401).send({ error: error.message });
      }
    });

    // 2. Authorization middleware
    this.fastify.addHook('preHandler', async (request, reply) => {
      if (request.url.startsWith('/mcp/')) {
        const { serverId, toolName } = parseRoute(request.url);
        try {
          await authorize(request.authContext, serverId, toolName);
        } catch (error) {
          reply.code(403).send({ error: error.message });
        }
      }
    });

    // 3. Rate limiting middleware
    this.fastify.addHook('preHandler', async (request, reply) => {
      const rateLimits = getRateLimits(request.authContext);
      const rateLimiter = getRateLimiterForKey(request.authContext.apiKey.id, rateLimits);

      try {
        await rateLimiter.acquire();
      } catch (error) {
        reply.code(429).send({
          error: 'Rate limit exceeded',
          retryAfter: error.retryAfter,
          limits: rateLimits,
        });
      }
    });

    // 4. Request logging middleware
    this.fastify.addHook('onResponse', async (request, reply) => {
      await logRequest({
        userId: request.authContext.user.id,
        apiKeyId: request.authContext.apiKey.id,
        agentId: request.authContext.agent?.id,
        serverId: parseRoute(request.url).serverId,
        toolName: request.body.name,
        statusCode: reply.statusCode,
        durationMs: reply.getResponseTime(),
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });
    });

    // Existing endpoints...
  }
}
```

---

## MVP Implementation Checklist

- [ ] Create Supabase database schema
- [ ] Implement API key generation endpoint
- [ ] Implement authentication middleware
- [ ] Implement authorization middleware
- [ ] Integrate rate limiting per API key
- [ ] Create agent management endpoints
- [ ] Add request logging to Supabase
- [ ] Build dashboard UI for key management
- [ ] Add analytics dashboard
- [ ] Implement key rotation
- [ ] Add IP-based throttling
- [ ] Create usage quotas and billing integration

---

**Status:** Ready for implementation
**Next Step:** Create SpecKit specifications
