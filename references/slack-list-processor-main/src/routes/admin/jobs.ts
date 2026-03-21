/**
 * Admin job endpoints.
 *
 * GET /api/v1/admin/jobs       — Paginated job list with filters.
 * GET /api/v1/admin/jobs/:id   — Full job detail with conversation flow and persona summary.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../models/index.js';

export const jobsRouter = Router();

// ---------------------------------------------------------------------------
// GET /jobs (paginated list with filters)
// ---------------------------------------------------------------------------

jobsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const where: Prisma.JobWhereInput = {};

    if (req.query.status) where.status = req.query.status as Prisma.EnumJobStatusFilter;
    if (req.query.job_type) where.jobType = req.query.job_type as Prisma.EnumJobTypeFilter;
    if (req.query.slack_team_id) where.slackTeamId = req.query.slack_team_id as string;
    if (req.query.slack_user_id) where.slackUserId = req.query.slack_user_id as string;
    if (req.query.is_cosell === 'true') where.isCosell = true;
    if (req.query.is_cosell === 'false') where.isCosell = false;

    if (req.query.start_date || req.query.end_date) {
      const now = new Date();
      const endDate = req.query.end_date ? new Date(req.query.end_date as string) : now;
      const startDate = req.query.start_date
        ? new Date(req.query.start_date as string)
        : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
      endDate.setHours(23, 59, 59, 999);
      where.createdAt = { gte: startDate, lte: endDate };
    }

    const sortParam = (req.query.sort as string) || 'created_at:desc';
    const [sortField, sortDir] = sortParam.split(':');
    const fieldMap: Record<string, string> = {
      created_at: 'createdAt',
      status: 'status',
      job_type: 'jobType',
    };
    const orderBy: Prisma.JobOrderByWithRelationInput = {
      [fieldMap[sortField] ?? 'createdAt']: sortDir === 'asc' ? 'asc' : 'desc',
    };

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        orderBy,
        take: limit,
        skip: offset,
        select: {
          id: true,
          jobType: true,
          status: true,
          sourceFileName: true,
          sourceRowCount: true,
          purpose: true,
          isCosell: true,
          cosellProvider: true,
          listOwner: true,
          slackUserId: true,
          slackTeamId: true,
          slackChannelName: true,
          companiesProcessed: true,
          contactsFound: true,
          qualityGateResult: true,
          createdAt: true,
          completedAt: true,
        },
      }),
      prisma.job.count({ where }),
    ]);

    res.json({
      jobs: jobs.map((j) => {
        // Extract quality gate summary from JSONB field
        const qg = j.qualityGateResult as Record<string, unknown> | null;
        const qualityGateSummary = qg ? {
          totalRows: qg.totalRows as number,
          passedRows: qg.passedRows as number,
          filteredRows: qg.filteredRows as number,
          uniqueDomains: qg.uniqueDomains as number,
        } : null;

        return {
          id: j.id,
          job_type: j.jobType,
          status: j.status,
          source_file_name: j.sourceFileName,
          source_row_count: j.sourceRowCount,
          purpose: j.purpose,
          is_cosell: j.isCosell,
          cosell_provider: j.cosellProvider,
          list_owner: j.listOwner,
          slack_user_id: j.slackUserId,
          slack_team_id: j.slackTeamId,
          slack_channel_name: j.slackChannelName,
          companies_processed: j.companiesProcessed,
          contacts_found: j.contactsFound,
          quality_gate_summary: qualityGateSummary,
          created_at: j.createdAt,
          completed_at: j.completedAt,
        };
      }),
      total,
      limit,
      offset,
    });
  } catch {
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// GET /jobs/:id (full detail with conversation flow + persona summary)
// ---------------------------------------------------------------------------

jobsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params['id'] as string;

    const job = await prisma.job.findUnique({
      where: { id },
      include: {
        apiUsageLogs: {
          select: {
            service: true,
            endpoint: true,
            estimatedCostUsd: true,
            creditsConsumed: true,
            tokensInput: true,
            tokensOutput: true,
            durationMs: true,
            createdAt: true,
          },
        },
        contacts: {
          select: {
            personaType: true,
            isDecisionMaker: true,
          },
        },
      },
    });

    if (!job) {
      res.status(404).json({ error: 'not_found', message: 'Job not found' });
      return;
    }

    // Aggregate persona counts.
    const personaCounts = new Map<string, number>();
    let decisionMakerCount = 0;
    for (const contact of job.contacts) {
      personaCounts.set(contact.personaType, (personaCounts.get(contact.personaType) ?? 0) + 1);
      if (contact.isDecisionMaker) decisionMakerCount++;
    }
    const personaSummary = Array.from(personaCounts.entries())
      .map(([persona_type, count]) => ({ persona_type, count }))
      .sort((a, b) => b.count - a.count);

    // Aggregate total API cost.
    let totalApiCostUsd = 0;
    let totalTokensInput = 0;
    let totalTokensOutput = 0;
    for (const log of job.apiUsageLogs) {
      totalApiCostUsd += parseFloat(log.estimatedCostUsd?.toString() ?? '0');
      totalTokensInput += log.tokensInput ?? 0;
      totalTokensOutput += log.tokensOutput ?? 0;
    }

    res.json({
      id: job.id,
      job_type: job.jobType,
      status: job.status,
      progress: job.progress,
      source_file_name: job.sourceFileName,
      source_file_type: job.sourceFileType,
      source_row_count: job.sourceRowCount,
      result_file_url: job.resultFileUrl,
      result_file_name: job.resultFileName,

      // Conversation flow fields
      purpose: job.purpose,
      is_cosell: job.isCosell,
      cosell_provider: job.cosellProvider,
      list_owner: job.listOwner,
      additional_context: job.additionalContext,
      enrich_instruction: job.enrichInstruction,
      parsed_intent: job.parsedIntent,

      // Slack context
      slack_channel_id: job.slackChannelId,
      slack_channel_name: job.slackChannelName,
      slack_thread_ts: job.slackThreadTs,
      slack_user_id: job.slackUserId,
      slack_team_id: job.slackTeamId,

      // Processing results
      companies_processed: job.companiesProcessed,
      companies_failed: job.companiesFailed,
      contacts_found: job.contactsFound,
      error_message: job.errorMessage,

      // Persona breakdown
      persona_summary: personaSummary,
      decision_maker_count: decisionMakerCount,
      total_contacts: job.contacts.length,

      // Cost summary
      api_cost: {
        total_cost_usd: totalApiCostUsd.toFixed(6),
        total_tokens_input: totalTokensInput,
        total_tokens_output: totalTokensOutput,
        log_count: job.apiUsageLogs.length,
      },

      // API usage detail
      api_usage_logs: job.apiUsageLogs.map((l) => ({
        service: l.service,
        endpoint: l.endpoint,
        estimated_cost_usd: l.estimatedCostUsd?.toString() ?? '0',
        credits_consumed: l.creditsConsumed?.toString() ?? '0',
        tokens_input: l.tokensInput,
        tokens_output: l.tokensOutput,
        duration_ms: l.durationMs,
        created_at: l.createdAt,
      })),

      // Quality gate (Feature 16)
      quality_gate_result: job.qualityGateResult ?? null,
      quality_gate_config_snapshot: job.qualityGateConfigSnapshot ?? null,

      // Timestamps
      started_at: job.startedAt,
      completed_at: job.completedAt,
      created_at: job.createdAt,
      updated_at: job.updatedAt,
    });
  } catch {
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});
