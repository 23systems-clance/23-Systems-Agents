/**
 * Infrastructure Maintenance Agent (T045-T050).
 *
 * Platform agent that runs on a SCHEDULED trigger (every 5 minutes via BullMQ).
 * Detects recently stopped ECS tasks, classifies failures, and either
 * auto-restarts transient failures or escalates code bugs to GitHub issues.
 *
 * Restart tracking: maintains an in-memory restart counter per task definition
 * ARN. After 3 failed restarts for the same task definition, further failures
 * are escalated to GitHub instead of retried.
 *
 * Kill switch: honours the AUTONOMOUS_AGENTS_ENABLED env var. When disabled,
 * actions are logged as SUGGESTED but never executed.
 */

import logger from '../../../lib/logger.js';
import type { AutonomousAgentOutput } from '../../../lib/autonomous/types.js';
import {
  AGENT_NAMES,
  AUDIT_ACTION_TYPES,
  SYSTEM_EVENT_TYPES,
} from '../../../lib/autonomous/types.js';
import {
  listStoppedTasks,
  describeTaskDetails,
  classifyFailure,
  restartTask,
} from '../tools/ecsOperations.js';
import type { TaskDetail } from '../tools/ecsOperations.js';
import { queryErrorLogs, getLogLink } from '../tools/cloudWatchLogs.js';
import { createIssue, buildIssueBody } from '../tools/githubIssues.js';
import { retryWithBackoff } from '../tools/retryWithBackoff.js';
import { recordAction } from '../auditRecorder.js';
import { emitEvent } from '../systemEventEmitter.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const log = logger.withContext({ service: 'infrastructureMaintenance' });

/** Agent name constant used in audit and event records. */
const AGENT_NAME = AGENT_NAMES.INFRASTRUCTURE_MAINTENANCE;

/** Maximum number of automatic restarts per task definition before escalation. */
const MAX_RESTARTS = 3;

/** Confidence threshold above which transient failures are auto-restarted. */
const TRANSIENT_AUTO_RESTART_THRESHOLD = 0.85;

/** Confidence threshold below which failures are treated as code bugs. */
const CODE_BUG_ESCALATION_THRESHOLD = 0.50;

/** ECS cluster name from environment, defaults to production cluster. */
const ECS_CLUSTER = process.env.ECS_CLUSTER ?? 'prod-slack-list-processor';

/** CloudWatch log group for fetching error context. */
const LOG_GROUP = process.env.CW_LOG_GROUP ?? '/ecs/prod-slack-list-processor';

// ---------------------------------------------------------------------------
// Restart Tracker (in-memory)
// ---------------------------------------------------------------------------

/**
 * Tracks restart attempts per task definition ARN.
 * Key: task definition ARN (without revision suffix for grouping).
 * Value: array of restart attempt records.
 */
interface RestartRecord {
  /** ISO-8601 timestamp of the restart attempt. */
  timestamp: string;
  /** Whether the restart succeeded (RunTask returned a new task ARN). */
  success: boolean;
  /** The original stopped task ARN that triggered the restart. */
  stoppedTaskArn: string;
  /** The new task ARN if restart succeeded, or error message if it failed. */
  result: string;
}

const restartTracker = new Map<string, RestartRecord[]>();

/**
 * Returns the number of restart attempts for a given task definition ARN.
 *
 * @param taskDefinitionArn - The task definition ARN to look up.
 * @returns The number of recorded restart attempts.
 */
function getRestartCount(taskDefinitionArn: string): number {
  return restartTracker.get(taskDefinitionArn)?.length ?? 0;
}

/**
 * Records a restart attempt for a task definition ARN.
 *
 * @param taskDefinitionArn - The task definition ARN.
 * @param record - The restart attempt details.
 */
function trackRestart(taskDefinitionArn: string, record: RestartRecord): void {
  const existing = restartTracker.get(taskDefinitionArn) ?? [];
  existing.push(record);
  restartTracker.set(taskDefinitionArn, existing);
}

