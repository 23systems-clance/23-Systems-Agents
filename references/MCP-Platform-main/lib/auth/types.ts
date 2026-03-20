/**
 * Authentication and Authorization Types
 * Based on Option 3: Global Keys with Server-Level Permissions
 */

export interface User {
  id: string;
  email: string;
  name: string | null;
  organization: string | null;
  role: RoleName;
  createdAt: Date;
  updatedAt: Date;
}

export type RoleName = 'free' | 'pro' | 'enterprise';

export interface Role {
  name: RoleName;
  displayName: string;
  rateLimit: RateLimitConfig;
  maxApiKeys: number; // -1 = unlimited
  maxAgents: number; // -1 = unlimited, 0 = not allowed
  accessLevel: AccessLevel;
  features: string[];
}

export type AccessLevel = 'basic' | 'advanced' | 'full';

export interface RateLimitConfig {
  requestsPerSecond: number;
  maxConcurrent: number;
  dailyQuota: number; // -1 = unlimited
  burstSize?: number;
}

export interface APIKey {
  id: string;
  userId: string;
  keyHash: string; // bcrypt hash
  keyPrefix: string; // Display-safe prefix (e.g., "mcp_prod_abc")
  name: string;
  description: string | null;
  role: RoleName;

  // Server-Level Permissions (Option 3)
  allowedServers: string[] | null; // null = all, [] = none, [ids] = specific
  allowedTools: string[] | null; // null = all, [ids] = specific

  // Agent Assignment
  agentId: string | null;
  agentName: string | null;

  // Rate Limiting
  rateLimitOverride: RateLimitConfig | null;

  // External API Keys (BYOK for enterprise)
  externalApiKeys: Record<string, string> | null; // Encrypted

  // Status
  enabled: boolean;
  lastUsedAt: Date | null;
  expiresAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export interface Agent {
  id: string;
  userId: string;
  name: string;
  description: string | null;

  // Server & Tool Permissions
  allowedServers: string[]; // Empty = no access
  allowedTools: string[] | null; // null = all tools in allowed servers

  // Rate Limiting
  rateLimit: RateLimitConfig | null;
  serverRateLimits: Record<string, RateLimitConfig> | null; // Per-server overrides

  createdAt: Date;
  updatedAt: Date;
}

/**
 * Authentication Context
 * Attached to each request after authentication
 */
export interface AuthContext {
  user: User;
  apiKey: APIKey;
  role: Role;
  agent: Agent | null;

  // Computed rate limits (hierarchy: key override > agent > role)
  rateLimits: RateLimitConfig;
}

/**
 * Authorization Result
 */
export interface AuthorizationResult {
  allowed: boolean;
  reason?: string; // If not allowed
}

/**
 * Request Log Entry
 */
export interface RequestLog {
  userId: string;
  apiKeyId: string;
  agentId: string | null;
  serverId: string;
  toolName: string;
  statusCode: number;
  durationMs: number;
  cached: boolean;
  errorCategory: ErrorCategory | null;
  errorMessage: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  arguments: Record<string, unknown> | null; // Sanitized
}

export type ErrorCategory =
  | 'RATE_LIMIT'
  | 'AUTH'
  | 'VALIDATION'
  | 'SERVER'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'FORBIDDEN';

/**
 * API Key Generation Options
 */
export interface GenerateAPIKeyOptions {
  userId: string;
  name: string;
  description?: string;
  role?: RoleName; // Override user's role
  allowedServers?: string[]; // null = all servers
  allowedTools?: string[];
  agentId?: string;
  rateLimitOverride?: RateLimitConfig;
  expiresAt?: Date;
}

/**
 * Generated API Key Result (only shown once)
 */
export interface GeneratedAPIKey {
  id: string;
  key: string; // Full key (only shown once!)
  keyPrefix: string;
  name: string;
  role: RoleName;
  createdAt: Date;
}
