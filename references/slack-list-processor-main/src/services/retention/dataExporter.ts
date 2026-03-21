/**
 * Workspace Data Exporter Service (T063)
 *
 * Exports workspace data for archival or compliance purposes.
 *
 * Exports include:
 *   - Job history with enrichment parameters
 *   - Enrichment results (companies, technologies, contacts)
 *   - API usage records
 *
 * The export is formatted as JSON and uploaded to S3 as a .json file.
 */

import { prisma } from '../../models/index.js';
import { uploadFile } from '../../lib/storage.js';
import logger from '../../lib/logger.js';

interface WorkspaceExport {
  exportedAt: string;
  teamId: string;
  teamName: string;
  jobs: Array<{
    id: string;
    type: string;
    status: string;
    createdAt: string;
    completedAt: string | null;
    sourceFileName: string | null;
    resultFileName: string | null;
    companiesProcessed: number;
    companiesFailed: number;
    contactsFound: number;
    companies: Array<{
      domain: string | null;
      companyName: string | null;
      enrichmentStatus: string;
      techSpendTier: string | null;
      technologyCount: number;
      contacts: Array<{
        fullName: string | null;
        email: string | null;
        jobTitle: string | null;
        personaType: string;
      }>;
    }>;
  }>;
  apiUsage: Array<{
    service: string;
    endpoint: string;
    requestCount: number;
    creditsConsumed: string | null;
    estimatedCostUsd: string | null;
    createdAt: string;
  }>;
  dailyAggregates: Array<{
    date: string;
    service: string;
    totalRequests: number;
    totalCostUsd: string;
    totalTokensInput: number;
    totalTokensOutput: number;
  }>;
}

/**
 * Exports all workspace data as a JSON archive and uploads to S3.
 *
 * @param teamId - The Slack team ID to export
 * @returns The S3 key where the export was uploaded
 */
export async function exportWorkspaceData(teamId: string): Promise<string> {
  logger.info('Starting workspace data export', { teamId });

  try {
    // Fetch workspace installation
    const workspace = await prisma.workspaceInstallation.findUnique({
      where: { slackTeamId: teamId },
    });

    if (!workspace) {
      throw new Error(`Workspace not found: ${teamId}`);
    }

    // Fetch all jobs with their companies and contacts
    const jobs = await prisma.job.findMany({
      where: { slackTeamId: teamId },
      include: {
        companies: {
          include: {
            contacts: {
              select: {
                fullName: true,
                email: true,
                jobTitle: true,
                personaType: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Fetch API usage logs
    const apiUsage = await prisma.apiUsageLog.findMany({
      where: { slackTeamId: teamId },
      orderBy: { createdAt: 'desc' },
    });

    // Fetch daily aggregates
    const dailyAggregates = await prisma.dailyAggregate.findMany({
      where: { slackTeamId: teamId },
      orderBy: { date: 'desc' },
    });

    // Build export object
    const exportData: WorkspaceExport = {
      exportedAt: new Date().toISOString(),
      teamId: workspace.slackTeamId,
      teamName: workspace.slackTeamName,
      jobs: jobs.map((job) => ({
        id: job.id,
        type: job.jobType,
        status: job.status,
        createdAt: job.createdAt.toISOString(),
        completedAt: job.completedAt?.toISOString() || null,
        sourceFileName: job.sourceFileName,
        resultFileName: job.resultFileName,
        companiesProcessed: job.companiesProcessed,
        companiesFailed: job.companiesFailed,
        contactsFound: job.contactsFound,
        companies: job.companies.map((company) => ({
          domain: company.domain,
          companyName: company.companyName,
          enrichmentStatus: company.enrichmentStatus,
          techSpendTier: company.techSpendTier,
          technologyCount: company.technologyCount,
          contacts: company.contacts.map((contact) => ({
            fullName: contact.fullName,
            email: contact.email,
            jobTitle: contact.jobTitle,
            personaType: contact.personaType,
          })),
        })),
      })),
      apiUsage: apiUsage.map((log) => ({
        service: log.service,
        endpoint: log.endpoint,
        requestCount: log.requestCount,
        creditsConsumed: log.creditsConsumed?.toString() || null,
        estimatedCostUsd: log.estimatedCostUsd?.toString() || null,
        createdAt: log.createdAt.toISOString(),
      })),
      dailyAggregates: dailyAggregates.map((agg) => ({
        date: agg.date.toISOString(),
        service: agg.service,
        totalRequests: agg.totalRequests,
        totalCostUsd: agg.totalCostUsd.toString(),
        totalTokensInput: agg.totalTokensInput,
        totalTokensOutput: agg.totalTokensOutput,
      })),
    };

    // Convert to JSON buffer
    const jsonBuffer = Buffer.from(JSON.stringify(exportData, null, 2), 'utf-8');

    // Upload to S3
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const s3Key = `exports/${teamId}/${timestamp}.json`;

    await uploadFile(s3Key, jsonBuffer, 'application/json');

    logger.info('Workspace data export completed', {
      teamId,
      s3Key,
      jobCount: jobs.length,
      apiUsageCount: apiUsage.length,
      sizeBytes: jsonBuffer.length,
    });

    return s3Key;
  } catch (err) {
    logger.error('Workspace data export failed', {
      teamId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