/**
 * Returns all restart records for a task definition ARN.
 *
 * @param taskDefinitionArn - The task definition ARN.
 * @returns Array of restart records, or empty array if none.
 */
function getRestartHistory(taskDefinitionArn: string): RestartRecord[] {
  return restartTracker.get(taskDefinitionArn) ?? [];
}

// ---------------------------------------------------------------------------
// Kill Switch
// ---------------------------------------------------------------------------

/**
 * Checks whether autonomous agents are enabled via the AUTONOMOUS_AGENTS_ENABLED
 * environment variable.
 *
 * @returns True if agents are enabled (env var is "true" or "1"), false otherwise.
 */
function isKillSwitchActive(): boolean {
  const value = process.env.AUTONOMOUS_AGENTS_ENABLED;
  return value !== 'true' && value !== '1';
}

// ---------------------------------------------------------------------------
// Core Logic
// ---------------------------------------------------------------------------

/** Input parameters for the infrastructure maintenance agent. */
export interface InfrastructureMaintenanceInput {
  /** Optional ECS cluster override (defaults to ECS_CLUSTER env var). */
  cluster?: string;
  /** Optional CloudWatch log group override (defaults to CW_LOG_GROUP env var). */
  logGroup?: string;
}

/**
 * Executes the Infrastructure Maintenance agent.
 *
 * Scans for recently stopped ECS tasks, classifies each failure, and takes
 * the appropriate action:
 *
 * - **Transient failures** (confidence >= 0.85): auto-restart via RunTask,
 *   up to 3 times per task definition. On the 4th failure, escalate instead.
 * - **Code bugs** (confidence < 0.50): create a GitHub issue with task
 *   details and CloudWatch log links.
 * - **Kill switch active**: log all actions as SUGGESTED without executing.
 *
 * @param params - Input parameters containing optional cluster/logGroup overrides.
 * @returns An AutonomousAgentOutput summarising the actions taken.
 */
export async function execute(params: {
  input: InfrastructureMaintenanceInput;
}): Promise<AutonomousAgentOutput> {
  const cluster = params.input.cluster ?? ECS_CLUSTER;
  const logGroup = params.input.logGroup ?? LOG_GROUP;
  const killSwitchActive = isKillSwitchActive();

  log.info('Infrastructure maintenance agent starting', {
    cluster,
    logGroup,
    killSwitchActive,
  });

  const results: Record<string, unknown>[] = [];
  let totalActions = 0;

  try {
    // Step 1: List all stopped tasks in the cluster
    const stoppedTaskArns = await retryWithBackoff(
      () => listStoppedTasks(cluster),
      {
        operationName: 'listStoppedTasks',
        agentName: AGENT_NAME,
      },
    );

    if (stoppedTaskArns.length === 0) {
      log.info('No stopped tasks found', { cluster });
      return {
        confidence: 1.0,
        action: 'no_action',
        rationale: 'No stopped tasks detected in the cluster.',
        data: { cluster, stoppedTaskCount: 0 },
      };
    }

    // Step 2: Describe task details for all stopped tasks
    const taskDetails = await retryWithBackoff(
      () => describeTaskDetails(cluster, stoppedTaskArns),
      {
        operationName: 'describeTaskDetails',
        agentName: AGENT_NAME,
      },
    );

    // Step 3: Process each stopped task
    for (const task of taskDetails) {
      const result = await processStoppedTask(
        task,
        cluster,
        logGroup,
        killSwitchActive,
      );
      results.push(result);
      if (result.actionTaken !== 'no_action') {
        totalActions++;
      }
    }

    const summary = buildSummary(results);

    log.info('Infrastructure maintenance agent completed', {
      cluster,
      stoppedTaskCount: stoppedTaskArns.length,
      actionsPerformed: totalActions,
    });

    return {
      confidence: summary.overallConfidence,
      action: totalActions > 0 ? 'infrastructure_maintenance' : 'no_action',
      rationale: summary.rationale,
      data: {
        cluster,
        stoppedTaskCount: stoppedTaskArns.length,
        actionsPerformed: totalActions,
        results,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Infrastructure maintenance agent failed', {
      cluster,
      error: errorMessage,
    });

    return {
      confidence: 0,
      action: 'agent_error',
      rationale: `Infrastructure maintenance agent encountered an error: ${errorMessage}`,
      data: { cluster, error: errorMessage },
    };
  }
}

