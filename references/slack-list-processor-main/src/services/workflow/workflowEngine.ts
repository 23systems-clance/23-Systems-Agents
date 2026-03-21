import { prisma } from '../../models/index.js';
import { workflowQueue } from '../queue/queues.js';
import type { WorkflowGraph, WorkflowNode, WorkflowEdge, NodeHistoryEntry, NodeConfig, EdgeCondition, ActionNodeConfig, EnrichmentNodeConfig, HubSpotNodeConfig, ParserNodeConfig, ApiCallNodeConfig } from './types.js';
import type { WorkflowExecutionStatus, Prisma } from '@prisma/client';
import logger from '../../lib/logger.js';

/**
 * Resolve the correct workflow template using 3-tier cascade:
 *   Tier 1: Channel-specific mapping (WorkflowChannelMapping)
 *   Tier 2: Client-level workflow (channel → client → workflow)
 *   Tier 3: Team-level fallback (clientId IS NULL)
 *
 * At each tier, the candidate must be active with a published version.
 * Returns null if no tier matches (caller falls back to legacy enrichment).
 */
export async function resolveWorkflowTemplate(params: {
  triggerType: string;
  slackTeamId: string;
  slackChannelId: string;
}): Promise<{ template: any; version: any; resolvedTier: number } | null> {
  const { triggerType, slackTeamId, slackChannelId } = params;

  const includePublishedVersion = {
    versions: {
      where: { status: 'PUBLISHED' as const },
      orderBy: { version: 'desc' as const },
      take: 1,
    },
  };

  // Tier 1: Channel-specific mapping
  const channelMapping = await prisma.workflowChannelMapping.findUnique({
    where: {
      slackTeamId_slackChannelId_triggerType: {
        slackTeamId,
        slackChannelId,
        triggerType: triggerType as any,
      },
    },
    include: {
      template: {
        include: includePublishedVersion,
      },
    },
  });

  if (channelMapping?.template?.isActive && channelMapping.template.versions.length > 0) {
    logger.info(`Workflow resolved via tier-1 (channel): template=${channelMapping.template.id}, channel=${slackChannelId}`);
    return {
      template: channelMapping.template,
      version: channelMapping.template.versions[0],
      resolvedTier: 1,
    };
  }

  // Tier 2: Client-level workflow (channel → client → workflow)
  const clientMapping = await prisma.channelClientMapping.findUnique({
    where: {
      slackTeamId_slackChannelId: {
        slackTeamId,
        slackChannelId,
      },
    },
  });

  if (clientMapping) {
    const clientTemplate = await prisma.workflowTemplate.findFirst({
      where: {
        slackTeamId,
        triggerType: triggerType as any,
        clientId: clientMapping.clientId,
        isActive: true,
      },
      include: includePublishedVersion,
    });

    if (clientTemplate && clientTemplate.versions.length > 0) {
      logger.info(`Workflow resolved via tier-2 (client): template=${clientTemplate.id}, client=${clientMapping.clientId}`);
      return {
        template: clientTemplate,
        version: clientTemplate.versions[0],
        resolvedTier: 2,
      };
    }
  }

  // Tier 3: Team-level fallback (no client assigned)
  const teamTemplate = await prisma.workflowTemplate.findFirst({
    where: {
      slackTeamId,
      triggerType: triggerType as any,
      clientId: null,
      isActive: true,
    },
    include: includePublishedVersion,
  });

  if (teamTemplate && teamTemplate.versions.length > 0) {
    logger.info(`Workflow resolved via tier-3 (team fallback): template=${teamTemplate.id}`);
    return {
      template: teamTemplate,
      version: teamTemplate.versions[0],
      resolvedTier: 3,
    };
  }

  logger.info(`No workflow resolved at any tier for triggerType=${triggerType}, team=${slackTeamId}, channel=${slackChannelId}`);
  return null;
}

/**
 * Start a new workflow execution from a trigger event.
 *
 * @param params - Trigger parameters including type, Slack identifiers, and initial context
 * @returns Execution details with current node and processed nodes, or null if no matching workflow
 */
