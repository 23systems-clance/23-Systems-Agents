/**
 * Authorization Middleware
 * Implements server-level permissions (Option 3)
 */

import { supabaseAdmin } from '../auth/supabase.js';
import { ForbiddenError } from '../auth/api-key-auth.js';
import type { AuthContext, AuthorizationResult } from '../auth/types.js';

/**
 * Authorize a request based on server and tool permissions
 * Implements Option 3 hierarchy:
 * 1. Check API key's allowedServers
 * 2. Check agent's allowedServers (if agent assigned)
 * 3. Check role's access level vs server's required level
 * 4. Check tool-level permissions (if specified)
 */
export async function authorize(
  authContext: AuthContext,
  serverId: string,
  toolName: string
): Promise<AuthorizationResult> {
  // 1. Check API key server permissions
  if (authContext.apiKey.allowedServers !== null) {
    if (authContext.apiKey.allowedServers.length === 0) {
      throw new ForbiddenError('API key has no server permissions');
    }

    if (!authContext.apiKey.allowedServers.includes(serverId)) {
      throw new ForbiddenError(`API key not authorized for server: ${serverId}`);
    }
  }

  // 2. Check agent server permissions (if agent assigned)
  if (authContext.agent) {
    if (authContext.agent.allowedServers.length === 0) {
      throw new ForbiddenError('Agent has no server permissions');
    }

    if (!authContext.agent.allowedServers.includes(serverId)) {
      throw new ForbiddenError(`Agent not authorized for server: ${serverId}`);
    }

    // Check tool-level permissions (if specified)
    if (authContext.agent.allowedTools && authContext.agent.allowedTools.length > 0) {
      if (!authContext.agent.allowedTools.includes(toolName)) {
        throw new ForbiddenError(`Agent not authorized for tool: ${toolName}`);
      }
    }
  }

  // 3. Check API key tool permissions (if specified)
  if (authContext.apiKey.allowedTools && authContext.apiKey.allowedTools.length > 0) {
    if (!authContext.apiKey.allowedTools.includes(toolName)) {
      throw new ForbiddenError(`API key not authorized for tool: ${toolName}`);
    }
  }

  // 4. Check role access level vs server requirements
  const { data: server } = await supabaseAdmin
    .from('mcp_servers')
    .select('required_access_level, is_public')
    .eq('id', serverId)
    .single();

  if (!server) {
    throw new ForbiddenError(`Server not found: ${serverId}`);
  }

  // Check if server requires higher access level
  const accessLevels = { basic: 1, advanced: 2, full: 3 };
  const userLevel = accessLevels[authContext.role.accessLevel];
  const requiredLevel = accessLevels[server.required_access_level as keyof typeof accessLevels];

  if (userLevel < requiredLevel) {
    throw new ForbiddenError(
      `This server requires ${server.required_access_level} access. Your role (${authContext.role.name}) has ${authContext.role.accessLevel} access.`
    );
  }

  return { allowed: true };
}

/**
 * Check if user has reached daily quota
 */
export async function checkDailyQuota(authContext: AuthContext): Promise<void> {
  const { rateLimits, user } = authContext;

  // Unlimited quota
  if (rateLimits.dailyQuota === -1) {
    return;
  }

  // Get today's date range
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Count requests today
  const { count } = await supabaseAdmin
    .from('request_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('timestamp', today.toISOString())
    .lt('timestamp', tomorrow.toISOString());

  if (count && count >= rateLimits.dailyQuota) {
    throw new RateLimitError(
      `Daily quota of ${rateLimits.dailyQuota} requests exceeded. Resets at midnight.`
    );
  }
}

/**
 * Get rate limits for a specific server (if agent has per-server limits)
 */
export function getRateLimitsForServer(
  authContext: AuthContext,
  serverId: string
) {
  // Check agent's per-server rate limits
  if (authContext.agent?.serverRateLimits) {
    const serverLimits = authContext.agent.serverRateLimits[serverId];
    if (serverLimits) {
      return serverLimits;
    }
  }

  // Fall back to context rate limits
  return authContext.rateLimits;
}

/**
 * Custom Error Class
 */
export class RateLimitError extends Error {
  public retryAfter: number; // Seconds until retry

  constructor(message: string, retryAfter: number = 60) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}
