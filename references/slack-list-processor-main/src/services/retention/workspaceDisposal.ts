/**
 * Workspace Disposal Service (T062 + T062b)
 *
 * Handles two types of data disposal:
 *   1. Operational data disposal for workspaces past purgeAfter date
 *   2. Audit log disposal for uninstalled workspaces older than 1 year
 *
 * Implements Phase 11 - Data Retention & Audit requirements.
 *
 * Data retention policy:
 *   - Operational data: Deleted at purgeAfter (90 days post-uninstall)
 *   - Audit/usage data: Retained for 1 year post-uninstall, then deleted
 *
 * MUST NOT delete: AgentThreadAudit, ApiUsageLog, DailyAggregate (retained for 1 year)
 */

import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

interface DisposalStats {
  workspacesDisposed: number;
  jobsDeleted: number;
  companiesDeleted: number;
  technologiesDeleted: number;
  contactsDeleted: number;
  threadsDeleted: number;
  turnsDeleted: number;
  cacheEntriesDeleted: number;
  errors: number;
}

interface AuditDisposalStats {
  workspacesProcessed: number;
  auditsDeleted: number;
  usageLogsDeleted: number;
  aggregatesDeleted: number;
  errors: number;
}

/**
 * Disposes of expired workspace operational data.
 *
 * For workspaces with status UNINSTALLED and purgeAfter < now:
 *   - Delete Jobs (cascades to JobCompanies, CompanyTechnologies, Contacts)
 *   - Delete AgentThreads (cascades to ConversationTurns)
 *   - Delete TechReportCaches
 *
 * RETAINS:
 *   - AgentThreadAudit (permanent retention)
 *   - ApiUsageLog (retained for 1 year)
 *   - DailyAggregate (retained for 1 year)
 *   - WorkspaceInstallation record (for audit trail)
 *
 * @returns Statistics about the disposal operation
 */
