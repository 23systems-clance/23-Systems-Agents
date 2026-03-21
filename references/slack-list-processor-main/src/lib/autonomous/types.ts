/**
 * Type definitions for the Autonomous Agents domain (Feature 31).
 *
 * Uses "Specialty" naming at the application layer while Prisma schema
 * retains the original "Skill" / "SkillExecution" naming.
 */

import type {
  Severity,
  AuditOutcome,
  PendingActionStatus,
  AdminRole,
} from '@prisma/client';

// ---------------------------------------------------------------------------
// Agent Output
// ---------------------------------------------------------------------------

/** Structured output every autonomous agent must return. */
export interface AutonomousAgentOutput {
  /** Self-assessed confidence in the recommended action (0–1). */
  confidence: number;
  /** Machine-readable action identifier. */
  action: string;
  /** Human-readable explanation for the decision. */
  rationale: string;
  /** Action-specific payload (task ARN, contact details, etc.). */
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Confidence Gate
// ---------------------------------------------------------------------------

export type ConfidenceDecision = 'auto_execute' | 'suggest' | 'escalate';

export interface ConfidenceThresholds {
  /** Minimum confidence to auto-execute (default 0.85). */
  autoThreshold: number;
  /** Minimum confidence to suggest (default 0.50). Below this → escalate. */
  suggestThreshold: number;
}

export interface ConfidenceGateResult {
  decision: ConfidenceDecision;
  thresholds: ConfidenceThresholds;
}

/** Default thresholds per spec FR-060. */
export const DEFAULT_CONFIDENCE_THRESHOLDS: ConfidenceThresholds = {
  autoThreshold: 0.85,
  suggestThreshold: 0.50,
};

// ---------------------------------------------------------------------------
// Admin Slash Command
// ---------------------------------------------------------------------------

export type AdminSubcommand =
  | 'jobs'
  | 'job'
  | 'cancel'
  | 'usage'
  | 'errors'
  | 'workflows'
  | 'workers'
  | 'cache'
  | 'config'
  | 'audit'
  | 'help';

/** Minimum role required for each subcommand (FR-004). */
export const SUBCOMMAND_ROLES: Record<AdminSubcommand, AdminRole> = {
  jobs: 'VIEWER',
  job: 'VIEWER',
  cancel: 'EDITOR',
  usage: 'VIEWER',
  errors: 'VIEWER',
  workflows: 'VIEWER',
  workers: 'VIEWER',
  cache: 'ADMIN',
  config: 'VIEWER', // GET = VIEWER, PUT = ADMIN (checked in handler)
  audit: 'VIEWER',
  help: 'VIEWER',
};

// ---------------------------------------------------------------------------
// System Event Types
// ---------------------------------------------------------------------------

export const SYSTEM_EVENT_TYPES = {
  INFRASTRUCTURE_AUTO_HEAL: 'infrastructure_auto_heal',
  INFRASTRUCTURE_ESCALATION: 'infrastructure_escalation',
  WORKER_CONFIG_UPDATE: 'worker_config_update',
  QUALITY_AUTO_REMEDIATION: 'quality_auto_remediation',
  AGENT_STARTED: 'agent_started',
  AGENT_STOPPED: 'agent_stopped',
  AGENT_ERROR: 'agent_error',
  EXECUTION_COMPLETED: 'execution_completed',
  MODE_CHANGED: 'mode_changed',
  TEAM_UPDATED: 'team_updated',
  THRESHOLD_ALERT: 'threshold_alert',
  SYSTEM_HEALTH: 'system_health',
  CAMPAIGN_OPTIMIZATION: 'campaign_optimization',
  CAMPAIGN_EOD_REPORT: 'campaign_eod_report',
} as const;

export type SystemEventType =
  (typeof SYSTEM_EVENT_TYPES)[keyof typeof SYSTEM_EVENT_TYPES];

// ---------------------------------------------------------------------------
// Audit Action Types
// ---------------------------------------------------------------------------

export const AUDIT_ACTION_TYPES = {
  ECS_TASK_RESTART: 'ecs_task_restart',
  ECS_TASK_ESCALATION: 'ecs_task_escalation',
  CONCURRENCY_UPDATE: 'concurrency_update',
  CONCURRENCY_PAUSE: 'concurrency_pause',
  CONCURRENCY_RESUME: 'concurrency_resume',
  GITHUB_ISSUE_CREATED: 'github_issue_created',
  ANOMALY_DETECTED: 'anomaly_detected',
  ROOT_CAUSE_CLASSIFIED: 'root_cause_classified',
  AUTO_REMEDIATION_APPLIED: 'auto_remediation_applied',
  CAMPAIGN_SCHEDULE_UPDATE: 'campaign_schedule_update',
  AB_TEST_WINNER: 'ab_test_winner',
  CRM_AUTO_MERGE: 'crm_auto_merge',
  CRM_CONFLICT_SUGGESTED: 'crm_conflict_suggested',
  CRM_CONFLICT_ESCALATED: 'crm_conflict_escalated',
  ADMIN_COMMAND: 'admin_command',
} as const;

export type AuditActionType =
  (typeof AUDIT_ACTION_TYPES)[keyof typeof AUDIT_ACTION_TYPES];

// ---------------------------------------------------------------------------
// Agent Name Constants
// ---------------------------------------------------------------------------

export const AGENT_NAMES = {
  INFRASTRUCTURE_MAINTENANCE: 'Infrastructure Maintenance',
  API_RATE_LIMIT_MANAGER: 'API Rate Limit Manager',
  ANOMALY_DETECTOR: 'Anomaly Detector',
  ROOT_CAUSE_ANALYZER: 'Root Cause Analyzer',
  AUTO_REMEDIATION_EXECUTOR: 'Auto-Remediation Executor',
  CAMPAIGN_OPTIMIZER: 'Campaign Optimizer',
  CRM_CONFLICT_RESOLVER: 'CRM Conflict Resolver',
} as const;

export type AgentName = (typeof AGENT_NAMES)[keyof typeof AGENT_NAMES];

// ---------------------------------------------------------------------------
// ECS Failure Classification
// ---------------------------------------------------------------------------

export type FailureType = 'transient' | 'code_bug';

export interface FailureClassification {
  type: FailureType;
  confidence: number;
  reason: string;
}

// ---------------------------------------------------------------------------
// Suggest-Only Mode
// ---------------------------------------------------------------------------

/** Graduation criteria: >=90% approval over 50+ actions (FR-064a, FR-064b). */
export const GRADUATION_CRITERIA = {
  MIN_REVIEWS: 50,
  MIN_APPROVAL_RATE: 0.90,
} as const;

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

export type { Severity, AuditOutcome, PendingActionStatus };
