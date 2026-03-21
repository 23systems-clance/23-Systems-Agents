/**
 * Platform audit logging middleware (T072 - Feature 39).
 *
 * Automatically logs mutating operations (POST, PUT, DELETE) on platform
 * admin routes: agents, MCP servers, skills, packs.
 */

import type { Request, Response, NextFunction } from 'express';
import { logAudit, type AuditAction } from './auditLogger.js';

/**
 * Route-to-action mapping for platform admin endpoints.
 * Matches on method + path pattern.
 */
/** Extract a single string param value (Express params can be string | string[]). */
function param(req: Request, name: string): string | undefined {
  const v = req.params[name];
  return Array.isArray(v) ? v[0] : v;
}

const AUDIT_MAP: Array<{
  method: string;
  pattern: RegExp;
  action: AuditAction;
  targetType: string;
  getTargetId: (req: Request) => string | undefined;
}> = [
  // Agents
  { method: 'POST', pattern: /^\/agents\/?$/, action: 'platform_agent_created', targetType: 'agent', getTargetId: () => undefined },
  { method: 'PUT', pattern: /^\/agents\/([^/]+)\/?$/, action: 'platform_agent_updated', targetType: 'agent', getTargetId: (r) => param(r, 'agentId') },
  { method: 'DELETE', pattern: /^\/agents\/([^/]+)\/?$/, action: 'platform_agent_deleted', targetType: 'agent', getTargetId: (r) => param(r, 'agentId') },
  { method: 'POST', pattern: /^\/agents\/([^/]+)\/publish\/?$/, action: 'platform_agent_published', targetType: 'agent', getTargetId: (r) => param(r, 'agentId') },
  { method: 'POST', pattern: /^\/agents\/([^/]+)\/deprecate\/?$/, action: 'platform_agent_deprecated', targetType: 'agent', getTargetId: (r) => param(r, 'agentId') },
  { method: 'POST', pattern: /^\/agents\/([^/]+)\/test\/?$/, action: 'platform_agent_tested', targetType: 'agent', getTargetId: (r) => param(r, 'agentId') },

  // MCP Servers
  { method: 'POST', pattern: /^\/mcp-servers\/?$/, action: 'platform_mcp_server_created', targetType: 'mcp_server', getTargetId: () => undefined },
  { method: 'PUT', pattern: /^\/mcp-servers\/([^/]+)\/?$/, action: 'platform_mcp_server_updated', targetType: 'mcp_server', getTargetId: (r) => param(r, 'serverId') },
  { method: 'DELETE', pattern: /^\/mcp-servers\/([^/]+)\/?$/, action: 'platform_mcp_server_deleted', targetType: 'mcp_server', getTargetId: (r) => param(r, 'serverId') },
  { method: 'POST', pattern: /^\/mcp-servers\/([^/]+)\/health\/?$/, action: 'platform_mcp_health_checked', targetType: 'mcp_server', getTargetId: (r) => param(r, 'serverId') },
  { method: 'POST', pattern: /^\/mcp-servers\/([^/]+)\/tools\/?$/, action: 'platform_mcp_tool_added', targetType: 'mcp_tool', getTargetId: (r) => param(r, 'serverId') },
  { method: 'PUT', pattern: /^\/mcp-servers\/([^/]+)\/tools\/([^/]+)\/?$/, action: 'platform_mcp_tool_updated', targetType: 'mcp_tool', getTargetId: (r) => param(r, 'toolId') },
  { method: 'DELETE', pattern: /^\/mcp-servers\/([^/]+)\/tools\/([^/]+)\/?$/, action: 'platform_mcp_tool_removed', targetType: 'mcp_tool', getTargetId: (r) => param(r, 'toolId') },

  // Skills
  { method: 'POST', pattern: /^\/skills\/?$/, action: 'platform_skill_created', targetType: 'skill', getTargetId: () => undefined },
  { method: 'PUT', pattern: /^\/skills\/([^/]+)\/?$/, action: 'platform_skill_updated', targetType: 'skill', getTargetId: (r) => param(r, 'skillId') },
  { method: 'POST', pattern: /^\/skills\/([^/]+)\/publish\/?$/, action: 'platform_skill_published', targetType: 'skill', getTargetId: (r) => param(r, 'skillId') },
  { method: 'POST', pattern: /^\/skills\/([^/]+)\/deprecate\/?$/, action: 'platform_skill_deprecated', targetType: 'skill', getTargetId: (r) => param(r, 'skillId') },
  { method: 'POST', pattern: /^\/skills\/([^/]+)\/test\/?$/, action: 'platform_skill_tested', targetType: 'skill', getTargetId: (r) => param(r, 'skillId') },

  // Packs
  { method: 'POST', pattern: /^\/packs\/?$/, action: 'platform_pack_created', targetType: 'pack', getTargetId: () => undefined },
  { method: 'PUT', pattern: /^\/packs\/([^/]+)\/?$/, action: 'platform_pack_updated', targetType: 'pack', getTargetId: (r) => param(r, 'packId') },
  { method: 'POST', pattern: /^\/packs\/([^/]+)\/publish\/?$/, action: 'platform_pack_published', targetType: 'pack', getTargetId: (r) => param(r, 'packId') },
  { method: 'POST', pattern: /^\/packs\/([^/]+)\/deprecate\/?$/, action: 'platform_pack_deprecated', targetType: 'pack', getTargetId: (r) => param(r, 'packId') },
  { method: 'PUT', pattern: /^\/packs\/([^/]+)\/skills\/?$/, action: 'platform_pack_skills_assigned', targetType: 'pack', getTargetId: (r) => param(r, 'packId') },
];

/**
 * Express middleware that fires audit log entries for mutating platform admin operations.
 * Runs after the response is sent (fire-and-forget).
 */
export function platformAuditMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Only audit mutating methods
  if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'DELETE') {
    next();
    return;
  }

  // Capture original end to log after response
  const originalEnd = res.end;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res.end = function (this: Response, ...args: any[]) {
    const result = (originalEnd as Function).apply(this, args);

    // Only audit successful mutations (2xx status)
    if (res.statusCode >= 200 && res.statusCode < 300) {
      for (const mapping of AUDIT_MAP) {
        if (req.method === mapping.method && mapping.pattern.test(req.path)) {
          const adminUser = (req as any).adminUser;
          const actorId = adminUser?.id ?? adminUser?.email ?? 'unknown-admin';

          logAudit({
            action: mapping.action,
            actorUserId: actorId,
            targetType: mapping.targetType,
            targetId: mapping.getTargetId(req),
            metadata: {
              method: req.method,
              path: req.originalUrl,
              statusCode: res.statusCode,
              ...(req.body?.name && { name: req.body.name }),
              ...(req.body?.slug && { slug: req.body.slug }),
            },
          });
          break;
        }
      }
    }

    return result;
  } as typeof originalEnd;

  next();
}