// ---------------------------------------------------------------------------
// Per-Task Processing
// ---------------------------------------------------------------------------

/**
 * Processes a single stopped ECS task: classifies the failure, decides on
 * restart vs. escalation, and records the action taken.
 *
 * @param task - The stopped task details.
 * @param cluster - ECS cluster name.
 * @param logGroup - CloudWatch log group name.
 * @param killSwitchActive - Whether the kill switch is active (dry-run mode).
 * @returns A record summarising the action taken for this task.
 */
async function processStoppedTask(
  task: TaskDetail,
  cluster: string,
  logGroup: string,
  killSwitchActive: boolean,
): Promise<Record<string, unknown>> {
  const classification = classifyFailure(task.stopReason, task.exitCode);
  const restartCount = getRestartCount(task.taskDefinitionArn);

  log.info('Processing stopped task', {
    taskArn: task.taskArn,
    taskDefinitionArn: task.taskDefinitionArn,
    stopReason: task.stopReason,
    exitCode: task.exitCode,
    classificationType: classification.type,
    classificationConfidence: classification.confidence,
    restartCount,
  });

  // Case 1: Transient failure eligible for restart (within restart limit)
  if (
    classification.type === 'transient' &&
    classification.confidence >= TRANSIENT_AUTO_RESTART_THRESHOLD &&
    restartCount < MAX_RESTARTS
  ) {
    return handleTransientRestart(
      task,
      cluster,
      classification.confidence,
      killSwitchActive,
    );
  }

  // Case 2: Transient failure that exceeded restart limit -- escalate
  if (
    classification.type === 'transient' &&
    restartCount >= MAX_RESTARTS
  ) {
    return handleRestartLimitEscalation(
      task,
      cluster,
      logGroup,
      classification.confidence,
      killSwitchActive,
    );
  }

  // Case 3: Code bug -- escalate to GitHub issue
  if (
    classification.type === 'code_bug' &&
    classification.confidence >= CODE_BUG_ESCALATION_THRESHOLD
  ) {
    return handleCodeBugEscalation(
      task,
      cluster,
      logGroup,
      classification.confidence,
      killSwitchActive,
    );
  }

  // Case 4: Low-confidence or ambiguous classification -- escalate
  return handleCodeBugEscalation(
    task,
    cluster,
    logGroup,
    classification.confidence,
    killSwitchActive,
  );
}

// ---------------------------------------------------------------------------
// Action Handlers
// ---------------------------------------------------------------------------

/**
 * Handles a transient failure by restarting the ECS task.
 *
 * If the kill switch is active, logs the action as SUGGESTED without executing.
 *
 * @param task - The stopped task details.
 * @param cluster - ECS cluster name.
 * @param confidence - Classification confidence score.
 * @param killSwitchActive - Whether the kill switch is active.
 * @returns A summary record of the action taken.
 */
