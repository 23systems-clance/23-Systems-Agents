/**
 * Skill admin API routes (Feature 39 - Vertical Pack Platform).
 *
 * CRUD for skills with test, publish, and version-check endpoints.
 * Per contracts/skills-api.yaml.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  createSkill,
  getSkill,
  listSkills,
  updateSkill,
  publishSkill,
  deprecateSkill,
  checkAgentVersionUpgrade,
} from '../../services/platform/skillComposer.js';
import { executeSkill } from '../../services/platform/skillExecutor.js';
import { prisma } from '../../models/index.js';
import {
  createSkillSchema,
  updateSkillSchema,
  listSkillsQuerySchema,
  testSkillSchema,
  validateBody,
  validateQuery,
} from '../../lib/platformValidation.js';
import logger from '../../lib/logger.js';

export const skillAdminRouter = Router();

/**
 * GET /api/v1/admin/skills
 * List all skills with optional status and trigger type filters.
 */
skillAdminRouter.get('/', async (req: Request, res: Response) => {
  try {
    const query = validateQuery(listSkillsQuerySchema, req.query, res);
    if (!query) return;

    const skills = await listSkills({
      status: query.status as any,
      triggerType: query.triggerType as any,
    });
    res.json({ skills, total: skills.length });
  } catch (error) {
    logger.error('Failed to list skills', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to list skills' });
  }
});

/**
 * POST /api/v1/admin/skills
 * Create a new skill.
 */
skillAdminRouter.post('/', async (req: Request, res: Response) => {
  const data = validateBody(createSkillSchema, req.body, res);
  if (!data) return;

  try {
    const skill = await createSkill(data);
    res.status(201).json(skill);
  } catch (error) {
    logger.error('Failed to create skill', { error: error instanceof Error ? error.message : String(error) });
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      res.status(409).json({ error: `Skill with slug "${data.slug}" already exists` });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to create skill' });
  }
});

/**
 * GET /api/v1/admin/skills/:skillId
 * Get skill details with execution stats and version check.
 */
skillAdminRouter.get('/:skillId', async (req: Request, res: Response) => {
  try {
    const skill = await getSkill(req.params.skillId as string);
    if (!skill) {
      res.status(404).json({ error: 'Skill not found' });
      return;
    }
    res.json(skill);
  } catch (error) {
    logger.error('Failed to get skill', { skillId: req.params.skillId as string, error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to get skill' });
  }
});

/**
 * PUT /api/v1/admin/skills/:skillId
 * Update skill.
 */
skillAdminRouter.put('/:skillId', async (req: Request, res: Response) => {
  const data = validateBody(updateSkillSchema, req.body, res);
  if (!data) return;

  try {
    const skill = await updateSkill(req.params.skillId as string, data);
    res.json(skill);
  } catch (error) {
    logger.error('Failed to update skill', { skillId: req.params.skillId as string, error: error instanceof Error ? error.message : String(error) });
    if (error instanceof Error && error.message.includes('not found')) {
      res.status(404).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to update skill' });
  }
});

/**
 * POST /api/v1/admin/skills/:skillId/test
 * Test skill end-to-end in sandbox.
 */
skillAdminRouter.post('/:skillId/test', async (req: Request, res: Response) => {
  const data = validateBody(testSkillSchema, req.body, res);
  if (!data) return;

  try {
    const execution = await prisma.skillExecution.create({
      data: {
        skillId: req.params.skillId as string,
        slackTeamId: 'sandbox',
        triggerType: 'MANUAL',
        triggerSource: 'admin-test',
        input: data.input as any,
        status: 'QUEUED',
      },
    });

    const result = await executeSkill({
      executionId: execution.id,
      skillId: req.params.skillId as string,
      slackTeamId: 'sandbox',
      input: data.input,
    });

    res.json(result);
  } catch (error) {
    logger.error('Skill test failed', { skillId: req.params.skillId as string, error: error instanceof Error ? error.message : String(error) });
    res.status(400).json({ error: error instanceof Error ? error.message : 'Skill test failed' });
  }
});

/**
 * POST /api/v1/admin/skills/:skillId/publish
 * Publish skill.
 */
skillAdminRouter.post('/:skillId/publish', async (req: Request, res: Response) => {
  try {
    const skill = await publishSkill(req.params.skillId as string);
    res.json(skill);
  } catch (error) {
    logger.error('Failed to publish skill', { skillId: req.params.skillId as string, error: error instanceof Error ? error.message : String(error) });
    if (error instanceof Error && error.message.includes('not found')) {
      res.status(404).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to publish skill' });
  }
});

/**
 * POST /api/v1/admin/skills/:skillId/deprecate
 * Deprecate skill.
 */
skillAdminRouter.post('/:skillId/deprecate', async (req: Request, res: Response) => {
  try {
    const skill = await deprecateSkill(req.params.skillId as string);
    res.json(skill);
  } catch (error) {
    logger.error('Failed to deprecate skill', { skillId: req.params.skillId as string, error: error instanceof Error ? error.message : String(error) });
    if (error instanceof Error && error.message.includes('not found')) {
      res.status(404).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to deprecate skill' });
  }
});

/**
 * GET /api/v1/admin/skills/:skillId/version-check
 * Check if skill's agent has a newer published version.
 */
skillAdminRouter.get('/:skillId/version-check', async (req: Request, res: Response) => {
  try {
    const result = await checkAgentVersionUpgrade(req.params.skillId as string);
    res.json(result);
  } catch (error) {
    logger.error('Version check failed', { skillId: req.params.skillId as string, error: error instanceof Error ? error.message : String(error) });
    if (error instanceof Error && error.message.includes('not found')) {
      res.status(404).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Version check failed' });
  }
});
