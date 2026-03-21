/**
 * AuditAction recorder service (T016).
 *
 * Creates and queries immutable audit trail records for every autonomous
 * agent action. Each record captures the agent name, action taken,
 * confidence score, severity, outcome, and optional execution context.
 */

import type { AuditAction, Severity, AuditOutcome, Prisma } from '@prisma/client';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

const log = logger.withContext({ service: 'auditRecorder' });

/** Parameters for recording a single audit action. */
export interface RecordActionParams {
  /** Name of the autonomous agent that performed the action. */
  agentName: string;
  /** Machine-readable action identifier (e.g. "ecs_task_restart"). */
  action: string;
  /** Self-assessed confidence score (0-1). */
  confidence: number;
  /** Severity classification of the action. */
  severity: Severity;
  /** Outcome of the action (auto-executed, suggested, etc.). */
  outcome: AuditOutcome;
  /** Arbitrary structured metadata about the action. */
  metadata: Record<string, unknown>;
  /** Optional link to a SkillExecution record. */
  specialtyExecutionId?: string;
  /** Optional admin user who triggered or reviewed the action. */
  adminUserId?: string;
}

/**
 * Persists an audit action record to the database.
 *
 * @param params - The action data to record.
 * @returns The created AuditAction record.
 */
export async function recordAction(params: RecordActionParams): Promise<AuditAction> {
  try {
    const record = await prisma.auditAction.create({
      data: {
        agentName: params.agentName,
        action: params.action,
        confidence: params.confidence,
        severity: params.severity,
        outcome: params.outcome,
        metadata: params.metadata as Prisma.InputJsonValue,
        specialtyExecutionId: params.specialtyExecutionId ?? null,
        adminUserId: params.adminUserId ?? null,
      },
    });

    log.info('Audit action recorded', {
      id: record.id,
      agentName: params.agentName,
      action: params.action,
      outcome: params.outcome,
    });

    return record;
  } catch (error) {
    log.error('Failed to record audit action', {
      agentName: params.agentName,
      action: params.action,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/** Filters for querying recent audit actions. */
export interface RecentActionsFilters {
  /** Filter by agent name. */
  agentName?: string;
  /** Filter by severity level. */
  severity?: Severity;
  /** Filter by outcome type. */
  outcome?: AuditOutcome;
  /** Page number (1-based). Defaults to 1. */
  page?: number;
  /** Results per page. Defaults to 25. */
  limit?: number;
}

/** Paginated result set of audit actions. */
export interface RecentActionsResult {
  /** The matching audit action records. */
  actions: AuditAction[];
  /** Total count of records matching the filters (for pagination). */
  total: number;
}

/**
 * Retrieves audit actions from the last N hours with optional filters and pagination.
 *
 * @param hours - Number of hours to look back from now.
 * @param filters - Optional filters for agent name, severity, outcome, and pagination.
 * @returns Paginated list of matching audit actions and the total count.
 */
export async function getRecentActions(
  hours: number,
  filters?: RecentActionsFilters,
): Promise<RecentActionsResult> {
  try {
    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 25;
    const skip = (page - 1) * limit;

    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const where: Prisma.AuditActionWhereInput = {
      timestamp: { gte: since },
      ...(filters?.agentName ? { agentName: filters.agentName } : {}),
      ...(filters?.severity ? { severity: filters.severity } : {}),
      ...(filters?.outcome ? { outcome: filters.outcome } : {}),
    };

    const [actions, total] = await Promise.all([
      prisma.auditAction.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
      }),
      prisma.auditAction.count({ where }),
    ]);

    log.debug('Retrieved recent audit actions', {
      hours,
      total,
      page,
      limit,
      returned: actions.length,
    });

    return { actions, total };
  } catch (error) {
    log.error('Failed to retrieve recent audit actions', {
      hours,
      filters,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
