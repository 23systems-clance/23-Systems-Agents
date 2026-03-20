# MCP Factory MVP - Phase 1 Specification

**Version:** 1.0
**Status:** Active
**Priority:** P0 (Critical)
**Last Updated:** 2026-01-11

---

## 📋 Overview

Build the MVP of MCP Factory - a platform that auto-generates production-ready MCP servers from API documentation with built-in user management, analytics, and HTTP access.

### Success Criteria
- ✅ BuildWith MCP Server accessible via HTTP API
- ✅ API key authentication system working
- ✅ User can generate and manage API keys from dashboard
- ✅ Request logging and basic analytics working
- ✅ Deployed to Vercel with Supabase backend
- ✅ Rate limiting enforced per API key
- ✅ Agent assignment functional

---

## 🎯 Scope

### Phase 1 (This Spec)
1. **Complete BuildWith MCP HTTP Server** ✅ DONE
2. **API Key Authentication System**
3. **Supabase Backend Setup**
4. **Basic Dashboard UI**
5. **Deploy to Vercel**
6. **Request Logging & Analytics**

### Out of Scope (Future Phases)
- MCP Server Generator (auto-generation from OpenAPI)
- Server Composition Engine
- Advanced analytics dashboards
- Billing integration

---

## 📐 Technical Architecture

### Stack
- **Frontend**: Next.js 14 (App Router), shadcn/ui, Tailwind CSS
- **Backend**: Vercel Edge Functions
- **Database**: Supabase PostgreSQL + TimescaleDB
- **Auth**: Supabase Auth (dashboard only) + API Key auth (API level)
- **MCP Server**: FastifyJS with HTTP transport
- **Deployment**: Vercel

### Repository Structure
```
MCP - Builtwith/
├── .specpilot/
│   └── specs/
│       └── mvp-phase-1.md (this file)
├── src/                       # BuildWith MCP Server (Node.js/TypeScript)
│   ├── config/
│   ├── infrastructure/        # Rate limiting, caching, retry, logging
│   ├── integration/           # BuildWith API client
│   ├── services/              # BuildWith service layer
│   ├── tools/                 # MCP tool definitions
│   ├── transport/             # HTTP server transport ✅ DONE
│   ├── types/
│   ├── index.ts               # stdio mode entry
│   └── http-server.ts         # HTTP mode entry ✅ DONE
├── app/                       # Next.js 14 Dashboard (to create)
│   ├── (auth)/
│   │   ├── login/
│   │   └── signup/
│   ├── (dashboard)/
│   │   ├── api-keys/
│   │   ├── agents/
│   │   ├── analytics/
│   │   └── settings/
│   ├── api/                   # tRPC/Next.js API routes
│   │   ├── auth/
│   │   ├── keys/
│   │   ├── agents/
│   │   └── analytics/
│   ├── layout.tsx
│   └── page.tsx
├── lib/                       # Shared utilities (to create)
│   ├── auth/
│   │   ├── api-key-auth.ts
│   │   └── supabase.ts
│   ├── middleware/
│   │   ├── authenticate.ts
│   │   ├── authorize.ts
│   │   └── rate-limit.ts
│   └── db/
│       ├── schema.sql
│       └── queries.ts
├── supabase/                  # Supabase migrations (to create)
│   └── migrations/
│       ├── 001_initial_schema.sql
│       ├── 002_api_keys.sql
│       └── 003_agents.sql
├── vercel.json                # Vercel configuration (to create)
└── package.json
```

---

## 📝 Detailed Requirements

### 1. API Key Authentication System

**Spec ID**: `AUTH-001`
**Priority**: P0
**Status**: Pending

#### Requirements
1. ✅ Users can generate API keys from dashboard
2. ✅ API keys follow format: `mcp_[env]_[32_random_chars]`
3. ✅ Keys are bcrypt hashed in database
4. ✅ Only key prefix shown after generation
5. ✅ Each key has:
   - Name (user-friendly)
   - Role (free, pro, enterprise)
   - Optional agent assignment
   - Optional rate limit override
   - Optional expiration date

#### Acceptance Criteria
- [ ] User can create API key from dashboard
- [ ] Key is shown once and copied to clipboard
- [ ] Only prefix visible in key list
- [ ] Key can be disabled/revoked
- [ ] HTTP requests with invalid key return 401
- [ ] HTTP requests with expired key return 401
- [ ] Last used timestamp updates on each request

#### Implementation Files
```typescript
// lib/auth/api-key-auth.ts
export async function authenticateAPIKey(key: string): Promise<AuthContext> { ... }
export async function generateAPIKey(userId: string, options: KeyOptions): Promise<APIKey> { ... }
export async function revokeAPIKey(keyId: string): Promise<void> { ... }

// lib/middleware/authenticate.ts
export async function withAuth(handler: APIHandler): Promise<Response> { ... }

// app/api/keys/route.ts
export async function POST(req: Request): Promise<Response> { ... }
export async function GET(req: Request): Promise<Response> { ... }
export async function DELETE(req: Request): Promise<Response> { ... }
```

