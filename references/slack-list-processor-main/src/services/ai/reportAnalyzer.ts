/**
 * AI-powered report narrative generator using Claude Sonnet.
 *
 * Makes multiple Claude API calls to generate the narrative sections
 * of the Account Analysis Report. Each call handles a subset of
 * sections to stay within context limits.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config/index.js';
import { calculateAiCost, type AiUsageData } from './costCalculator.js';
import type { ScoredCompany, ScoringSummary } from './opportunityScorer.js';
import logger from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Cloud distribution data for the report. */
export interface CloudDistribution {
  provider: string;
  count: number;
  percentage: number;
  opportunity: string;
}

/** Industry vertical data for the report. */
export interface IndustryVertical {
  vertical: string;
  count: number;
  percentage: number;
  cloudPlay: string;
}

/** AI tool detection data for the report. */
export interface AiToolEntry {
  tool: string;
  count: number;
  percentage: number;
  competitivePosition: string;
}

/** Contact coverage data for the report. */
export interface ContactCoverage {
  seniorityDistribution: Array<{ level: string; count: number; percentage: number; priority: string }>;
  departmentDistribution: Array<{ department: string; count: number }>;
  totalContacts: number;
  companiesWithContacts: number;
  coveragePercentage: number;
}

/** Full structured report data. */
export interface ReportData {
  title: string;
  subtitle: string;
  reportDate: string;
  dataSources: string;
  totalAccounts: number;
  preparedBy: string;
  preparedFor: string;

  executiveSummary: string;
  keyMetrics: {
    totalAccounts: number;
    enrichedContacts: number;
    migrationTargets: number;
    aiEnabled: number;
    highOpportunity: number;
  };

  cloudDistribution: CloudDistribution[];
  cloudAnalysis: string;

  industryVerticals: IndustryVertical[];
  industryAnalysis: string;

  aiLandscape: AiToolEntry[];
  aiAnalysis: string;

  contactCoverage: ContactCoverage;
  contactAnalysis: string;

  topOpportunities: ScoredCompany[];

  scoringSummary: ScoringSummary;

  /** Per-cloud-provider account tables. */
  accountsByCloud: Record<string, ScoredCompany[]>;

  /** ICP-guided recommendations (only if config docs exist). */
  icpRecommendations?: string;

  /** List of missing config docs with improvement descriptions. */
  missingDocs: Array<{ docType: string; label: string; improvement: string }>;