export async function startExecution(params: {
  triggerType: string;
  slackTeamId: string;
  slackUserId: string;
  slackChannelId: string;
  slackThreadTs?: string;
  initialContext?: Record<string, unknown>;
}) {
  const { triggerType, slackTeamId, slackUserId, slackChannelId, slackThreadTs, initialContext = {} } = params;

  // Resolve workflow via 3-tier cascade
  const resolved = await resolveWorkflowTemplate({ triggerType, slackTeamId, slackChannelId });

  if (!resolved) {
    logger.info(`No active workflow found for triggerType=${triggerType}, slackTeamId=${slackTeamId}, channel=${slackChannelId}`);
    return null;
  }

  const { template, version, resolvedTier } = resolved;

  // Concurrent execution prevention: one active execution per user per workflow template
  const existingExecution = await prisma.workflowExecution.findFirst({
    where: {
      version: { templateId: template.id },
      slackUserId,
      status: { in: ['ACTIVE', 'WAITING_INPUT', 'WAITING_DELAY'] },
    },
  });

  if (existingExecution) {
    logger.info(`User ${slackUserId} already has active execution ${existingExecution.id} for workflow ${template.id}`);
    return null;
  }

  const graph = version.graph as unknown as WorkflowGraph;

  // Find the TRIGGER node in the graph
  const triggerNode = graph.nodes.find((n) => n.type === 'TRIGGER');
  if (!triggerNode) {
    logger.error(`No TRIGGER node found in workflow template ${template.id}, version ${version.version}`);
    return null;
  }

  // Create execution record
  const execution = await prisma.workflowExecution.create({
    data: {
      versionId: version.id,
      slackTeamId,
      slackUserId,
      slackChannelId,
      slackThreadTs: slackThreadTs || null,
      status: 'ACTIVE',
      currentNodeId: triggerNode.id,
      context: { ...initialContext, resolvedTier } as any,
      nodeHistory: [] as any,
      expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
    },
  });

  logger.info(`Started workflow execution ${execution.id} for template ${template.id} (${template.name})`);

  // Auto-advance from trigger node through all auto-advance nodes
  const { currentNode, status, nodesProcessed } = await advanceFromNode(execution, graph, triggerNode.id);

  // Extract pending actions from context before persisting
  const pendingActions = extractPendingActions(execution.context as Record<string, unknown>);

  // Update execution with final state after auto-advance
  const updatedExecution = await prisma.workflowExecution.update({
    where: { id: execution.id },
    data: {
      status,
      currentNodeId: currentNode?.id || null,
      context: execution.context as any,
      nodeHistory: execution.nodeHistory as any, // nodeHistory is updated in-place during advanceFromNode
    },
  });

  return {
    execution: updatedExecution,
    currentNode,
    nodesProcessed,
    pendingActions,
  };
}

/**
 * Resume a paused workflow execution with user input.
 *
 * @param executionId - The execution ID to resume
 * @param input - User input data to merge into execution context
 * @param selectedHandle - Optional handle ID for button choice selections
 * @returns Next node where execution paused, completion status, and processed nodes
 */
export async function resumeWithInput(
  executionId: string,
  input: Record<string, unknown>,
  selectedHandle?: string
) {
  const execution = await prisma.workflowExecution.findUnique({
    where: { id: executionId },
    include: {
      version: true,
    },
  });

  if (!execution) {
    throw new Error(`Execution ${executionId} not found`);
  }

  if (execution.status !== 'WAITING_INPUT') {
    throw new Error(`Execution ${executionId} is not in WAITING_INPUT status (current: ${execution.status})`);
  }

  const now = new Date();
  if (execution.expiresAt && execution.expiresAt < now) {
    await prisma.workflowExecution.update({
      where: { id: executionId },
      data: { status: 'EXPIRED', completedAt: now },
    });
    throw new Error(`Execution ${executionId} has expired`);
  }

  // Merge input into context
  const context = { ...(execution.context as Record<string, unknown>), ...input };

  // Update nodeHistory to record exit from current node
  const nodeHistory = (execution.nodeHistory as unknown as NodeHistoryEntry[]) || [];
  const currentNodeHistory = nodeHistory.find((h) => h.nodeId === execution.currentNodeId && !h.exitedAt);
  if (currentNodeHistory) {
    currentNodeHistory.exitedAt = now.toISOString();
    currentNodeHistory.userInput = input as any;
  }

  // Reset expiry time
  const newExpiresAt = new Date(Date.now() + 3600000);

  // Resolve next node from current node
  const graph = (execution as any).version.graph as unknown as WorkflowGraph;
  const nextNodeId = resolveNextNode(graph, execution.currentNodeId!, selectedHandle, context);

  if (!nextNodeId) {
    // No next node means execution is complete
    await prisma.workflowExecution.update({
      where: { id: executionId },
      data: {
        status: 'COMPLETED',
        completedAt: now,
        context: context as any,
        nodeHistory: nodeHistory as any,
      },
    });

    logger.info(`Workflow execution ${executionId} completed`);
    return { nextNode: null, completed: true, nodesProcessed: [], pendingActions: [] as Array<Record<string, unknown>> };
  }

  // Update execution with new context and continue auto-advance
  execution.context = context as any;
  execution.nodeHistory = nodeHistory as any;
  execution.expiresAt = newExpiresAt;

  const { currentNode, status, nodesProcessed } = await advanceFromNode(execution, graph, nextNodeId);

  // Extract pending actions from context before persisting
  const pendingActions = extractPendingActions(execution.context as Record<string, unknown>);

  // Persist final state
  await prisma.workflowExecution.update({
    where: { id: executionId },
    data: {
      status,
      currentNodeId: currentNode?.id || null,
      context: execution.context as any,
      nodeHistory: execution.nodeHistory as any,
      expiresAt: execution.expiresAt,
      completedAt: status === 'COMPLETED' ? now : null,
    },
  });

  logger.info(`Workflow execution ${executionId} resumed, new status: ${status}`);

  return {
    nextNode: currentNode,
    completed: status === 'COMPLETED',
    nodesProcessed,
    pendingActions,
  };
}

