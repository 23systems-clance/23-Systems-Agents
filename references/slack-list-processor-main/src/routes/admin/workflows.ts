/**
 * Workflow CRUD + Execution admin endpoints (Feature 7 — Workflow Builder).
 *
 * GET    /api/v1/admin/workflows                                — List workflows
 * POST   /api/v1/admin/workflows                                — Create workflow
 * GET    /api/v1/admin/workflows/templates                      — List templates
 * POST   /api/v1/admin/workflows/templates                      — Save as template
 * GET    /api/v1/admin/workflows/executions/:executionId        — Get execution detail
 * POST   /api/v1/admin/workflows/executions/:executionId/cancel — Cancel execution
 * GET    /api/v1/admin/workflows/:workflowId/analytics          — Aggregate workflow metrics
 * GET    /api/v1/admin/workflows/:workflowId/analytics/funnel   — Step-by-step funnel
 * GET    /api/v1/admin/workflows/:workflowId/analytics/nodes/:nodeId — Per-node metrics
 * GET    /api/v1/admin/workflows/:workflowId                    — Get workflow
 * GET    /api/v1/admin/workflows/:workflowId/versions/:vId      — Get version graph
 * PUT    /api/v1/admin/workflows/:workflowId/versions/:vId      — Update draft graph
 * PUT    /api/v1/admin/workflows/:workflowId/name               — Rename workflow
 * POST   /api/v1/admin/workflows/:workflowId/validate           — Validate draft
 * POST   /api/v1/admin/workflows/:workflowId/publish            — Publish draft
 * POST   /api/v1/admin/workflows/:workflowId/clone              — Clone workflow
 * POST   /api/v1/admin/workflows/:workflowId/archive            — Archive workflow
 * POST   /api/v1/admin/workflows/:workflowId/edit               — Create draft from published
 * PUT    /api/v1/admin/workflows/:workflowId/client             — Assign/remove client
 * GET    /api/v1/admin/workflows/:workflowId/channels           — List channel mappings
 * POST   /api/v1/admin/workflows/:workflowId/channels           — Add channel mapping
 * DELETE /api/v1/admin/workflows/:workflowId/channels/:mappingId — Remove channel mapping
 * DELETE /api/v1/admin/workflows/:workflowId                    — Delete workflow
 * GET    /api/v1/admin/workflows/:workflowId/executions         — List executions
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  listWorkflows,
  createWorkflow,
  getWorkflow,
  getVersion,
  updateDraftVersion,
  updateWorkflowName,
  validateWorkflow,
  publishVersion,
  cloneWorkflow,
  archiveWorkflow,
  createDraftFromPublished,
  deleteWorkflow,
} from '../../services/workflow/workflowService.js';
import { cancelExecution } from '../../services/workflow/workflowEngine.js';
import { getBuiltInTemplates } from '../../services/workflow/workflowTemplates.js';
import { getExecutionProgress, subscribeToProgress } from '../../services/workflow/progressTracker.js';
import { prisma } from '../../models/index.js';
import { logAudit } from '../../lib/auditLogger.js';
import logger from '../../lib/logger.js';

export const workflowsRouter = Router();

// ---------------------------------------------------------------------------
// GET / — List workflows
// ---------------------------------------------------------------------------

workflowsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const teamId = String(req.query.teamId);
    if (!req.query.teamId) {
      return res.status(400).json({ error: 'missing_param', message: 'teamId is required' });
    }

    // Map frontend status filter to backend query approach
    const statusParam = req.query.status ? String(req.query.status).toLowerCase() : undefined;

    // Fetch all relevant workflows (filter semantically after)
    let versionStatus: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' | undefined;
    if (statusParam === 'draft') versionStatus = 'DRAFT';
    else if (statusParam === 'archived') versionStatus = 'ARCHIVED';
    // 'active' and undefined use the default (PUBLISHED + DRAFT)

    const clientIdParam = req.query.clientId !== undefined ? String(req.query.clientId) : undefined;
    const rawWorkflows = await listWorkflows(teamId, versionStatus, clientIdParam);

    // Transform to snake_case format matching frontend WorkflowListItem type
    const workflows = rawWorkflows
      .filter((wf) => {
        // Apply semantic status filter
        if (statusParam === 'active') return wf.isActive && wf.publishedVersion !== null;
        if (statusParam === 'archived') return !wf.isActive;
        if (statusParam === 'draft') return wf.isActive && !wf.publishedVersion;
        return true; // 'all'
      })
      .map((wf) => ({
        id: wf.id,
        name: wf.name,
        description: wf.description,
        trigger_type: wf.triggerType,
        is_active: wf.isActive,
        client_id: wf.clientId || null,
        client_name: wf.clientName || null,
        created_by_user_id: (wf as any).createdByUserId ?? 'system',
        created_at: wf.createdAt,
        updated_at: wf.updatedAt,
        current_version: wf.publishedVersion
          ? {
              id: wf.publishedVersion.id,
              version: wf.publishedVersion.version,
              status: 'PUBLISHED' as const,
              published_at: wf.publishedVersion.publishedAt,
              node_count: 0,
              edge_count: 0,
            }
          : null,
        draft_version: wf.draftVersion
          ? {
              id: wf.draftVersion.id,
              version: wf.draftVersion.version,
              status: 'DRAFT' as const,
              published_at: null,
              node_count: 0,
              edge_count: 0,
            }
          : null,
        total_runs: wf.stats.totalExecutions,
        completion_rate: wf.stats.completionRate,
      }));

    res.json({ workflows, total: workflows.length });
  } catch (error) {
    logger.error('Failed to list workflows', { error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// POST / — Create workflow
// ---------------------------------------------------------------------------

workflowsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { slack_team_id, name, description, trigger_type, created_by_user_id, from_template, template_id, client_id } =
      req.body;

    if (!slack_team_id || !name || !trigger_type) {
      return res.status(400).json({
        error: 'missing_param',
        message: 'slack_team_id, name, and trigger_type are required',
      });
    }

    const result = await createWorkflow({
      slackTeamId: slack_team_id,
      name,
      description,
      triggerType: trigger_type,
      createdByUserId: created_by_user_id ?? 'system',
      fromTemplate: from_template || template_id,
      clientId: client_id || null,
    });

    res.status(201).json({
      id: result.id,
      name: result.name,
      description: result.description,
      trigger_type: result.triggerType,
      is_active: result.isActive,
      created_by_user_id: result.createdByUserId,
      created_at: result.createdAt,
      updated_at: result.updatedAt,
      versions: result.versions.map((v) => ({
        id: v.id,
        version: v.version,
        status: v.status,
        published_at: v.publishedAt,
        node_count: ((v.graph as any)?.nodes || []).length,
        edge_count: ((v.graph as any)?.edges || []).length,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    if (message.includes('already active')) {
      return res.status(409).json({ error: 'trigger_conflict', message });
    }
    if (message.includes('not found')) {
      return res.status(404).json({ error: 'not_found', message });
    }
    logger.error('Failed to create workflow', { error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// GET /templates — List templates (must be before /:workflowId)
// ---------------------------------------------------------------------------

workflowsRouter.get('/templates', async (req: Request, res: Response) => {
  try {
    const builtIn = getBuiltInTemplates();
    const builtInMapped = builtIn.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      node_count: t.nodeCount,
      is_custom: false,
    }));

    // Fetch custom templates scoped to the requesting team (if teamId provided)
    const teamId = req.query.teamId ? String(req.query.teamId) : undefined;
    let customMapped: Array<{
      id: string;
      name: string;
      description: string | null;
      node_count: number;
      is_custom: boolean;
      created_by_user_id: string;
    }> = [];

    if (teamId) {
      const customTemplates = await prisma.workflowCustomTemplate.findMany({
        where: { slackTeamId: teamId },
        orderBy: { createdAt: 'desc' },
      });

      customMapped = customTemplates.map((ct) => ({
        id: ct.id,
        name: ct.name,
        description: ct.description,
        node_count: ct.nodeCount,
        is_custom: true,
        created_by_user_id: ct.createdByUserId,
      }));
    }

    res.json({
      templates: [...builtInMapped, ...customMapped],
    });
  } catch (error) {
    logger.error('Failed to list templates', { error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// POST /templates — Save workflow as custom template
// ---------------------------------------------------------------------------

workflowsRouter.post('/templates', async (req: Request, res: Response) => {
  try {
    const { workflow_id, slack_team_id } = req.body;
    if (!workflow_id || !slack_team_id) {
      return res.status(400).json({
        error: 'missing_param',
        message: 'workflow_id and slack_team_id are required',
      });
    }

    const workflow = await getWorkflow(workflow_id, slack_team_id);
    const publishedVersion = workflow.versions.find((v) => v.status === 'PUBLISHED');

    if (!publishedVersion) {
      return res.status(400).json({
        error: 'no_published_version',
        message: 'Workflow must have a published version to save as template',
      });
    }

    const graph = publishedVersion.graph as Record<string, unknown>;
    const nodes = (graph.nodes as unknown[]) || [];

    const customTemplate = await prisma.workflowCustomTemplate.create({
      data: {
        slackTeamId: slack_team_id,
        name: workflow.name,
        description: workflow.description || `Custom template from "${workflow.name}"`,
        graph: publishedVersion.graph as any,
        nodeCount: nodes.length,
        createdByUserId: workflow.createdByUserId,
      },
    });

    res.status(201).json({
      template: {
        id: customTemplate.id,
        name: customTemplate.name,
        description: customTemplate.description,
        node_count: customTemplate.nodeCount,
        is_custom: true,
        created_by_user_id: customTemplate.createdByUserId,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    if (message.includes('not found')) {
      return res.status(404).json({ error: 'not_found', message });
    }
    logger.error('Failed to save workflow as template', { error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// GET /executions/:executionId — Get execution detail (before /:workflowId)
// ---------------------------------------------------------------------------

workflowsRouter.get('/executions/:executionId', async (req: Request, res: Response) => {
  try {
    const executionId = String(req.params.executionId);

    const execution = await prisma.workflowExecution.findUnique({
      where: { id: executionId },
      include: {
        version: {
          select: { version: true, templateId: true },
        },
      },
    });

    if (!execution) {
      return res.status(404).json({ error: 'not_found', message: 'Execution not found' });
    }

    res.json({
      execution: {
        id: execution.id,
        version_id: execution.versionId,
        version_number: (execution as any).version.version,
        slack_team_id: execution.slackTeamId,
        slack_user_id: execution.slackUserId,
        slack_channel_id: execution.slackChannelId,
        slack_thread_ts: execution.slackThreadTs,
        status: execution.status,
        current_node_id: execution.currentNodeId,
        context: execution.context,
        node_history: execution.nodeHistory,
        error_message: execution.errorMessage,
        expires_at: execution.expiresAt,
        started_at: execution.createdAt,
        completed_at: execution.completedAt,
      },
    });
  } catch (error) {
    logger.error('Failed to get execution', { executionId: req.params.executionId, error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// POST /executions/:executionId/cancel — Cancel execution
// ---------------------------------------------------------------------------

workflowsRouter.post('/executions/:executionId/cancel', async (req: Request, res: Response) => {
  try {
    const executionId = String(req.params.executionId);
    const execution = await cancelExecution(executionId);

    res.json({
      execution: {
        id: execution.id,
        status: execution.status,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    if (message.includes('not found')) {
      return res.status(404).json({ error: 'not_found', message });
    }
    if (message.includes('terminal state')) {
      return res.status(400).json({ error: 'invalid_state', message });
    }
    logger.error('Failed to cancel execution', { executionId: req.params.executionId, error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// GET /:workflowId/analytics — Aggregate workflow metrics
// ---------------------------------------------------------------------------

workflowsRouter.get('/:workflowId/analytics', async (req: Request, res: Response) => {
  try {
    const workflowId = String(req.params.workflowId);
    const teamId = String(req.query.teamId);
    if (!req.query.teamId) {
      return res.status(400).json({ error: 'missing_param', message: 'teamId is required' });
    }

    // Verify workflow belongs to team
    await getWorkflow(workflowId, teamId);

    // Determine date filter from period param
    const periodDays: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
    const periodParam = String(req.query.period || '30d');
    const days = periodDays[periodParam];
    const dateFilter = days
      ? { gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) }
      : undefined;

    const whereClause: Record<string, unknown> = {
      version: { templateId: workflowId },
      ...(dateFilter ? { createdAt: dateFilter } : {}),
    };

    // Fetch counts by status
    const [total_runs, completed, failed, expired, cancelled] = await Promise.all([
      prisma.workflowExecution.count({ where: whereClause as any }),
      prisma.workflowExecution.count({ where: { ...whereClause, status: 'COMPLETED' } as any }),
      prisma.workflowExecution.count({ where: { ...whereClause, status: 'FAILED' } as any }),
      prisma.workflowExecution.count({ where: { ...whereClause, status: 'EXPIRED' } as any }),
      prisma.workflowExecution.count({ where: { ...whereClause, status: 'CANCELLED' } as any }),
    ]);

    const completion_rate = total_runs > 0 ? Math.round((completed / total_runs) * 10000) / 100 : 0;

    // Compute average and median duration for completed executions
    const completedExecutions = await prisma.workflowExecution.findMany({
      where: { ...whereClause, status: 'COMPLETED', completedAt: { not: null } } as any,
      select: { createdAt: true, completedAt: true },
    });

    const durations = completedExecutions
      .filter((e) => e.completedAt)
      .map((e) => (e.completedAt!.getTime() - e.createdAt.getTime()) / 1000)
      .sort((a, b) => a - b);

    let avg_duration_seconds = 0;
    let median_duration_seconds = 0;
    if (durations.length > 0) {
      avg_duration_seconds = Math.round(
        durations.reduce((sum, d) => sum + d, 0) / durations.length,
      );
      const mid = Math.floor(durations.length / 2);
      median_duration_seconds =
        durations.length % 2 === 0
          ? Math.round((durations[mid - 1] + durations[mid]) / 2)
          : Math.round(durations[mid]);
    }

    // Daily runs aggregation using raw SQL
    const dateFilterSql = dateFilter
      ? `AND we."createdAt" >= '${dateFilter.gte.toISOString()}'`
      : '';

    const dailyRuns = await prisma.$queryRawUnsafe<
      Array<{ date: string; total: bigint; completed: bigint; failed: bigint }>
    >(
      `SELECT
        DATE(we."createdAt") as date,
        COUNT(*)::bigint as total,
        COUNT(*) FILTER (WHERE we."status" = 'COMPLETED')::bigint as completed,
        COUNT(*) FILTER (WHERE we."status" = 'FAILED')::bigint as failed
      FROM "WorkflowExecution" we
      JOIN "WorkflowVersion" wv ON we."versionId" = wv."id"
      WHERE wv."templateId" = $1 ${dateFilterSql}
      GROUP BY DATE(we."createdAt")
      ORDER BY date ASC`,
      workflowId,
    );

    const daily_runs = dailyRuns.map((row) => ({
      date: String(row.date),
      total: Number(row.total),
      completed: Number(row.completed),
      failed: Number(row.failed),
    }));

    res.json({
      total_runs,
      completed,
      failed,
      expired,
      cancelled,
      completion_rate,
      avg_duration_seconds,
      median_duration_seconds,
      daily_runs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    if (message.includes('not found')) {
      return res.status(404).json({ error: 'not_found', message });
    }
    logger.error('Failed to get analytics', { workflowId: req.params.workflowId, error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// GET /:workflowId/analytics/funnel — Step-by-step funnel
// ---------------------------------------------------------------------------

workflowsRouter.get('/:workflowId/analytics/funnel', async (req: Request, res: Response) => {
  try {
    const workflowId = String(req.params.workflowId);
    const teamId = String(req.query.teamId);
    if (!req.query.teamId) {
      return res.status(400).json({ error: 'missing_param', message: 'teamId is required' });
    }

    // Get workflow and its published version's graph for node ordering
    const workflow = await getWorkflow(workflowId, teamId);
    const publishedVersion = workflow.versions.find((v) => v.status === 'PUBLISHED');
    if (!publishedVersion) {
      return res.status(400).json({
        error: 'no_published_version',
        message: 'Workflow must have a published version for funnel analytics',
      });
    }

    const graph = publishedVersion.graph as Record<string, unknown>;
    const nodes = (graph.nodes as Array<{ id: string; type: string; data?: { label?: string } }>) || [];

    // Determine date filter from period param
    const periodDays: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
    const periodParam = String(req.query.period || '30d');
    const days = periodDays[periodParam];
    const dateFilter = days
      ? { gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) }
      : undefined;

    const whereClause: Record<string, unknown> = {
      version: { templateId: workflowId },
      ...(dateFilter ? { createdAt: dateFilter } : {}),
    };

    // Get all executions and their nodeHistory
    const executions = await prisma.workflowExecution.findMany({
      where: whereClause as any,
      select: { nodeHistory: true },
    });

    // Build counts per node: reached = entered the node, completed = exited the node
    const reachedMap = new Map<string, number>();
    const completedMap = new Map<string, number>();

    for (const exec of executions) {
      const history = (exec.nodeHistory as Array<{
        nodeId: string;
        enteredAt?: string;
        exitedAt?: string;
      }>) || [];

      for (const entry of history) {
        reachedMap.set(entry.nodeId, (reachedMap.get(entry.nodeId) || 0) + 1);
        if (entry.exitedAt) {
          completedMap.set(entry.nodeId, (completedMap.get(entry.nodeId) || 0) + 1);
        }
      }
    }

    const totalExecutions = executions.length;
    const steps = nodes.map((node) => {
      const reached = reachedMap.get(node.id) || 0;
      const nodeCompleted = completedMap.get(node.id) || 0;
      const drop_off_count = reached - nodeCompleted;
      const drop_off_rate = reached > 0
        ? Math.round((drop_off_count / reached) * 10000) / 100
        : 0;

      return {
        node_id: node.id,
        node_type: node.type,
        label: node.data?.label || node.id,
        reached,
        completed: nodeCompleted,
        drop_off_count,
        drop_off_rate,
      };
    });

    res.json({ steps, total_executions: totalExecutions });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    if (message.includes('not found')) {
      return res.status(404).json({ error: 'not_found', message });
    }
    logger.error('Failed to get funnel analytics', { workflowId: req.params.workflowId, error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// GET /:workflowId/analytics/nodes/:nodeId — Per-node metrics
// ---------------------------------------------------------------------------

workflowsRouter.get('/:workflowId/analytics/nodes/:nodeId', async (req: Request, res: Response) => {
  try {
    const workflowId = String(req.params.workflowId);
    const nodeId = String(req.params.nodeId);
    const teamId = String(req.query.teamId);
    if (!req.query.teamId) {
      return res.status(400).json({ error: 'missing_param', message: 'teamId is required' });
    }

    // Verify workflow belongs to team
    await getWorkflow(workflowId, teamId);

    // Determine date filter from period param
    const periodDays: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
    const periodParam = String(req.query.period || '30d');
    const days = periodDays[periodParam];
    const dateFilter = days
      ? { gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) }
      : undefined;

    const whereClause: Record<string, unknown> = {
      version: { templateId: workflowId },
      ...(dateFilter ? { createdAt: dateFilter } : {}),
    };

    // Get all executions with nodeHistory
    const executions = await prisma.workflowExecution.findMany({
      where: whereClause as any,
      select: { nodeHistory: true },
    });

    let reached = 0;
    let completed = 0;
    const timesAtNode: number[] = [];
    const choiceCounts = new Map<string, number>();

    for (const exec of executions) {
      const history = (exec.nodeHistory as Array<{
        nodeId: string;
        nodeType?: string;
        enteredAt?: string;
        exitedAt?: string;
        userInput?: string;
      }>) || [];

      for (const entry of history) {
        if (entry.nodeId !== nodeId) continue;

        reached++;
        if (entry.exitedAt) {
          completed++;
          if (entry.enteredAt) {
            const enteredMs = new Date(entry.enteredAt).getTime();
            const exitedMs = new Date(entry.exitedAt).getTime();
            if (!isNaN(enteredMs) && !isNaN(exitedMs)) {
              timesAtNode.push((exitedMs - enteredMs) / 1000);
            }
          }
        }

        // Track choice distribution for BUTTON_CHOICE nodes
        if (entry.userInput) {
          choiceCounts.set(String(entry.userInput), (choiceCounts.get(String(entry.userInput)) || 0) + 1);
        }
      }
    }

    const avg_time_seconds =
      timesAtNode.length > 0
        ? Math.round(timesAtNode.reduce((sum, t) => sum + t, 0) / timesAtNode.length)
        : 0;

    // Build choice_distribution as object (only if choices exist)
    const choice_distribution: Record<string, number> | null =
      choiceCounts.size > 0 ? Object.fromEntries(choiceCounts) : null;

    res.json({
      node_id: nodeId,
      reached,
      completed,
      avg_time_seconds,
      choice_distribution,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    if (message.includes('not found')) {
      return res.status(404).json({ error: 'not_found', message });
    }
    logger.error('Failed to get node analytics', {
      workflowId: req.params.workflowId,
      nodeId: req.params.nodeId,
      error,
    });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// GET /:workflowId — Get workflow detail
// ---------------------------------------------------------------------------

workflowsRouter.get('/:workflowId', async (req: Request, res: Response) => {
  try {
    const teamId = String(req.query.teamId);
    const workflowId = String(req.params.workflowId);
    if (!teamId) {
      return res.status(400).json({ error: 'missing_param', message: 'teamId is required' });
    }

    const workflow = await getWorkflow(workflowId, teamId);

    res.json({
      workflow: {
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        trigger_type: workflow.triggerType,
        is_active: workflow.isActive,
        client_id: (workflow as any).client?.id || null,
        client_name: (workflow as any).client?.name || null,
        channel_mappings: ((workflow as any).channelMappings || []).map((m: any) => ({
          id: m.id,
          slack_channel_id: m.slackChannelId,
          slack_team_id: m.slackTeamId,
          trigger_type: m.triggerType,
        })),
        created_by_user_id: workflow.createdByUserId,
        created_at: workflow.createdAt,
        updated_at: workflow.updatedAt,
        versions: workflow.versions.map((v) => ({
          id: v.id,
          version: v.version,
          status: v.status,
          published_at: v.publishedAt,
          node_count: ((v.graph as any)?.nodes || []).length,
          edge_count: ((v.graph as any)?.edges || []).length,
        })),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    if (message.includes('not found')) {
      return res.status(404).json({ error: 'not_found', message });
    }
    logger.error('Failed to get workflow', { workflowId: req.params.workflowId, error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// GET /:workflowId/versions/:versionId — Get version with graph
// ---------------------------------------------------------------------------

workflowsRouter.get('/:workflowId/versions/:versionId', async (req: Request, res: Response) => {
  try {
    const version = await getVersion(String(req.params.workflowId), String(req.params.versionId));

    res.json({
      version: {
        id: version.id,
        version: version.version,
        status: version.status,
        graph: version.graph,
        published_at: version.publishedAt,
        created_at: version.createdAt,
        updated_at: version.updatedAt,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    if (message.includes('not found')) {
      return res.status(404).json({ error: 'not_found', message });
    }
    logger.error('Failed to get version', {
      workflowId: req.params.workflowId,
      versionId: req.params.versionId,
      error,
    });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// PUT /:workflowId/versions/:versionId — Update draft version graph
// ---------------------------------------------------------------------------

workflowsRouter.put('/:workflowId/versions/:versionId', async (req: Request, res: Response) => {
  try {
    const { graph } = req.body;
    if (!graph) {
      return res.status(400).json({ error: 'missing_param', message: 'graph is required' });
    }

    const teamId = req.query.teamId ? String(req.query.teamId) : undefined;
    const userId = req.body.updated_by_user_id ? String(req.body.updated_by_user_id) : undefined;

    const version = await updateDraftVersion(
      String(req.params.workflowId),
      String(req.params.versionId),
      graph,
      userId,
      teamId,
    );

    res.json({
      version: {
        id: version.id,
        version: version.version,
        status: version.status,
        graph: version.graph,
        updated_at: version.updatedAt,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    if (message.includes('not found')) {
      return res.status(404).json({ error: 'not_found', message });
    }
    if (message.includes('Only draft')) {
      return res.status(400).json({ error: 'invalid_state', message });
    }
    logger.error('Failed to update draft version', {
      workflowId: req.params.workflowId,
      versionId: req.params.versionId,
      error,
    });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// PUT /:workflowId/name — Update workflow name
// ---------------------------------------------------------------------------

workflowsRouter.put('/:workflowId/name', async (req: Request, res: Response) => {
  try {
    const { name, description } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'missing_param', message: 'name is required' });
    }

    const teamId = req.query.teamId ? String(req.query.teamId) : undefined;
    const userId = req.body.updated_by_user_id ? String(req.body.updated_by_user_id) : undefined;

    const result = await updateWorkflowName(String(req.params.workflowId), name, description, userId, teamId);

    res.json({
      workflow: {
        id: result.id,
        name: result.name,
        description: result.description,
        trigger_type: result.triggerType,
        is_active: result.isActive,
        updated_at: result.updatedAt,
      },
    });
  } catch (error) {
    logger.error('Failed to update workflow name', {
      workflowId: req.params.workflowId,
      error,
    });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// POST /:workflowId/validate — Validate draft graph
// ---------------------------------------------------------------------------

workflowsRouter.post('/:workflowId/validate', async (req: Request, res: Response) => {
  try {
    const teamId = String(req.query.teamId);
    if (!teamId) {
      return res.status(400).json({ error: 'missing_param', message: 'teamId is required' });
    }

    const result = await validateWorkflow(String(req.params.workflowId), teamId);

    res.json({
      valid: result.isValid,
      errors: (result.errors || []).map((e) =>
        typeof e === 'string' ? { message: e } : e,
      ),
      warnings: (result.warnings || []).map((w) =>
        typeof w === 'string' ? { message: w } : w,
      ),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    if (message.includes('not found')) {
      return res.status(404).json({ error: 'not_found', message });
    }
    logger.error('Failed to validate workflow', { workflowId: req.params.workflowId, error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// POST /:workflowId/publish — Publish draft version
// ---------------------------------------------------------------------------

workflowsRouter.post('/:workflowId/publish', async (req: Request, res: Response) => {
  try {
    const teamId = String(req.query.teamId);
    if (!teamId) {
      return res.status(400).json({ error: 'missing_param', message: 'teamId is required' });
    }

    const { published_by_user_id } = req.body;

    const result = await publishVersion(
      String(req.params.workflowId),
      published_by_user_id ?? 'system',
      teamId,
    );

    res.json({
      version: {
        id: result.publishedVersion.id,
        version: result.publishedVersion.version,
        status: result.publishedVersion.status,
        published_at: result.publishedVersion.publishedAt,
        published_by_user_id: result.publishedVersion.publishedByUserId,
      },
      previous_version_archived: result.archivedVersionId,
      deactivated_workflow: result.deactivatedWorkflow || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    if (message.includes('invalid workflow')) {
      return res.status(400).json({ error: 'validation_failed', message });
    }
    if (message.includes('already active')) {
      return res.status(409).json({ error: 'trigger_conflict', message });
    }
    if (message.includes('not found') || message.includes('No draft')) {
      return res.status(404).json({ error: 'not_found', message });
    }
    logger.error('Failed to publish workflow', { workflowId: req.params.workflowId, error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// POST /:workflowId/clone — Clone workflow
// ---------------------------------------------------------------------------

workflowsRouter.post('/:workflowId/clone', async (req: Request, res: Response) => {
  try {
    const teamId = String(req.query.teamId);
    if (!teamId) {
      return res.status(400).json({ error: 'missing_param', message: 'teamId is required' });
    }

    const { created_by_user_id } = req.body;

    const result = await cloneWorkflow(
      String(req.params.workflowId),
      teamId,
      created_by_user_id ?? 'system',
    );

    res.status(201).json({
      id: result.id,
      name: result.name,
      description: result.description,
      trigger_type: result.triggerType,
      is_active: result.isActive,
      created_by_user_id: result.createdByUserId,
      created_at: result.createdAt,
      updated_at: result.updatedAt,
      versions: result.versions.map((v) => ({
        id: v.id,
        version: v.version,
        status: v.status,
        published_at: v.publishedAt,
        node_count: ((v.graph as any)?.nodes || []).length,
        edge_count: ((v.graph as any)?.edges || []).length,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    if (message.includes('not found') || message.includes('without a published')) {
      return res.status(404).json({ error: 'not_found', message });
    }
    logger.error('Failed to clone workflow', { workflowId: req.params.workflowId, error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// POST /:workflowId/archive — Archive workflow
// ---------------------------------------------------------------------------

workflowsRouter.post('/:workflowId/archive', async (req: Request, res: Response) => {
  try {
    const teamId = String(req.query.teamId);
    if (!teamId) {
      return res.status(400).json({ error: 'missing_param', message: 'teamId is required' });
    }

    const userId = req.body.archived_by_user_id ? String(req.body.archived_by_user_id) : undefined;
    const workflow = await archiveWorkflow(String(req.params.workflowId), teamId, userId);

    res.json({
      workflow: {
        id: workflow.id,
        name: workflow.name,
        is_active: false,
        updated_at: workflow.updatedAt,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    if (message.includes('not found')) {
      return res.status(404).json({ error: 'not_found', message });
    }
    logger.error('Failed to archive workflow', { workflowId: req.params.workflowId, error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// POST /:workflowId/edit — Create draft from published
// ---------------------------------------------------------------------------

workflowsRouter.post('/:workflowId/edit', async (req: Request, res: Response) => {
  try {
    const teamId = String(req.query.teamId);
    if (!teamId) {
      return res.status(400).json({ error: 'missing_param', message: 'teamId is required' });
    }

    const userId = req.body.created_by_user_id ? String(req.body.created_by_user_id) : undefined;
    const version = await createDraftFromPublished(String(req.params.workflowId), teamId, userId);

    res.status(201).json({
      version: {
        id: version.id,
        version: version.version,
        status: version.status,
        graph: version.graph,
        created_at: version.createdAt,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    if (message.includes('not found') || message.includes('No published')) {
      return res.status(404).json({ error: 'not_found', message });
    }
    if (message.includes('draft version already exists')) {
      return res.status(409).json({ error: 'draft_exists', message });
    }
    logger.error('Failed to create draft from published', {
      workflowId: req.params.workflowId,
      error,
    });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// PUT /:workflowId/client — Assign or remove client (T010)
// ---------------------------------------------------------------------------

workflowsRouter.put('/:workflowId/client', async (req: Request, res: Response) => {
  try {
    const workflowId = String(req.params.workflowId);
    const teamId = String(req.query.teamId);
    if (!teamId) {
      return res.status(400).json({ error: 'missing_param', message: 'teamId is required' });
    }

    const { client_id } = req.body;
    const newClientId = client_id === null || client_id === undefined ? null : String(client_id);

    // Verify workflow exists
    await getWorkflow(workflowId, teamId);

    const updated = await prisma.workflowTemplate.update({
      where: { id: workflowId },
      data: { clientId: newClientId, updatedAt: new Date() },
      include: { client: { select: { id: true, name: true } } },
    });

    await logAudit({
      action: newClientId ? 'workflow.client_assigned' : 'workflow.client_removed',
      actorUserId: req.body.user_id ?? 'system',
      actorTeamId: teamId,
      targetType: 'workflow_template',
      targetId: workflowId,
      metadata: { clientId: newClientId },
    });

    res.json({
      workflow: {
        id: updated.id,
        client_id: updated.clientId,
        client_name: updated.client?.name || null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    if (message.includes('not found')) {
      return res.status(404).json({ error: 'not_found', message });
    }
    logger.error('Failed to assign client to workflow', { workflowId: req.params.workflowId, error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// GET /:workflowId/channels — List channel mappings (T015)
// ---------------------------------------------------------------------------

workflowsRouter.get('/:workflowId/channels', async (req: Request, res: Response) => {
  try {
    const workflowId = String(req.params.workflowId);
    const teamId = String(req.query.teamId);
    if (!teamId) {
      return res.status(400).json({ error: 'missing_param', message: 'teamId is required' });
    }

    await getWorkflow(workflowId, teamId);

    const mappings = await prisma.workflowChannelMapping.findMany({
      where: { templateId: workflowId },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      mappings: mappings.map((m) => ({
        id: m.id,
        slack_channel_id: m.slackChannelId,
        slack_team_id: m.slackTeamId,
        trigger_type: m.triggerType,
        created_by_user_id: m.createdByUserId,
        created_at: m.createdAt,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    if (message.includes('not found')) {
      return res.status(404).json({ error: 'not_found', message });
    }
    logger.error('Failed to list channel mappings', { workflowId: req.params.workflowId, error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// POST /:workflowId/channels — Add channel mapping (T016)
// ---------------------------------------------------------------------------

workflowsRouter.post('/:workflowId/channels', async (req: Request, res: Response) => {
  try {
    const workflowId = String(req.params.workflowId);
    const teamId = String(req.query.teamId);
    if (!teamId) {
      return res.status(400).json({ error: 'missing_param', message: 'teamId is required' });
    }

    const { slack_channel_id, slack_team_id, created_by_user_id } = req.body;
    if (!slack_channel_id || !slack_team_id) {
      return res.status(400).json({
        error: 'missing_param',
        message: 'slack_channel_id and slack_team_id are required',
      });
    }

    const workflow = await getWorkflow(workflowId, teamId);

    // Validate team ID matches
    if (slack_team_id !== workflow.slackTeamId) {
      return res.status(400).json({ error: 'team_id_mismatch' });
    }

    // Check for existing mapping
    const existing = await prisma.workflowChannelMapping.findUnique({
      where: {
        slackTeamId_slackChannelId_triggerType: {
          slackTeamId: slack_team_id,
          slackChannelId: slack_channel_id,
          triggerType: workflow.triggerType,
        },
      },
    });

    if (existing) {
      return res.status(409).json({
        error: 'channel_already_mapped',
        existing_workflow_id: existing.templateId,
      });
    }

    const mapping = await prisma.workflowChannelMapping.create({
      data: {
        templateId: workflowId,
        slackChannelId: slack_channel_id,
        slackTeamId: slack_team_id,
        triggerType: workflow.triggerType,
        createdByUserId: created_by_user_id ?? 'system',
      },
    });

    await logAudit({
      action: 'workflow.channel_mapped',
      actorUserId: created_by_user_id ?? 'system',
      actorTeamId: teamId,
      targetType: 'workflow_channel_mapping',
      targetId: mapping.id,
      metadata: { workflowId, slackChannelId: slack_channel_id, triggerType: workflow.triggerType },
    });

    res.status(201).json({
      mapping: {
        id: mapping.id,
        slack_channel_id: mapping.slackChannelId,
        slack_team_id: mapping.slackTeamId,
        trigger_type: mapping.triggerType,
        created_by_user_id: mapping.createdByUserId,
        created_at: mapping.createdAt,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    if (message.includes('not found')) {
      return res.status(404).json({ error: 'not_found', message });
    }
    logger.error('Failed to add channel mapping', { workflowId: req.params.workflowId, error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /:workflowId/channels/:mappingId — Remove channel mapping (T017)
// ---------------------------------------------------------------------------

workflowsRouter.delete('/:workflowId/channels/:mappingId', async (req: Request, res: Response) => {
  try {
    const workflowId = String(req.params.workflowId);
    const mappingId = String(req.params.mappingId);
    const teamId = String(req.query.teamId);
    if (!teamId) {
      return res.status(400).json({ error: 'missing_param', message: 'teamId is required' });
    }

    await getWorkflow(workflowId, teamId);

    const mapping = await prisma.workflowChannelMapping.findFirst({
      where: { id: mappingId, templateId: workflowId },
    });

    if (!mapping) {
      return res.status(404).json({ error: 'not_found', message: 'Mapping not found' });
    }

    await prisma.workflowChannelMapping.delete({ where: { id: mappingId } });

    await logAudit({
      action: 'workflow.channel_unmapped',
      actorUserId: req.body?.user_id ?? 'system',
      actorTeamId: teamId,
      targetType: 'workflow_channel_mapping',
      targetId: mappingId,
      metadata: { workflowId, slackChannelId: mapping.slackChannelId },
    });

    res.json({ deleted: true });
  } catch (error) {
    logger.error('Failed to delete channel mapping', {
      workflowId: req.params.workflowId,
      mappingId: req.params.mappingId,
      error,
    });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /:workflowId — Delete workflow
// ---------------------------------------------------------------------------

workflowsRouter.delete('/:workflowId', async (req: Request, res: Response) => {
  try {
    const teamId = String(req.query.teamId);
    if (!teamId) {
      return res.status(400).json({ error: 'missing_param', message: 'teamId is required' });
    }

    const userId = req.body.deleted_by_user_id ? String(req.body.deleted_by_user_id) : undefined;
    await deleteWorkflow(String(req.params.workflowId), teamId, userId);

    res.json({ message: 'Workflow deleted successfully', workflow_id: req.params.workflowId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    if (message.includes('not found')) {
      return res.status(404).json({ error: 'not_found', message });
    }
    if (message.includes('active execution')) {
      return res.status(409).json({ error: 'active_executions', message });
    }
    logger.error('Failed to delete workflow', { workflowId: req.params.workflowId, error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// GET /:workflowId/executions — List executions for a workflow
// ---------------------------------------------------------------------------

workflowsRouter.get('/:workflowId/executions', async (req: Request, res: Response) => {
  try {
    const teamId = String(req.query.teamId);
    if (!teamId) {
      return res.status(400).json({ error: 'missing_param', message: 'teamId is required' });
    }

    const status = req.query.status ? String(req.query.status) : undefined;
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const offset = Number(req.query.offset) || 0;

    // Verify workflow belongs to team
    const workflowId = String(req.params.workflowId);
    await getWorkflow(workflowId, teamId);

    const where: Record<string, unknown> = {
      version: { templateId: workflowId },
    };
    if (status) {
      where.status = status;
    }

    const [executions, total] = await Promise.all([
      prisma.workflowExecution.findMany({
        where: where as any,
        include: {
          version: { select: { version: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.workflowExecution.count({ where: where as any }),
    ]);

    res.json({
      executions: executions.map((e) => {
        const nodeHistory = (e.nodeHistory as unknown[]) || [];
        const durationSeconds = e.completedAt
          ? Math.round((e.completedAt.getTime() - e.createdAt.getTime()) / 1000)
          : null;

        return {
          id: e.id,
          version_id: e.versionId,
          version_number: (e as any).version.version,
          slack_user_id: e.slackUserId,
          slack_channel_id: e.slackChannelId,
          status: e.status,
          current_node_id: e.currentNodeId,
          node_history_count: nodeHistory.length,
          started_at: e.createdAt,
          completed_at: e.completedAt,
          duration_seconds: durationSeconds,
        };
      }),
      total,
      limit,
      offset,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    if (message.includes('not found')) {
      return res.status(404).json({ error: 'not_found', message });
    }
    logger.error('Failed to list executions', { workflowId: req.params.workflowId, error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// GET /executions/:executionId/progress — SSE stream for execution progress
// ---------------------------------------------------------------------------

workflowsRouter.get('/executions/:executionId/progress', async (req: Request, res: Response) => {
  const executionId = String(req.params.executionId);

  // Verify execution exists
  const execution = await prisma.workflowExecution.findUnique({
    where: { id: executionId },
    select: { id: true, status: true },
  });

  if (!execution) {
    return res.status(404).json({ error: 'not_found', message: 'Execution not found' });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send current progress as initial event
  const currentProgress = await getExecutionProgress(executionId);
  res.write(`data: ${JSON.stringify({ type: 'init', progress: currentProgress })}\n\n`);

  // Subscribe to real-time updates
  const { unsubscribe } = subscribeToProgress(executionId, (progress) => {
    res.write(`data: ${JSON.stringify({ type: 'update', progress })}\n\n`);
  });

  // Keep-alive ping every 30s
  const keepAlive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 30000);

  // Cleanup on close
  req.on('close', async () => {
    clearInterval(keepAlive);
    await unsubscribe();
  });
});

// ---------------------------------------------------------------------------
// POST /executions/:executionId/progress — Get execution progress (non-SSE)
// ---------------------------------------------------------------------------

workflowsRouter.get('/executions/:executionId/progress-snapshot', async (req: Request, res: Response) => {
  try {
    const executionId = String(req.params.executionId);
    const progress = await getExecutionProgress(executionId);
    res.json({ progress });
  } catch (error) {
    logger.error('Failed to get execution progress', { executionId: req.params.executionId, error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// POST /test-api-call — Test an API call configuration without executing workflow
// ---------------------------------------------------------------------------

workflowsRouter.post('/test-api-call', async (req: Request, res: Response) => {
  try {
    const { url, method, headers, body_template, auth_type, auth_config, timeout_ms } = req.body;

    if (!url || !method) {
      return res.status(400).json({
        error: 'missing_param',
        message: 'url and method are required',
      });
    }

    const timeout = Math.min(Number(timeout_ms) || 10000, 30000);

    // Build request
    const requestHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (headers && typeof headers === 'object') {
      Object.assign(requestHeaders, headers);
    }

    // Apply auth
    if (auth_type === 'bearer' && auth_config?.token) {
      requestHeaders['Authorization'] = `Bearer ${auth_config.token}`;
    } else if (auth_type === 'api_key' && auth_config?.header_name && auth_config?.api_key) {
      requestHeaders[auth_config.header_name] = auth_config.api_key;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const fetchOptions: RequestInit = {
      method: method.toUpperCase(),
      headers: requestHeaders,
      signal: controller.signal,
    };

    if (['POST', 'PUT', 'PATCH'].includes(method.toUpperCase()) && body_template) {
      fetchOptions.body = body_template;
    }

    const startTime = Date.now();
    const response = await fetch(url, fetchOptions);
    const elapsed = Date.now() - startTime;
    clearTimeout(timer);

    const responseText = await response.text();
    let responseJson: unknown = null;
    let discoveredSchema: unknown[] = [];

    try {
      responseJson = JSON.parse(responseText);
      // Discover schema
      const { discoverSchema } = await import('../../services/workflow/nodes/schemaDiscoverer.js');
      discoveredSchema = discoverSchema(responseJson);
    } catch {
      // Not JSON - that's fine
    }

    res.json({
      status: response.status,
      status_text: response.statusText,
      elapsed_ms: elapsed,
      headers: Object.fromEntries(response.headers.entries()),
      body: responseJson ?? responseText,
      discovered_schema: discoveredSchema,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    if (message.includes('abort')) {
      return res.status(408).json({ error: 'timeout', message: 'Request timed out' });
    }
    logger.error('Failed to test API call', { error });
    res.status(500).json({ error: 'request_failed', message });
  }
});
