/**
 * Workflow graph validation module.
 *
 * Validates workflow graphs before they can be published. Checks for:
 * - Single trigger node
 * - Cycle detection via Kahn's topological sort
 * - Disconnected nodes (all nodes must be reachable from trigger)
 * - Node configuration completeness
 * - Edge validity
 * - Button handle matching
 * - Dangling nodes
 */

import type {
  WorkflowGraph,
  WorkflowNode,
  WorkflowEdge,
  ValidationResult,
  ValidationError,
  TriggerNodeConfig,
  MessageNodeConfig,
  ButtonChoiceNodeConfig,
  FormModalNodeConfig,
  EnrichmentNodeConfig,
  ConditionNodeConfig,
  ActionNodeConfig,
  DelayNodeConfig,
  HubSpotNodeConfig,
  ParserNodeConfig,
  ApiCallNodeConfig,
} from './types.js';

/**
 * Validates a workflow graph against all validation rules.
 *
 * @param graph - The workflow graph to validate
 * @returns Validation result with errors and warnings
 */
export function validateWorkflowGraph(graph: WorkflowGraph): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  // Rule 1: Single trigger
  validateSingleTrigger(graph, errors);

  // Rule 2: Cycle detection
  validateNoCycles(graph, errors);

  // Rule 3: Disconnected nodes
  validateConnectivity(graph, errors);

  // Rule 4: Node completeness
  validateNodeConfigs(graph, errors);

  // Rule 5: Edge validity
  validateEdges(graph, errors);

  // Rule 6: Button handle matching
  validateButtonHandles(graph, warnings);

  // Rule 7: Dangling nodes
  validateDanglingNodes(graph, warnings);

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Rule 1: Exactly one TRIGGER node must exist.
 */
function validateSingleTrigger(graph: WorkflowGraph, errors: ValidationError[]): void {
  const triggerNodes = graph.nodes.filter((n) => n.type === 'TRIGGER');

  if (triggerNodes.length === 0) {
    errors.push({ message: 'Workflow must have exactly one TRIGGER node' });
  } else if (triggerNodes.length > 1) {
    errors.push({
      message: `Workflow must have exactly one TRIGGER node, found ${triggerNodes.length}`,
    });
  }
}

/**
 * Rule 2: Detect cycles using Kahn's topological sort algorithm.
 */
function validateNoCycles(graph: WorkflowGraph, errors: ValidationError[]): void {
  const { nodes, edges } = graph;

  // Build adjacency list and in-degree map
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const node of nodes) {
    adjacency.set(node.id, []);
    inDegree.set(node.id, 0);
  }

  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  // Kahn's algorithm: process nodes with in-degree 0
  const queue: string[] = [];
  const processed = new Set<string>();

  for (const [nodeId, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(nodeId);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    processed.add(current);

    for (const neighbor of adjacency.get(current) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, newDegree);

      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  // If not all nodes processed, there's a cycle
  if (processed.size < nodes.length) {
    const unprocessed = nodes
      .filter((n) => !processed.has(n.id))
      .map((n) => n.id)
      .join(', ');

    errors.push({
      message: `Circular reference detected involving nodes: ${unprocessed}`,
    });
  }
}

/**
 * Rule 3: All non-trigger nodes must be reachable from the trigger via BFS.
 */
function validateConnectivity(graph: WorkflowGraph, errors: ValidationError[]): void {
  const { nodes, edges } = graph;
  const triggerNode = nodes.find((n) => n.type === 'TRIGGER');

  if (!triggerNode) {
    // Already caught by validateSingleTrigger
    return;
  }

  // Build adjacency list
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
  }

  // BFS from trigger
  const visited = new Set<string>();
  const queue = [triggerNode.id];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    for (const neighbor of adjacency.get(current) ?? []) {
      if (!visited.has(neighbor)) {
        queue.push(neighbor);
      }
    }
  }

  // Check for disconnected nodes
  for (const node of nodes) {
    if (node.type !== 'TRIGGER' && !visited.has(node.id)) {
      errors.push({
        nodeId: node.id,
        message: 'Node is not connected to the workflow',
      });
    }
  }
}