export async function disposeExpiredWorkspaces(): Promise<DisposalStats> {
  const stats: DisposalStats = {
    workspacesDisposed: 0,
    jobsDeleted: 0,
    companiesDeleted: 0,
    technologiesDeleted: 0,
    contactsDeleted: 0,
    threadsDeleted: 0,
    turnsDeleted: 0,
    cacheEntriesDeleted: 0,
    errors: 0,
  };

  const now = new Date();

  logger.info('Starting workspace disposal', {
    timestamp: now.toISOString(),
  });

  try {
    // Find workspaces ready for disposal
    const expiredWorkspaces = await prisma.workspaceInstallation.findMany({
      where: {
        status: 'UNINSTALLED',
        purgeAfter: {
          lt: now,
        },
      },
    });

    logger.info('Found expired workspaces', {
      workspaceCount: expiredWorkspaces.length,
    });

    // Process each workspace
    for (const workspace of expiredWorkspaces) {
      try {
        const teamId = workspace.slackTeamId;

        logger.info('Disposing workspace data', {
          teamId,
          uninstalledAt: workspace.uninstalledAt,
          purgeAfter: workspace.purgeAfter,
        });

        // Delete TechReportCaches and entries
        const cacheEntries = await prisma.techReportCacheEntry.deleteMany({
          where: {
            cache: {
              requestedByUserId: {
                contains: teamId, // Assuming userId contains teamId
              },
            },
          },
        });
        stats.cacheEntriesDeleted += cacheEntries.count;

        await prisma.techReportCache.deleteMany({
          where: {
            requestedByUserId: {
              contains: teamId,
            },
          },
        });

        // Count agent threads before deletion
        const threadCount = await prisma.agentThread.count({
          where: { slackTeamId: teamId },
        });

        const turnCount = await prisma.conversationTurn.count({
          where: {
            agentThread: {
              slackTeamId: teamId,
            },
          },
        });

        // Delete agent threads (cascades to turns)
        await prisma.agentThread.deleteMany({
          where: { slackTeamId: teamId },
        });

        stats.threadsDeleted += threadCount;
        stats.turnsDeleted += turnCount;

        // Count jobs and related data before deletion
        const jobsToDelete = await prisma.job.findMany({
          where: { slackTeamId: teamId },
          select: { id: true },
        });

        const jobIds = jobsToDelete.map((j) => j.id);

        if (jobIds.length > 0) {
          // Count companies and technologies
          const companyCount = await prisma.jobCompany.count({
            where: { jobId: { in: jobIds } },
          });

          const contactCount = await prisma.jobContact.count({
            where: { jobId: { in: jobIds } },
          });

          const techCount = await prisma.companyTechnology.count({
            where: {
              jobCompany: {
                jobId: { in: jobIds },
              },
            },
          });

          // Delete jobs (cascades to companies, technologies, contacts via onDelete: Cascade)
          await prisma.job.deleteMany({
            where: { slackTeamId: teamId },
          });

          stats.jobsDeleted += jobIds.length;
          stats.companiesDeleted += companyCount;
          stats.technologiesDeleted += techCount;
          stats.contactsDeleted += contactCount;
        }

        stats.workspacesDisposed++;

        logger.info('Workspace data disposed', {
          teamId,
          jobsDeleted: jobIds.length,
          threadsDeleted: threadCount,
        });
      } catch (err) {
        stats.errors++;
        logger.error('Failed to dispose workspace', {
          teamId: workspace.slackTeamId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info('Workspace disposal completed', {
      workspacesDisposed: stats.workspacesDisposed,
      jobsDeleted: stats.jobsDeleted,
      companiesDeleted: stats.companiesDeleted,
      technologiesDeleted: stats.technologiesDeleted,
      contactsDeleted: stats.contactsDeleted,
      threadsDeleted: stats.threadsDeleted,
      turnsDeleted: stats.turnsDeleted,
      cacheEntriesDeleted: stats.cacheEntriesDeleted,
      errors: stats.errors,
    });
    return stats;
  } catch (err) {
    logger.error('Workspace disposal failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Disposes of expired audit and usage logs.
 *
 * For uninstalled workspaces older than 1 year post-uninstall:
 *   - Delete AgentThreadAudit records
 *   - Delete ApiUsageLog records
 *   - Delete DailyAggregate records
 *
 * @returns Statistics about the audit disposal operation
 */
export async function disposeExpiredAuditLogs(): Promise<AuditDisposalStats> {
  const stats: AuditDisposalStats = {
    workspacesProcessed: 0,
    auditsDeleted: 0,
    usageLogsDeleted: 0,
    aggregatesDeleted: 0,
    errors: 0,
  };

  const now = new Date();
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  logger.info('Starting audit log disposal', {
    timestamp: now.toISOString(),
    oneYearCutoff: oneYearAgo.toISOString(),
  });

  try {
    // Find uninstalled workspaces older than 1 year
    const oldWorkspaces = await prisma.workspaceInstallation.findMany({
      where: {
        status: 'UNINSTALLED',
        uninstalledAt: {
          lt: oneYearAgo,
        },
      },
    });

    logger.info('Found workspaces with expired audit data', {
      workspaceCount: oldWorkspaces.length,
    });

    // Process each workspace
    for (const workspace of oldWorkspaces) {
      try {
        const teamId = workspace.slackTeamId;

        logger.info('Disposing audit data for workspace', {
          teamId,
          uninstalledAt: workspace.uninstalledAt,
        });

        // Delete AgentThreadAudits
        const auditsDeleted = await prisma.agentThreadAudit.deleteMany({
          where: { slackTeamId: teamId },
        });
        stats.auditsDeleted += auditsDeleted.count;

        // Delete ApiUsageLogs
        const usageLogsDeleted = await prisma.apiUsageLog.deleteMany({
          where: { slackTeamId: teamId },
        });
        stats.usageLogsDeleted += usageLogsDeleted.count;

        // Delete DailyAggregates
        const aggregatesDeleted = await prisma.dailyAggregate.deleteMany({
          where: { slackTeamId: teamId },
        });
        stats.aggregatesDeleted += aggregatesDeleted.count;

        stats.workspacesProcessed++;

        logger.info('Audit data disposed for workspace', {
          teamId,
          auditsDeleted: auditsDeleted.count,
          usageLogsDeleted: usageLogsDeleted.count,
          aggregatesDeleted: aggregatesDeleted.count,
        });
      } catch (err) {
        stats.errors++;
        logger.error('Failed to dispose audit data for workspace', {
          teamId: workspace.slackTeamId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info('Audit log disposal completed', {
      workspacesProcessed: stats.workspacesProcessed,
      auditsDeleted: stats.auditsDeleted,
      usageLogsDeleted: stats.usageLogsDeleted,
      aggregatesDeleted: stats.aggregatesDeleted,
      errors: stats.errors,
    });
    return stats;
  } catch (err) {
    logger.error('Audit log disposal failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