async function handleTransientRestart(
  task: TaskDetail,
  cluster: string,
  confidence: number,
  killSwitchActive: boolean,
): Promise<Record<string, unknown>> {
  const restartCount = getRestartCount(task.taskDefinitionArn);

  if (killSwitchActive) {
    log.info('Kill switch active: would restart task (dry-run)', {
      taskArn: task.taskArn,
      taskDefinitionArn: task.taskDefinitionArn,
    });

    await recordAction({
      agentName: AGENT_NAME,
      action: AUDIT_ACTION_TYPES.ECS_TASK_RESTART,
      confidence,
      severity: 'WARNING',
      outcome: 'SUGGESTED',
      metadata: {
        taskArn: task.taskArn,
        taskDefinitionArn: task.taskDefinitionArn,
        stopReason: task.stopReason,
        exitCode: task.exitCode,
        restartAttempt: restartCount + 1,
        dryRun: true,
        reason: 'Kill switch active - would restart task',
      },
    });

    await emitEvent({
      type: SYSTEM_EVENT_TYPES.INFRASTRUCTURE_AUTO_HEAL,
      severity: 'INFO',
      message: `[DRY RUN] Would restart task ${task.taskArn} (attempt ${restartCount + 1}/${MAX_RESTARTS})`,
      metadata: {
        taskArn: task.taskArn,
        taskDefinitionArn: task.taskDefinitionArn,
        dryRun: true,
      },
      agentName: AGENT_NAME,
    });

    return {
      taskArn: task.taskArn,
      actionTaken: 'would_restart',
      dryRun: true,
      restartAttempt: restartCount + 1,
    };
  }

  // Execute restart
  try {
    const newTaskArn = await retryWithBackoff(
      () => restartTask(cluster, task.taskDefinitionArn, task.networkConfig),
      {
        operationName: 'restartTask',
        agentName: AGENT_NAME,
      },
    );

    trackRestart(task.taskDefinitionArn, {
      timestamp: new Date().toISOString(),
      success: true,
      stoppedTaskArn: task.taskArn,
      result: newTaskArn,
    });

    // T049: Record audit action
    await recordAction({
      agentName: AGENT_NAME,
      action: AUDIT_ACTION_TYPES.ECS_TASK_RESTART,
      confidence,
      severity: 'WARNING',
      outcome: 'AUTO_EXECUTED',
      metadata: {
        taskArn: task.taskArn,
        taskDefinitionArn: task.taskDefinitionArn,
        newTaskArn,
        stopReason: task.stopReason,
        exitCode: task.exitCode,
        restartAttempt: restartCount + 1,
      },
    });

    // T049: Emit system event
    await emitEvent({
      type: SYSTEM_EVENT_TYPES.INFRASTRUCTURE_AUTO_HEAL,
      severity: 'WARNING',
      message: `Auto-restarted task ${task.taskArn} as ${newTaskArn} (attempt ${restartCount + 1}/${MAX_RESTARTS})`,
      metadata: {
        taskArn: task.taskArn,
        newTaskArn,
        taskDefinitionArn: task.taskDefinitionArn,
        restartAttempt: restartCount + 1,
      },
      agentName: AGENT_NAME,
    });

    log.info('Task restarted successfully', {
      taskArn: task.taskArn,
      newTaskArn,
      restartAttempt: restartCount + 1,
    });

    return {
      taskArn: task.taskArn,
      actionTaken: 'restarted',
      newTaskArn,
      restartAttempt: restartCount + 1,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    trackRestart(task.taskDefinitionArn, {
      timestamp: new Date().toISOString(),
      success: false,
      stoppedTaskArn: task.taskArn,
      result: errorMessage,
    });

    log.error('Failed to restart task', {
      taskArn: task.taskArn,
      error: errorMessage,
    });

    return {
      taskArn: task.taskArn,
      actionTaken: 'restart_failed',
      error: errorMessage,
      restartAttempt: restartCount + 1,
    };
  }
}

/**
 * Handles escalation after the restart limit (3 restarts) has been exceeded.
 *
 * Creates a GitHub issue with details of all previous restart attempts.
 *
 * @param task - The stopped task details.
 * @param cluster - ECS cluster name.
 * @param logGroup - CloudWatch log group name.
 * @param confidence - Classification confidence score.
 * @param killSwitchActive - Whether the kill switch is active.
 * @returns A summary record of the action taken.
 */
async function handleRestartLimitEscalation(
  task: TaskDetail,
  cluster: string,
  logGroup: string,
  confidence: number,
  killSwitchActive: boolean,
): Promise<Record<string, unknown>> {
  const restartHistory = getRestartHistory(task.taskDefinitionArn);
  const logLink = buildLogLink(task, logGroup);

  // Build issue body with restart history (T048)
  const restartHistorySummary = restartHistory
    .map(
      (r, i) =>
        `${i + 1}. **${r.timestamp}** - ${r.success ? 'Success' : 'Failed'}: ${r.result}`,
    )
    .join('\n');

  const analysis =
    `Task has failed ${restartHistory.length + 1} times after ${MAX_RESTARTS} automatic restart attempts.\n\n` +
    `### Previous Restart Attempts\n${restartHistorySummary}\n\n` +
    `### Latest Failure\n` +
    `- **Stop Reason**: ${task.stopReason}\n` +
    `- **Exit Code**: ${task.exitCode}\n` +
    `- **Stopped At**: ${task.stoppedAt}\n\n` +
    `Manual investigation is required.`;

  if (killSwitchActive) {
    log.info('Kill switch active: would escalate after restart limit (dry-run)', {
      taskArn: task.taskArn,
      restartCount: restartHistory.length,
    });

    await recordAction({
      agentName: AGENT_NAME,
      action: AUDIT_ACTION_TYPES.ECS_TASK_ESCALATION,
      confidence,
      severity: 'HIGH',
      outcome: 'SUGGESTED',
      metadata: {
        taskArn: task.taskArn,
        taskDefinitionArn: task.taskDefinitionArn,
        restartHistory,
        dryRun: true,
        reason: 'Kill switch active - would create GitHub issue after restart limit exceeded',
      },
    });

    return {
      taskArn: task.taskArn,
      actionTaken: 'would_escalate',
      dryRun: true,
      reason: 'restart_limit_exceeded',
      restartHistory,
    };
  }

  try {
    const issueBody = buildIssueBody({
      agentName: AGENT_NAME,
      analysis,
      taskDetails: {
        taskArn: task.taskArn,
        taskDefinitionArn: task.taskDefinitionArn,
        cluster,
        stopReason: task.stopReason,
        exitCode: task.exitCode,
        stoppedAt: task.stoppedAt,
        restartAttempts: restartHistory.length,
      },
      logLink,
    });

    const issue = await retryWithBackoff(
      () =>
        createIssue({
          title: `[Auto] ECS task restart limit exceeded: ${task.taskDefinitionArn.split('/').pop() ?? task.taskDefinitionArn}`,
          body: issueBody,
          labels: ['infrastructure', 'auto-generated'],
        }),
      {
        operationName: 'createGitHubIssue',
        agentName: AGENT_NAME,
      },
    );

    // T049: Record audit action
    await recordAction({
      agentName: AGENT_NAME,
      action: AUDIT_ACTION_TYPES.ECS_TASK_ESCALATION,
      confidence,
      severity: 'HIGH',
      outcome: 'AUTO_EXECUTED',
      metadata: {
        taskArn: task.taskArn,
        taskDefinitionArn: task.taskDefinitionArn,
        issueNumber: issue.issueNumber,
        issueUrl: issue.url,
        restartHistory,
        reason: 'restart_limit_exceeded',
      },
    });

    // T049: Emit system event
    await emitEvent({
      type: SYSTEM_EVENT_TYPES.INFRASTRUCTURE_ESCALATION,
      severity: 'HIGH',
      message: `Escalated task ${task.taskArn} to GitHub issue #${issue.issueNumber} after ${MAX_RESTARTS} failed restarts`,
      metadata: {
        taskArn: task.taskArn,
        issueNumber: issue.issueNumber,
        issueUrl: issue.url,
        restartAttempts: restartHistory.length,
      },
      agentName: AGENT_NAME,
    });

    log.info('Task escalated after restart limit', {
      taskArn: task.taskArn,
      issueNumber: issue.issueNumber,
      issueUrl: issue.url,
    });

    return {
      taskArn: task.taskArn,
      actionTaken: 'escalated',
      reason: 'restart_limit_exceeded',
      issueNumber: issue.issueNumber,
      issueUrl: issue.url,
      restartHistory,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Failed to create escalation issue', {
      taskArn: task.taskArn,
      error: errorMessage,
    });

    return {
      taskArn: task.taskArn,
      actionTaken: 'escalation_failed',
      reason: 'restart_limit_exceeded',
      error: errorMessage,
    };
  }
}

