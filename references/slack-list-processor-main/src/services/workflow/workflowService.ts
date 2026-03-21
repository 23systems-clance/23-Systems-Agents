import { prisma } from '../../models/index.js';
import { logAudit } from '../../lib/auditLogger.js';
import { validateWorkflowGraph } from './workflowValidator.js';
import { getTemplateById } from './workflowTemplates.js';
import { createEndpoint, deactivateEndpoint } from '../webhook/webhookEndpointService.js';
import type { WorkflowGraph, ValidationResult, TriggerNodeConfig } from './types.js';
import type { WorkflowVersionStatus } from '@prisma/client';
import logger from '../../lib/logger.js';

/**
 * List all workflows for a team with optional status filter.
 * Includes published and draft versions, plus execution statistics.
 */
export async function listWorkflows(teamId: string, status?: WorkflowVersionStatus, clientId?: string | null) {
  // Build where clause with optional clientId filter
  const where: any = { slackTeamId: teamId };
  if (clientId !== undefined) {
    where.clientId = clientId === 'null' ? null : clientId;
  }

  // Query templates with their versions and client
  const templates = await prisma.workflowTemplate.findMany({
    where,
    include: {
      client: { select: { id: true, name: true } },
      versions: {
        where: status ? { status } : {
          OR: [
            { status: 'PUBLISHED' },
            { status: 'DRAFT' }
          ]
        },
        orderBy: { version: 'desc' }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  // Get execution stats for each template
  const workflowsWithStats = await Promise.all(
    templates.map(async (template) => {
      const executions = await prisma.workflowExecution.findMany({
        where: {
          version: {
            templateId: template.id
          }
        },
        select: { status: true }
      });

      const totalExecutions = executions.length;
      const completedExecutions = executions.filter(e => e.status === 'COMPLETED').length;
      const completionRate = totalExecutions > 0 ? (completedExecutions / totalExecutions) * 100 : 0;

      const publishedVersion = template.versions.find(v => v.status === 'PUBLISHED');
      const draftVersion = template.versions.find(v => v.status === 'DRAFT');

      return {
        id: template.id,
        name: template.name,
        description: template.description,
        triggerType: template.triggerType,
        isActive: template.isActive,
        clientId: template.clientId,
        clientName: template.client?.name || null,
        createdAt: template.createdAt,
        updatedAt: template.updatedAt,
        publishedVersion: publishedVersion ? {
          id: publishedVersion.id,
          version: publishedVersion.version,
          publishedAt: publishedVersion.publishedAt,
          publishedBy: publishedVersion.publishedByUserId
        } : null,
        draftVersion: draftVersion ? {
          id: draftVersion.id,
          version: draftVersion.version,
          updatedAt: draftVersion.updatedAt
        } : null,
        stats: {
          totalExecutions,
          completionRate: Math.round(completionRate * 100) / 100
        }
      };
    })
  );

  return workflowsWithStats;
}

/**
 * Create a new workflow template with an initial draft version.
 * Optionally initialize from a predefined template.
 */
export async function createWorkflow(params: {
  slackTeamId: string;
  name: string;
  description?: string;
  triggerType: string;
  createdByUserId: string;
  fromTemplate?: string;
  clientId?: string | null;
}) {
  const { slackTeamId, name, description, triggerType, createdByUserId, fromTemplate, clientId } = params;

  // Get initial graph - from template or empty
  let initialGraph: WorkflowGraph;
  if (fromTemplate) {
    const template = getTemplateById(fromTemplate);
    if (!template) {
      throw new Error(`Template ${fromTemplate} not found`);
    }
    initialGraph = template.graph;
  } else {
    initialGraph = {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    };
  }

  // Create template and initial draft version in transaction
  const result = await prisma.$transaction(async (tx) => {
    const template = await tx.workflowTemplate.create({
      data: {
        slackTeamId,
        name,
        description,
        triggerType: triggerType as any,
        isActive: false,
        createdByUserId,
        clientId: clientId || null,
        versions: {
          create: {
            version: 1,
            status: 'DRAFT',
            graph: initialGraph as any,
          }
        }
      },
      include: {
        versions: true
      }
    });

    return template;
  });

  // Audit log
  await logAudit({
    action: 'workflow_created',
    actorUserId: createdByUserId,
    actorTeamId: slackTeamId,
    targetType: 'workflow_template',
    targetId: result.id,
    metadata: {
      name,
      triggerType,
      fromTemplate
    }
  });

  return result;
}

/**
 * Get a workflow template by ID with all versions.
 * Validates team ownership.
 */
export async function getWorkflow(workflowId: string, teamId: string) {
  const template = await prisma.workflowTemplate.findFirst({
    where: {
      id: workflowId,
      slackTeamId: teamId
    },
    include: {
      client: { select: { id: true, name: true } },
      channelMappings: true,
      versions: {
        orderBy: { version: 'desc' }
      }
    }
  });

  if (!template) {
    throw new Error(`Workflow ${workflowId} not found for team ${teamId}`);
  }

  return template;
}

/**
 * Get a specific workflow version with its graph data.
 */
export async function getVersion(workflowId: string, versionId: string) {
  const version = await prisma.workflowVersion.findFirst({
    where: {
      id: versionId,
      templateId: workflowId
    }
  });

  if (!version) {
    throw new Error(`Version ${versionId} not found for workflow ${workflowId}`);
  }

  return version;
}

/**
 * Update the graph of a draft workflow version.
 * Only draft versions can be modified.
 */
export async function updateDraftVersion(
  workflowId: string,
  versionId: string,
  graph: WorkflowGraph,
  userId?: string,
  teamId?: string
) {
  const version = await prisma.workflowVersion.findFirst({
    where: {
      id: versionId,
      templateId: workflowId
    }
  });

  if (!version) {
    throw new Error(`Version ${versionId} not found`);
  }

  if (version.status !== 'DRAFT') {
    throw new Error('Only draft versions can be modified');
  }

  // Run non-blocking validation so callers get early feedback on draft quality
  const validation = validateWorkflowGraph(graph);

  const updated = await prisma.workflowVersion.update({
    where: { id: versionId },
    data: {
      graph: graph as any,
      updatedAt: new Date()
    }
  });

  // Audit log
  await logAudit({
    action: 'workflow_updated',
    actorUserId: userId ?? 'system',
    actorTeamId: teamId,
    targetType: 'workflow_version',
    targetId: versionId,
    metadata: {
      workflowId,
      version: updated.version
    }
  });

  return { ...updated, validation };
}

/**
 * Update workflow template name and description.
 */
export async function updateWorkflowName(
  workflowId: string,
  name: string,
  description?: string,
  userId?: string,
  teamId?: string
) {
  const updated = await prisma.workflowTemplate.update({
    where: { id: workflowId },
    data: {
      name,
      description,
      updatedAt: new Date()
    }
  });

  // Audit log
  await logAudit({
    action: 'workflow_updated',
    actorUserId: userId ?? 'system',
    actorTeamId: teamId,
    targetType: 'workflow_template',
    targetId: workflowId,
    metadata: {
      name,
      description
    }
  });

  return updated;
}

/**
 * Validate a workflow's draft version graph.
 * Returns validation result with any errors.
 */
export async function validateWorkflow(workflowId: string, teamId: string): Promise<ValidationResult> {
  const template = await getWorkflow(workflowId, teamId);

  const draftVersion = template.versions.find(v => v.status === 'DRAFT');
  if (!draftVersion) {
    return {
      isValid: false,
      errors: ['No draft version found to validate']
    };
  }

  return validateWorkflowGraph(draftVersion.graph as unknown as WorkflowGraph);
}

/**
 * Publish a draft workflow version.
 * Archives any existing published version and validates the graph.
 * Ensures no trigger type conflicts with other active workflows.
 */
export async function publishVersion(
  workflowId: string,
  publishedByUserId: string,
  teamId: string
) {
  const template = await getWorkflow(workflowId, teamId);

  const draftVersion = template.versions.find(v => v.status === 'DRAFT');
  if (!draftVersion) {
    throw new Error('No draft version found to publish');
  }

  // Validate the graph
  const validation = validateWorkflowGraph(draftVersion.graph as unknown as WorkflowGraph);
  if (!validation.isValid) {
    throw new Error(`Cannot publish invalid workflow: ${validation.errors?.join(', ')}`);
  }

  // Check for trigger type + client scope conflicts with other active workflows.
  // NULL = NULL is a valid match (both are team-level fallbacks).
  const conflictingWorkflow = await prisma.workflowTemplate.findFirst({
    where: {
      slackTeamId: teamId,
      triggerType: template.triggerType,
      clientId: template.clientId ?? null, // Prisma treats null as "IS NULL" in where
      isActive: true,
      NOT: { id: workflowId }
    }
  });

  // Publish in transaction — auto-deactivate conflicting workflow if found
  const result = await prisma.$transaction(async (tx) => {
    let deactivatedWorkflow: { id: string; name: string } | null = null;

    if (conflictingWorkflow) {
      await tx.workflowTemplate.update({
        where: { id: conflictingWorkflow.id },
        data: { isActive: false, updatedAt: new Date() }
      });
      deactivatedWorkflow = { id: conflictingWorkflow.id, name: conflictingWorkflow.name };
    }

    // Archive any existing published version for this template
    const existingPublished = template.versions.find(v => v.status === 'PUBLISHED');
    let archivedVersionId: string | null = null;

    if (existingPublished) {
      await tx.workflowVersion.update({
        where: { id: existingPublished.id },
        data: { status: 'ARCHIVED' }
      });
      archivedVersionId = existingPublished.id;
    }

    // Update draft to published
    const publishedVersion = await tx.workflowVersion.update({
      where: { id: draftVersion.id },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        publishedByUserId
      }
    });

    // Activate the template
    await tx.workflowTemplate.update({
      where: { id: workflowId },
      data: {
        isActive: true,
        updatedAt: new Date()
      }
    });

    return { publishedVersion, archivedVersionId, deactivatedWorkflow };
  });

  // Audit log for auto-deactivation
  if (result.deactivatedWorkflow) {
    await logAudit({
      action: 'workflow.auto_deactivated',
      actorUserId: publishedByUserId,
      actorTeamId: teamId,
      targetType: 'workflow_template',
      targetId: result.deactivatedWorkflow.id,
      metadata: {
        reason: 'conflict_on_publish',
        deactivatedBy: workflowId,
        triggerType: template.triggerType,
        clientId: template.clientId,
      }
    });
  }

  // Create webhook endpoint if trigger type is WEBHOOK
  let webhookEndpoint = null;
  const graph = result.publishedVersion.graph as unknown as WorkflowGraph;
  const triggerNode = graph?.nodes?.find((n: any) => n.type === 'TRIGGER');
  const triggerConfig = triggerNode?.data as unknown as TriggerNodeConfig | undefined;

  if (triggerConfig?.triggerType === 'webhook') {
    try {
      // Deactivate existing endpoints for this template first
      await deactivateEndpoint(workflowId);
      webhookEndpoint = await createEndpoint(workflowId, result.publishedVersion.id, `Webhook for ${template.name}`);
      logger.info('Webhook endpoint created on publish', {
        workflowId,
        endpointId: webhookEndpoint.id,
        token: webhookEndpoint.token.slice(0, 8) + '...',
      });
    } catch (err) {
      logger.error('Failed to create webhook endpoint on publish', {
        workflowId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Audit log
  await logAudit({
    action: 'workflow_published',
    actorUserId: publishedByUserId,
    actorTeamId: teamId,
    targetType: 'workflow_version',
    targetId: result.publishedVersion.id,
    metadata: {
      workflowId,
      workflowName: template.name,
      version: result.publishedVersion.version,
      archivedVersionId: result.archivedVersionId,
      webhookEndpointId: webhookEndpoint?.id,
    }
  });

  return { ...result, webhookEndpoint };
}

/**
 * Clone a workflow template with its latest published version.
 * Creates a new template with a draft copy of the published graph.
 */
export async function cloneWorkflow(
  workflowId: string,
  teamId: string,
  createdByUserId: string
) {
  const sourceTemplate = await getWorkflow(workflowId, teamId);

  const publishedVersion = sourceTemplate.versions.find(v => v.status === 'PUBLISHED');
  if (!publishedVersion) {
    throw new Error('Cannot clone workflow without a published version');
  }

  const clonedTemplate = await prisma.workflowTemplate.create({
    data: {
      slackTeamId: teamId,
      name: `Copy of ${sourceTemplate.name}`,
      description: sourceTemplate.description,
      triggerType: sourceTemplate.triggerType,
      isActive: false,
      createdByUserId,
      versions: {
        create: {
          version: 1,
          status: 'DRAFT',
          graph: publishedVersion.graph as any,
        }
      }
    },
    include: {
      versions: true
    }
  });

  // Audit log
  await logAudit({
    action: 'workflow_cloned',
    actorUserId: createdByUserId,
    actorTeamId: teamId,
    targetType: 'workflow_template',
    targetId: clonedTemplate.id,
    metadata: {
      sourceWorkflowId: workflowId,
      sourceWorkflowName: sourceTemplate.name
    }
  });

  return clonedTemplate;
}

/**
 * Archive a workflow template.
 * Deactivates the template and archives its published version.
 */
export async function archiveWorkflow(workflowId: string, teamId: string, userId?: string) {
  const template = await getWorkflow(workflowId, teamId);

  await prisma.$transaction(async (tx) => {
    // Archive published version if exists
    const publishedVersion = template.versions.find(v => v.status === 'PUBLISHED');
    if (publishedVersion) {
      await tx.workflowVersion.update({
        where: { id: publishedVersion.id },
        data: { status: 'ARCHIVED' }
      });
    }

    // Deactivate template
    await tx.workflowTemplate.update({
      where: { id: workflowId },
      data: {
        isActive: false,
        updatedAt: new Date()
      }
    });
  });

  // Deactivate any webhook endpoints
  try {
    await deactivateEndpoint(workflowId);
  } catch (err) {
    logger.warn('Failed to deactivate webhook endpoints on archive', {
      workflowId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Audit log
  await logAudit({
    action: 'workflow_archived',
    actorUserId: userId ?? 'system',
    actorTeamId: teamId,
    targetType: 'workflow_template',
    targetId: workflowId,
    metadata: {
      workflowName: template.name
    }
  });

  return template;
}

/**
 * Create a new draft version from the current published version.
 * Useful for making edits to a published workflow.
 */
export async function createDraftFromPublished(workflowId: string, teamId: string, userId?: string) {
  const template = await getWorkflow(workflowId, teamId);

  // Check no existing draft
  const existingDraft = template.versions.find(v => v.status === 'DRAFT');
  if (existingDraft) {
    throw new Error('A draft version already exists for this workflow');
  }

  // Find published version
  const publishedVersion = template.versions.find(v => v.status === 'PUBLISHED');
  if (!publishedVersion) {
    throw new Error('No published version found to create draft from');
  }

  // Create new draft with incremented version
  const maxVersion = Math.max(...template.versions.map(v => v.version));
  const newDraft = await prisma.workflowVersion.create({
    data: {
      templateId: workflowId,
      version: maxVersion + 1,
      status: 'DRAFT',
      graph: publishedVersion.graph as any,
    }
  });

  // Audit log
  await logAudit({
    action: 'workflow_draft_created',
    actorUserId: userId ?? 'system',
    actorTeamId: teamId,
    targetType: 'workflow_version',
    targetId: newDraft.id,
    metadata: {
      workflowId,
      workflowName: template.name,
      version: newDraft.version,
      sourceVersionId: publishedVersion.id
    }
  });

  return newDraft;
}

/**
 * Delete a workflow template permanently.
 * Prevents deletion if there are active executions.
 */
export async function deleteWorkflow(workflowId: string, teamId: string, userId?: string) {
  const template = await getWorkflow(workflowId, teamId);

  // Check for active executions
  const activeExecutions = await prisma.workflowExecution.count({
    where: {
      version: {
        templateId: workflowId
      },
      status: {
        notIn: ['COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED']
      }
    }
  });

  if (activeExecutions > 0) {
    throw new Error(
      `Cannot delete workflow with ${activeExecutions} active execution(s). ` +
      'Please wait for executions to complete or cancel them first.'
    );
  }

  // Delete template (cascades to versions)
  await prisma.workflowTemplate.delete({
    where: { id: workflowId }
  });

  // Audit log
  await logAudit({
    action: 'workflow_deleted',
    actorUserId: userId ?? 'system',
    actorTeamId: teamId,
    targetType: 'workflow_template',
    targetId: workflowId,
    metadata: {
      workflowName: template.name,
      triggerType: template.triggerType
    }
  });

  return { success: true };
}