  /** Total AI usage across all calls. */
  totalUsage: AiUsageData;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const anthropic = new Anthropic({
  apiKey: config.anthropic.apiKey,
});

// ---------------------------------------------------------------------------
// Narrative generation tools
// ---------------------------------------------------------------------------

const GENERATE_ANALYSIS_TOOL: Anthropic.Messages.Tool = {
  name: 'generate_analysis',
  description: 'Generate narrative analysis sections for the account report.',
  input_schema: {
    type: 'object' as const,
    properties: {
      executive_summary: {
        type: 'string',
        description: 'Executive summary paragraph (2-3 sentences) summarizing key findings.',
      },
      cloud_analysis: {
        type: 'string',
        description: 'Analysis paragraph for cloud provider distribution and migration opportunities.',
      },
      industry_analysis: {
        type: 'string',
        description: 'Analysis paragraph for industry vertical distribution and vertical-specific opportunities.',
      },
      ai_analysis: {
        type: 'string',
        description: 'Analysis paragraph for AI adoption landscape and competitive positioning.',
      },
      contact_analysis: {
        type: 'string',
        description: 'Analysis paragraph for contact coverage and outreach readiness.',
      },
    },
    required: ['executive_summary', 'cloud_analysis', 'industry_analysis', 'ai_analysis', 'contact_analysis'],
  },
};

const GENERATE_ICP_RECOMMENDATIONS_TOOL: Anthropic.Messages.Tool = {
  name: 'generate_icp_recommendations',
  description: 'Generate ICP-guided targeting recommendations based on config documents.',
  input_schema: {
    type: 'object' as const,
    properties: {
      recommendations: {
        type: 'string',
        description: 'Detailed recommendations for targeting accounts based on ICP, use cases, and campaigns.',
      },
    },
    required: ['recommendations'],
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generates narrative sections for the report using Claude Sonnet.
 *
 * @param dataContext - Summary statistics and distributions to analyze.
 * @param configDocs - Optional ICP/UseCases/Campaigns/Settings content.
 * @returns Generated narratives and total AI usage.
 */
export async function generateReportNarratives(params: {
  summary: ScoringSummary;
  cloudDistribution: CloudDistribution[];
  industryVerticals: IndustryVertical[];
  aiTools: AiToolEntry[];
  contactCoverage: ContactCoverage;
  topCompanies: ScoredCompany[];
  configDocs: Record<string, string>;
}): Promise<{
  executiveSummary: string;
  cloudAnalysis: string;
  industryAnalysis: string;
  aiAnalysis: string;
  contactAnalysis: string;
  icpRecommendations?: string;
  totalUsage: AiUsageData;
}> {
  let totalUsage: AiUsageData = {
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
    durationMs: 0,
  };

  // --- Call 1: Main analysis narratives ---
  const dataPrompt = `Analyze this account data and generate report narratives.

Key Metrics:
- Total accounts: ${params.summary.totalCompanies}
- Migration targets (non-Google cloud): ${params.summary.migrationTargetCount}
- AI-enabled accounts: ${params.summary.aiEnabledCount}
- High-opportunity accounts (score 85+): ${params.summary.highOpportunityCount}

Cloud Distribution:
${params.cloudDistribution.map((c) => `- ${c.provider}: ${c.count} (${c.percentage.toFixed(1)}%)`).join('\n')}

Industry Verticals (top 10):
${params.industryVerticals.slice(0, 10).map((v) => `- ${v.vertical}: ${v.count} (${v.percentage.toFixed(1)}%)`).join('\n')}

AI Tools Detected:
${params.aiTools.slice(0, 10).map((a) => `- ${a.tool}: ${a.count} accounts`).join('\n')}

Contact Coverage:
- Total contacts: ${params.contactCoverage.totalContacts}
- Companies with contacts: ${params.contactCoverage.companiesWithContacts} (${params.contactCoverage.coveragePercentage.toFixed(1)}%)
${params.contactCoverage.seniorityDistribution.slice(0, 5).map((s) => `- ${s.level}: ${s.count} (${s.percentage.toFixed(1)}%)`).join('\n')}

Top 5 Opportunity Accounts:
${params.topCompanies.slice(0, 5).map((c, i) => `${i + 1}. ${c.companyName} (${c.domain}) - Score: ${c.score} ${c.tier}`).join('\n')}

Generate concise, professional analysis narratives for each section. Focus on actionable insights for a BDR team. Write in third person.`;

  const startTime = Date.now();

  const analysisResponse = await anthropic.messages.create({
    model: config.anthropic.sonnetModel,
    max_tokens: 2048,
    system: 'You are a business intelligence analyst generating a professional account analysis report for a technology sales team. Be concise, data-driven, and actionable.',
    messages: [{ role: 'user', content: dataPrompt }],
    tools: [GENERATE_ANALYSIS_TOOL],
    tool_choice: { type: 'tool', name: 'generate_analysis' },
  });

  const durationMs = Date.now() - startTime;
  const usage1: AiUsageData = {
    inputTokens: analysisResponse.usage.input_tokens,
    outputTokens: analysisResponse.usage.output_tokens,
    estimatedCostUsd: calculateAiCost(analysisResponse.usage.input_tokens, analysisResponse.usage.output_tokens),
    durationMs,
  };
  totalUsage = addUsage(totalUsage, usage1);

  const analysisBlock = analysisResponse.content.find(
    (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
  );

  const analysis = analysisBlock?.input as {
    executive_summary: string;
    cloud_analysis: string;
    industry_analysis: string;
    ai_analysis: string;
    contact_analysis: string;
  };

  if (!analysis) {
    throw new Error('Failed to generate analysis narratives');
  }

  // --- Call 2 (conditional): ICP-guided recommendations ---
  let icpRecommendations: string | undefined;

  if (Object.keys(params.configDocs).length > 0) {
    const configContext = Object.entries(params.configDocs)
      .map(([type, content]) => `--- ${type} ---\n${content}`)
      .join('\n\n');

    const icpPrompt = `Based on the following configuration documents and account data, generate targeting recommendations.

${configContext}

Account Data Summary:
- ${params.summary.totalCompanies} total accounts
- ${params.summary.highOpportunityCount} high-opportunity accounts (score 85+)
- Top verticals: ${params.industryVerticals.slice(0, 3).map((v) => v.vertical).join(', ')}
- Cloud distribution: ${params.cloudDistribution.map((c) => `${c.provider}: ${c.count}`).join(', ')}

Top opportunity accounts:
${params.topCompanies.slice(0, 10).map((c) => `- ${c.companyName} (${c.domain}): ${c.tier}, Score ${c.score}`).join('\n')}

Generate specific, actionable targeting recommendations that cross-reference the ICP criteria with the account data. Include which accounts to prioritize, which campaigns align, and suggested outreach strategies.`;

    const startTime2 = Date.now();

    const icpResponse = await anthropic.messages.create({
      model: config.anthropic.sonnetModel,
      max_tokens: 2048,
      system: 'You are a strategic sales advisor generating targeting recommendations for a BDR team.',
      messages: [{ role: 'user', content: icpPrompt }],
      tools: [GENERATE_ICP_RECOMMENDATIONS_TOOL],
      tool_choice: { type: 'tool', name: 'generate_icp_recommendations' },
    });

    const durationMs2 = Date.now() - startTime2;
    const usage2: AiUsageData = {
      inputTokens: icpResponse.usage.input_tokens,
      outputTokens: icpResponse.usage.output_tokens,
      estimatedCostUsd: calculateAiCost(icpResponse.usage.input_tokens, icpResponse.usage.output_tokens),
      durationMs: durationMs2,
    };
    totalUsage = addUsage(totalUsage, usage2);

    const icpBlock = icpResponse.content.find(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
    );

    icpRecommendations = (icpBlock?.input as { recommendations: string })?.recommendations;
  }

  logger.info('Report narratives generated', {
    totalCostUsd: totalUsage.estimatedCostUsd,
    totalDurationMs: totalUsage.durationMs,
  });

  return {
    executiveSummary: analysis.executive_summary,
    cloudAnalysis: analysis.cloud_analysis,
    industryAnalysis: analysis.industry_analysis,
    aiAnalysis: analysis.ai_analysis,
    contactAnalysis: analysis.contact_analysis,
    icpRecommendations,
    totalUsage,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Adds two usage data objects together.
 */
function addUsage(a: AiUsageData, b: AiUsageData): AiUsageData {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    estimatedCostUsd: a.estimatedCostUsd + b.estimatedCostUsd,
    durationMs: a.durationMs + b.durationMs,
  };
}