/**
 * Rule 4: Validate node configuration completeness.
 */
function validateNodeConfigs(graph: WorkflowGraph, errors: ValidationError[]): void {
  for (const node of graph.nodes) {
    switch (node.type) {
      case 'TRIGGER': {
        const config = node.data as unknown as TriggerNodeConfig;
        if (!config.triggerType) {
          errors.push({
            nodeId: node.id,
            message: 'TRIGGER node must have a triggerType',
          });
        }
        break;
      }

      case 'MESSAGE': {
        const config = node.data as unknown as MessageNodeConfig;
        if (!config.text || config.text.trim().length === 0) {
          errors.push({
            nodeId: node.id,
            message: 'MESSAGE node must have non-empty text',
          });
        }
        break;
      }

      case 'BUTTON_CHOICE': {
        const config = node.data as unknown as ButtonChoiceNodeConfig;
        if (!config.buttons || config.buttons.length < 2) {
          errors.push({
            nodeId: node.id,
            message: 'BUTTON_CHOICE node must have at least 2 buttons',
          });
        } else {
          // Check each button has id and label
          for (const button of config.buttons) {
            if (!button.id || !button.label) {
              errors.push({
                nodeId: node.id,
                message: 'All buttons must have id and label',
              });
              break;
            }
          }
        }
        if (!config.outputVariable) {
          errors.push({
            nodeId: node.id,
            message: 'BUTTON_CHOICE node must have an outputVariable',
          });
        }
        break;
      }

      case 'FORM_MODAL': {
        const config = node.data as unknown as FormModalNodeConfig;
        if (!config.title || config.title.trim().length === 0) {
          errors.push({
            nodeId: node.id,
            message: 'FORM_MODAL node must have a title',
          });
        }
        if (!config.fields || config.fields.length === 0) {
          errors.push({
            nodeId: node.id,
            message: 'FORM_MODAL node must have at least 1 field',
          });
        }
        break;
      }

      case 'ENRICHMENT': {
        const config = node.data as unknown as EnrichmentNodeConfig;
        if (!config.enrichmentType) {
          errors.push({
            nodeId: node.id,
            message: 'ENRICHMENT node must have an enrichmentType',
          });
        }
        if (!config.fileSourceVariable) {
          errors.push({
            nodeId: node.id,
            message: 'ENRICHMENT node must have a fileSourceVariable',
          });
        }
        break;
      }

      case 'CONDITION': {
        const config = node.data as unknown as ConditionNodeConfig;
        if (!config.evaluationField) {
          errors.push({
            nodeId: node.id,
            message: 'CONDITION node must have an evaluationField',
          });
        }
        break;
      }

      case 'ACTION': {
        const config = node.data as unknown as ActionNodeConfig;
        if (!config.actionType) {
          errors.push({
            nodeId: node.id,
            message: 'ACTION node must have an actionType',
          });
        } else if (config.actionType === 'ASSIGN_TO_CAMPAIGN') {
          if (!config.params?.campaignId) {
            errors.push({
              nodeId: node.id,
              message: 'ASSIGN_TO_CAMPAIGN action requires params.campaignId',
            });
          }
        }
        break;
      }

      case 'DELAY': {
        const config = node.data as unknown as DelayNodeConfig;
        if (
          (!config.durationSeconds || config.durationSeconds <= 0) &&
          !config.durationVariable
        ) {
          errors.push({
            nodeId: node.id,
            message: 'DELAY node must have durationSeconds > 0 or durationVariable',
          });
        }
        break;
      }

      case 'HUBSPOT': {
        const config = node.data as unknown as HubSpotNodeConfig;
        if (!config.mode) {
          errors.push({ nodeId: node.id, message: 'HUBSPOT node must have a mode (import or sync)' });
        } else if (config.mode === 'import') {
          if (!config.listId) {
            errors.push({ nodeId: node.id, message: 'HUBSPOT import mode requires a listId' });
          }
        } else if (config.mode === 'sync') {
          if (!config.syncMatchFields || config.syncMatchFields.length === 0) {
            errors.push({ nodeId: node.id, message: 'HUBSPOT sync mode requires at least one syncMatchField' });
          }
          if (!config.fieldMapping || config.fieldMapping.length === 0) {
            errors.push({ nodeId: node.id, message: 'HUBSPOT sync mode requires at least one fieldMapping entry' });
          }
          if (config.fuzzyThreshold !== undefined && (config.fuzzyThreshold < 0 || config.fuzzyThreshold > 100)) {
            errors.push({ nodeId: node.id, message: 'HUBSPOT fuzzyThreshold must be between 0 and 100' });
          }
        }
        break;
      }

      case 'PARSER': {
        const config = node.data as unknown as ParserNodeConfig;
        if (!config.parseMode) {
          errors.push({ nodeId: node.id, message: 'PARSER node must have a parseMode (json or csv)' });
        }
        if (
          (!config.fieldMappings || config.fieldMappings.length === 0) &&
          (!config.transformations || config.transformations.length === 0) &&
          (!config.filters || config.filters.length === 0)
        ) {
          errors.push({ nodeId: node.id, message: 'PARSER node must have at least one fieldMapping, transformation, or filter' });
        }
        break;
      }

      case 'API_CALL': {
        const config = node.data as unknown as ApiCallNodeConfig;
        if (!config.method) {
          errors.push({ nodeId: node.id, message: 'API_CALL node must have a method' });
        }
        if (!config.url) {
          errors.push({ nodeId: node.id, message: 'API_CALL node must have a url' });
        }
        if (config.authType && config.authType !== 'none' && !config.authConfig) {
          errors.push({ nodeId: node.id, message: 'API_CALL node with auth requires authConfig' });
        }
        if (config.maxRetries !== undefined && config.maxRetries > 5) {
          errors.push({ nodeId: node.id, message: 'API_CALL maxRetries should not exceed 5' });
        }
        break;
      }

      default:
        // Unknown node type
        errors.push({
          nodeId: node.id,
          message: `Unknown node type: ${node.type}`,
        });
    }
  }
}

