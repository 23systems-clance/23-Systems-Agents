/**
 * API Key Authentication
 * Implements Option 3: Global Keys with Server-Level Permissions
 */

import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { supabaseAdmin } from './supabase.js';
import type {
  APIKey,
  Agent,
  AuthContext,
  GenerateAPIKeyOptions,
  GeneratedAPIKey,
  Role,
  User,
} from './types.js';

const BCRYPT_ROUNDS = 10;

/**
 * Generate a new API key
 * Format: mcp_[environment]_[32_random_chars]
 */
export function generateKey(environment: 'prod' | 'test' = 'prod'): string {
  const randomBytes = crypto.randomBytes(24); // 24 bytes = 32 base64 chars
  const randomString = randomBytes.toString('base64url').slice(0, 32);
  return `mcp_${environment}_${randomString}`;
}

/**
 * Extract key prefix for display (first 12 characters)
 */
export function getKeyPrefix(key: string): string {
  return key.slice(0, 12); // "mcp_prod_abc"
}

/**
 * Hash API key for storage
 */
export async function hashKey(key: string): Promise<string> {
  return bcrypt.hash(key, BCRYPT_ROUNDS);
}

/**
 * Verify API key against hash
 */
export async function verifyKey(key: string, hash: string): Promise<boolean> {
  return bcrypt.compare(key, hash);
}

/**
 * Create a new API key for a user
 */
export async function createAPIKey(
  options: GenerateAPIKeyOptions
): Promise<GeneratedAPIKey> {
  const { userId, name, description, role, allowedServers, allowedTools, agentId, rateLimitOverride, expiresAt } = options;

  // 1. Check if user can create more API keys
  const { data: canCreate } = await supabaseAdmin.rpc('can_create_api_key', {
    p_user_id: userId,
  });

  if (!canCreate) {
    throw new Error('Maximum API keys limit reached for your plan');
  }

  // 2. Get user's role if not overridden
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('role')
    .eq('id', userId)
    .single();

  if (!user) {
    throw new Error('User not found');
  }

  const keyRole = role || user.role;

  // 3. Generate API key
  const key = generateKey('prod');
  const keyHash = await hashKey(key);
  const keyPrefix = getKeyPrefix(key);

  // 4. Get agent name if agentId provided
  let agentName: string | null = null;
  if (agentId) {
    const { data: agent } = await supabaseAdmin
      .from('agents')
      .select('name')
      .eq('id', agentId)
      .single();

    agentName = agent?.name || null;
  }

  // 5. Insert API key
  const { data: apiKey, error } = await supabaseAdmin
    .from('api_keys')
    .insert({
      user_id: userId,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      name,
      description: description || null,
      role: keyRole,
      allowed_servers: allowedServers || null,
      allowed_tools: allowedTools || null,
      agent_id: agentId || null,
      agent_name: agentName,
      rate_limit_override: rateLimitOverride || null,
      expires_at: expiresAt || null,
      enabled: true,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create API key: ${error.message}`);
  }

  return {
    id: apiKey.id,
    key, // Only returned once!
    keyPrefix,
    name,
    role: keyRole,
    createdAt: new Date(apiKey.created_at),
  };
}

/**
 * Authenticate API key and return auth context
 * This is called on every MCP request
 */
export async function authenticateAPIKey(key: string): Promise<AuthContext> {
  if (!key) {
    throw new UnauthorizedError('API key is required');
  }

  // 1. Extract key prefix for initial lookup (optimization)
  const keyPrefix = getKeyPrefix(key);

  // 2. Lookup API key by prefix
  const { data: apiKeys } = await supabaseAdmin
    .from('api_keys')
    .select('*')
    .eq('key_prefix', keyPrefix)
    .eq('enabled', true);

  if (!apiKeys || apiKeys.length === 0) {
    throw new UnauthorizedError('Invalid API key');
  }

  // 3. Verify full key hash (multiple keys might share prefix)
  let validApiKey: APIKey | null = null;
  for (const apiKey of apiKeys) {
    const isValid = await verifyKey(key, apiKey.key_hash);
    if (isValid) {
      validApiKey = apiKey as unknown as APIKey;
      break;
    }
  }

  if (!validApiKey) {
    throw new UnauthorizedError('Invalid API key');
  }

  // 4. Check expiration
  if (validApiKey.expiresAt && new Date() > new Date(validApiKey.expiresAt)) {
    throw new UnauthorizedError('API key has expired');
  }

  // 5. Load user
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', validApiKey.userId)
    .single();

  if (!user) {
    throw new UnauthorizedError('User not found');
  }

  // 6. Load role
  const { data: role } = await supabaseAdmin
    .from('roles')
    .select('*')
    .eq('name', validApiKey.role)
    .single();

  if (!role) {
    throw new UnauthorizedError('Role not found');
  }

  // 7. Load agent (if assigned)
  let agent: Agent | null = null;
  if (validApiKey.agentId) {
    const { data: agentData } = await supabaseAdmin
      .from('agents')
      .select('*')
      .eq('id', validApiKey.agentId)
      .single();

    agent = agentData as unknown as Agent;
  }

  // 8. Compute rate limits (hierarchy: key override > agent > role)
  const rateLimits = validApiKey.rateLimitOverride || agent?.rateLimit || role.rate_limit;

  // 9. Update last_used_at (async, don't await)
  supabaseAdmin.rpc('update_api_key_last_used', {
    p_key_hash: validApiKey.keyHash,
  }).catch(console.error);

  return {
    user: user as unknown as User,
    apiKey: validApiKey,
    role: role as unknown as Role,
    agent,
    rateLimits,
  };
}

/**
 * Revoke (disable) an API key
 */
export async function revokeAPIKey(keyId: string, userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('api_keys')
    .update({ enabled: false })
    .eq('id', keyId)
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to revoke API key: ${error.message}`);
  }
}

/**
 * List user's API keys (without sensitive data)
 */
export async function listAPIKeys(userId: string): Promise<Partial<APIKey>[]> {
  const { data: apiKeys, error } = await supabaseAdmin
    .from('api_keys')
    .select('id, key_prefix, name, description, role, enabled, last_used_at, expires_at, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to list API keys: ${error.message}`);
  }

  return apiKeys as unknown as Partial<APIKey>[];
}

/**
 * Custom Error Classes
 */
export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}
