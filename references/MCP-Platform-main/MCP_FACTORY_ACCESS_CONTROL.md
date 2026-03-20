# MCP Factory - Access Control Strategy

**Version:** 1.0
**Status:** Design Phase
**Last Updated:** 2026-01-11

---

## Question

Should access controls be managed:
1. **Globally** - One API key works across all MCP servers with permissions?
2. **Per-Server** - Each MCP server has its own set of API keys?
3. **Hybrid** - Global API keys with server-level permissions?

---

## Option 1: Global API Keys (Simple)

### How It Works
- User has **one API key** that works across all MCP servers
- All MCP servers share the same authentication system
- No per-server access control

### Pros
✅ Simple for users to manage
✅ One key to rule them all
✅ Easy to implement

### Cons
❌ No granular control per server
❌ If key is compromised, all servers are exposed
❌ Can't have different rate limits per server

### Example
```typescript
// User has ONE API key
const apiKey = "mcp_prod_abc123...";

// Works for all servers
await fetch('/mcp/builtwith/tools/call', {
  headers: { 'Authorization': `Bearer ${apiKey}` }
});

await fetch('/mcp/stripe/tools/call', {
  headers: { 'Authorization': `Bearer ${apiKey}` }
});

await fetch('/mcp/github/tools/call', {
  headers: { 'Authorization': `Bearer ${apiKey}` }
});
```

---

## Option 2: Per-Server API Keys (Complex)

### How It Works
- Each MCP server has its own isolated set of API keys
- User creates separate keys for each server they want to use
- Keys are scoped to a specific server

### Pros
✅ Maximum isolation and security
✅ Can have different rate limits per server
✅ Compromise of one key doesn't affect others

### Cons
❌ Complex for users to manage multiple keys
❌ Difficult to track which key is for what
❌ Annoying if using many servers

### Example
```typescript
// User has DIFFERENT API key per server
const builtwithKey = "mcp_builtwith_abc123...";
const stripeKey = "mcp_stripe_def456...";
const githubKey = "mcp_github_ghi789...";

// Each server requires its own key
await fetch('/mcp/builtwith/tools/call', {
  headers: { 'Authorization': `Bearer ${builtwithKey}` }
});

await fetch('/mcp/stripe/tools/call', {
  headers: { 'Authorization': `Bearer ${stripeKey}` }
});

await fetch('/mcp/github/tools/call', {
  headers: { 'Authorization': `Bearer ${githubKey}` }
});
```

---

## Option 3: Global Keys with Server-Level Permissions (RECOMMENDED ⭐)

### How It Works
- User has **global API keys** that work across all MCP servers
- Each key has **permissions** defining which servers are accessible
- Permissions can be configured via:
  - **Agent assignment** (agent has allowedServers)
  - **Key-level permissions** (key has allowedServers)
  - **Role-based defaults** (free users can only access certain servers)

### Pros
✅ Best of both worlds - simple UX with granular control
✅ One key to manage, but configurable access
✅ Can have different rate limits per server per key
✅ Agent-based access control works naturally
✅ Easy to revoke access to specific servers

### Cons
❌ Slightly more complex implementation
❌ Requires permissions system

### Example

#### Database Schema
```typescript
// API Keys table
interface APIKey {
  id: string;
  userId: string;
  keyHash: string;
  name: string;

  // Global permissions
  allowedServers: string[]; // ['builtwith', 'stripe', 'github']

  // Or use agent
  agentId?: string;
}

// Agents table
interface Agent {
  id: string;
  userId: string;
  name: string;

  // Server-level permissions
  allowedServers: string[]; // ['builtwith', 'github']
  allowedTools: string[]; // Optional: specific tools

  // Per-server rate limits
  serverRateLimits: {
    [serverId: string]: RateLimitConfig;
  };
}
```

#### User Experience
```typescript
// 1. User creates ONE global API key
const apiKey = "mcp_prod_abc123...";

// 2. User configures which servers this key can access
// Option A: Direct configuration
await createAPIKey({
  name: "My Global Key",
  allowedServers: ["builtwith", "github"], // Explicit list
});

// Option B: Via agent
await createAgent({
  name: "Research Agent",
  allowedServers: ["builtwith", "github"],
  allowedTools: ["builtwith_free_lookup", "github_get_repo"],
});

await createAPIKey({
  name: "Research Key",
  agentId: "agent-uuid", // Inherits agent permissions
});

// 3. Key works for allowed servers only
await fetch('/mcp/builtwith/tools/call', {
  headers: { 'Authorization': `Bearer ${apiKey}` }
}); // ✅ Works

await fetch('/mcp/github/tools/call', {
  headers: { 'Authorization': `Bearer ${apiKey}` }
}); // ✅ Works

await fetch('/mcp/stripe/tools/call', {
  headers: { 'Authorization': `Bearer ${apiKey}` }
}); // ❌ 403 Forbidden - not in allowedServers
```