/**
 * Find an active workflow execution for a given Slack thread.
 *
 * @param slackChannelId - The Slack channel ID
 * @param slackThreadTs - The Slack thread timestamp
 * @returns Active execution or null if none found
 */
export async function findActiveExecution(slackChannelId: string, slackThreadTs: string) {
  const now = new Date();
  const execution = await prisma.workflowExecution.findFirst({
    where: {
      slackChannelId,
      slackThreadTs,
      status: { in: ['ACTIVE', 'WAITING_INPUT', 'WAITING_DELAY'] },
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: 'desc' },
  });

  return execution;
}

/**
 * Cancel a running workflow execution.
 *
 * @param executionId - The execution ID to cancel
 * @returns Updated execution record
 */
export async function cancelExecution(executionId: string) {
  const execution = await prisma.workflowExecution.findUnique({
    where: { id: executionId },
  });

  if (!execution) {
    throw new Error(`Execution ${executionId} not found`);
  }

  const terminalStatuses: WorkflowExecutionStatus[] = ['COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED'];
  if (terminalStatuses.includes(execution.status)) {
    throw new Error(`Execution ${executionId} is already in terminal state: ${execution.status}`);
  }

  const updated = await prisma.workflowExecution.update({
    where: { id: executionId },
    data: {
      status: 'CANCELLED',
      completedAt: new Date(),
    },
  });

  logger.info(`Workflow execution ${executionId} cancelled`);
  return updated;
}

/**
 * Expire stale workflow executions that have exceeded their expiry time.
 * Called periodically by a background job.
 *
 * @returns Array of expired executions
 */
export async function expireStaleExecutions() {
  const now = new Date();

  const staleExecutions = await prisma.workflowExecution.findMany({
    where: {
      status: { in: ['ACTIVE', 'WAITING_INPUT', 'WAITING_DELAY'] },
      expiresAt: { lt: now },
    },
  });

  if (staleExecutions.length === 0) {
    return [];
  }

  await prisma.workflowExecution.updateMany({
    where: {
      id: { in: staleExecutions.map((e) => e.id) },
    },
    data: {
      status: 'EXPIRED',
      completedAt: now,
    },
  });

  logger.info(`Expired ${staleExecutions.length} stale workflow executions`);
  return staleExecutions;
}

/**
 * Core auto-advance loop that processes nodes until hitting a pause point.
 * Mutates execution.context and execution.nodeHistory in-place.
 *
 * @param execution - The execution record (context and nodeHistory are mutated)
 * @param graph - The workflow graph to traverse
 * @param startNodeId - The node ID to start processing from
 * @returns Current node (where execution paused), final status, and all processed nodes
 */
