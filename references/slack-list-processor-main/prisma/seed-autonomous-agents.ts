/**
 * Seed script for autonomous agent records (T051, T057, T073, T080, T088).
 *
 * Creates Agent records, initial AgentVersions, and associated Skills
 * for the following agents:
 *   - Infrastructure Maintenance (T051): SCHEDULED health check every 5 min.
 *   - API Rate Limit Manager (T057): SCHEDULED quota check every 5 min.
 *   - Anomaly Detector (T073): SCHEDULED anomaly scan every 15 min.
 *   - Root Cause Analyzer (T073): EVENT-triggered on 'anomaly.detected'.
 *   - Auto-Remediation Executor (T073): EVENT-triggered on 'rootcause.classified'.
 *   - Campaign Optimizer (T080): SCHEDULED daily optimisation at 6 AM UTC.
 *   - CRM Conflict Resolver (T088): EVENT-triggered on 'hubspot.sync.conflict'.
 *
 * Also creates the Quality Monitoring team linking the 3 quality agents.
 *
 * Idempotent: skips creation if the agent slug already exists.
 *
 * Run via: npx tsx prisma/seed-autonomous-agents.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('Seeding autonomous agents...');

  // -----------------------------------------------------------------------
  // Infrastructure Maintenance Agent
  // -----------------------------------------------------------------------

  const agentSlug = 'infrastructure-maintenance';
  const existing = await prisma.agent.findUnique({
    where: { slug: agentSlug },
  });

  if (existing) {
    console.log(`  Skipping "${existing.name}" agent (slug "${agentSlug}" already exists)`);
  } else {
    const agent = await prisma.agent.create({
      data: {
        name: 'Infrastructure Maintenance',
        slug: agentSlug,
        description:
          'Monitors ECS tasks for failures, auto-restarts transient issues, ' +
          'and escalates code bugs to GitHub issues.',
        status: 'DRAFT',
        modelId: 'claude-3-5-haiku-20241022',
        maxTokens: 1024,
        creditCost: 0,
        suggestOnlyMode: true,
        toolIds: [
          'ecs-list-stopped-tasks',
          'ecs-describe-task-details',
          'ecs-restart-task',
          'ecs-classify-failure',
          'cloudwatch-query-error-logs',
          'github-create-issue',
        ],
      },
    });

    console.log(`  Created agent "${agent.name}" (id: ${agent.id})`);

    // Create initial AgentVersion (required for Skill relation)
    const agentVersion = await prisma.agentVersion.create({
      data: {
        agentId: agent.id,
        version: 1,
        status: 'DRAFT',
        systemPrompt:
          'You are the Infrastructure Maintenance agent. ' +
          'You monitor ECS tasks for failures and take corrective action.',
        modelId: 'claude-3-5-haiku-20241022',
        maxTokens: 1024,
        toolIds: agent.toolIds,
      },
    });

    console.log(`  Created agent version v${agentVersion.version} (id: ${agentVersion.id})`);

    // Create associated Skill with SCHEDULED trigger
    const skill = await prisma.skill.create({
      data: {
        name: 'Infrastructure Health Check',
        slug: 'infrastructure-health-check',
        description:
          'Scheduled skill that checks ECS task health every 5 minutes ' +
          'and takes corrective action on failures.',
        status: 'DRAFT',
        agentId: agent.id,
        agentVersionId: agentVersion.id,
        triggerType: 'SCHEDULED',
        triggerConfig: {
          cronPattern: '*/5 * * * *',
        },
        deliveryChannels: [],
        creditCost: 0,
        retryPolicy: {
          maxAttempts: 3,
          baseDelayMs: 1000,
        },
      },
    });

    console.log(`  Created skill "${skill.name}" (id: ${skill.id})`);
    console.log(`    Trigger: SCHEDULED (*/5 * * * *)`);
    console.log(`    Status: DRAFT`);
    console.log(`    Suggest-only mode: enabled`);
  }

  // -----------------------------------------------------------------------
  // API Rate Limit Manager Agent (T057)
  // -----------------------------------------------------------------------

  const rateLimitSlug = 'api-rate-limit-manager';
  const existingRateLimit = await prisma.agent.findUnique({
    where: { slug: rateLimitSlug },
  });

  if (existingRateLimit) {
    console.log(`  Skipping "${existingRateLimit.name}" agent (slug "${rateLimitSlug}" already exists)`);
  } else {
    const rateLimitAgent = await prisma.agent.create({
      data: {
        name: 'API Rate Limit Manager',
        slug: rateLimitSlug,
        description:
          'Monitors API quota utilization for BuiltWith and Apollo providers. ' +
          'Dynamically adjusts enrichment worker concurrency based on hourly usage ' +
          'thresholds, pauses workers when quota is critically high, and escalates ' +
          'on excessive fluctuations.',
        status: 'DRAFT',
        modelId: 'claude-3-5-haiku-20241022',
        maxTokens: 1024,
        creditCost: 0,
        suggestOnlyMode: true,
      },
    });

    console.log(`  Created agent "${rateLimitAgent.name}" (id: ${rateLimitAgent.id})`);

    // Create initial AgentVersion (required for Skill relation)
    const rateLimitVersion = await prisma.agentVersion.create({
      data: {
        agentId: rateLimitAgent.id,
        version: 1,
        status: 'DRAFT',
        systemPrompt:
          'You are the API Rate Limit Manager agent. Your role is to monitor API quota ' +
          'utilization and adjust worker concurrency to prevent rate limit violations. ' +
          'You operate on a 5-minute schedule and make decisions based on hourly usage data.',
        modelId: 'claude-3-5-haiku-20241022',
        maxTokens: 1024,
      },
    });

    console.log(`  Created agent version v${rateLimitVersion.version} (id: ${rateLimitVersion.id})`);

    // Create associated Skill with SCHEDULED trigger
    const rateLimitSkill = await prisma.skill.create({
      data: {
        name: 'API Rate Limit Check',
        slug: 'api-rate-limit-check',
        description:
          'Scheduled skill that evaluates API quota utilization every 5 minutes ' +
          'and adjusts enrichment worker concurrency accordingly.',
        status: 'DRAFT',
        agentId: rateLimitAgent.id,
        agentVersionId: rateLimitVersion.id,
        triggerType: 'SCHEDULED',
        triggerConfig: {
          cronPattern: '*/5 * * * *',
        },
        deliveryChannels: [],
        creditCost: 0,
        retryPolicy: {
          maxAttempts: 3,
          baseDelayMs: 1000,
        },
      },
    });

    console.log(`  Created skill "${rateLimitSkill.name}" (id: ${rateLimitSkill.id})`);
    console.log(`    Trigger: SCHEDULED (*/5 * * * *)`);
    console.log(`    Status: DRAFT`);
    console.log(`    Suggest-only mode: enabled`);
  }

  // -----------------------------------------------------------------------
  // Anomaly Detector Agent (T073)
  // -----------------------------------------------------------------------

  const anomalyDetectorSlug = 'anomaly-detector';
  const existingAnomalyDetector = await prisma.agent.findUnique({
    where: { slug: anomalyDetectorSlug },
  });

  let anomalyDetectorId: string;

  if (existingAnomalyDetector) {
    console.log(`  Skipping "${existingAnomalyDetector.name}" agent (slug "${anomalyDetectorSlug}" already exists)`);
    anomalyDetectorId = existingAnomalyDetector.id;
  } else {
    const anomalyDetectorAgent = await prisma.agent.create({
      data: {
        name: 'Anomaly Detector',
        slug: anomalyDetectorSlug,
        description:
          'Monitors enrichment job error rates and latency metrics on a 15-minute schedule. ' +
          'Detects anomalies using statistical analysis and emits anomaly.detected events ' +
          'for downstream processing by the Root Cause Analyzer.',
        status: 'DRAFT',
        modelId: 'claude-3-5-haiku-20241022',
        maxTokens: 1024,
        creditCost: 0,
        suggestOnlyMode: true,
      },
    });

    anomalyDetectorId = anomalyDetectorAgent.id;
    console.log(`  Created agent "${anomalyDetectorAgent.name}" (id: ${anomalyDetectorAgent.id})`);

    const anomalyDetectorVersion = await prisma.agentVersion.create({
      data: {
        agentId: anomalyDetectorAgent.id,
        version: 1,
        status: 'DRAFT',
        systemPrompt:
          'You are the Anomaly Detector agent. You monitor enrichment job metrics ' +
          'and detect statistical anomalies in error rates and latency.',
        modelId: 'claude-3-5-haiku-20241022',
        maxTokens: 1024,
      },
    });

    console.log(`  Created agent version v${anomalyDetectorVersion.version} (id: ${anomalyDetectorVersion.id})`);

    const anomalyDetectorSkill = await prisma.skill.create({
      data: {
        name: 'Anomaly Detection Scan',
        slug: 'anomaly-detection-scan',
        description:
          'Scheduled skill that scans enrichment job metrics every 15 minutes ' +
          'and detects anomalies using statistical analysis.',
        status: 'DRAFT',
        agentId: anomalyDetectorAgent.id,
        agentVersionId: anomalyDetectorVersion.id,
        triggerType: 'SCHEDULED',
        triggerConfig: {
          cronPattern: '*/15 * * * *',
        },
        chainEventName: 'anomaly.detected',
        deliveryChannels: [],
        creditCost: 0,
        retryPolicy: {
          maxAttempts: 3,
          baseDelayMs: 1000,
        },
      },
    });

    console.log(`  Created skill "${anomalyDetectorSkill.name}" (id: ${anomalyDetectorSkill.id})`);
    console.log(`    Trigger: SCHEDULED (*/15 * * * *)`);
    console.log(`    Chain event: anomaly.detected`);
    console.log(`    Status: DRAFT`);
    console.log(`    Suggest-only mode: enabled`);
  }

  // -----------------------------------------------------------------------
  // Root Cause Analyzer Agent (T073)
  // -----------------------------------------------------------------------

  const rootCauseSlug = 'root-cause-analyzer';
  const existingRootCause = await prisma.agent.findUnique({
    where: { slug: rootCauseSlug },
  });

  let rootCauseId: string;

  if (existingRootCause) {
    console.log(`  Skipping "${existingRootCause.name}" agent (slug "${rootCauseSlug}" already exists)`);
    rootCauseId = existingRootCause.id;
  } else {
    const rootCauseAgent = await prisma.agent.create({
      data: {
        name: 'Root Cause Analyzer',
        slug: rootCauseSlug,
        description:
          'Analyses anomalies detected by the Anomaly Detector to classify error ' +
          'patterns into actionable categories (api_timeout, quota_exceeded, ' +
          'data_quality, infrastructure). Emits rootcause.classified events.',
        status: 'DRAFT',
        modelId: 'claude-3-5-haiku-20241022',
        maxTokens: 1024,
        creditCost: 0,
        suggestOnlyMode: true,
      },
    });

    rootCauseId = rootCauseAgent.id;
    console.log(`  Created agent "${rootCauseAgent.name}" (id: ${rootCauseAgent.id})`);

    const rootCauseVersion = await prisma.agentVersion.create({
      data: {
        agentId: rootCauseAgent.id,
        version: 1,
        status: 'DRAFT',
        systemPrompt:
          'You are the Root Cause Analyzer agent. You classify anomalies into ' +
          'actionable error categories for downstream remediation.',
        modelId: 'claude-3-5-haiku-20241022',
        maxTokens: 1024,
      },
    });

    console.log(`  Created agent version v${rootCauseVersion.version} (id: ${rootCauseVersion.id})`);

    const rootCauseSkill = await prisma.skill.create({
      data: {
        name: 'Root Cause Classification',
        slug: 'root-cause-classification',
        description:
          'Event-triggered skill that analyses anomalies and classifies their ' +
          'root cause into actionable categories.',
        status: 'DRAFT',
        agentId: rootCauseAgent.id,
        agentVersionId: rootCauseVersion.id,
        triggerType: 'EVENT',
        triggerConfig: {
          eventName: 'anomaly.detected',
        },
        chainEventName: 'rootcause.classified',
        deliveryChannels: [],
        creditCost: 0,
        retryPolicy: {
          maxAttempts: 3,
          baseDelayMs: 1000,
        },
      },
    });

    console.log(`  Created skill "${rootCauseSkill.name}" (id: ${rootCauseSkill.id})`);
    console.log(`    Trigger: EVENT (anomaly.detected)`);
    console.log(`    Chain event: rootcause.classified`);
    console.log(`    Status: DRAFT`);
    console.log(`    Suggest-only mode: enabled`);
  }

  // -----------------------------------------------------------------------
  // Auto-Remediation Executor Agent (T073)
  // -----------------------------------------------------------------------

  const autoRemediationSlug = 'auto-remediation-executor';
  const existingAutoRemediation = await prisma.agent.findUnique({
    where: { slug: autoRemediationSlug },
  });

  let autoRemediationId: string;

  if (existingAutoRemediation) {
    console.log(`  Skipping "${existingAutoRemediation.name}" agent (slug "${autoRemediationSlug}" already exists)`);
    autoRemediationId = existingAutoRemediation.id;
  } else {
    const autoRemediationAgent = await prisma.agent.create({
      data: {
        name: 'Auto-Remediation Executor',
        slug: autoRemediationSlug,
        description:
          'Receives classified root causes and applies matching remediation rules. ' +
          'Auto-applies fixes when confidence is high, suggests for human review when ' +
          'confidence is moderate, and escalates unknown patterns to GitHub issues.',
        status: 'DRAFT',
        modelId: 'claude-3-5-haiku-20241022',
        maxTokens: 1024,
        creditCost: 0,
        suggestOnlyMode: true,
      },
    });

    autoRemediationId = autoRemediationAgent.id;
    console.log(`  Created agent "${autoRemediationAgent.name}" (id: ${autoRemediationAgent.id})`);

    const autoRemediationVersion = await prisma.agentVersion.create({
      data: {
        agentId: autoRemediationAgent.id,
        version: 1,
        status: 'DRAFT',
        systemPrompt:
          'You are the Auto-Remediation Executor agent. You apply remediation rules ' +
          'based on classified root causes and escalate unknown patterns.',
        modelId: 'claude-3-5-haiku-20241022',
        maxTokens: 1024,
      },
    });

    console.log(`  Created agent version v${autoRemediationVersion.version} (id: ${autoRemediationVersion.id})`);

    const autoRemediationSkill = await prisma.skill.create({
      data: {
        name: 'Auto-Remediation Execution',
        slug: 'auto-remediation-execution',
        description:
          'Event-triggered skill that applies remediation rules based on ' +
          'root cause classifications.',
        status: 'DRAFT',
        agentId: autoRemediationAgent.id,
        agentVersionId: autoRemediationVersion.id,
        triggerType: 'EVENT',
        triggerConfig: {
          eventName: 'rootcause.classified',
        },
        deliveryChannels: [],
        creditCost: 0,
        retryPolicy: {
          maxAttempts: 3,
          baseDelayMs: 1000,
        },
      },
    });

    console.log(`  Created skill "${autoRemediationSkill.name}" (id: ${autoRemediationSkill.id})`);
    console.log(`    Trigger: EVENT (rootcause.classified)`);
    console.log(`    Status: DRAFT`);
    console.log(`    Suggest-only mode: enabled`);
  }

  // -----------------------------------------------------------------------
  // Quality Monitoring Team (T073)
  // -----------------------------------------------------------------------

  const qualityTeamSlug = 'quality-monitoring';
  const existingTeam = await prisma.team.findUnique({
    where: { slug: qualityTeamSlug },
  });

  if (existingTeam) {
    console.log(`  Skipping "${existingTeam.name}" team (slug "${qualityTeamSlug}" already exists)`);
  } else {
    const qualityTeam = await prisma.team.create({
      data: {
        name: 'Quality Monitoring',
        slug: qualityTeamSlug,
        description:
          'Chains Anomaly Detector -> Root Cause Analyzer -> Auto-Remediation Executor ' +
          'to automatically detect, diagnose, and fix enrichment quality issues.',
        status: 'ACTIVE',
      },
    });

    console.log(`  Created team "${qualityTeam.name}" (id: ${qualityTeam.id})`);

    // Link agents to team with sort order
    const teamAgentData = [
      { agentId: anomalyDetectorId, sortOrder: 0 },
      { agentId: rootCauseId, sortOrder: 1 },
      { agentId: autoRemediationId, sortOrder: 2 },
    ];

    for (const { agentId, sortOrder } of teamAgentData) {
      const existing = await prisma.teamAgent.findUnique({
        where: {
          teamId_agentId: {
            teamId: qualityTeam.id,
            agentId,
          },
        },
      });

      if (!existing) {
        await prisma.teamAgent.create({
          data: {
            teamId: qualityTeam.id,
            agentId,
            sortOrder,
          },
        });
      }
    }

    console.log(`  Linked 3 agents to "${qualityTeam.name}" team`);
    console.log(`    Sort order: Anomaly Detector (0) -> Root Cause Analyzer (1) -> Auto-Remediation Executor (2)`);
  }

  // -----------------------------------------------------------------------
  // Campaign Optimizer Agent (T080)
  // -----------------------------------------------------------------------

  const campaignOptimizerSlug = 'campaign-optimizer';
  const existingCampaignOptimizer = await prisma.agent.findUnique({
    where: { slug: campaignOptimizerSlug },
  });

  if (existingCampaignOptimizer) {
    console.log(`  Skipping "${existingCampaignOptimizer.name}" agent (slug "${campaignOptimizerSlug}" already exists)`);
  } else {
    const campaignOptimizerAgent = await prisma.agent.create({
      data: {
        name: 'Campaign Optimizer',
        slug: campaignOptimizerSlug,
        description:
          'Optimises campaign send times and A/B test selections using statistical ' +
          'analysis of DM open rates and response rates. Runs daily at 6 AM UTC.',
        status: 'DRAFT',
        modelId: 'claude-3-5-haiku-20241022',
        maxTokens: 1024,
        creditCost: 0,
        suggestOnlyMode: true,
      },
    });

    console.log(`  Created agent "${campaignOptimizerAgent.name}" (id: ${campaignOptimizerAgent.id})`);

    const campaignOptimizerVersion = await prisma.agentVersion.create({
      data: {
        agentId: campaignOptimizerAgent.id,
        version: 1,
        status: 'DRAFT',
        systemPrompt:
          'You are the Campaign Optimizer agent. You analyse campaign engagement metrics ' +
          'to identify optimal send times and A/B test winners using statistical testing.',
        modelId: 'claude-3-5-haiku-20241022',
        maxTokens: 1024,
      },
    });

    console.log(`  Created agent version v${campaignOptimizerVersion.version} (id: ${campaignOptimizerVersion.id})`);

    const campaignOptimizerSkill = await prisma.skill.create({
      data: {
        name: 'Campaign Send Time Optimization',
        slug: 'campaign-send-time-optimization',
        description:
          'Scheduled skill that analyses campaign DM metrics daily at 6 AM UTC ' +
          'and optimises send times and A/B test selections.',
        status: 'DRAFT',
        agentId: campaignOptimizerAgent.id,
        agentVersionId: campaignOptimizerVersion.id,
        triggerType: 'SCHEDULED',
        triggerConfig: {
          cronPattern: '0 6 * * *',
        },
        deliveryChannels: [],
        creditCost: 0,
        retryPolicy: {
          maxAttempts: 3,
          baseDelayMs: 1000,
        },
      },
    });

    console.log(`  Created skill "${campaignOptimizerSkill.name}" (id: ${campaignOptimizerSkill.id})`);
    console.log(`    Trigger: SCHEDULED (0 6 * * *)`);
    console.log(`    Status: DRAFT`);
    console.log(`    Suggest-only mode: enabled`);
  }

  // -----------------------------------------------------------------------
  // CRM Conflict Resolver Agent (T088)
  // -----------------------------------------------------------------------

  const crmConflictSlug = 'crm-conflict-resolver';
  const existingCrmConflict = await prisma.agent.findUnique({
    where: { slug: crmConflictSlug },
  });

  if (existingCrmConflict) {
    console.log(`  Skipping "${existingCrmConflict.name}" agent (slug "${crmConflictSlug}" already exists)`);
  } else {
    const crmConflictAgent = await prisma.agent.create({
      data: {
        name: 'CRM Conflict Resolver',
        slug: crmConflictSlug,
        description:
          'Resolves CRM sync conflicts by scoring record similarity using weighted ' +
          'feature comparison (email, company name, domain, phone, title). Auto-merges ' +
          'high-confidence matches, suggests moderate matches for admin review, and ' +
          'escalates low-confidence conflicts. Includes a learning loop that refines ' +
          'weights from admin feedback.',
        status: 'DRAFT',
        modelId: 'claude-3-5-haiku-20241022',
        maxTokens: 1024,
        creditCost: 0,
        suggestOnlyMode: true,
      },
    });

    console.log(`  Created agent "${crmConflictAgent.name}" (id: ${crmConflictAgent.id})`);

    const crmConflictVersion = await prisma.agentVersion.create({
      data: {
        agentId: crmConflictAgent.id,
        version: 1,
        status: 'DRAFT',
        systemPrompt:
          'You are the CRM Conflict Resolver agent. You evaluate CRM sync conflicts ' +
          'using weighted feature scoring and route decisions based on confidence thresholds.',
        modelId: 'claude-3-5-haiku-20241022',
        maxTokens: 1024,
      },
    });

    console.log(`  Created agent version v${crmConflictVersion.version} (id: ${crmConflictVersion.id})`);

    const crmConflictSkill = await prisma.skill.create({
      data: {
        name: 'CRM Conflict Resolution',
        slug: 'crm-conflict-resolution',
        description:
          'Event-triggered skill that evaluates CRM sync conflicts and makes ' +
          'confidence-based merge/escalation decisions.',
        status: 'DRAFT',
        agentId: crmConflictAgent.id,
        agentVersionId: crmConflictVersion.id,
        triggerType: 'EVENT',
        triggerConfig: {
          eventName: 'hubspot.sync.conflict',
        },
        deliveryChannels: [],
        creditCost: 0,
        retryPolicy: {
          maxAttempts: 3,
          baseDelayMs: 1000,
        },
      },
    });

    console.log(`  Created skill "${crmConflictSkill.name}" (id: ${crmConflictSkill.id})`);
    console.log(`    Trigger: EVENT (hubspot.sync.conflict)`);
    console.log(`    Status: DRAFT`);
    console.log(`    Suggest-only mode: enabled`);
  }

  console.log('Autonomous agent seeding complete.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
