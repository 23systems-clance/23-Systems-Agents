/**
 * Request Logger Middleware
 * Logs all MCP requests to Supabase for analytics
 */

import { supabaseAdmin } from '../auth/supabase.js';
import type { AuthContext, ErrorCategory, RequestLog } from '../auth/types.js';

/**
 * Log a request to Supabase
 * Called asynchronously after request completes
 */
export async function logRequest(log: RequestLog): Promise<void> {
  try {
    await supabaseAdmin.rpc('log_request', {
      p_user_id: log.userId,
      p_api_key_id: log.apiKeyId,
      p_agent_id: log.agentId,
      p_server_id: log.serverId,
      p_tool_name: log.toolName,
      p_status_code: log.statusCode,
      p_duration_ms: log.durationMs,
      p_cached: log.cached,
      p_error_category: log.errorCategory,
      p_error_message: log.errorMessage,
      p_ip_address: log.ipAddress,
      p_user_agent: log.userAgent,
      p_arguments: log.arguments,
    });
  } catch (error) {
    // Don't throw - logging failures shouldn't break requests
    console.error('Failed to log request:', error);
  }
}

/**
 * Extract error category from error
 */
export function getErrorCategory(error: Error): ErrorCategory {
  if (error.name === 'UnauthorizedError') return 'AUTH';
  if (error.name === 'ForbiddenError') return 'FORBIDDEN';
  if (error.name === 'RateLimitError') return 'RATE_LIMIT';
  if (error.name === 'ZodError') return 'VALIDATION';
  if (error.name === 'TimeoutError') return 'TIMEOUT';
  if (error.message.includes('network') || error.message.includes('fetch')) {
    return 'NETWORK';
  }
  return 'SERVER';
}

/**
 * Sanitize request arguments (remove sensitive data)
 */
export function sanitizeArguments(args: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...args };

  // Remove common sensitive fields
  const sensitiveKeys = [
    'password',
    'token',
    'secret',
    'apiKey',
    'api_key',
    'accessToken',
    'refreshToken',
    'privateKey',
    'creditCard',
    'ssn',
  ];

  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some((sensitive) => key.toLowerCase().includes(sensitive))) {
      sanitized[key] = '[REDACTED]';
    }
  }

  return sanitized;
}

/**
 * Create request log entry from auth context and result
 */
export function createRequestLog(
  authContext: AuthContext,
  serverId: string,
  toolName: string,
  statusCode: number,
  durationMs: number,
  cached: boolean,
  error: Error | null,
  ipAddress: string | null,
  userAgent: string | null,
  args: Record<string, unknown> | null
): RequestLog {
  return {
    userId: authContext.user.id,
    apiKeyId: authContext.apiKey.id,
    agentId: authContext.agent?.id || null,
    serverId,
    toolName,
    statusCode,
    durationMs,
    cached,
    errorCategory: error ? getErrorCategory(error) : null,
    errorMessage: error ? error.message : null,
    ipAddress,
    userAgent,
    arguments: args ? sanitizeArguments(args) : null,
  };
}