async function advanceFromNode(
  execution: { id: string; context: Prisma.JsonValue; nodeHistory: Prisma.JsonValue },
  graph: WorkflowGraph,
  startNodeId: string
): Promise<{ currentNode: WorkflowNode | null; status: WorkflowExecutionStatus; nodesProcessed: WorkflowNode[] }> {
  let currentNodeId: string | null = startNodeId;
  const nodesProcessed: WorkflowNode[] = [];
  const context = execution.context as unknown as Record<string, unknown>;
  const nodeHistory = (execution.nodeHistory as unknown as NodeHistoryEntry[]) || [];

  while (currentNodeId) {
    const node = graph.nodes.find((n) => n.id === currentNodeId);
    if (!node) {
      logger.error(`Node ${currentNodeId} not found in workflow graph`);
      return { currentNode: null, status: 'FAILED', nodesProcessed };
    }

    // Record node entry
    const entryTime = new Date().toISOString();
    nodeHistory.push({
      nodeId: node.id,
      nodeType: node.type,
      enteredAt: entryTime,
    } as NodeHistoryEntry);

    nodesProcessed.push(node);
    logger.info(`Processing node ${node.id} (${node.type}) in execution ${execution.id}`);

    // Process node based on type
    switch (node.type) {
      case 'TRIGGER': {
        // Auto-advance through trigger node
        const nextNodeId = resolveNextNode(graph, node.id);
        const lastEntry = nodeHistory[nodeHistory.length - 1];
        lastEntry.exitedAt = new Date().toISOString();
        currentNodeId = nextNodeId;
        break;
      }

      case 'MESSAGE': {
        // Auto-advance, caller will render message
        const nextNodeId = resolveNextNode(graph, node.id);
        const lastEntry = nodeHistory[nodeHistory.length - 1];
        lastEntry.exitedAt = new Date().toISOString();
        currentNodeId = nextNodeId;
        break;
      }

      case 'BUTTON_CHOICE': {
        // PAUSE: wait for user button selection
        execution.nodeHistory = nodeHistory as any;
        return { currentNode: node, status: 'WAITING_INPUT', nodesProcessed };
      }

      case 'FORM_MODAL': {
        // PAUSE: wait for user form submission
        execution.nodeHistory = nodeHistory as any;
        return { currentNode: node, status: 'WAITING_INPUT', nodesProcessed };
      }

      case 'CONDITION': {
        // Auto-advance: evaluate condition and follow matching edge
        const nextNodeId = resolveNextNode(graph, node.id, undefined, context);
        const lastEntry = nodeHistory[nodeHistory.length - 1];
        lastEntry.exitedAt = new Date().toISOString();
        (lastEntry as any).conditionResult = nextNodeId ? true : false;
        currentNodeId = nextNodeId;
        break;
      }

      case 'ACTION': {
        // Auto-advance: dispatch to specialized executors or record generic action
        const config = node.data as unknown as ActionNodeConfig;
        const executedAt = new Date().toISOString();
        if (config.actionType) {
          const params = config.params ?? {};
          try {
            switch (config.actionType) {
              case 'ASSIGN_TO_CAMPAIGN': {
                const { executeAssignToCampaign } = await import('./nodes/actionExecutors/assignToCampaign.js');
                await executeAssignToCampaign(params, context);
                break;
              }
              case 'GET_EMAIL': {
                const { executeGetEmail } = await import('./nodes/actionExecutors/getEmail.js');
                await executeGetEmail(params, context);
                break;
              }
              case 'GET_PHONE': {
                const { executeGetPhone } = await import('./nodes/actionExecutors/getPhone.js');
                await executeGetPhone(params, context);
                break;
              }
              default: {
                // Generic action: append to pending actions for Slack-layer execution
                const pending = (context._pendingActions as Array<Record<string, unknown>>) || [];
                pending.push({
                  nodeId: node.id,
                  actionType: config.actionType,
                  params,
                  executedAt,
                });
                context._pendingActions = pending;
                break;
              }
            }
          } catch (err) {
            logger.error(`Action ${config.actionType} on node ${node.id} failed`, {
              executionId: execution.id,
              error: err instanceof Error ? err.message : String(err),
            });
            context[`action_${node.id}_error`] = err instanceof Error ? err.message : String(err);
          }
          context[`action_${node.id}_result`] = {
            actionType: config.actionType,
            executedAt,
          };
        }
        const nextNodeId = resolveNextNode(graph, node.id);
        const lastEntry = nodeHistory[nodeHistory.length - 1];
        lastEntry.exitedAt = new Date().toISOString();
        currentNodeId = nextNodeId;
        break;
      }

      case 'ENRICHMENT': {
        // Auto-advance: record enrichment request in context and queue for Slack-layer execution
        const config = node.data as unknown as EnrichmentNodeConfig;
        const requestedAt = new Date().toISOString();
        context[`enrichment_${node.id}_request`] = {
          enrichmentType: config.enrichmentType,
          fileSourceVariable: config.fileSourceVariable,
          purpose: config.purpose,
          outputJobIdVariable: config.outputJobIdVariable,
          requestedAt,
        };
        // Append to pending actions for the Slack listener to process
        const pending = (context._pendingActions as Array<Record<string, unknown>>) || [];
        pending.push({
          nodeId: node.id,
          actionType: 'ENRICHMENT',
          enrichmentType: config.enrichmentType,
          fileSourceVariable: config.fileSourceVariable,
          purpose: config.purpose,
          outputJobIdVariable: config.outputJobIdVariable,
          executedAt: requestedAt,
        });
        context._pendingActions = pending;
        const nextNodeId = resolveNextNode(graph, node.id);
        const lastEntry = nodeHistory[nodeHistory.length - 1];
        lastEntry.exitedAt = new Date().toISOString();
        currentNodeId = nextNodeId;
        break;
      }

      case 'HUBSPOT': {
        // Auto-advance: execute HubSpot import or sync
        try {
          const { executeHubSpotNode } = await import('./nodes/hubspotNodeExecutor.js');
          const hsConfig = node.data as unknown as HubSpotNodeConfig;
          await executeHubSpotNode(hsConfig, context);

          // If large batch was deferred, enqueue to hubspotQueue
          if (context._hubspotSyncPending) {
            const { hubspotQueue } = await import('../queue/queues.js');
            const pending = context._hubspotSyncPending as { contacts: Record<string, unknown>[]; config: Record<string, unknown> };
            await hubspotQueue.add('hubspot-batch-sync', {
              executionId: execution.id,
              nodeId: node.id,
              contacts: pending.contacts,
              config: pending.config,
            });
            delete context._hubspotSyncPending;
            logger.info(`HubSpot node ${node.id}: queued ${pending.contacts.length} contacts for async sync`);
          }

          logger.info(`HubSpot node ${node.id} executed in execution ${execution.id}`, { mode: hsConfig.mode });
        } catch (err) {
          logger.error(`HubSpot node ${node.id} failed`, {
            executionId: execution.id,
            error: err instanceof Error ? err.message : String(err),
          });
          context[`hubspot_${node.id}_error`] = err instanceof Error ? err.message : String(err);
        }
        const nextNodeId = resolveNextNode(graph, node.id);
        const lastEntry = nodeHistory[nodeHistory.length - 1];
        lastEntry.exitedAt = new Date().toISOString();
        currentNodeId = nextNodeId;
        break;
      }

      case 'PARSER': {
        // Auto-advance: parse, transform, and filter data
        try {
          const { executeParserNode } = await import('./nodes/parserNodeExecutor.js');
          const parserConfig = node.data as unknown as ParserNodeConfig;
          await executeParserNode(parserConfig, context);
          logger.info(`Parser node ${node.id} executed in execution ${execution.id}`);
        } catch (err) {
          logger.error(`Parser node ${node.id} failed`, {
            executionId: execution.id,
            error: err instanceof Error ? err.message : String(err),
          });
          context[`parser_${node.id}_error`] = err instanceof Error ? err.message : String(err);
        }
        const nextNodeId = resolveNextNode(graph, node.id);
        const lastEntry = nodeHistory[nodeHistory.length - 1];
        lastEntry.exitedAt = new Date().toISOString();
        currentNodeId = nextNodeId;
        break;
      }

      case 'API_CALL': {
        // Auto-advance: make HTTP API call with variable interpolation
        try {
          const { executeApiCallNode } = await import('./nodes/apiCallNodeExecutor.js');
          const apiConfig = node.data as unknown as ApiCallNodeConfig;
          await executeApiCallNode(apiConfig, context);
          logger.info(`API Call node ${node.id} executed in execution ${execution.id}`);
        } catch (err) {
          logger.error(`API Call node ${node.id} failed`, {
            executionId: execution.id,
            error: err instanceof Error ? err.message : String(err),
          });
          context[`api_call_${node.id}_error`] = err instanceof Error ? err.message : String(err);
        }
        const nextNodeId = resolveNextNode(graph, node.id);
        const lastEntry = nodeHistory[nodeHistory.length - 1];
        lastEntry.exitedAt = new Date().toISOString();
        currentNodeId = nextNodeId;
        break;
      }

      case 'DELAY': {
        // PAUSE: schedule delayed job
        const config = node.data as any;
        const durationSeconds = config.durationSeconds || config.delayDuration || 60;
        await workflowQueue.add(
          'workflow-delay',
          { executionId: execution.id, nodeId: node.id },
          { delay: durationSeconds * 1000 }
        );
        logger.info(`Scheduled workflow-delay job for execution ${execution.id}, delay ${durationSeconds}s`);
        execution.nodeHistory = nodeHistory as any;
        return { currentNode: node, status: 'WAITING_DELAY', nodesProcessed };
      }

      default: {
        logger.warn(`Unknown node type: ${node.type}, treating as auto-advance`);
        const nextNodeId = resolveNextNode(graph, node.id);
        const lastEntry = nodeHistory[nodeHistory.length - 1];
        lastEntry.exitedAt = new Date().toISOString();
        currentNodeId = nextNodeId;
        break;
      }
    }

    // Update execution context after each node
    execution.context = context as any;
  }

  // No more nodes to process: execution complete
  execution.nodeHistory = nodeHistory as any;
  return { currentNode: null, status: 'COMPLETED', nodesProcessed };
}