#### Authorization Middleware
```typescript
async function authorize(
  authContext: AuthContext,
  serverId: string,
  toolName: string
) {
  // 1. Check if key has direct server permissions
  if (authContext.apiKey.allowedServers) {
    if (!authContext.apiKey.allowedServers.includes(serverId)) {
      throw new ForbiddenError(`API key not authorized for server: ${serverId}`);
    }
  }

  // 2. Check if agent has server permissions
  if (authContext.agent) {
    if (!authContext.agent.allowedServers.includes(serverId)) {
      throw new ForbiddenError(`Agent not authorized for server: ${serverId}`);
    }

    // Optional: Check tool-level permissions
    if (authContext.agent.allowedTools) {
      if (!authContext.agent.allowedTools.includes(toolName)) {
        throw new ForbiddenError(`Agent not authorized for tool: ${toolName}`);
      }
    }
  }

  // 3. Check role-based defaults
  const server = await db.servers.findById(serverId);
  if (server.requiredAccessLevel > authContext.role.accessLevel) {
    throw new ForbiddenError(`Requires ${server.requiredAccessLevel} access level`);
  }

  return true;
}
```

---

## Advanced: Per-Server Rate Limits

With Option 3, you can also have **different rate limits per server**:

```typescript
interface Agent {
  id: string;
  name: string;

  // Default rate limit (global)
  rateLimit: RateLimitConfig;

  // Per-server overrides
  serverRateLimits: {
    builtwith: {
      requestsPerSecond: 2, // Slower for BuildWith
      maxConcurrent: 4,
    },
    stripe: {
      requestsPerSecond: 10, // Faster for Stripe
      maxConcurrent: 8,
    },
  };
}

// Authorization middleware
function getRateLimitsForServer(agent: Agent, serverId: string): RateLimitConfig {
  return agent.serverRateLimits[serverId] || agent.rateLimit;
}
```

---

## External API Key Passthrough (Bonus)

Some MCP servers might require **external API keys** (e.g., BuildWith API key, Stripe API key). We can support this:

### Option A: Store in User Profile
```typescript
interface User {
  id: string;
  email: string;

  // Store external API keys encrypted
  externalAPIKeys: {
    builtwith: string; // User's BuildWith API key
    stripe: string; // User's Stripe API key
  };
}

// MCP server uses user's external key
async function callBuildWith(authContext: AuthContext, domain: string) {
  const userBuiltWithKey = authContext.user.externalAPIKeys.builtwith;
  const result = await buildwithClient.lookup(domain, userBuiltWithKey);
  return result;
}
```

### Option B: Shared Pool (Factory-Managed)
```typescript
// MCP Factory manages API keys centrally
const BUILTWITH_API_KEY = process.env.BUILTWITH_API_KEY;
const STRIPE_API_KEY = process.env.STRIPE_API_KEY;

// All users share the factory's keys
async function callBuildWith(authContext: AuthContext, domain: string) {
  const result = await buildwithClient.lookup(domain, BUILTWITH_API_KEY);

  // Track usage per user for billing
  await logUsage(authContext.userId, 'builtwith', 'domain_lookup', cost);

  return result;
}
```

### Recommended: Hybrid Approach
- **Free/Pro users**: Use shared pool (factory-managed keys)
- **Enterprise users**: Can provide their own external API keys (BYOK)

---

## Recommendation: Option 3 with Hybrid External Keys

### Why?
✅ **Simple UX**: One global API key per user
✅ **Granular Control**: Server-level permissions via agents or direct config
✅ **Flexible Rate Limiting**: Global + per-server limits
✅ **Secure**: Agent-based isolation when needed
✅ **Scalable**: Easy to add new servers without key proliferation
✅ **Cost-Effective**: Shared pool for most users, BYOK for enterprise

### Implementation Summary

```typescript
// 1. User creates API key
POST /api/keys/create
{
  "name": "My Global Key",
  "allowedServers": ["builtwith", "github"], // Optional: defaults to all
  "agentId": "agent-uuid", // Optional: use agent permissions
}

// 2. HTTP request to MCP server
POST /mcp/builtwith/tools/call
Headers:
  Authorization: Bearer mcp_prod_abc123...

// 3. Middleware validates
async function handleRequest(req: Request) {
  // Auth
  const authContext = await authenticateAPIKey(req);

  // Authorize
  await authorize(authContext, 'builtwith', 'builtwith_domain_lookup');

  // Rate limit
  const rateLimits = getRateLimitsForServer(authContext, 'builtwith');
  await enforceRateLimit(authContext, rateLimits);

  // Execute tool
  const result = await callTool('builtwith_domain_lookup', args);

  // Log
  await logRequest(authContext, 'builtwith', 'builtwith_domain_lookup', result);

  return result;
}
```

---

## Migration Path

### Phase 1 (MVP)
- Single global API key per user
- No server-level permissions (all servers accessible)
- Global rate limits only

### Phase 2 (Post-MVP)
- Add `allowedServers` to API keys
- Add `allowedServers` to agents
- Implement authorization middleware

### Phase 3 (Advanced)
- Per-server rate limits
- Tool-level permissions
- External API key passthrough (BYOK)

---

**Recommended Decision:** Use **Option 3** (Global Keys with Server-Level Permissions)

**Rationale:**
- Balances simplicity and flexibility
- Supports agent-based workflows
- Easy to add granular controls later
- Best user experience
