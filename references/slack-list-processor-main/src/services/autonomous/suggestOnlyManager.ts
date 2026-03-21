/**
 * Suggest-only mode manager service (T019).
 *
 * Manages the lifecycle of pending actions that require admin approval
 * before execution. Handles creation, approval, rejection, and automatic
 * graduation from suggest-only mode when an agent demonstrates sufficient
 * reliability (>= 90 % approval over 50+ reviewed actions).
 *
 * Slack notification delivery is intentionally NOT handled here -- callers
 * or a dedicated notification layer are responsible for posting messages.
 */

import type {
  Agent,
  PendingAction,
  PendingActionStatus,
  Prisma,
} from '@prisma/client';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';
import type { AutonomousAgentOutput } from '../../lib/autonomous/types.js';
import { GRADUATION_CRITERIA } from '../../lib/autonomous/types.js';

const log = logger.withContext({ service: 'suggestOnlyManager' });

// -------------------------------------------------------------------------
// Create Pending Action
// -------------------------------------------------------------------------

/** Parameters for creating a pending action. */
export interface CreatePendingActionParams {
  /** The agent that produced the recommendation. */
  agent: Agent;
  /** The agent's structured output. */
  output: AutonomousAgentOutput;
  /** Optional linked SkillExecution ID. */
  executionId?: string;
}

/**
 * Creates a PendingAction record with status PENDING.
 *
 * Does NOT post Slack messages -- that responsibility lies with the caller
 * or a separate notification step.
 *
 * @param params - Agent, output, and optional execution context.
 * @returns The created PendingAction record.
 */
