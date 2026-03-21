/**
 * Prompt library admin endpoints (Feature 19).
 *
 * GET    /             — List all prompts (with filters)
 * POST   /             — Create a new prompt
 * GET    /:slug        — Get prompt detail with versions
 * PATCH  /:slug        — Update prompt metadata
 * GET    /:slug/versions            — List versions
 * POST   /:slug/versions            — Create new draft version
 * GET    /:slug/versions/:versionId — Get specific version
 * PATCH  /:slug/versions/:versionId — Update draft version content
 * POST   /:slug/versions/:versionId/publish — Publish a draft
 * GET    /:slug/diff   — Diff two versions
 * POST   /:slug/versions/:versionId/test      — Run a prompt test
 * GET    /:slug/versions/:versionId/test-runs  — List test runs
 * GET    /variables                 — List template variables
 * POST   /variables                 — Create a template variable
 * PATCH  /variables/:variableId     — Update a template variable
 * GET    /variables/overrides       — List workspace overrides
 * PUT    /variables/overrides       — Upsert a workspace override
 * DELETE /variables/overrides       — Remove a workspace override
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { Prisma } from '@prisma/client';
import { prisma } from '../../models/index.js';
import { config } from '../../config/index.js';
import { logAudit } from '../../lib/auditLogger.js';
import logger from '../../lib/logger.js';
import { invalidateCache, resolvePrompt } from '../../services/ai/promptResolver.js';
import { calculateAiCost } from '../../services/ai/costCalculator.js';
import { trackUsage } from '../../services/metering/usageTracker.js';
import { createTwoFilesPatch } from 'diff';

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

export const promptsRouter = Router();

// ---------------------------------------------------------------------------
// GET / — List all prompts
// ---------------------------------------------------------------------------

promptsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { category, search, isActive, page = '1', limit = '20' } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 20));
    const skip = (pageNum - 1) * pageSize;

    const where: Prisma.PromptWhereInput = {};
    if (category) {
      where.category = category as Prisma.EnumPromptCategoryFilter;
    }
    if (search) {
      where.OR = [
        { displayName: { contains: search as string, mode: 'insensitive' } },
        { slug: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } },
      ];
    }
    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    }

    const [prompts, total] = await Promise.all([
      prisma.prompt.findMany({
        where,
        include: {
          versions: {
            where: { status: 'PUBLISHED' },
            take: 1,
            select: { version: true, status: true, publishedAt: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.prompt.count({ where }),
    ]);

    // Compute usage counts from ApiUsageLog endpoint field.
    // AI service refactors (T018-T021) will include prompt slug in the endpoint
    // field as "endpoint:prompt-slug", e.g. "classifyIntent:agent-intent-classifier".
    const usageCounts: Record<string, number> = {};
    for (const p of prompts) {
      const count = await prisma.apiUsageLog.count({
        where: {
          endpoint: { contains: p.slug },
        },
      });
      usageCounts[p.slug] = count;
    }

    const formatted = prompts.map((p) => ({
      id: p.id,
      slug: p.slug,
      displayName: p.displayName,
      description: p.description,
      category: p.category,
      isActive: p.isActive,
      modelConfig: p.modelConfig,
      publishedVersion: p.versions[0] ?? null,
      usageCount: usageCounts[p.slug] ?? 0,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));

    res.json({ prompts: formatted, total, page: pageNum, limit: pageSize });
  } catch (err) {
    logger.error('Failed to list prompts', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Failed to list prompts' });
  }
});

// ---------------------------------------------------------------------------
// POST / — Create a new prompt
// ---------------------------------------------------------------------------

promptsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { slug, displayName, description, category, modelConfig, toolDefinitions, initialContent } = req.body;

    if (!slug || !displayName || !category || !modelConfig) {
      res.status(400).json({ error: 'slug, displayName, category, and modelConfig are required' });
      return;
    }

    // Validate slug format
    if (!/^[a-z][a-z0-9-]*$/.test(slug)) {
      res.status(400).json({ error: 'slug must be lowercase alphanumeric with hyphens, starting with a letter' });
      return;
    }

    // Check uniqueness
    const existing = await prisma.prompt.findUnique({ where: { slug } });
    if (existing) {
      res.status(409).json({ error: `Prompt with slug "${slug}" already exists` });
      return;
    }

    const prompt = await prisma.prompt.create({
      data: {
        slug,
        displayName,
        description: description ?? null,
        category,
        modelConfig,
        toolDefinitions: toolDefinitions ?? null,
      },
    });

    // If initialContent provided, create a DRAFT v1
    if (initialContent) {
      await prisma.promptVersion.create({
        data: {
          promptId: prompt.id,
          version: 1,
          content: initialContent,
          status: 'DRAFT',
        },
      });
    }

    logAudit({
      action: 'prompt_created',
      actorUserId: req.admin?.id ?? 'system',
      targetType: 'prompt',
      targetId: prompt.id,
      metadata: { slug, category },
    });

    res.status(201).json({ prompt });
  } catch (err) {
    logger.error('Failed to create prompt', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Failed to create prompt' });
  }
});

// ---------------------------------------------------------------------------
// GET /variables — List all template variables (US3 — T033)
// NOTE: These /variables routes MUST be before /:slug to avoid matching.
// ---------------------------------------------------------------------------

promptsRouter.get('/variables', async (_req: Request, res: Response) => {
  try {
    const variables = await prisma.promptVariable.findMany({
      include: {
        _count: { select: { prompts: true } },
      },
      orderBy: { name: 'asc' },
    });

    const formatted = variables.map((v) => ({
      id: v.id,
      name: v.name,
      description: v.description,
      defaultValue: v.defaultValue,
      promptCount: v._count.prompts,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
    }));

    res.json({ variables: formatted, total: formatted.length });
  } catch (err) {
    logger.error('Failed to list variables', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Failed to list variables' });
  }
});

// ---------------------------------------------------------------------------
// POST /variables — Create a template variable (US3 — T033)
// ---------------------------------------------------------------------------

promptsRouter.post('/variables', async (req: Request, res: Response) => {
  try {
    const { name, description, defaultValue } = req.body;

    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) {
      res.status(400).json({
        error: 'name must start with a letter and contain only letters, digits, and underscores',
      });
      return;
    }

    const existing = await prisma.promptVariable.findUnique({ where: { name } });
    if (existing) {
      res.status(409).json({ error: `Variable "${name}" already exists` });
      return;
    }

    const variable = await prisma.promptVariable.create({
      data: {
        name,
        description: description ?? null,
        defaultValue: defaultValue ?? null,
      },
    });

    logAudit({
      action: 'prompt_variable_created',
      actorUserId: req.admin?.id ?? 'system',
      targetType: 'prompt_variable',
      targetId: variable.id,
      metadata: { name },
    });

    res.status(201).json({ variable });
  } catch (err) {
    logger.error('Failed to create variable', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Failed to create variable' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /variables/:variableId — Update a template variable (US3 — T033)
// ---------------------------------------------------------------------------

promptsRouter.patch('/variables/:variableId', async (req: Request, res: Response) => {
  try {
    const variableId = req.params.variableId as string;
    const { description, defaultValue } = req.body;

    const variable = await prisma.promptVariable.findUnique({ where: { id: variableId } });
    if (!variable) {
      res.status(404).json({ error: 'Variable not found' });
      return;
    }

    const updated = await prisma.promptVariable.update({
      where: { id: variableId },
      data: {
        ...(description !== undefined && { description }),
        ...(defaultValue !== undefined && { defaultValue }),
      },
    });

    logAudit({
      action: 'prompt_variable_updated',
      actorUserId: req.admin?.id ?? 'system',
      targetType: 'prompt_variable',
      targetId: variableId,
      metadata: { name: variable.name },
    });

    res.json({ variable: updated });
  } catch (err) {
    logger.error('Failed to update variable', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Failed to update variable' });
  }
});

// ---------------------------------------------------------------------------
// GET /variables/overrides — List workspace overrides (US3 — T034)
// ---------------------------------------------------------------------------

promptsRouter.get('/variables/overrides', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = req.query;

    const where: Prisma.WorkspacePromptOverrideWhereInput = {};
    if (workspaceId) {
      where.workspaceId = workspaceId as string;
    }

    const overrides = await prisma.workspacePromptOverride.findMany({
      where,
      include: { variable: true },
      orderBy: { createdAt: 'desc' },
    });

    const formatted = overrides.map((o) => ({
      id: o.id,
      workspaceId: o.workspaceId,
      variableId: o.variableId,
      variableName: o.variable.name,
      overrideValue: o.overrideValue,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    }));

    res.json({ overrides: formatted, total: formatted.length });
  } catch (err) {
    logger.error('Failed to list overrides', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Failed to list overrides' });
  }
});

// ---------------------------------------------------------------------------
// PUT /variables/overrides — Upsert a workspace override (US3 — T034)
// ---------------------------------------------------------------------------

promptsRouter.put('/variables/overrides', async (req: Request, res: Response) => {
  try {
    const { workspaceId, variableId, overrideValue } = req.body;

    if (!workspaceId || !variableId || overrideValue === undefined) {
      res.status(400).json({ error: 'workspaceId, variableId, and overrideValue are required' });
      return;
    }

    const variable = await prisma.promptVariable.findUnique({ where: { id: variableId } });
    if (!variable) {
      res.status(404).json({ error: 'Variable not found' });
      return;
    }

    const override = await prisma.workspacePromptOverride.upsert({
      where: {
        workspaceId_variableId: { workspaceId, variableId },
      },
      update: { overrideValue },
      create: { workspaceId, variableId, overrideValue },
    });

    // Invalidate cache for all prompts that use this variable
    const mappings = await prisma.promptVariableMapping.findMany({
      where: { variableId },
      include: { prompt: true },
    });
    for (const m of mappings) {
      await invalidateCache(m.prompt.slug);
    }

    logAudit({
      action: 'prompt_override_set',
      actorUserId: req.admin?.id ?? 'system',
      targetType: 'workspace_prompt_override',
      targetId: override.id,
      metadata: { workspaceId, variableName: variable.name },
    });

    res.json({ override });
  } catch (err) {
    logger.error('Failed to upsert override', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Failed to upsert override' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /variables/overrides — Remove a workspace override (US3 — T034)
// ---------------------------------------------------------------------------

promptsRouter.delete('/variables/overrides', async (req: Request, res: Response) => {
  try {
    const { workspaceId, variableId } = req.query;

    if (!workspaceId || !variableId) {
      res.status(400).json({ error: 'workspaceId and variableId query params are required' });
      return;
    }

    const existing = await prisma.workspacePromptOverride.findUnique({
      where: {
        workspaceId_variableId: {
          workspaceId: workspaceId as string,
          variableId: variableId as string,
        },
      },
      include: { variable: true },
    });

    if (!existing) {
      res.status(404).json({ error: 'Override not found' });
      return;
    }

    await prisma.workspacePromptOverride.delete({
      where: { id: existing.id },
    });

    // Invalidate cache for affected prompts
    const mappings = await prisma.promptVariableMapping.findMany({
      where: { variableId: variableId as string },
      include: { prompt: true },
    });
    for (const m of mappings) {
      await invalidateCache(m.prompt.slug);
    }

    logAudit({
      action: 'prompt_override_removed',
      actorUserId: req.admin?.id ?? 'system',
      targetType: 'workspace_prompt_override',
      targetId: existing.id,
      metadata: {
        workspaceId: workspaceId as string,
        variableName: existing.variable.name,
      },
    });

    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to delete override', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Failed to delete override' });
  }
});

// ---------------------------------------------------------------------------
// GET /:slug — Prompt detail with versions and variables
// ---------------------------------------------------------------------------

promptsRouter.get('/:slug', async (req: Request, res: Response) => {
  try {
    const slugParam = req.params.slug as string;

    const prompt = await prisma.prompt.findUnique({
      where: { slug: slugParam },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          select: {
            id: true,
            version: true,
            status: true,
            publishedBy: true,
            publishedAt: true,
            changeNote: true,
            createdAt: true,
          },
        },
        variables: {
          include: { variable: true },
        },
      },
    });

    if (!prompt) {
      res.status(404).json({ error: `Prompt "${slugParam}" not found` });
      return;
    }

    const { variables: variableMappings, ...rest } = prompt;
    res.json({
      prompt: {
        ...rest,
        variables: variableMappings.map((m: { variable: unknown }) => m.variable),
      },
    });
  } catch (err) {
    logger.error('Failed to get prompt detail', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Failed to get prompt detail' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /:slug — Update prompt metadata
// ---------------------------------------------------------------------------

promptsRouter.patch('/:slug', async (req: Request, res: Response) => {
  try {
    const slug = req.params.slug as string;
    const { displayName, description, category, modelConfig, toolDefinitions } = req.body;

    const prompt = await prisma.prompt.findUnique({ where: { slug } });
    if (!prompt) {
      res.status(404).json({ error: `Prompt "${slug}" not found` });
      return;
    }

    const updated = await prisma.prompt.update({
      where: { slug },
      data: {
        ...(displayName !== undefined && { displayName }),
        ...(description !== undefined && { description }),
        ...(category !== undefined && { category }),
        ...(modelConfig !== undefined && { modelConfig }),
        ...(toolDefinitions !== undefined && { toolDefinitions }),
      },
    });

    logAudit({
      action: 'prompt_updated',
      actorUserId: req.admin?.id ?? 'system',
      targetType: 'prompt',
      targetId: prompt.id,
      metadata: { slug },
    });

    res.json({ prompt: updated });
  } catch (err) {
    logger.error('Failed to update prompt', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Failed to update prompt' });
  }
});

// ---------------------------------------------------------------------------
// GET /:slug/versions — List versions
// ---------------------------------------------------------------------------

promptsRouter.get('/:slug/versions', async (req: Request, res: Response) => {
  try {
    const slug = req.params.slug as string;
    const { status } = req.query;

    const prompt = await prisma.prompt.findUnique({ where: { slug } });
    if (!prompt) {
      res.status(404).json({ error: `Prompt "${slug}" not found` });
      return;
    }

    const where: Prisma.PromptVersionWhereInput = { promptId: prompt.id };
    if (status) {
      where.status = status as Prisma.EnumPromptVersionStatusFilter;
    }

    const versions = await prisma.promptVersion.findMany({
      where,
      orderBy: { version: 'desc' },
    });

    res.json({ versions, total: versions.length });
  } catch (err) {
    logger.error('Failed to list versions', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Failed to list versions' });
  }
});

// ---------------------------------------------------------------------------
// POST /:slug/versions — Create new draft version
// ---------------------------------------------------------------------------

promptsRouter.post('/:slug/versions', async (req: Request, res: Response) => {
  try {
    const slug = req.params.slug as string;
    const { content, copyFromVersionId, changeNote } = req.body;

    const prompt = await prisma.prompt.findUnique({ where: { slug } });
    if (!prompt) {
      res.status(404).json({ error: `Prompt "${slug}" not found` });
      return;
    }

    // Determine version content
    let versionContent = content;
    if (copyFromVersionId) {
      const source = await prisma.promptVersion.findUnique({
        where: { id: copyFromVersionId },
      });
      if (!source) {
        res.status(404).json({ error: 'Source version not found' });
        return;
      }
      versionContent = source.content;
    }

    if (!versionContent) {
      res.status(400).json({ error: 'content or copyFromVersionId is required' });
      return;
    }

    // Auto-increment version number
    const latest = await prisma.promptVersion.findFirst({
      where: { promptId: prompt.id },
      orderBy: { version: 'desc' },
    });
    const nextVersion = (latest?.version ?? 0) + 1;

    const version = await prisma.promptVersion.create({
      data: {
        promptId: prompt.id,
        version: nextVersion,
        content: versionContent,
        status: 'DRAFT',
        changeNote: changeNote ?? null,
      },
    });

    logAudit({
      action: 'prompt_version_created',
      actorUserId: req.admin?.id ?? 'system',
      targetType: 'prompt_version',
      targetId: version.id,
      metadata: { slug, version: nextVersion, copiedFrom: copyFromVersionId },
    });

    res.status(201).json({ version });
  } catch (err) {
    logger.error('Failed to create version', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Failed to create version' });
  }
});

// ---------------------------------------------------------------------------
// GET /:slug/versions/:versionId — Get specific version
// ---------------------------------------------------------------------------

promptsRouter.get('/:slug/versions/:versionId', async (req: Request, res: Response) => {
  try {
    const versionId = req.params.versionId as string;

    const version = await prisma.promptVersion.findUnique({
      where: { id: versionId },
    });

    if (!version) {
      res.status(404).json({ error: 'Version not found' });
      return;
    }

    res.json({ version });
  } catch (err) {
    logger.error('Failed to get version', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Failed to get version' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /:slug/versions/:versionId — Update draft content (optimistic lock)
// ---------------------------------------------------------------------------

promptsRouter.patch('/:slug/versions/:versionId', async (req: Request, res: Response) => {
  try {
    const versionId = req.params.versionId as string;
    const { content, changeNote, updatedAt } = req.body;

    const version = await prisma.promptVersion.findUnique({
      where: { id: versionId },
    });

    if (!version) {
      res.status(404).json({ error: 'Version not found' });
      return;
    }

    if (version.status !== 'DRAFT') {
      res.status(422).json({ error: 'Only DRAFT versions can be edited' });
      return;
    }

    // Optimistic locking: check createdAt since PromptVersion has no updatedAt
    // We use the version's createdAt as a proxy — but since drafts can be updated,
    // we compare against the provided updatedAt (which the client received on last fetch).
    // Note: PromptVersion doesn't have updatedAt, so we compare createdAt as baseline.
    // For a more robust solution, the parent Prompt's updatedAt is checked.
    if (updatedAt) {
      const prompt = await prisma.prompt.findUnique({
        where: { id: version.promptId },
      });
      if (prompt && new Date(updatedAt).getTime() !== prompt.updatedAt.getTime()) {
        res.status(409).json({
          error: 'Conflict: prompt was modified by another user. Please reload.',
          currentUpdatedAt: prompt.updatedAt,
        });
        return;
      }
    }

    // Delete and recreate since PromptVersion has no updatedAt.
    // Instead, we update the content by creating a new record approach.
    // Actually — Prisma update works fine on the version row.
    const updated = await prisma.promptVersion.update({
      where: { id: versionId },
      data: {
        ...(content !== undefined && { content }),
        ...(changeNote !== undefined && { changeNote }),
      },
    });

    // Touch parent prompt's updatedAt for optimistic locking
    await prisma.prompt.update({
      where: { id: version.promptId },
      data: { updatedAt: new Date() },
    });

    res.json({ version: updated });
  } catch (err) {
    logger.error('Failed to update version', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Failed to update version' });
  }
});

// ---------------------------------------------------------------------------
// POST /:slug/versions/:versionId/publish — Publish a draft version
// ---------------------------------------------------------------------------

promptsRouter.post('/:slug/versions/:versionId/publish', async (req: Request, res: Response) => {
  try {
    const slug = req.params.slug as string;
    const versionId = req.params.versionId as string;

    const prompt = await prisma.prompt.findUnique({ where: { slug } });
    if (!prompt) {
      res.status(404).json({ error: `Prompt "${slug}" not found` });
      return;
    }

    const version = await prisma.promptVersion.findUnique({
      where: { id: versionId },
    });

    if (!version) {
      res.status(404).json({ error: 'Version not found' });
      return;
    }

    if (version.status !== 'DRAFT') {
      res.status(422).json({ error: 'Only DRAFT versions can be published' });
      return;
    }

    // FR-018: Test-before-publish gate
    if (config.anthropic.promptTestRequired) {
      const testRunCount = await prisma.promptTestRun.count({
        where: { promptVersionId: versionId },
      });
      if (testRunCount === 0) {
        res.status(422).json({
          error: 'At least one test run is required before publishing. Run a test first.',
        });
        return;
      }
    }

    const adminUserId = req.admin?.id ?? 'system';

    // Atomic transaction: archive current published, publish draft
    await prisma.$transaction(async (tx) => {
      // Archive current published version
      await tx.promptVersion.updateMany({
        where: {
          promptId: prompt.id,
          status: 'PUBLISHED',
        },
        data: {
          status: 'ARCHIVED',
        },
      });

      // Publish the draft
      await tx.promptVersion.update({
        where: { id: versionId },
        data: {
          status: 'PUBLISHED',
          publishedBy: adminUserId,
          publishedAt: new Date(),
        },
      });
    });

    // Invalidate Redis cache
    await invalidateCache(slug);

    logAudit({
      action: 'prompt_published',
      actorUserId: adminUserId,
      targetType: 'prompt_version',
      targetId: versionId,
      metadata: { slug, version: version.version },
    });

    res.json({ success: true, message: `Version ${version.version} published` });
  } catch (err) {
    logger.error('Failed to publish version', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Failed to publish version' });
  }
});

// ---------------------------------------------------------------------------
// GET /:slug/diff — Compare two versions
// ---------------------------------------------------------------------------

promptsRouter.get('/:slug/diff', async (req: Request, res: Response) => {
  try {
    const slug = req.params.slug as string;
    const { from, to } = req.query;

    if (!from || !to) {
      res.status(400).json({ error: 'from and to version IDs are required' });
      return;
    }

    const [fromVersion, toVersion] = await Promise.all([
      prisma.promptVersion.findUnique({ where: { id: from as string } }),
      prisma.promptVersion.findUnique({ where: { id: to as string } }),
    ]);

    if (!fromVersion || !toVersion) {
      res.status(404).json({ error: 'One or both versions not found' });
      return;
    }

    const diff = createTwoFilesPatch(
      `v${fromVersion.version}`,
      `v${toVersion.version}`,
      fromVersion.content,
      toVersion.content,
      `Version ${fromVersion.version} (${fromVersion.status})`,
      `Version ${toVersion.version} (${toVersion.status})`,
    );

    res.json({
      from: {
        id: fromVersion.id,
        version: fromVersion.version,
        status: fromVersion.status,
        content: fromVersion.content,
      },
      to: {
        id: toVersion.id,
        version: toVersion.version,
        status: toVersion.status,
        content: toVersion.content,
      },
      diff,
    });
  } catch (err) {
    logger.error('Failed to compute diff', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Failed to compute diff' });
  }
});

// ---------------------------------------------------------------------------
// POST /:slug/versions/:versionId/test — Run a prompt test (US2 — T028)
// ---------------------------------------------------------------------------

promptsRouter.post('/:slug/versions/:versionId/test', async (req: Request, res: Response) => {
  try {
    const slug = req.params.slug as string;
    const versionId = req.params.versionId as string;
    const { inputText, workspaceId } = req.body;

    if (!inputText) {
      res.status(400).json({ error: 'inputText is required' });
      return;
    }

    // Load version and parent prompt
    const version = await prisma.promptVersion.findUnique({
      where: { id: versionId },
      include: { prompt: true },
    });

    if (!version) {
      res.status(404).json({ error: 'Version not found' });
      return;
    }

    // Resolve prompt content (applies template variables if workspaceId provided)
    const resolved = await resolvePrompt(slug, workspaceId ?? undefined);

    // Use the draft version's content instead of the published resolved content
    const systemContent = version.content;
    const modelConfig = (version.prompt.modelConfig ?? resolved.modelConfig) as {
      model: string;
      maxTokens: number;
      temperature?: number;
    };
    const toolDefs = (version.prompt.toolDefinitions as unknown as Anthropic.Messages.Tool[]) ?? undefined;

    const startMs = Date.now();

    const apiParams: Anthropic.Messages.MessageCreateParams = {
      model: modelConfig.model,
      max_tokens: modelConfig.maxTokens,
      system: systemContent,
      messages: [{ role: 'user', content: inputText }],
    };

    if (toolDefs && toolDefs.length > 0) {
      apiParams.tools = toolDefs;
      apiParams.tool_choice = { type: 'tool', name: toolDefs[0].name };
    }

    const response = await anthropic.messages.create(apiParams);

    const durationMs = Date.now() - startMs;
    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    const tokensUsed = inputTokens + outputTokens;
    const estimatedCostUsd = calculateAiCost(inputTokens, outputTokens);

    // Extract result from response
    const toolUseBlock = response.content.find(
      (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use',
    );
    const textBlock = response.content.find(
      (block): block is Anthropic.Messages.TextBlock => block.type === 'text',
    );
    const outputResult = toolUseBlock
      ? { toolName: toolUseBlock.name, input: toolUseBlock.input }
      : { text: textBlock?.text ?? '' };

    // Persist test run
    const testRun = await prisma.promptTestRun.create({
      data: {
        promptVersionId: versionId,
        inputText,
        outputResult: outputResult as Prisma.InputJsonValue,
        tokensUsed,
        inputTokens,
        outputTokens,
        estimatedCostUsd,
        durationMs,
        testedBy: req.admin?.id ?? 'system',
      },
    });

    // Track API usage for cost attribution
    await trackUsage({
      jobId: `test:${testRun.id}`,
      slackTeamId: workspaceId ?? 'admin-test',
      service: 'ANTHROPIC',
      endpoint: `promptTest:${slug}`,
      tokensInput: inputTokens,
      tokensOutput: outputTokens,
      estimatedCostUsd,
      durationMs,
    });

    logAudit({
      action: 'prompt_tested',
      actorUserId: req.admin?.id ?? 'system',
      targetType: 'prompt_version',
      targetId: versionId,
      metadata: { slug, version: version.version, tokensUsed, durationMs },
    });

    res.json({ testRun });
  } catch (err) {
    logger.error('Failed to run prompt test', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Failed to run prompt test' });
  }
});

// ---------------------------------------------------------------------------
// GET /:slug/versions/:versionId/test-runs — List test runs (US2 — T029)
// ---------------------------------------------------------------------------

promptsRouter.get('/:slug/versions/:versionId/test-runs', async (req: Request, res: Response) => {
  try {
    const versionId = req.params.versionId as string;

    const testRuns = await prisma.promptTestRun.findMany({
      where: { promptVersionId: versionId },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ testRuns, total: testRuns.length });
  } catch (err) {
    logger.error('Failed to list test runs', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Failed to list test runs' });
  }
});

// ---------------------------------------------------------------------------
// POST /:slug/flush-cache — Force cache invalidation for a prompt
// ---------------------------------------------------------------------------

promptsRouter.post('/:slug/flush-cache', async (req: Request, res: Response) => {
  try {
    const slug = req.params.slug as string;

    // Check if prompt exists
    const prompt = await prisma.prompt.findUnique({
      where: { slug },
      include: {
        versions: {
          where: { status: 'PUBLISHED' },
          take: 1,
        },
      },
    });

    const source = prompt && prompt.versions.length > 0 ? 'database' : 'compiled defaults';

    // Invalidate cache
    await invalidateCache(slug);

    logAudit({
      action: 'prompt_cache_flushed',
      actorUserId: req.admin?.id ?? 'system',
      targetType: 'prompt',
      targetId: prompt?.id ?? slug,
      metadata: { slug, source },
    });

    res.json({
      success: true,
      message: `Cache flushed for prompt "${slug}"`,
      source,
      version: prompt?.versions[0]?.version ?? 0,
    });
  } catch (err) {
    logger.error('Failed to flush prompt cache', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Failed to flush prompt cache' });
  }
});

// ---------------------------------------------------------------------------
// POST /:slug/reset-to-defaults — Archive all DB versions and use compiled defaults
// ---------------------------------------------------------------------------

promptsRouter.post('/:slug/reset-to-defaults', async (req: Request, res: Response) => {
  try {
    const slug = req.params.slug as string;

    // Check if prompt exists
    const prompt = await prisma.prompt.findUnique({
      where: { slug },
    });

    if (!prompt) {
      res.status(404).json({ error: `Prompt "${slug}" not found` });
      return;
    }

    // Archive all published versions
    const archivedCount = await prisma.promptVersion.updateMany({
      where: {
        promptId: prompt.id,
        status: 'PUBLISHED',
      },
      data: {
        status: 'ARCHIVED',
      },
    });

    // Invalidate cache
    await invalidateCache(slug);

    logAudit({
      action: 'prompt_reset_to_defaults',
      actorUserId: req.admin?.id ?? 'system',
      targetType: 'prompt',
      targetId: prompt.id,
      metadata: { slug, archivedVersions: archivedCount.count },
    });

    res.json({
      success: true,
      message: `Prompt "${slug}" reset to compiled defaults`,
      archivedVersions: archivedCount.count,
    });
  } catch (err) {
    logger.error('Failed to reset prompt to defaults', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Failed to reset prompt to defaults' });
  }
});

