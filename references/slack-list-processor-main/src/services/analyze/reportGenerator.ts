/**
 * Report generation orchestrator for /analyze.
 *
 * Loads enrichment data from the database, computes opportunity scores,
 * generates AI narrative sections, and assembles the complete ReportData
 * object used by pdfGenerator and reportBlocks.
 */

import { prisma } from '../../models/index.js';
import {
  scoreAllCompanies,
  detectAiTechnologies,
  type ScoringInput,
} from '../ai/opportunityScorer.js';
import {
  generateReportNarratives,
  type ReportData,
  type CloudDistribution,
  type IndustryVertical,
  type AiToolEntry,
  type ContactCoverage,
} from '../ai/reportAnalyzer.js';
import { getAllConfigDocs } from './configDocService.js';
import { DOC_TYPE_LABELS } from './configDocService.js';
import { getIcpContext } from './icpDocumentProcessor.js';
import type { ConfigDocType } from '@prisma/client';
import logger from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Missing doc improvement descriptions
// ---------------------------------------------------------------------------

const MISSING_DOC_IMPROVEMENTS: Record<ConfigDocType, string> = {
  ICP: 'Would enable ICP-guided opportunity scoring and targeting recommendations tailored to your ideal customer profile.',
  USE_CASES: 'Would add use-case-specific opportunity matching, identifying accounts that align with your product capabilities.',
  CAMPAIGNS: 'Would enable campaign-level targeting analysis, mapping accounts to active campaigns and outreach strategies.',
  SETTINGS: 'Would customize scoring weights and report parameters to match your team\'s priorities.',
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generates a complete ReportData object from enrichment job data.
 *
 * @param sourceJobIds - IDs of enrichment Jobs to analyze.
 * @param teamId - Slack team ID for config doc lookup.
 * @param channelId - Slack channel ID for config doc lookup.
 * @returns Assembled ReportData ready for PDF generation.
 */
export async function generateReport(params: {
  sourceJobIds: string[];
  teamId: string;
  channelId: string;
}): Promise<ReportData> {
  const { sourceJobIds, teamId, channelId } = params;

  // --- Load enrichment data ---
  const companies = await prisma.jobCompany.findMany({
    where: {
      jobId: { in: sourceJobIds },
      enrichmentStatus: 'SUCCESS',
    },
    include: {
      technologies: true,
      contacts: true,
    },
    orderBy: { rowIndex: 'asc' },
  });

  const allContacts = await prisma.jobContact.findMany({
    where: { jobId: { in: sourceJobIds } },
  });

  const sourceJobs = await prisma.job.findMany({
    where: { id: { in: sourceJobIds } },
  });

  // --- Load config docs ---
  const configDocs = await getAllConfigDocs(teamId, channelId);
  const configDocMap: Record<string, string> = {};
  configDocs.forEach((d) => {
    const label = d.displayLabel || DOC_TYPE_LABELS[d.docType];
    const header = d.originalFileName ? `[Source: ${d.originalFileName}]\n` : '';
    configDocMap[label] = header + d.content;
  });

  // --- Load ICP context from AnalysisChannel (T068) ---
  const icpContext = await getIcpContext(teamId);
  if (icpContext?.hasContext) {
    if (icpContext.icpDefinition && !configDocMap['Ideal Customer Profile (ICP)']) {
      configDocMap['Ideal Customer Profile (ICP)'] = icpContext.icpDefinition;
    }
    if (icpContext.useCases && !configDocMap['Use Cases']) {
      configDocMap['Use Cases'] = icpContext.useCases;
    }
    if (icpContext.caseStudies && !configDocMap['Case Studies']) {
      configDocMap['Case Studies'] = icpContext.caseStudies;
    }
    if (icpContext.testimonials && !configDocMap['Testimonials']) {
      configDocMap['Testimonials'] = icpContext.testimonials;
    }
    logger.info('ICP context injected into report', { teamId, hasIcp: !!icpContext.icpDefinition, hasUseCases: !!icpContext.useCases, hasCaseStudies: !!icpContext.caseStudies, hasTestimonials: !!icpContext.testimonials });
  }

  const allTypes: ConfigDocType[] = ['ICP', 'USE_CASES', 'CAMPAIGNS', 'SETTINGS'];
  const existingTypes = new Set(configDocs.map((d) => d.docType));
  const missingTypes = allTypes.filter((t) => !existingTypes.has(t));

  // --- Prepare scoring inputs ---
  const scoringInputs: ScoringInput[] = companies.map((company) => {
    const techNames = company.technologies.map((t) => t.name);
    const aiTechs = detectAiTechnologies(techNames);
    const companyContacts = company.contacts;

    return {
      companyId: company.id,
      companyName: company.companyNameFromApi ?? company.companyName,
      domain: company.resolvedDomain ?? company.domain,
      cloudProviderPrimary: company.cloudProviderPrimary,
      cloudProvidersAll: company.cloudProvidersAll,
      vertical: company.vertical,
      salesRevenue: company.salesRevenue,
      employeeCount: company.employeeCount,
      techSpendUsd: company.techSpendUsd,
      techSpendTier: company.techSpendTier,
      technologyCount: company.technologyCount,
      socialProfiles: company.socialProfiles,
      locationCountry: company.locationCountry,
      hasContacts: companyContacts.length > 0,
      contactCount: companyContacts.length,
      aiTechnologies: aiTechs,
    };
  });

  // --- Score all companies ---
  const { scored, summary } = scoreAllCompanies(scoringInputs);

  // --- Compute distributions ---
  const cloudDistribution = computeCloudDistribution(companies);
  const industryVerticals = computeIndustryVerticals(companies);
  const aiTools = computeAiTools(companies);
  const contactCoverage = computeContactCoverage(companies, allContacts);

  // --- Generate AI narratives ---
  const topCompanies = scored.filter((c) => c.score >= 85);

  const narratives = await generateReportNarratives({
    summary,
    cloudDistribution,
    industryVerticals,
    aiTools,
    contactCoverage,
    topCompanies: scored.slice(0, 10),
    configDocs: configDocMap,
  });

  // --- Assemble report ---
  const now = new Date();
  const sourceFileNames = sourceJobs
    .map((j) => j.sourceFileName)
    .filter(Boolean) as string[];

  const report: ReportData = {
    title: 'Account Analysis Report',
    subtitle: 'Opportunity Assessment',
    reportDate: now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: '2-digit' }),
    dataSources: `Company Technographics (${companies.length} accounts) + Contact Enrichment (${allContacts.length} contacts)`,
    totalAccounts: companies.length,
    preparedBy: 'Dev Labs BDR Intelligence',
    preparedFor: 'Analysis',

    executiveSummary: narratives.executiveSummary,
    keyMetrics: {
      totalAccounts: companies.length,
      enrichedContacts: allContacts.length,
      migrationTargets: summary.migrationTargetCount,
      aiEnabled: summary.aiEnabledCount,
      highOpportunity: summary.highOpportunityCount,
    },

    cloudDistribution,
    cloudAnalysis: narratives.cloudAnalysis,

    industryVerticals,
    industryAnalysis: narratives.industryAnalysis,

    aiLandscape: aiTools,
    aiAnalysis: narratives.aiAnalysis,

    contactCoverage,
    contactAnalysis: narratives.contactAnalysis,

    topOpportunities: topCompanies,
    scoringSummary: summary,
    accountsByCloud: groupByCloud(scored, companies),

    icpRecommendations: narratives.icpRecommendations,

    missingDocs: missingTypes.map((t) => ({
      docType: t,
      label: DOC_TYPE_LABELS[t],
      improvement: MISSING_DOC_IMPROVEMENTS[t],
    })),

    totalUsage: narratives.totalUsage,
  };

  logger.info('Report generated', {
    totalAccounts: companies.length,
    totalContacts: allContacts.length,
    topOpportunities: topCompanies.length,
    missingDocs: missingTypes.length,
  });

  return report;
}