export async function createPendingAction(
  params: CreatePendingActionParams,
): Promise<PendingAction> {
  try {
    const { agent, output, executionId } = params;

    const pendingAction = await prisma.pendingAction.create({
      data: {
        agentName: agent.name,
        action: output.action,
        confidence: output.confidence,
        metadata: {
          rationale: output.rationale,
          ...output.data,
        } as Prisma.InputJsonValue,
        specialtyExecutionId: executionId ?? null,
        status: 'PENDING',
      },
    });

    log.info('Pending action created', {
      id: pendingAction.id,
      agentName: agent.name,
      action: output.action,
      confidence: output.confidence,
    });

    return pendingAction;
  } catch (error) {
    log.error('Failed to create pending action', {
      agentName: params.agent.name,
      action: params.output.action,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// -------------------------------------------------------------------------
// Approval
// -------------------------------------------------------------------------

/**
 * Approves a pending action and increments the agent's approval counter.
 *
 * After incrementing, evaluates whether the agent qualifies for graduation
 * out of suggest-only mode.
 *
 * @param pendingActionId - UUID of the PendingAction to approve.
 * @param adminUserId - Identifier of the approving admin.
 * @returns The updated PendingAction record.
 */
export async function processApproval(
  pendingActionId: string,
  adminUserId: string,
): Promise<PendingAction> {
  try {
    const updatedAction = await prisma.$transaction(async (tx) => {
      const action = await tx.pendingAction.update({
        where: { id: pendingActionId },
        data: {
          status: 'APPROVED',
          reviewedBy: adminUserId,
          reviewedAt: new Date(),
        },
      });

      // Find the agent by name to increment approval counter.
      const agent = await tx.agent.findFirst({
        where: { name: action.agentName },
      });

      if (agent) {
        await tx.agent.update({
          where: { id: agent.id },
          data: {
            suggestOnlyApprovals: { increment: 1 },
          },
        });
      }

      return action;
    });

    log.info('Pending action approved', {
      id: pendingActionId,
      agentName: updatedAction.agentName,
      adminUserId,
    });

    // Check graduation outside the transaction to avoid holding locks.
    const agent = await prisma.agent.findFirst({
      where: { name: updatedAction.agentName },
    });
    if (agent) {
      await checkGraduation(agent.id);
    }

    return updatedAction;
  } catch (error) {
    log.error('Failed to process approval', {
      pendingActionId,
      adminUserId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// -------------------------------------------------------------------------
// Rejection
// -------------------------------------------------------------------------

/**
 * Rejects a pending action and increments the agent's rejection counter.
 *
 * After incrementing, evaluates whether the agent qualifies for graduation
 * out of suggest-only mode (unlikely after a rejection, but keeps counters
 * up to date).
 *
 * @param pendingActionId - UUID of the PendingAction to reject.
 * @param adminUserId - Identifier of the rejecting admin.
 * @param reason - Optional reason for the rejection.
 * @returns The updated PendingAction record.
 */
export async function processRejection(
  pendingActionId: string,
  adminUserId: string,
  reason?: string,
): Promise<PendingAction> {
  try {
    const updatedAction = await prisma.$transaction(async (tx) => {
      const updateData: Prisma.PendingActionUpdateInput = {
        status: 'REJECTED',
        reviewedBy: adminUserId,
        reviewedAt: new Date(),
      };

      // Store rejection reason in metadata if provided.
      if (reason) {
        const existing = await tx.pendingAction.findUniqueOrThrow({
          where: { id: pendingActionId },
        });
        const currentMeta =
          (existing.metadata as Record<string, unknown>) ?? {};
        updateData.metadata = {
          ...currentMeta,
          rejectionReason: reason,
        } as Prisma.InputJsonValue;
      }

      const action = await tx.pendingAction.update({
        where: { id: pendingActionId },
        data: updateData,
      });

      // Find the agent by name to increment rejection counter.
      const agent = await tx.agent.findFirst({
        where: { name: action.agentName },
      });

      if (agent) {
        await tx.agent.update({
          where: { id: agent.id },
          data: {
            suggestOnlyRejections: { increment: 1 },
          },
        });
      }

      return action;
    });

    log.info('Pending action rejected', {
      id: pendingActionId,
      agentName: updatedAction.agentName,
      adminUserId,
      reason: reason ?? null,
    });

    // Check graduation outside the transaction.
    const agent = await prisma.agent.findFirst({
      where: { name: updatedAction.agentName },
    });
    if (agent) {
      await checkGraduation(agent.id);
    }

    return updatedAction;
  } catch (error) {
    log.error('Failed to process rejection', {
      pendingActionId,
      adminUserId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// -------------------------------------------------------------------------
// Graduation
// -------------------------------------------------------------------------

/**
 * Evaluates whether an agent has met the graduation criteria to exit
 * suggest-only mode and operate autonomously.
 *
 * Graduation requires:
 * - At least GRADUATION_CRITERIA.MIN_REVIEWS total reviews (approvals + rejections).
 * - An approval rate >= GRADUATION_CRITERIA.MIN_APPROVAL_RATE.
 *
 * If criteria are met, suggestOnlyMode is set to false on the agent record.
 *
 * @param agentId - UUID of the Agent to evaluate.
 * @returns True if the agent graduated, false otherwise.
 */
export async function checkGraduation(agentId: string): Promise<boolean> {
  try {
    const agent = await prisma.agent.findUniqueOrThrow({
      where: { id: agentId },
    });

    const totalReviewed =
      agent.suggestOnlyApprovals + agent.suggestOnlyRejections;

    if (totalReviewed < GRADUATION_CRITERIA.MIN_REVIEWS) {
      log.debug('Agent has not reached minimum reviews for graduation', {
        agentId,
        agentName: agent.name,
        totalReviewed,
        required: GRADUATION_CRITERIA.MIN_REVIEWS,
      });
      return false;
    }

    const approvalRate =
      totalReviewed > 0 ? agent.suggestOnlyApprovals / totalReviewed : 0;

    if (approvalRate < GRADUATION_CRITERIA.MIN_APPROVAL_RATE) {
      log.debug('Agent approval rate below graduation threshold', {
        agentId,
        agentName: agent.name,
        approvalRate,
        required: GRADUATION_CRITERIA.MIN_APPROVAL_RATE,
      });
      return false;
    }

    // Agent qualifies -- graduate to full autonomy.
    await prisma.agent.update({
      where: { id: agentId },
      data: { suggestOnlyMode: false },
    });

    log.info('Agent graduated from suggest-only mode', {
      agentId,
      agentName: agent.name,
      totalReviewed,
      approvalRate,
    });

    return true;
  } catch (error) {
    log.error('Failed to check graduation criteria', {
      agentId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// -------------------------------------------------------------------------
// Query
// -------------------------------------------------------------------------

/** Filters for querying pending actions. */
export interface GetPendingActionsFilters {
  /** Filter by agent name. */
  agentName?: string;
  /** Filter by action status. */
  status?: PendingActionStatus;
  /** Page number (1-based). Defaults to 1. */
  page?: number;
  /** Results per page. Defaults to 25. */
  limit?: number;
}

/** Paginated result set of pending actions. */
export interface GetPendingActionsResult {
  /** The matching pending action records. */
  actions: PendingAction[];
  /** Total count of records matching the filters (for pagination). */
  total: number;
}

/**
 * Retrieves pending actions with optional filters and pagination.
 *
 * @param filters - Optional filters for agent name, status, and pagination.
 * @returns Paginated list of matching pending actions and the total count.
 */
export async function getPendingActions(
  filters?: GetPendingActionsFilters,
): Promise<GetPendingActionsResult> {
  try {
    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 25;
    const skip = (page - 1) * limit;

    const where: Prisma.PendingActionWhereInput = {
      ...(filters?.agentName ? { agentName: filters.agentName } : {}),
      ...(filters?.status ? { status: filters.status } : {}),
    };

    const [actions, total] = await Promise.all([
      prisma.pendingAction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.pendingAction.count({ where }),
    ]);

    log.debug('Retrieved pending actions', {
      total,
      page,
      limit,
      returned: actions.length,
    });

    return { actions, total };
  } catch (error) {
    log.error('Failed to retrieve pending actions', {
      filters,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