---

### 2. Supabase Backend Setup

**Spec ID**: `DB-001`
**Priority**: P0
**Status**: Pending

#### Requirements
1. ✅ Create Supabase project
2. ✅ Run schema migrations
3. ✅ Enable TimescaleDB extension for analytics
4. ✅ Create database tables:
   - `users`
   - `api_keys`
   - `agents`
   - `roles`
   - `request_logs` (hypertable)
   - `mcp_servers` (for future use)
5. ✅ Set up row-level security policies
6. ✅ Create database indexes for performance

#### Acceptance Criteria
- [ ] Supabase project created
- [ ] All tables created successfully
- [ ] TimescaleDB extension enabled
- [ ] Row-level security policies working
- [ ] Can query request_logs efficiently
- [ ] Environment variables configured

#### Implementation Files
```sql
-- supabase/migrations/001_initial_schema.sql
create table users (...);
create table roles (...);

-- supabase/migrations/002_api_keys.sql
create table api_keys (...);
create index idx_api_keys_user_id on api_keys(user_id);

-- supabase/migrations/003_agents.sql
create table agents (...);

-- supabase/migrations/004_request_logs.sql
create table request_logs (...);
select create_hypertable('request_logs', 'timestamp');
```

---

### 3. HTTP Server Middleware Integration

**Spec ID**: `HTTP-001`
**Priority**: P0
**Status**: Pending

#### Requirements
1. ✅ Add authentication middleware to HTTP server
2. ✅ Add authorization middleware
3. ✅ Add request logging middleware
4. ✅ Add rate limiting per API key
5. ✅ Add error handling middleware

#### Acceptance Criteria
- [ ] All HTTP requests require valid API key
- [ ] Rate limiting enforced per key
- [ ] Requests logged to Supabase
- [ ] Agent permissions enforced
- [ ] Proper error responses (401, 403, 429, 500)

#### Implementation Files
```typescript
// src/transport/http-server-transport.ts (update existing)
async initialize(port: number): Promise<void> {
  // Add authentication hook
  this.fastify.addHook('preHandler', async (request, reply) => {
    request.authContext = await authenticateAPIKey(request);
  });

  // Add authorization hook
  this.fastify.addHook('preHandler', async (request, reply) => {
    await authorize(request.authContext, serverId, toolName);
  });

  // Add rate limiting hook
  this.fastify.addHook('preHandler', async (request, reply) => {
    await enforceRateLimit(request.authContext);
  });

  // Add logging hook
  this.fastify.addHook('onResponse', async (request, reply) => {
    await logRequest({...});
  });

  // Existing endpoints...
}
```

---

### 4. Basic Dashboard UI

**Spec ID**: `UI-001`
**Priority**: P0
**Status**: Pending

#### Requirements
1. ✅ Login/Signup pages (Supabase Auth)
2. ✅ API Keys management page
3. ✅ Agents management page
4. ✅ Basic analytics dashboard
5. ✅ Settings page

#### Pages

##### 4.1 Login Page
- Email + password login
- "Sign up" link
- Supabase Auth integration

##### 4.2 API Keys Page
- List all API keys (show prefix, name, role, last used)
- "Create New Key" button
- Delete/Revoke key button
- Copy key button (only shows once)
- Modal for key creation:
  - Name input
  - Role selector
  - Agent selector (optional)
  - Expiration date picker (optional)
  - Rate limit override (optional)

##### 4.3 Agents Page
- List all agents
- "Create New Agent" button
- Edit/Delete agent
- Agent creation form:
  - Name input
  - Description textarea
  - Allowed servers multi-select
  - Allowed tools multi-select
  - Rate limit configuration

##### 4.4 Analytics Page
- Total requests (today/week/month)
- Success rate gauge
- Average latency chart
- Requests per API key table
- Requests per agent table
- Usage quota progress bar

##### 4.5 Settings Page
- User profile
- Role/Plan display
- Upgrade to Pro/Enterprise

#### Acceptance Criteria
- [ ] User can sign up and log in
- [ ] User can create API keys
- [ ] User can create agents
- [ ] User can view analytics
- [ ] Dashboard is responsive (mobile-friendly)
- [ ] Loading states for all async actions
- [ ] Error handling with toast notifications

#### Implementation Files
```typescript
// app/(dashboard)/api-keys/page.tsx
export default function APIKeysPage() { ... }

// app/(dashboard)/agents/page.tsx
export default function AgentsPage() { ... }

// app/(dashboard)/analytics/page.tsx
export default function AnalyticsPage() { ... }

// components/api-key-card.tsx
// components/agent-card.tsx
// components/analytics-chart.tsx
```

---

### 5. Deploy to Vercel

**Spec ID**: `DEPLOY-001`
**Priority**: P0
**Status**: Pending

