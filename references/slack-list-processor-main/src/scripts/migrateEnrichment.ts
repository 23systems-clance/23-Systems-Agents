/**
 * Enrichment Pipeline Migration Script (T052-T055 — Feature 39).
 *
 * Creates platform records for the existing enrichment pipeline:
 *   - Agent records for AI functions (intent classifier, document classifier, etc.)
 *   - AgentVersion records with system prompts
 *   - McpServer records for external integrations (Apollo, BuiltWith, etc.)
 *   - McpTool records for each API capability
 *   - Skill records composing agents + MCP tools
 *   - Enrichment Pack bundling all skills
 *
 * Idempotent: uses upsert by slug to allow re-running safely.
 *
 * Usage: npx tsx src/scripts/migrateEnrichment.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// System Prompts (extracted from existing service files)
// ---------------------------------------------------------------------------

const INTENT_CLASSIFIER_PROMPT = `You are an intent classifier for a Slack-based AI agent that helps users with company list enrichment. Users interact via a conversational side-panel.

Classify the user's message into exactly one of these intents:

**Enrichment intents:**
1. **technographic** — Enrich a company list with technology stack data (BuiltWith). Keywords: "tech stacks", "technologies", "what software they use".
2. **contact** — Find decision makers / contacts for companies (Apollo.io). Keywords: "contacts", "decision makers", "people", "emails", "find who".
3. **combined** — Both tech data AND contacts. Keywords: "full enrichment", "everything", "tech stacks and contacts".
4. **tech_report** — Generate a technology adoption report (no file needed). Keywords: "find companies using [tech]", "who uses [tech]".

**Job management intents:**
5. **job_status** — Check on running/recent jobs.
6. **job_cancel** — Cancel/stop a job.
7. **job_history** — View past enrichments.
8. **job_download** — Download results from a job.

**Filter intent:**
9. **filter_results** — Filter previous enrichment results.

**Admin intent:**
10. **usage_query** — Check workspace API usage/costs.

**Settings intent:**
11. **settings_update** — Update workspace settings.

**Conversation management:**
12. **help** — User asking what the agent can do.
13. **clarification** — User responding to a question with additional info.
14. **confirmation** — User confirming a proposed action.
15. **unknown** — Message doesn't match any intent.`;

const DOCUMENT_CLASSIFIER_PROMPT = `You are a document classifier for a sales enrichment platform. Users upload documents to configure how company lists are enriched. Classify each document into exactly one type:

1. ICP (Ideal Customer Profile) - Targeting criteria, audience definitions, company filters
2. USE_CASE - Enrichment scenarios, workflow descriptions, campaign strategies
3. SETTINGS - Configuration with key-value pairs (decision makers count, personas, integrations)
4. ONE_PAGER - Marketing materials, product overviews, sales collateral, company briefs
5. UNKNOWN - Does not clearly match any category

Generate a concise one-sentence summary suitable for a table of contents.`;

const REPORT_ANALYZER_PROMPT = `You are a business intelligence analyst generating a professional account analysis report for a technology sales team. Be concise, data-driven, and actionable.`;

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

async function migrate() {
  console.log('Starting enrichment pipeline migration...\n');

  // -----------------------------------------------------------------------
  // T052: Create Agent records
  // -----------------------------------------------------------------------
  console.log('--- T052: Creating Agent records ---');

  const intentClassifier = await prisma.agent.upsert({
    where: { slug: 'intent-classifier' },
    update: {},
    create: {
      name: 'Intent Classifier',
      slug: 'intent-classifier',
      description: 'Classifies user messages into enrichment intents using Claude tool-use.',
      status: 'PUBLISHED',
      modelId: 'claude-3-5-haiku-20241022',
      maxTokens: 1024,
      creditCost: 0.01,
    },
  });
  console.log(`  Agent: ${intentClassifier.name} (${intentClassifier.id})`);

  // Create published version for intent classifier
  const icVersion = await prisma.agentVersion.upsert({
    where: { agentId_version: { agentId: intentClassifier.id, version: 1 } },
    update: {},
    create: {
      agentId: intentClassifier.id,
      version: 1,
      status: 'PUBLISHED',
      systemPrompt: INTENT_CLASSIFIER_PROMPT,
      modelId: 'claude-3-5-haiku-20241022',
      maxTokens: 1024,
      publishedAt: new Date(),
    },
  });

  const documentClassifier = await prisma.agent.upsert({
    where: { slug: 'document-classifier' },
    update: {},
    create: {
      name: 'Document Classifier',
      slug: 'document-classifier',
      description: 'Classifies uploaded configuration documents (ICP, USE_CASE, SETTINGS, ONE_PAGER).',
      status: 'PUBLISHED',
      modelId: 'claude-3-5-haiku-20241022',
      maxTokens: 1024,
      creditCost: 0.01,
    },
  });
  console.log(`  Agent: ${documentClassifier.name} (${documentClassifier.id})`);

  const dcVersion = await prisma.agentVersion.upsert({
    where: { agentId_version: { agentId: documentClassifier.id, version: 1 } },
    update: {},
    create: {
      agentId: documentClassifier.id,
      version: 1,
      status: 'PUBLISHED',
      systemPrompt: DOCUMENT_CLASSIFIER_PROMPT,
      modelId: 'claude-3-5-haiku-20241022',
      maxTokens: 1024,
      publishedAt: new Date(),
    },
  });

  const reportAnalyzer = await prisma.agent.upsert({
    where: { slug: 'report-analyzer' },
    update: {},
    create: {
      name: 'Report Analyzer',
      slug: 'report-analyzer',
      description: 'Generates professional account analysis narratives for tech sales teams.',
      status: 'PUBLISHED',
      modelId: 'claude-3-5-sonnet-20241022',
      maxTokens: 4096,
      creditCost: 0.10,
    },
  });
  console.log(`  Agent: ${reportAnalyzer.name} (${reportAnalyzer.id})`);

  const raVersion = await prisma.agentVersion.upsert({
    where: { agentId_version: { agentId: reportAnalyzer.id, version: 1 } },
    update: {},
    create: {
      agentId: reportAnalyzer.id,
      version: 1,
      status: 'PUBLISHED',
      systemPrompt: REPORT_ANALYZER_PROMPT,
      modelId: 'claude-3-5-sonnet-20241022',
      maxTokens: 4096,
      publishedAt: new Date(),
    },
  });

  const opportunityScorer = await prisma.agent.upsert({
    where: { slug: 'opportunity-scorer' },
    update: {},
    create: {
      name: 'Opportunity Scorer',
      slug: 'opportunity-scorer',
      description: 'Deterministic scoring of companies based on tech stack, contacts, and revenue signals. Max score ~145.',
      status: 'PUBLISHED',
      modelId: 'none',
      maxTokens: 0,
      creditCost: 0,
    },
  });
  console.log(`  Agent: ${opportunityScorer.name} (${opportunityScorer.id})`);

  const osVersion = await prisma.agentVersion.upsert({
    where: { agentId_version: { agentId: opportunityScorer.id, version: 1 } },
    update: {},
    create: {
      agentId: opportunityScorer.id,
      version: 1,
      status: 'PUBLISHED',
      systemPrompt: 'Deterministic scorer — no LLM prompt. Scoring logic in src/services/ai/opportunityScorer.ts.',
      modelId: 'none',
      maxTokens: 0,
      publishedAt: new Date(),
    },
  });

  console.log('  Agents created.\n');

  // -----------------------------------------------------------------------
  // T053: Create McpServer + McpTool records
  // -----------------------------------------------------------------------
  console.log('--- T053: Creating McpServer records ---');

  const apollo = await prisma.mcpServer.upsert({
    where: { slug: 'apollo' },
    update: {},
    create: {
      name: 'Apollo.io',
      slug: 'apollo',
      provider: 'Apollo',
      baseUrl: 'https://api.apollo.io',
      authType: 'API_KEY',
      status: 'HEALTHY',
      byokEnabled: true,
      rateLimitRpm: 60,
    },
  });
  console.log(`  McpServer: ${apollo.name} (${apollo.id})`);

  // Apollo tools
  for (const tool of [
    { name: 'people-search', description: 'Search for people/contacts by company, title, location filters.', creditCost: 0.05 },
    { name: 'accounts-search', description: 'Search for company accounts by industry, size, technology filters.', creditCost: 0.03 },
    { name: 'people-bulk-enrich', description: 'Bulk enrich contacts with emails and phone numbers.', creditCost: 0.10 },
  ]) {
    await prisma.mcpTool.upsert({
      where: { serverId_name: { serverId: apollo.id, name: tool.name } },
      update: {},
      create: { serverId: apollo.id, ...tool },
    });
  }

  const builtwith = await prisma.mcpServer.upsert({
    where: { slug: 'builtwith' },
    update: {},
    create: {
      name: 'BuiltWith',
      slug: 'builtwith',
      provider: 'BuiltWith',
      baseUrl: 'https://api.builtwith.com',
      authType: 'API_KEY',
      status: 'HEALTHY',
      byokEnabled: true,
      rateLimitRpm: 120,
    },
  });
  console.log(`  McpServer: ${builtwith.name} (${builtwith.id})`);

  for (const tool of [
    { name: 'domain-lookup', description: 'Lookup technology stack for a domain (v22 API).', creditCost: 0.02 },
    { name: 'company-to-url', description: 'Resolve company name to domain URL (CTU API).', creditCost: 0.01 },
    { name: 'technology-search', description: 'Search for companies using a specific technology (Lists API).', creditCost: 0.05 },
  ]) {
    await prisma.mcpTool.upsert({
      where: { serverId_name: { serverId: builtwith.id, name: tool.name } },
      update: {},
      create: { serverId: builtwith.id, ...tool },
    });
  }

  const findymail = await prisma.mcpServer.upsert({
    where: { slug: 'findymail' },
    update: {},
    create: {
      name: 'Findymail',
      slug: 'findymail',
      provider: 'Findymail',
      baseUrl: 'https://app.findymail.com',
      authType: 'BEARER_TOKEN',
      status: 'HEALTHY',
      byokEnabled: true,
      rateLimitRpm: 100,
    },
  });
  console.log(`  McpServer: ${findymail.name} (${findymail.id})`);

  await prisma.mcpTool.upsert({
    where: { serverId_name: { serverId: findymail.id, name: 'verify-email' } },
    update: {},
    create: {
      serverId: findymail.id,
      name: 'verify-email',
      description: 'Verify email deliverability. Supports single and batch mode.',
      creditCost: 0.01,
    },
  });

  const wiza = await prisma.mcpServer.upsert({
    where: { slug: 'wiza' },
    update: {},
    create: {
      name: 'Wiza',
      slug: 'wiza',
      provider: 'Wiza',
      baseUrl: 'https://wiza.co/api',
      authType: 'API_KEY',
      status: 'HEALTHY',
      byokEnabled: true,
      rateLimitRpm: 60,
    },
  });
  console.log(`  McpServer: ${wiza.name} (${wiza.id})`);

  await prisma.mcpTool.upsert({
    where: { serverId_name: { serverId: wiza.id, name: 'individual-reveal' } },
    update: {},
    create: {
      serverId: wiza.id,
      name: 'individual-reveal',
      description: 'Async contact enrichment with email and phone discovery. Supports partial/phone/full levels.',
      creditCost: 0.08,
    },
  });

  const aiark = await prisma.mcpServer.upsert({
    where: { slug: 'aiark' },
    update: {},
    create: {
      name: 'AI Ark',
      slug: 'aiark',
      provider: 'AI Ark',
      baseUrl: 'https://api.ai-ark.com/api/developer-portal/v1',
      authType: 'API_KEY',
      status: 'HEALTHY',
      byokEnabled: false,
      rateLimitRpm: 60,
    },
  });
  console.log(`  McpServer: ${aiark.name} (${aiark.id})`);

  for (const tool of [
    { name: 'mobile-phone-finder', description: 'Find mobile phone numbers for contacts.', creditCost: 0.05 },
    { name: 'personality-analysis', description: 'Analyze contact personality profile for communication style.', creditCost: 0.03 },
  ]) {
    await prisma.mcpTool.upsert({
      where: { serverId_name: { serverId: aiark.id, name: tool.name } },
      update: {},
      create: { serverId: aiark.id, ...tool },
    });
  }

  console.log('  MCP Servers + Tools created.\n');

  // -----------------------------------------------------------------------
  // T054: Create Skill records
  // -----------------------------------------------------------------------
  console.log('--- T054: Creating Skill records ---');

  // Fetch tool IDs for skill MCP tool references
  const apolloTools = await prisma.mcpTool.findMany({ where: { serverId: apollo.id } });
  const builtwithTools = await prisma.mcpTool.findMany({ where: { serverId: builtwith.id } });
  const findymailTools = await prisma.mcpTool.findMany({ where: { serverId: findymail.id } });
  const wizaTools = await prisma.mcpTool.findMany({ where: { serverId: wiza.id } });

  const toolId = (tools: typeof apolloTools, name: string) =>
    tools.find((t) => t.name === name)?.id ?? '';

  const fileEnrichment = await prisma.skill.upsert({
    where: { slug: 'file-enrichment' },
    update: {},
    create: {
      name: 'File Enrichment',
      slug: 'file-enrichment',
      description: 'Enrich a company list file with tech stacks (BuiltWith) and/or contacts (Apollo).',
      status: 'PUBLISHED',
      agentId: intentClassifier.id,
      agentVersionId: icVersion.id,
      triggerType: 'SLACK_COMMAND',
      deliveryChannels: ['SLACK_THREAD', 'FILE_DOWNLOAD'],
      mcpToolIds: [
        toolId(apolloTools, 'people-search'),
        toolId(apolloTools, 'people-bulk-enrich'),
        toolId(builtwithTools, 'domain-lookup'),
        toolId(builtwithTools, 'company-to-url'),
        toolId(findymailTools, 'verify-email'),
        toolId(wizaTools, 'individual-reveal'),
      ].filter(Boolean),
      creditCost: 1.0,
      retryPolicy: { maxRetries: 2, backoffMs: 5000 },
    },
  });
  console.log(`  Skill: ${fileEnrichment.name} (${fileEnrichment.id})`);

  const techStackLookup = await prisma.skill.upsert({
    where: { slug: 'tech-stack-lookup' },
    update: {},
    create: {
      name: 'Tech Stack Lookup',
      slug: 'tech-stack-lookup',
      description: 'Look up the technology stack for a single domain.',
      status: 'PUBLISHED',
      agentId: intentClassifier.id,
      agentVersionId: icVersion.id,
      triggerType: 'SLACK_COMMAND',
      deliveryChannels: ['SLACK_THREAD'],
      mcpToolIds: [
        toolId(builtwithTools, 'domain-lookup'),
        toolId(builtwithTools, 'company-to-url'),
      ].filter(Boolean),
      creditCost: 0.10,
    },
  });
  console.log(`  Skill: ${techStackLookup.name} (${techStackLookup.id})`);

  const contactEnrichment = await prisma.skill.upsert({
    where: { slug: 'contact-enrichment' },
    update: {},
    create: {
      name: 'Contact Enrichment',
      slug: 'contact-enrichment',
      description: 'Find and enrich contacts/decision makers for companies.',
      status: 'PUBLISHED',
      agentId: intentClassifier.id,
      agentVersionId: icVersion.id,
      triggerType: 'SLACK_COMMAND',
      deliveryChannels: ['SLACK_THREAD', 'FILE_DOWNLOAD'],
      mcpToolIds: [
        toolId(apolloTools, 'people-search'),
        toolId(apolloTools, 'people-bulk-enrich'),
        toolId(wizaTools, 'individual-reveal'),
      ].filter(Boolean),
      creditCost: 0.50,
    },
  });
  console.log(`  Skill: ${contactEnrichment.name} (${contactEnrichment.id})`);

  const techReport = await prisma.skill.upsert({
    where: { slug: 'tech-report' },
    update: {},
    create: {
      name: 'Technology Adoption Report',
      slug: 'tech-report',
      description: 'Generate a technology adoption report for companies using a specific technology.',
      status: 'PUBLISHED',
      agentId: reportAnalyzer.id,
      agentVersionId: raVersion.id,
      triggerType: 'SLACK_COMMAND',
      deliveryChannels: ['SLACK_THREAD', 'FILE_DOWNLOAD'],
      mcpToolIds: [
        toolId(builtwithTools, 'technology-search'),
        toolId(apolloTools, 'people-search'),
      ].filter(Boolean),
      creditCost: 2.0,
    },
  });
  console.log(`  Skill: ${techReport.name} (${techReport.id})`);

  const emailVerification = await prisma.skill.upsert({
    where: { slug: 'email-verification' },
    update: {},
    create: {
      name: 'Email Verification',
      slug: 'email-verification',
      description: 'Verify email deliverability for contacts.',
      status: 'PUBLISHED',
      agentId: intentClassifier.id,
      agentVersionId: icVersion.id,
      triggerType: 'API_CALL',
      deliveryChannels: ['WEBHOOK'],
      mcpToolIds: [toolId(findymailTools, 'verify-email')].filter(Boolean),
      creditCost: 0.05,
    },
  });
  console.log(`  Skill: ${emailVerification.name} (${emailVerification.id})`);

  console.log('  Skills created.\n');

  // -----------------------------------------------------------------------
  // T055: Create Enrichment Pack
  // -----------------------------------------------------------------------
  console.log('--- T055: Creating Enrichment Pack ---');

  const enrichmentPack = await prisma.verticalPack.upsert({
    where: { slug: 'enrichment-pack' },
    update: {},
    create: {
      name: 'Enrichment Pack',
      slug: 'enrichment-pack',
      description: 'Complete company list enrichment pipeline — tech stacks, contacts, reports, email verification.',
      category: 'SALES',
      status: 'PUBLISHED',
      tier: 'STARTER',
      monthlyPriceUsd: 0,
      creditsIncluded: 1000,
      overageRateUsd: 0.01,
    },
  });
  console.log(`  Pack: ${enrichmentPack.name} (${enrichmentPack.id})`);

  // Assign skills to pack
  const skillIds = [
    fileEnrichment.id,
    techStackLookup.id,
    contactEnrichment.id,
    techReport.id,
    emailVerification.id,
  ];

  // Remove existing assignments to allow re-running
  await prisma.packSkill.deleteMany({ where: { packId: enrichmentPack.id } });

  for (let i = 0; i < skillIds.length; i++) {
    await prisma.packSkill.create({
      data: {
        packId: enrichmentPack.id,
        skillId: skillIds[i],
        sortOrder: i,
      },
    });
  }

  console.log(`  Assigned ${skillIds.length} skills to Enrichment Pack.\n`);

  console.log('Migration complete!');
  console.log(`  Agents: 4`);
  console.log(`  MCP Servers: 5`);
  console.log(`  Skills: 5`);
  console.log(`  Packs: 1`);
}

migrate()
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
