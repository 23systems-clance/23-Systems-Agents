/**
 * ECS operations tool service for the autonomous agent framework (T021).
 *
 * Provides functions to list stopped tasks, describe task details, restart
 * tasks on Fargate, and classify ECS failure reasons as transient or code bugs.
 */

import {
  ECSClient,
  RunTaskCommand,
  DescribeTasksCommand,
  ListTasksCommand,
} from '@aws-sdk/client-ecs';
import logger from '../../../lib/logger.js';
import type { FailureClassification } from '../../../lib/autonomous/types.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Summarised details for an ECS task retrieved via DescribeTasks. */
export interface TaskDetail {
  /** Full task ARN. */
  taskArn: string;
  /** ARN of the task definition revision that was running. */
  taskDefinitionArn: string;
  /** Human-readable reason the task was stopped. */
  stopReason: string;
  /** Container exit code (0 = success, >=128 = signal, -1 = unknown). */
  exitCode: number;
  /** ISO-8601 timestamp when the task stopped. */
  stoppedAt: string;
  /** Network configuration extracted from the task's attachment. */
  networkConfig: NetworkConfig;
}

/** VPC network configuration required to launch a Fargate task. */
export interface NetworkConfig {
  /** Subnet IDs the task ENI was attached to. */
  subnets: string[];
  /** Security group IDs applied to the task ENI. */
  securityGroups: string[];
  /** Whether the task was assigned a public IP. */
  assignPublicIp: 'ENABLED' | 'DISABLED';
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const log = logger.withContext({ service: 'ecsOperations' });

const ecsClient = new ECSClient({ region: process.env.AWS_REGION });

// ---------------------------------------------------------------------------
// Keyword sets for failure classification
// ---------------------------------------------------------------------------

const TRANSIENT_KEYWORDS = [
  'OutOfMemory',
  'OOMKilled',
  'oom',
  'timeout',
  'Timeout',
  'TIMEOUT',
  'CannotPullContainerError',
  'ResourceNotFoundException',
  'ThrottlingException',
  'ServiceUnavailable',
  'HostUnreachable',
  'connection refused',
  'connection reset',
  'network error',
];

const CODE_BUG_KEYWORDS = [
  'TypeError',
  'ReferenceError',
  'SyntaxError',
  'RangeError',
  'stack trace',
  'stackTrace',
  'ENOENT',
  'MODULE_NOT_FOUND',
  'Cannot find module',
  'UnhandledPromiseRejection',
  'AssertionError',
];

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Lists the ARNs of all stopped tasks in the given ECS cluster.
 *
 * @param cluster - ECS cluster name or ARN.
 * @returns Array of task ARN strings.
 */
export async function listStoppedTasks(cluster: string): Promise<string[]> {
  try {
    log.info('Listing stopped tasks', { cluster });

    const response = await ecsClient.send(
      new ListTasksCommand({
        cluster,
        desiredStatus: 'STOPPED',
      }),
    );

    const taskArns = response.taskArns ?? [];
    log.info('Listed stopped tasks', { cluster, count: taskArns.length });
    return taskArns;
  } catch (error) {
    log.error('Failed to list stopped tasks', {
      cluster,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Describes one or more ECS tasks and returns normalised {@link TaskDetail} objects.
 *
 * @param cluster  - ECS cluster name or ARN.
 * @param taskArns - Array of task ARN strings to describe (max 100 per API call).
 * @returns Array of task detail objects.
 */
export async function describeTaskDetails(
  cluster: string,
  taskArns: string[],
): Promise<TaskDetail[]> {
  try {
    if (taskArns.length === 0) {
      return [];
    }

    log.info('Describing task details', { cluster, taskCount: taskArns.length });

    const response = await ecsClient.send(
      new DescribeTasksCommand({ cluster, tasks: taskArns }),
    );

    const tasks = response.tasks ?? [];

    return tasks.map((task) => {
      // Extract network config from the ENI attachment
      const eniAttachment = task.attachments?.find(
        (a) => a.type === 'ElasticNetworkInterface',
      );
      const eniDetails = eniAttachment?.details ?? [];

      const subnets = eniDetails
        .filter((d) => d.name === 'subnetId')
        .map((d) => d.value ?? '');

      const securityGroups = eniDetails
        .filter((d) => d.name === 'securityGroupId')
        .map((d) => d.value ?? '');

      const assignPublicIp =
        eniDetails.find((d) => d.name === 'assignPublicIp')?.value === 'ENABLED'
          ? 'ENABLED'
          : 'DISABLED';

      // Extract exit code from the first essential container
      const exitCode =
        task.containers?.[0]?.exitCode ?? -1;

      return {
        taskArn: task.taskArn ?? '',
        taskDefinitionArn: task.taskDefinitionArn ?? '',
        stopReason: task.stoppedReason ?? 'Unknown',
        exitCode,
        stoppedAt: task.stoppedAt?.toISOString() ?? '',
        networkConfig: {
          subnets,
          securityGroups,
          assignPublicIp,
        },
      } satisfies TaskDetail;
    });
  } catch (error) {
    log.error('Failed to describe task details', {
      cluster,
      taskCount: taskArns.length,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Launches a new Fargate task using the specified task definition and network config.
 *
 * @param cluster           - ECS cluster name or ARN.
 * @param taskDefinitionArn - Full ARN of the task definition (including revision).
 * @param networkConfig     - VPC network configuration for the new task.
 * @returns The ARN of the newly launched task.
 */
export async function restartTask(
  cluster: string,
  taskDefinitionArn: string,
  networkConfig: NetworkConfig,
): Promise<string> {
  try {
    log.info('Restarting task', { cluster, taskDefinitionArn });

    const response = await ecsClient.send(
      new RunTaskCommand({
        cluster,
        taskDefinition: taskDefinitionArn,
        launchType: 'FARGATE',
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: networkConfig.subnets,
            securityGroups: networkConfig.securityGroups,
            assignPublicIp: networkConfig.assignPublicIp,
          },
        },
        count: 1,
      }),
    );

    const newTaskArn = response.tasks?.[0]?.taskArn;
    if (!newTaskArn) {
      const failures = response.failures ?? [];
      const failureReason = failures.map((f) => f.reason).join(', ') || 'Unknown';
      throw new Error(`RunTask returned no task ARN. Failures: ${failureReason}`);
    }

    log.info('Task restarted successfully', { cluster, newTaskArn });
    return newTaskArn;
  } catch (error) {
    log.error('Failed to restart task', {
      cluster,
      taskDefinitionArn,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Classifies an ECS task failure as transient (restart-safe) or a code bug
 * based on the stop reason text and container exit code.
 *
 * Classification heuristics:
 * - Exit codes >= 128 or OOM/timeout keywords -> transient (confidence 0.90)
 * - Exit code 1 with stack-trace keywords      -> code_bug (confidence 0.85)
 * - Otherwise                                  -> conservative classification
 *
 * @param stopReason - The ECS stop reason string.
 * @param exitCode   - The container exit code.
 * @returns A {@link FailureClassification} with type, confidence, and reason.
 */
export function classifyFailure(
  stopReason: string,
  exitCode: number,
): FailureClassification {
  log.debug('Classifying failure', { stopReason, exitCode });

  // Signal-killed processes (SIGKILL=137, SIGSEGV=139, etc.) are typically transient
  if (exitCode >= 128) {
    return {
      type: 'transient',
      confidence: 0.90,
      reason: `Exit code ${exitCode} indicates process killed by signal (likely OOM or resource constraint)`,
    };
  }

  // Check for transient keywords in the stop reason
  const matchedTransient = TRANSIENT_KEYWORDS.find((kw) =>
    stopReason.includes(kw),
  );
  if (matchedTransient) {
    return {
      type: 'transient',
      confidence: 0.90,
      reason: `Stop reason contains transient indicator: "${matchedTransient}"`,
    };
  }

  // Exit code 1 with code-bug keywords suggests an application error
  if (exitCode === 1) {
    const matchedBug = CODE_BUG_KEYWORDS.find((kw) =>
      stopReason.includes(kw),
    );
    if (matchedBug) {
      return {
        type: 'code_bug',
        confidence: 0.85,
        reason: `Exit code 1 with code-level error indicator: "${matchedBug}"`,
      };
    }
  }

  // Conservative fallback: low-confidence transient classification
  // We default to transient to avoid blocking auto-restart, but with lower
  // confidence so the confidence gate may escalate for human review.
  return {
    type: 'transient',
    confidence: 0.60,
    reason: `Unable to determine root cause from exit code ${exitCode} and stop reason; defaulting to transient with low confidence`,
  };
}