#### Requirements
1. ✅ Create `vercel.json` configuration
2. ✅ Configure environment variables in Vercel
3. ✅ Deploy Next.js dashboard
4. ✅ Deploy MCP HTTP server as serverless function
5. ✅ Configure custom domain (optional)

#### Acceptance Criteria
- [ ] Dashboard accessible at Vercel URL
- [ ] MCP HTTP endpoints working
- [ ] Environment variables properly configured
- [ ] Build succeeds without errors
- [ ] Health check endpoint returns 200

#### Implementation Files
```json
// vercel.json
{
  "buildCommand": "npm run build",
  "devCommand": "npm run dev",
  "installCommand": "npm install",
  "framework": "nextjs",
  "rewrites": [
    {
      "source": "/mcp/:path*",
      "destination": "/api/mcp/:path*"
    }
  ],
  "env": {
    "BUILTWITH_API_KEY": "@builtwith-api-key",
    "NEXT_PUBLIC_SUPABASE_URL": "@supabase-url",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY": "@supabase-anon-key",
    "SUPABASE_SERVICE_KEY": "@supabase-service-key"
  }
}
```

---

### 6. Request Logging & Analytics

**Spec ID**: `ANALYTICS-001`
**Priority**: P1
**Status**: Pending

#### Requirements
1. ✅ Log every MCP request to Supabase
2. ✅ Store: user_id, api_key_id, agent_id, server_id, tool_name, status, duration, cached, ip
3. ✅ Aggregate data for analytics dashboard
4. ✅ Real-time usage quota tracking

#### Acceptance Criteria
- [ ] Every request logged asynchronously
- [ ] Analytics dashboard loads in <2s
- [ ] Usage quota updates in real-time
- [ ] Can filter by date range
- [ ] Can filter by API key or agent

#### Implementation Files
```typescript
// lib/analytics/log-request.ts
export async function logRequest(data: RequestLogData): Promise<void> { ... }

// lib/analytics/get-analytics.ts
export async function getUserAnalytics(userId: string, dateRange: DateRange): Promise<Analytics> { ... }

// app/api/analytics/route.ts
export async function GET(req: Request): Promise<Response> { ... }
```

---

## 🚀 Implementation Plan

### Week 1: Backend Foundation
- [ ] Day 1-2: Supabase setup + schema migrations
- [ ] Day 3-4: API key authentication system
- [ ] Day 5-6: Middleware integration (auth, rate limit, logging)
- [ ] Day 7: Testing + bug fixes

### Week 2: Dashboard UI
- [ ] Day 1-2: Next.js project setup + auth pages
- [ ] Day 3-4: API Keys management page
- [ ] Day 5-6: Agents management page
- [ ] Day 7: Analytics dashboard

### Week 3: Polish & Deploy
- [ ] Day 1-2: UI polish, error handling, loading states
- [ ] Day 3-4: Testing (E2E, integration)
- [ ] Day 5-6: Deploy to Vercel + environment configuration
- [ ] Day 7: Documentation + handoff

---

## 🧪 Testing Strategy

### Unit Tests
- API key generation and validation
- Authentication middleware
- Rate limiting logic
- Request logging

### Integration Tests
- Full HTTP request flow (auth → rate limit → tool call → log)
- Dashboard API endpoints
- Supabase queries

### E2E Tests
- User signup → create API key → make MCP request
- Create agent → assign to key → verify permissions

---

## 📊 Success Metrics

### Performance
- API latency P95 < 500ms (cached)
- API latency P95 < 2s (non-cached)
- Dashboard load time < 3s

### Reliability
- 99.9% uptime
- < 0.1% error rate

### Usage
- 10+ users signed up
- 50+ API keys created
- 1000+ MCP requests handled

---

## 🔒 Security Considerations

1. ✅ API keys bcrypt hashed
2. ✅ Row-level security on all Supabase tables
3. ✅ Rate limiting prevents abuse
4. ✅ IP-based throttling
5. ✅ CORS configured properly
6. ✅ No API keys in logs (redacted)

---

## 📚 Dependencies

### External Services
- Supabase (database, auth)
- Vercel (hosting)
- BuildWith API (external API)

### NPM Packages (Additional)
```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2.39.0",
    "@supabase/auth-helpers-nextjs": "^0.8.0",
    "bcrypt": "^5.1.1",
    "next": "^14.0.0",
    "react": "^18.2.0",
    "@radix-ui/react-*": "latest",
    "tailwindcss": "^3.4.0",
    "zod": "^3.22.0"
  }
}
```

---

## 🔗 Related Documents

- [MCP Factory Architecture](../MCP_FACTORY_ARCHITECTURE.md)
- [User Management Design](../MCP_FACTORY_USER_MANAGEMENT.md)
- [BuildWith MCP Server Spec](../SPEC.md)

---

**Next Steps:**
1. Mark "Design user management" as completed ✅
2. Start implementing Supabase schema
3. Build API key authentication system
4. Create dashboard UI
5. Deploy to Vercel

**Assigned To:** Developer Labs AI
**Target Completion:** Week of 2026-01-18