/**
 * Extract pending actions from the execution context and remove them.
 * This prevents actions from being re-processed on subsequent resumptions.
 *
 * @param context - The execution context (mutated to remove _pendingActions)
 * @returns Array of pending action descriptors
 */
function extractPendingActions(context: Record<string, unknown>): Array<Record<string, unknown>> {
  const pending = (context._pendingActions as Array<Record<string, unknown>>) || [];
  if (pending.length > 0) {
    delete context._pendingActions;
  }
  return pending;
}

/**
 * Resolve the next node ID based on current node and edge conditions.
 *
 * @param graph - The workflow graph
 * @param currentNodeId - Current node ID
 * @param selectedHandle - Optional handle for button choice
 * @param context - Optional context for condition evaluation
 * @returns Next node ID or null if no matching edge
 */
function resolveNextNode(
  graph: WorkflowGraph,
  currentNodeId: string,
  selectedHandle?: string,
  context?: Record<string, unknown>
): string | null {
  const outgoingEdges = graph.edges.filter((e) => e.source === currentNodeId);

  if (outgoingEdges.length === 0) {
    return null; // No outgoing edges = execution complete
  }

  // If selectedHandle provided (button choice), find matching edge
  if (selectedHandle) {
    const matchingEdge = outgoingEdges.find((e) => e.sourceHandle === selectedHandle);
    return matchingEdge?.target || null;
  }

  // If context provided (condition evaluation), evaluate edge conditions
  if (context) {
    for (const edge of outgoingEdges) {
      if (edge.condition && evaluateCondition(edge.condition, context)) {
        return edge.target;
      }
    }
    // Look for default edge if no condition matched
    const defaultEdge = outgoingEdges.find((e) => e.condition?.operator === 'default');
    return defaultEdge?.target || null;
  }

  // Otherwise return single outgoing edge
  if (outgoingEdges.length === 1) {
    return outgoingEdges[0].target;
  }

  logger.warn(`Multiple outgoing edges from node ${currentNodeId} but no selection criteria provided`);
  return outgoingEdges[0].target; // Fallback to first edge
}

/**
 * Evaluate a condition against the execution context.
 *
 * @param condition - The edge condition to evaluate
 * @param context - The execution context
 * @returns True if condition matches, false otherwise
 */
function evaluateCondition(condition: EdgeCondition, context: Record<string, unknown>): boolean {
  const value = context[condition.field];

  switch (condition.operator) {
    case 'equals':
      return value === condition.value;

    case 'not_equals':
      return value !== condition.value;

    case 'contains':
      return String(value).includes(String(condition.value));

    case 'greater_than':
      return Number(value) > Number(condition.value);

    case 'less_than':
      return Number(value) < Number(condition.value);

    case 'is_empty':
      return value === null || value === undefined || value === '';

    case 'is_not_empty':
      return value !== null && value !== undefined && value !== '';

    case 'regex':
      try {
        return new RegExp(String(condition.value)).test(String(value));
      } catch (err) {
        logger.error(`Invalid regex pattern: ${condition.value}`, { error: err });
        return false;
      }

    case 'default':
      return true; // Default edge always matches

    default:
      logger.warn(`Unknown condition operator: ${condition.operator}`);
      return false;
  }
}