// ---------------------------------------------------------------------------
// Distribution computation helpers
// ---------------------------------------------------------------------------

function computeCloudDistribution(
  companies: Array<{ cloudProviderPrimary: string | null }>,
): CloudDistribution[] {
  const counts = new Map<string, number>();
  companies.forEach((c) => {
    const cloud = c.cloudProviderPrimary || 'No Hosting Data';
    counts.set(cloud, (counts.get(cloud) ?? 0) + 1);
  });

  const total = companies.length;
  const opportunityMap: Record<string, string> = {
    AWS: 'HIGH - Direct migration target',
    'Microsoft Azure': 'HIGH - Direct migration target',
    'Google Cloud': 'EXPAND - Upsell advanced services',
    'Multi-Cloud': 'MEDIUM - Consolidation / expansion',
    'Other Cloud/Hosting': 'HIGH - Greenfield migration target',
    'No Hosting Data': 'EVALUATE - Discovery required',
  };

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([provider, count]) => ({
      provider,
      count,
      percentage: (count / total) * 100,
      opportunity: opportunityMap[provider] ?? 'EVALUATE',
    }));
}

function computeIndustryVerticals(
  companies: Array<{ vertical: string | null }>,
): IndustryVertical[] {
  const counts = new Map<string, number>();
  companies.forEach((c) => {
    const vertical = c.vertical || 'Unknown';
    counts.set(vertical, (counts.get(vertical) ?? 0) + 1);
  });

  const total = companies.length;

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([vertical, count]) => ({
      vertical,
      count,
      percentage: (count / total) * 100,
      cloudPlay: 'Cloud migration, BigQuery, Gemini productivity',
    }));
}

