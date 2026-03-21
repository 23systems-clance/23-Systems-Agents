/**
 * Skill Executor Service (Feature 39 - Vertical Pack Platform)
 *
 * Full execution pipeline: validate input -> check spend limit ->
 * invoke agent -> run MCP tool calls -> format output -> deliver ->
 * log execution trace -> publish chain event (FR-012, FR-013, FR-021).
 */

import { prisma } from '../../models/index.js';
import { skillExecutionQueue } from '../queue/queues.js';
import { invokeAgent, type InvocationResult } from './agentInvoker.js';
import { invokeTool } from './mcpToolRunner.js';
import { checkDailySpendLimit, incrementDailySpend } from './spendLimiter.js';
import { checkCredits, deductCredits } from './creditGate.js';
import { evaluateAction } from '../autonomous/confidenceGate.js';
import { recordAction } from '../autonomous/auditRecorder.js';
import { createPendingAction } from '../autonomous/suggestOnlyManager.js';
import type { AutonomousAgentOutput } from '../../lib/autonomous/types.js';
import logger from '../../lib/logger.js';
import type { SkillExecutionStatus } from '@prisma/client';

const log = logger.withContext({ service: 'skillExecutor' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecutionInput {
  executionId: string;
  skillId: string;
  slackTeamId: string;
  slackUserId?: string;
  input?: Record<string, unknown>;
  packSubscriptionId?: string;
  triggeredBy?: string;
}

export interface ExecutionResult {
  executionId: string;
  status: SkillExecutionStatus;
  output: unknown;
  creditsCost: number;
  durationMs: number;
  error?: string;
  trace: {
    agentInvocations: Array<{
      versionId: string;
      tokensInput: number;
      tokensOutput: number;
      costUsd: number;
      durationMs: number;
    }>;
    toolCalls: Array<{
      toolId: string;
      toolName: string;
      durationMs: number;
      statusCode: number;
      error?: string;
    }>;
  };
}

// ---------------------------------------------------------------------------
// Core Execution (T032)
// ---------------------------------------------------------------------------

/**
 * Execute a skill end-to-end.
 * Creates SkillExecution + AgentInvocation records.
 */
export async function executeSkill(input: ExecutionInput): Promise<ExecutionResult> {
  const startTime = Date.now();
  const trace: ExecutionResult['trace'] = { agentInvocations: [], toolCalls: [] };

  // Load skill with agent version
  const skill = await prisma.skill.findUnique({
    where: { id: input.skillId },
    include: {
      agentVersion: true,
      agent: true,
    },
  });

  if (!skill) {
    await markExecution(input.executionId, 'FAILED', null, 0, Date.now() - startTime, 'Skill not found');
    throw new Error(`Skill ${input.skillId} not found`);
  }

  if (skill.status !== 'PUBLISHED' && skill.status !== 'TESTING') {
    await markExecution(input.executionId, 'FAILED', null, 0, Date.now() - startTime, `Skill is ${skill.status}`);
    throw new Error(`Skill ${input.skillId} is ${skill.status}, must be PUBLISHED or TESTING`);
  }

  // Mark execution as RUNNING
  await prisma.skillExecution.update({
    where: { id: input.executionId },
    data: { status: 'RUNNING' },
  });

  try {
    // Check spend limit (FR-025)
    const estimatedCost = Number(skill.creditCost);
    const spendCheck = await checkDailySpendLimit(input.slackTeamId, estimatedCost);
    if (!spendCheck.allowed) {
      await markExecution(input.executionId, 'FAILED', null, 0, Date.now() - startTime, spendCheck.reason);
      throw new Error(spendCheck.reason ?? 'Daily spend limit exceeded');
    }

    // Credit gate check (FR-014, T044) — skip for sandbox tests
    let resolvedSubscriptionId = input.packSubscriptionId;
    if (input.slackTeamId !== 'sandbox' && !resolvedSubscriptionId) {
      const creditCheck = await checkCredits(input.skillId, input.slackTeamId);
      if (!creditCheck.allowed) {
        await markExecution(input.executionId, 'FAILED', null, 0, Date.now() - startTime, creditCheck.reason);
        throw new Error(creditCheck.reason ?? 'Insufficient credits');
      }
      resolvedSubscriptionId = creditCheck.packSubscriptionId;
    }

    // Invoke agent (FR-005)
    log.info('Executing skill agent', {
      skillId: skill.id,
      agentVersionId: skill.agentVersionId,
      executionId: input.executionId,
    });

    const agentResult = await invokeAgent(skill.agentVersionId, input.input ?? {});

    // Record agent invocation
    const invocation = await prisma.agentInvocation.create({
      data: {
        executionId: input.executionId,
        agentVersionId: skill.agentVersionId,
        input: (input.input ?? {}) as any,
        output: agentResult.output as any ?? {},
        tokensInput: agentResult.tokensInput,
        tokensOutput: agentResult.tokensOutput,
        costUsd: agentResult.costUsd,
        modelId: agentResult.modelId,
        durationMs: agentResult.durationMs,
      },
    });

    trace.agentInvocations.push({
      versionId: skill.agentVersionId,
      tokensInput: agentResult.tokensInput,
      tokensOutput: agentResult.tokensOutput,
      costUsd: agentResult.costUsd,
      durationMs: agentResult.durationMs,
    });

    // Run MCP tool calls if agent made any (FR-010)
    const mcpToolIds = skill.mcpToolIds as string[];
    for (const toolCall of agentResult.toolCallsMade) {
      // Find matching tool by name from skill's registered tools
      const matchingTool = await prisma.mcpTool.findFirst({
        where: {
          id: { in: mcpToolIds },
          name: toolCall.toolName,
        },
      });

      if (matchingTool) {
        const toolResult = await invokeTool(
          matchingTool.id,
          toolCall.input as Record<string, unknown>,
          input.slackTeamId,
        );

        trace.toolCalls.push({
          toolId: matchingTool.id,
          toolName: matchingTool.name,
          durationMs: toolResult.durationMs,
          statusCode: toolResult.statusCode,
          error: toolResult.error,
        });
      }
    }

    // Increment daily spend
    await incrementDailySpend(input.slackTeamId, agentResult.costUsd);

    const durationMs = Date.now() - startTime;
    const creditsCost = Number(skill.creditCost);

    // Deduct pack credits (T044) — skip for sandbox
    if (resolvedSubscriptionId && input.slackTeamId !== 'sandbox') {
      await deductCredits(resolvedSubscriptionId, creditsCost, input.executionId);
    }

    // Autonomous agent confidence gate (T029)
    // Check if agent is in suggest-only mode and output qualifies for gating.
    if (skill.agent && isAutonomousAgentOutput(agentResult.output)) {
      const gateResult = evaluateAction(skill.agent, agentResult.output);

      // Record every autonomous agent execution in the audit trail
      try {
        await recordAction({
          agentName: skill.agent.name,
          action: agentResult.output.action,
          confidence: agentResult.output.confidence,
          severity: agentResult.output.confidence >= 0.85 ? 'INFO' : agentResult.output.confidence >= 0.50 ? 'WARNING' : 'HIGH',
          outcome: gateResult.decision === 'auto_execute' ? 'AUTO_EXECUTED' : gateResult.decision === 'suggest' ? 'SUGGESTED' : 'ESCALATED',
          metadata: {
            rationale: agentResult.output.rationale,
            ...agentResult.output.data,
          },
          specialtyExecutionId: input.executionId,
        });
      } catch (auditErr) {
        log.error('Failed to record audit action', {
          error: auditErr instanceof Error ? auditErr.message : String(auditErr),
        });
      }

      if (gateResult.decision === 'suggest') {
        // Create pending action for admin review
        try {
          await createPendingAction({
            agent: skill.agent,
            output: agentResult.output,
            executionId: input.executionId,
          });
        } catch (pendingErr) {
          log.error('Failed to create pending action', {
            error: pendingErr instanceof Error ? pendingErr.message : String(pendingErr),
          });
        }

        // Mark execution as AWAITING_APPROVAL
        await markExecution(
          input.executionId,
          'AWAITING_APPROVAL',
          agentResult.output,
          creditsCost,
          durationMs,
        );

        log.info('Skill execution awaiting approval (suggest-only mode)', {
          skillId: skill.id,
          executionId: input.executionId,
          confidence: agentResult.output.confidence,
        });

        return {
          executionId: input.executionId,
          status: 'AWAITING_APPROVAL',
          output: agentResult.output,
          creditsCost,
          durationMs,
          trace,
        };
      }
      // 'auto_execute' → proceed to COMPLETED below
      // 'escalate' → proceed to COMPLETED with note (escalation handled by audit record)
    }

    // Mark execution as COMPLETED
    await markExecution(
      input.executionId,
      'COMPLETED',
      agentResult.output,
      creditsCost,
      durationMs,
    );

    // Chain event (T034) — if skill has chainEventName, enqueue downstream skills
    if (skill.chainEventName) {
      await publishChainEvent(skill.chainEventName, agentResult.output, input.slackTeamId, input.slackUserId);
    }

    log.info('Skill execution complete', {
      skillId: skill.id,
      executionId: input.executionId,
      durationMs,
      creditsCost,
    });

    return {
      executionId: input.executionId,
      status: 'COMPLETED',
      output: agentResult.output,
      creditsCost,
      durationMs,
      trace,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Only mark as failed if not already marked
    try {
      await markExecution(input.executionId, 'FAILED', null, 0, durationMs, errorMessage);
    } catch {
      // Already marked
    }

    log.error('Skill execution failed', {
      skillId: skill.id,
      executionId: input.executionId,
      error: errorMessage,
      durationMs,
    });

    throw error;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Update SkillExecution record status.
 */
async function markExecution(
  executionId: string,
  status: SkillExecutionStatus,
  output: unknown,
  creditsCost: number,
  durationMs: number,
  error?: string,
) {
  await prisma.skillExecution.update({
    where: { id: executionId },
    data: {
      status,
      output: output as any ?? undefined,
      creditsCost,
      errorMessage: error,
      completedAt: status === 'COMPLETED' || status === 'FAILED' ? new Date() : undefined,
    },
  });
}

// ---------------------------------------------------------------------------
// Skill Chaining (T034)
// ---------------------------------------------------------------------------

/**
 * Publish a chain event to trigger downstream skills.
 * Finds all PUBLISHED skills with triggerType=EVENT that match
 * the event name and enqueues them as new skill execution jobs.
 */
async function publishChainEvent(
  eventName: string,
  eventPayload: unknown,
  slackTeamId: string,
  slackUserId?: string,
): Promise<void> {
  // Find downstream skills listening for this event
  const downstreamSkills = await prisma.skill.findMany({
    where: {
      status: 'PUBLISHED',
      triggerType: 'EVENT',
      triggerConfig: {
        path: ['eventName'],
        equals: eventName,
      },
    },
  });

  if (downstreamSkills.length === 0) return;

  log.info('Publishing chain event', {
    eventName,
    downstreamCount: downstreamSkills.length,
  });

  for (const downstream of downstreamSkills) {
    // Create execution record
    const execution = await prisma.skillExecution.create({
      data: {
        skillId: downstream.id,
        slackTeamId,
        slackUserId,
        triggerType: 'EVENT',
        triggerSource: eventName,
        input: { chainEvent: eventName, payload: eventPayload } as any,
        status: 'QUEUED',
      },
    });

    // Enqueue
    await skillExecutionQueue.add('skill-execution', {
      executionId: execution.id,
      skillId: downstream.id,
      slackTeamId,
      slackUserId,
      input: { chainEvent: eventName, payload: eventPayload },
    });
  }
}

/**
 * Type guard that checks whether agent output conforms to the
 * AutonomousAgentOutput shape (has confidence, action, rationale).
 * This distinguishes autonomous agent outputs from generic skill outputs.
 */
function isAutonomousAgentOutput(output: unknown): output is AutonomousAgentOutput {
  if (!output || typeof output !== 'object') return false;
  const o = output as Record<string, unknown>;
  return (
    typeof o.confidence === 'number' &&
    typeof o.action === 'string' &&
    typeof o.rationale === 'string'
  );
}