/**
 * Handles a code bug failure by creating a GitHub issue with diagnostic details.
 *
 * @param task - The stopped task details.
 * @param cluster - ECS cluster name.
 * @param logGroup - CloudWatch log group name.
 * @param confidence - Classification confidence score.
 * @param killSwitchActive - Whether the kill switch is active.
 * @returns A summary record of the action taken.
 */
async function handleCodeBugEscalation(
  task: TaskDetail,
  cluster: string,
  logGroup: string,
  confidence: number,
  killSwitchActive: boolean,
): Promise<Record<string, unknown>> {
  const logLink = buildLogLink(task, logGroup);

  // Attempt to fetch recent error logs for additional context
  let errorContext = '';
  try {
    const stoppedAtMs = task.stoppedAt
      ? new Date(task.stoppedAt).getTime()
      : Date.now();
    const logs = await queryErrorLogs({
      logGroupName: logGroup,
      startTime: stoppedAtMs - 5 * 60 * 1000, // 5 minutes before stop
      endTime: stoppedAtMs,
      limit: 10,
    });
    if (logs.length > 0) {
      errorContext =
        '\n\n### Recent Error Logs\n```\n' +
        logs.map((l) => `[${l.level}] ${l.message}`).join('\n') +
        '\n```';
    }
  } catch (logError) {
    log.warn('Failed to fetch error logs for escalation', {
      taskArn: task.taskArn,
      error: logError instanceof Error ? logError.message : String(logError),
    });
  }

  const analysis =
    `Detected a code bug in ECS task.\n\n` +
    `- **Stop Reason**: ${task.stopReason}\n` +
    `- **Exit Code**: ${task.exitCode}\n` +
    `- **Stopped At**: ${task.stoppedAt}\n` +
    `- **Classification Confidence**: ${confidence.toFixed(2)}` +
    errorContext;

  if (killSwitchActive) {
    log.info('Kill switch active: would create GitHub issue for code bug (dry-run)', {
      taskArn: task.taskArn,
    });

    await recordAction({
      agentName: AGENT_NAME,
      action: AUDIT_ACTION_TYPES.GITHUB_ISSUE_CREATED,
      confidence,
      severity: 'HIGH',
      outcome: 'SUGGESTED',
      metadata: {
        taskArn: task.taskArn,
        taskDefinitionArn: task.taskDefinitionArn,
        stopReason: task.stopReason,
        exitCode: task.exitCode,
        dryRun: true,
        reason: 'Kill switch active - would create GitHub issue for code bug',
      },
    });

    return {
      taskArn: task.taskArn,
      actionTaken: 'would_escalate',
      dryRun: true,
      reason: 'code_bug',
    };
  }

  try {
    const issueBody = buildIssueBody({
      agentName: AGENT_NAME,
      analysis,
      taskDetails: {
        taskArn: task.taskArn,
        taskDefinitionArn: task.taskDefinitionArn,
        cluster,
        stopReason: task.stopReason,
        exitCode: task.exitCode,
        stoppedAt: task.stoppedAt,
      },
      logLink,
    });

    const issue = await retryWithBackoff(
      () =>
        createIssue({
          title: `[Auto] Code bug detected in ECS task: ${task.taskDefinitionArn.split('/').pop() ?? task.taskDefinitionArn}`,
          body: issueBody,
          labels: ['infrastructure', 'auto-generated'],
        }),
      {
        operationName: 'createGitHubIssue',
        agentName: AGENT_NAME,
      },
    );

    // T049: Record audit action
    await recordAction({
      agentName: AGENT_NAME,
      action: AUDIT_ACTION_TYPES.GITHUB_ISSUE_CREATED,
      confidence,
      severity: 'HIGH',
      outcome: 'AUTO_EXECUTED',
      metadata: {
        taskArn: task.taskArn,
        taskDefinitionArn: task.taskDefinitionArn,
        issueNumber: issue.issueNumber,
        issueUrl: issue.url,
        stopReason: task.stopReason,
        exitCode: task.exitCode,
        reason: 'code_bug',
      },
    });

    // T049: Emit system event
    await emitEvent({
      type: SYSTEM_EVENT_TYPES.INFRASTRUCTURE_ESCALATION,
      severity: 'HIGH',
      message: `Code bug detected in task ${task.taskArn}, created GitHub issue #${issue.issueNumber}`,
      metadata: {
        taskArn: task.taskArn,
        issueNumber: issue.issueNumber,
        issueUrl: issue.url,
        stopReason: task.stopReason,
        exitCode: task.exitCode,
      },
      agentName: AGENT_NAME,
    });

    log.info('Code bug escalated to GitHub issue', {
      taskArn: task.taskArn,
      issueNumber: issue.issueNumber,
      issueUrl: issue.url,
    });

    return {
      taskArn: task.taskArn,
      actionTaken: 'escalated',
      reason: 'code_bug',
      issueNumber: issue.issueNumber,
      issueUrl: issue.url,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Failed to create code bug issue', {
      taskArn: task.taskArn,
      error: errorMessage,
    });

    return {
      taskArn: task.taskArn,
      actionTaken: 'escalation_failed',
      reason: 'code_bug',
      error: errorMessage,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a CloudWatch console deep link for a stopped task's log stream.
 *
 * Uses the task ARN to derive a likely log stream name and links to the
 * time window around when the task stopped.
 *
 * @param task - The stopped task details.
 * @param logGroup - CloudWatch log group name.
 * @returns A CloudWatch console URL string.
 */
function buildLogLink(task: TaskDetail, logGroup: string): string {
  // ECS Fargate log stream names follow the pattern: prefix/container/taskId
  const taskId = task.taskArn.split('/').pop() ?? task.taskArn;
  const logStreamName = `ecs/${taskId}`;
  const timestamp = task.stoppedAt
    ? new Date(task.stoppedAt).getTime()
    : Date.now();

  return getLogLink(logGroup, logStreamName, timestamp);
}

/**
 * Builds a summary of all actions taken during this agent execution.
 *
 * @param results - Array of per-task action result records.
 * @returns An object with overall confidence and a human-readable rationale.
 */
function buildSummary(results: Record<string, unknown>[]): {
  overallConfidence: number;
  rationale: string;
} {
  const restarted = results.filter((r) => r.actionTaken === 'restarted').length;
  const escalated = results.filter((r) => r.actionTaken === 'escalated').length;
  const dryRuns = results.filter((r) => r.dryRun === true).length;
  const failures = results.filter(
    (r) =>
      r.actionTaken === 'restart_failed' ||
      r.actionTaken === 'escalation_failed',
  ).length;

  const parts: string[] = [];

  if (restarted > 0) {
    parts.push(`${restarted} task(s) auto-restarted`);
  }
  if (escalated > 0) {
    parts.push(`${escalated} task(s) escalated to GitHub issues`);
  }
  if (dryRuns > 0) {
    parts.push(`${dryRuns} action(s) logged as dry-run (kill switch active)`);
  }
  if (failures > 0) {
    parts.push(`${failures} action(s) failed`);
  }
  if (parts.length === 0) {
    parts.push('No actionable stopped tasks found');
  }

  // Confidence is lower if there were failures
  const overallConfidence = failures > 0 ? 0.6 : 0.9;

  return {
    overallConfidence,
    rationale: parts.join('; ') + '.',
  };
}