function computeAiTools(
  companies: Array<{ technologies: Array<{ name: string }> }>,
): AiToolEntry[] {
  const counts = new Map<string, number>();
  let totalAiCompanies = 0;

  companies.forEach((c) => {
    const aiTechs = detectAiTechnologies(c.technologies.map((t) => t.name));
    if (aiTechs.length > 0) {
      totalAiCompanies++;
      aiTechs.forEach((tech) => {
        counts.set(tech, (counts.get(tech) ?? 0) + 1);
      });
    }
  });

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([tool, count]) => ({
      tool,
      count,
      percentage: totalAiCompanies > 0 ? (count / totalAiCompanies) * 100 : 0,
      competitivePosition: tool.toLowerCase().includes('openai') || tool.toLowerCase().includes('chatgpt')
        ? 'STRONG - Gemini as integrated GCP alternative'
        : 'EVALUATE - Potential replacement or complement',
    }));
}

function computeContactCoverage(
  companies: Array<{ id: string; contacts: Array<{ seniorityLevel: string | null; jobTitle: string | null }> }>,
  allContacts: Array<{ seniorityLevel: string | null; jobTitle: string | null }>,
): ContactCoverage {
  const companiesWithContacts = companies.filter((c) => c.contacts.length > 0).length;

  // Seniority distribution
  const seniorityMap = new Map<string, number>();
  allContacts.forEach((c) => {
    const level = c.seniorityLevel || 'Unknown';
    seniorityMap.set(level, (seniorityMap.get(level) ?? 0) + 1);
  });

  const priorityMap: Record<string, string> = {
    'c_suite': 'HIGHEST - Executive sponsorship',
    'vp': 'HIGH - Budget authority / champion',
    'director': 'HIGH - Decision influencer',
    'manager': 'MEDIUM - Day-to-day champion',
    'senior': 'STANDARD - Technical evaluator',
    'founder': 'STANDARD - Technical evaluator',
  };

  const seniorityDistribution = Array.from(seniorityMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([level, count]) => ({
      level: level.charAt(0).toUpperCase() + level.slice(1),
      count,
      percentage: allContacts.length > 0 ? (count / allContacts.length) * 100 : 0,
      priority: priorityMap[level.toLowerCase()] ?? 'STANDARD - Technical evaluator',
    }));

  return {
    totalContacts: allContacts.length,
    companiesWithContacts,
    coveragePercentage: companies.length > 0 ? (companiesWithContacts / companies.length) * 100 : 0,
    seniorityDistribution,
    departmentDistribution: [],
  };
}

function groupByCloud(
  scored: Array<import('../ai/opportunityScorer.js').ScoredCompany>,
  companies: Array<{ id: string; cloudProviderPrimary: string | null }>,
): Record<string, import('../ai/opportunityScorer.js').ScoredCompany[]> {
  const cloudMap = new Map<string, string>();
  companies.forEach((c) => {
    cloudMap.set(c.id, c.cloudProviderPrimary ?? 'Unknown');
  });

  const groups: Record<string, import('../ai/opportunityScorer.js').ScoredCompany[]> = {};
  scored.forEach((sc) => {
    const cloud = cloudMap.get(sc.companyId) ?? 'Unknown';
    if (!groups[cloud]) groups[cloud] = [];
    groups[cloud].push(sc);
  });

  return groups;
}