/**
 * Rule 5: Validate edge references.
 */
function validateEdges(graph: WorkflowGraph, errors: ValidationError[]): void {
  const nodeIds = new Set(graph.nodes.map((n) => n.id));

  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source)) {
      errors.push({
        message: `Edge ${edge.id} references non-existent source node: ${edge.source}`,
      });
    }
    if (!nodeIds.has(edge.target)) {
      errors.push({
        message: `Edge ${edge.id} references non-existent target node: ${edge.target}`,
      });
    }
  }
}

/**
 * Rule 6: Validate button handle matching (warning).
 */
function validateButtonHandles(graph: WorkflowGraph, warnings: ValidationError[]): void {
  for (const node of graph.nodes) {
    if (node.type === 'BUTTON_CHOICE') {
      const config = node.data as unknown as ButtonChoiceNodeConfig;
      const outgoingEdges = graph.edges.filter((e) => e.source === node.id);

      for (const button of config.buttons ?? []) {
        const hasEdge = outgoingEdges.some((e) => e.sourceHandle === button.id);
        if (!hasEdge) {
          warnings.push({
            nodeId: node.id,
            message: `Button "${button.label}" (${button.id}) has no outgoing edge`,
          });
        }
      }
    }
  }
}

/**
 * Rule 7: Warn about dangling nodes (no outgoing edges for non-terminal types).
 */
function validateDanglingNodes(graph: WorkflowGraph, warnings: ValidationError[]): void {
  const terminalTypes = new Set(['ENRICHMENT', 'ACTION', 'DELAY', 'HUBSPOT', 'API_CALL']);

  for (const node of graph.nodes) {
    const outgoingEdges = graph.edges.filter((e) => e.source === node.id);

    if (outgoingEdges.length === 0 && !terminalTypes.has(node.type)) {
      warnings.push({
        nodeId: node.id,
        message: `Node has no outgoing edges and is not a terminal node type`,
      });
    }
  }
}
