/**
 * Report endpoints.
 *
 * POST /api/v1/admin/reports/export          — On-demand CSV export
 * GET  /api/v1/admin/reports/scheduled       — List scheduled reports
 * POST /api/v1/admin/reports/scheduled       — Create scheduled report
 * PUT  /api/v1/admin/reports/scheduled/:id   — Update scheduled report
 * DELETE /api/v1/admin/reports/scheduled/:id — Delete scheduled report
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../../models/index.js';
import { logAudit } from '../../lib/auditLogger.js';
import { generateReport } from '../../services/admin/reportGenerator.js';
import { adminQueue } from '../../services/queue/queues.js';

export const reportsRouter = Router();

const VALID_REPORT_TYPES = ['COST_SUMMARY', 'USAGE_BREAKDOWN', 'CLIENT_REPORT', 'ERROR_SUMMARY'] as const;
const VALID_FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;

// ---------------------------------------------------------------------------
// T030 — POST /export (on-demand CSV)
// ---------------------------------------------------------------------------

reportsRouter.post('/export', async (req: Request, res: Response) => {
  try {
    const { report_type, start_date, end_date, filters } = req.body;

    if (!report_type || !start_date || !end_date) {
      res.status(400).json({
        error: 'validation_error',
        message: 'report_type, start_date, and end_date are required',
      });
      return;
    }

    if (!VALID_REPORT_TYPES.includes(report_type)) {
      res.status(400).json({
        error: 'validation_error',
        message: `report_type must be one of: ${VALID_REPORT_TYPES.join(', ')}`,
      });
      return;
    }

    const startDate = new Date(start_date);
    const endDate = new Date(end_date);
    endDate.setHours(23, 59, 59, 999);

    const csv = await generateReport({
      reportType: report_type,
      startDate,
      endDate,
      filters: filters
        ? { service: filters.service ?? null, slackTeamId: filters.slack_team_id ?? null }
        : undefined,
    });

    const filename = `${report_type.toLowerCase().replace(/_/g, '-')}-${start_date}-to-${end_date}.csv`;

    await logAudit({
      action: 'report_exported',
      actorUserId: req.admin!.id,
      actorTeamId: 'admin',
      metadata: { report_type, start_date, end_date, filters },
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    res.status(500).json({
      error: 'internal_error',
      message: 'An unexpected error occurred',
    });
  }
});

// ---------------------------------------------------------------------------
// T031 — Scheduled report CRUD
// ---------------------------------------------------------------------------

// GET /scheduled — List
reportsRouter.get('/scheduled', async (_req: Request, res: Response) => {
  try {
    const reports = await prisma.scheduledReport.findMany({
      include: { creator: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      reports: reports.map((r) => ({
        id: r.id,
        name: r.name,
        report_type: r.reportType,
        frequency: r.frequency,
        slack_channel_id: r.slackChannelId,
        filters: r.filters,
        is_active: r.isActive,
        last_run_at: r.lastRunAt,
        last_error: r.lastError,
        created_by: { id: r.creator.id, name: r.creator.name },
      })),
    });
  } catch (error) {
    res.status(500).json({
      error: 'internal_error',
      message: 'An unexpected error occurred',
    });
  }
});

// POST /scheduled — Create
reportsRouter.post('/scheduled', async (req: Request, res: Response) => {
  try {
    const { name, report_type, frequency, slack_channel_id, filters } = req.body;

    if (!name || !report_type || !frequency || !slack_channel_id) {
      res.status(400).json({
        error: 'validation_error',
        message: 'name, report_type, frequency, and slack_channel_id are required',
      });
      return;
    }

    if (!VALID_REPORT_TYPES.includes(report_type)) {
      res.status(400).json({
        error: 'validation_error',
        message: `report_type must be one of: ${VALID_REPORT_TYPES.join(', ')}`,
      });
      return;
    }

    if (!VALID_FREQUENCIES.includes(frequency)) {
      res.status(400).json({
        error: 'validation_error',
        message: `frequency must be one of: ${VALID_FREQUENCIES.join(', ')}`,
      });
      return;
    }

    const report = await prisma.scheduledReport.create({
      data: {
        name,
        reportType: report_type,
        frequency,
        slackChannelId: slack_channel_id,
        filters: filters ?? null,
        createdBy: req.admin!.id,
      },
      include: { creator: { select: { id: true, name: true } } },
    });

    // Register a BullMQ repeatable job for this scheduled report.
    const cronPattern = getCronForFrequency(frequency);
    const jobKey = `scheduled-report:${report.id}`;

    await adminQueue.upsertJobScheduler(
      jobKey,
      { pattern: cronPattern },
      {
        name: 'scheduled-report',
        data: { reportId: report.id },
      },
    );

    await prisma.scheduledReport.update({
      where: { id: report.id },
      data: { bullmqJobKey: jobKey },
    });

    await logAudit({
      action: 'report_scheduled',
      actorUserId: req.admin!.id,
      actorTeamId: 'admin',
      metadata: {
        reportId: report.id,
        name: report.name,
        reportType: report.reportType,
        frequency: report.frequency,
      },
    });

    res.status(201).json({
      id: report.id,
      name: report.name,
      report_type: report.reportType,
      frequency: report.frequency,
      slack_channel_id: report.slackChannelId,
      filters: report.filters,
      is_active: report.isActive,
      last_run_at: report.lastRunAt,
      last_error: report.lastError,
      created_by: { id: report.creator.id, name: report.creator.name },
    });
  } catch (error) {
    res.status(500).json({
      error: 'internal_error',
      message: 'An unexpected error occurred',
    });
  }
});

// PUT /scheduled/:id — Update
reportsRouter.put('/scheduled/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params['id'] as string;
    const { name, report_type, frequency, slack_channel_id, filters, is_active } = req.body;

    const existing = await prisma.scheduledReport.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'not_found', message: 'Scheduled report not found' });
      return;
    }

    if (report_type && !VALID_REPORT_TYPES.includes(report_type)) {
      res.status(400).json({
        error: 'validation_error',
        message: `report_type must be one of: ${VALID_REPORT_TYPES.join(', ')}`,
      });
      return;
    }

    if (frequency && !VALID_FREQUENCIES.includes(frequency)) {
      res.status(400).json({
        error: 'validation_error',
        message: `frequency must be one of: ${VALID_FREQUENCIES.join(', ')}`,
      });
      return;
    }

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (report_type !== undefined) data.reportType = report_type;
    if (frequency !== undefined) data.frequency = frequency;
    if (slack_channel_id !== undefined) data.slackChannelId = slack_channel_id;
    if (filters !== undefined) data.filters = filters;
    if (is_active !== undefined) data.isActive = is_active;

    const updated = await prisma.scheduledReport.update({
      where: { id },
      data,
      include: { creator: { select: { id: true, name: true } } },
    });

    // If frequency changed, update the BullMQ repeatable job.
    if (frequency && frequency !== existing.frequency) {
      if (existing.bullmqJobKey) {
        await adminQueue.removeJobScheduler(existing.bullmqJobKey);
      }
      const cronPattern = getCronForFrequency(frequency);
      const jobKey = `scheduled-report:${id}`;
      await adminQueue.upsertJobScheduler(
        jobKey,
        { pattern: cronPattern },
        {
          name: 'scheduled-report',
          data: { reportId: id },
        },
      );
      await prisma.scheduledReport.update({
        where: { id },
        data: { bullmqJobKey: jobKey },
      });
    }

    res.json({
      id: updated.id,
      name: updated.name,
      report_type: updated.reportType,
      frequency: updated.frequency,
      slack_channel_id: updated.slackChannelId,
      filters: updated.filters,
      is_active: updated.isActive,
      last_run_at: updated.lastRunAt,
      last_error: updated.lastError,
      created_by: { id: updated.creator.id, name: updated.creator.name },
    });
  } catch (error) {
    res.status(500).json({
      error: 'internal_error',
      message: 'An unexpected error occurred',
    });
  }
});

// DELETE /scheduled/:id
reportsRouter.delete('/scheduled/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params['id'] as string;

    const existing = await prisma.scheduledReport.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'not_found', message: 'Scheduled report not found' });
      return;
    }

    // Remove BullMQ repeatable job.
    if (existing.bullmqJobKey) {
      await adminQueue.removeJobScheduler(existing.bullmqJobKey);
    }

    await prisma.scheduledReport.delete({ where: { id } });

    res.status(204).send();
  } catch (error) {
    res.status(500).json({
      error: 'internal_error',
      message: 'An unexpected error occurred',
    });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Maps a report frequency to a cron pattern.
 */
function getCronForFrequency(frequency: string): string {
  switch (frequency) {
    case 'DAILY':
      return '0 2 * * *';       // 02:00 UTC daily
    case 'WEEKLY':
      return '0 2 * * 1';       // 02:00 UTC every Monday
    case 'MONTHLY':
      return '0 2 1 * *';       // 02:00 UTC 1st of month
    default:
      return '0 2 * * 1';       // Default: weekly
  }
}
