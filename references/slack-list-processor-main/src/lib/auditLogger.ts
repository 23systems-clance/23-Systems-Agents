/**
 * Audit logging helper.
 *
 * Creates immutable AuditLog records for SOC 2 compliance and
 * user-action traceability. Uses a fire-and-forget pattern so
 * callers do not need to await the result.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../models/index.js';
import logger from './logger.js';

/**
 * Canonical set of auditable actions within the application.
 */
export type AuditAction =
  | 'file_upload'
  | 'enrich_request'
  | 'button_click'
  | 'job_download'
  | 'job_completed'
  | 'job_failed'
  | 'doc_upload'
  | 'doc_classify'
  | 'doc_archive'
  | 'doc_reference'
  // Admin dashboard actions (Feature 3)
  | 'error_acknowledged'
  | 'error_resolved'
  | 'error_reopened'
  | 'threshold_created'
  | 'threshold_updated'
  | 'threshold_triggered'
  | 'report_exported'
  | 'report_scheduled'
  | 'retention_updated'
  | 'admin_authenticated'
  | 'admin_login'
  | 'admin_logout'
  | 'admin_user_created'
  | 'admin_user_updated'
  | 'admin_user_deleted'
  // Client & BDR management actions
  | 'client_created'
  | 'client_updated'
  | 'client_deactivated'
  | 'bdr_created'
  | 'bdr_updated'
  | 'bdr_deactivated'
  | 'bdr_client_associated'
  | 'bdr_client_disassociated'
  // Enrichment preset actions
  | 'preset_created'
  | 'preset_updated'
  | 'preset_deleted'
  // Onboarding actions (Feature 7)
  | 'onboarding_plan_created'
  | 'onboarding_plan_updated'
  | 'onboarding_plan_deleted'
  | 'onboarding_plan_duplicated'
  | 'onboarding_enrollment_created'
  | 'onboarding_enrollment_updated'
  | 'onboarding_enrollment_cancelled'
  | 'onboarding_enrollment_graduated'
  | 'onboarding_enrollment_extended'
  | 'onboarding_enrollment_rejected'
  | 'onboarding_module_completed'
  | 'onboarding_quiz_submitted'
  | 'onboarding_practice_reviewed'
  | 'onboarding_automation_fired'
  | 'onboarding_enrollment_via_slack'
  | 'bdr_manager_assigned'
  | 'onboarding_library_item_created'
  | 'onboarding_library_item_updated'
  | 'onboarding_library_item_deleted'
  // Workflow builder actions (Feature 7-workflow-builder)
  | 'workflow_created'
  | 'workflow_updated'
  | 'workflow_published'
  | 'workflow_cloned'
  | 'workflow_archived'
  | 'workflow_deleted'
  | 'workflow_draft_created'
  // Workflow channel scoping actions (Feature 21)
  | 'workflow.auto_deactivated'
  | 'workflow.client_assigned'
  | 'workflow.client_removed'
  | 'workflow.channel_mapped'
  | 'workflow.channel_unmapped'
  // Campaign management actions (Feature 8)
  | 'campaign_updated'
  | 'campaign_activated'
  | 'campaign_deleted'
  | 'campaign_archived'
  // Billing actions (Feature 12)
  | 'billing_profile_created'
  | 'billing_profile_updated'
  | 'billing_status_changed'
  | 'billing_credit_adjusted'
  | 'credit_rates_updated'
  // HubSpot integration actions (Feature 14)
  | 'hubspot_connected'
  | 'hubspot_disconnected'
  | 'hubspot_token_refreshed'
  | 'hubspot_token_expired'
  | 'hubspot_import_started'
  | 'hubspot_import_completed'
  | 'hubspot_import_failed'
  | 'hubspot_activity_synced'
  | 'hubspot_activity_sync_failed'
  | 'hubspot_webhook_received'
  // Quality gate config actions (Feature 16)
  | 'quality_gate_config_updated'
  | 'quality_gate_config_reset'
  // Provider cost management actions (Feature 27)
  | 'provider_cost_created'
  | 'provider_cost_updated'
  | 'provider_cost_deleted'
  // Apollo cache admin actions (Feature 22)
  | 'APOLLO_CACHE_CONFIG_UPDATED'
  | 'APOLLO_CACHE_PURGED'
  | 'APOLLO_CACHE_ENTRY_DELETED'
  // Cache management actions (Feature 17)
  | 'cache_config_updated'
  | 'cache_purged'
  | 'cache_entry_deleted'
  | 'cache_auto_purge'
  // Prompt library actions (Feature 19)
  | 'prompt_created'
  | 'prompt_updated'
  | 'prompt_version_created'
  | 'prompt_published'
  | 'prompt_archived'
  | 'prompt_tested'
  | 'prompt_variable_created'
  | 'prompt_variable_updated'
  | 'prompt_override_set'
  | 'prompt_override_removed'
  | 'prompt_cache_flushed'
  | 'prompt_reset_to_defaults'
  // Multi-tenant SaaS licensing actions (Feature 35)
  | 'CREDIT_PACK_PURCHASED'
  | 'ENRICHMENT_CHANNEL_REGISTERED'
  | 'ANALYSIS_CHANNEL_REGISTERED'
  | 'ONBOARDING_COMPLETED'
  // Platform entity actions (Feature 39 - Vertical Pack Platform)
  | 'platform_agent_created'
  | 'platform_agent_updated'
  | 'platform_agent_deleted'
  | 'platform_agent_published'
  | 'platform_agent_deprecated'
  | 'platform_agent_tested'
  | 'platform_mcp_server_created'
  | 'platform_mcp_server_updated'
  | 'platform_mcp_server_deleted'
  | 'platform_mcp_tool_added'
  | 'platform_mcp_tool_updated'
  | 'platform_mcp_tool_removed'
  | 'platform_mcp_health_checked'
  | 'platform_skill_created'
  | 'platform_skill_updated'
  | 'platform_skill_published'
  | 'platform_skill_deprecated'
  | 'platform_skill_tested'
  | 'platform_pack_created'
  | 'platform_pack_updated'
  | 'platform_pack_published'
  | 'platform_pack_deprecated'
  | 'platform_pack_skills_assigned'
  | 'platform_byok_credentials_set';

/**
 * Input data for recording a single audit event.
 */
export interface AuditEntry {
  /** The action being audited. */
  action: AuditAction;
  /** Slack user ID of the actor who triggered the action. */
  actorUserId: string;
  /** Slack team/workspace ID, if available. */
  actorTeamId?: string;
  /** The type of entity being acted upon (e.g. "job", "file"). */
  targetType?: string;
  /** The identifier of the target entity. */
  targetId?: string;
  /** Slack channel where the action occurred. */
  channelId?: string;
  /** Arbitrary structured metadata to attach to the audit record. */
  metadata?: Record<string, unknown>;
}

/**
 * Persists an audit log record to the database.
 *
 * Designed as fire-and-forget: errors are caught internally and logged
 * rather than propagated. Callers should not await the returned promise
 * unless they need confirmation that the write succeeded.
 *
 * @param entry - The audit data to record.
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        actorUserId: entry.actorUserId,
        actorTeamId: entry.actorTeamId ?? null,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        channelId: entry.channelId ?? null,
        metadata: (entry.metadata as Prisma.InputJsonValue) ?? undefined,
      },
    });

    logger.debug('Audit event recorded', {
      action: entry.action,
      actorUserId: entry.actorUserId,
    });
  } catch (error) {
    logger.error('Failed to record audit event', {
      action: entry.action,
      actorUserId: entry.actorUserId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
