/**
 * Prompt Context Builder
 * Feature 23: Dynamic Suggested Prompts - T009-T012, T025-T026
 */

import logger from '../../lib/logger';
import { prisma } from '../../models/index';
import {
  PromptContext,
  SlackThreadContext,
  JobSummary,
  ChannelHistory,
  DocumentSummary,
  PresetSummary,
  WorkspaceConfig,
  IPromptContextBuilder,
} from '../../types/promptTypes';
import { ACTIVITY_WINDOWS } from '../../constants/promptCategories';
import { PromptContextBuildError, createErrorContext } from '../../utils/promptErrors';
import { promptContextCache } from '../cache/promptCache';
import { promptMetrics } from '../../utils/promptMetrics';

export class PromptContextBuilder implements IPromptContextBuilder {
  async build(slackContext: SlackThreadContext): Promise<PromptContext> {
    // T025: Check cache first
    const cached = await promptContextCache.get(slackContext.teamId, slackContext.userId);
    if (cached) {
      promptMetrics.recordCacheHit(slackContext.teamId);
      return cached;
    }

    promptMetrics.recordCacheMiss(slackContext.teamId);

    try {
      const buildStartTime = Date.now();

      const [activeJobs, completedJobs, failedJobs, totalCount, workspaceConfig, channelHistory, channelDocuments, channelPresets] =
        await Promise.all([
          this.fetchActiveJobs(slackContext.teamId, slackContext.userId),
          this.fetchCompletedJobs(slackContext.teamId, slackContext.userId),
          this.fetchFailedJobs(slackContext.teamId, slackContext.userId),
          this.fetchTotalEnrichmentCount(slackContext.teamId, slackContext.userId),
          this.fetchWorkspaceConfig(slackContext.teamId),
          slackContext.channelId ? this.fetchChannelHistory(slackContext.teamId, slackContext.channelId) : Promise.resolve(undefined),
          slackContext.channelId ? this.fetchChannelDocuments(slackContext.teamId, slackContext.channelId) : Promise.resolve(undefined),
          slackContext.channelId ? this.fetchChannelPresets(slackContext.teamId, slackContext.channelId) : Promise.resolve(undefined),
        ]);

      const context: PromptContext = {
        userId: slackContext.userId,
        teamId: slackContext.teamId,
        channelId: slackContext.channelId,
        threadTs: slackContext.threadTs,
        activeJobs,
        completedJobs,
        failedJobs,
        totalEnrichmentCount: totalCount,
        channelEnrichmentHistory: channelHistory,
        channelDocuments,
        channelPresets,
        workspaceConfig,
        generatedAt: new Date(),
      };

      const buildDuration = Date.now() - buildStartTime;
      promptMetrics.recordContextBuildLatency(buildDuration, slackContext.teamId);

      // T026: Cache the context
      await promptContextCache.set(slackContext.teamId, slackContext.userId, context);

      return context;
    } catch (error) {
      throw new PromptContextBuildError('Failed to build prompt context', error, createErrorContext('buildPromptContext', { slackContext }));
    }
  }

  // T009: Fetch active jobs
  private async fetchActiveJobs(teamId: string, userId: string): Promise<JobSummary[]> {
    const jobs = await prisma.job.findMany({
      where: { slackTeamId: teamId, slackUserId: userId, status: { in: ['PROCESSING', 'PENDING', 'AWAITING_PHONES'] } },
      select: { id: true, jobType: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return jobs.map(job => ({
      id: job.id,
      type: this.mapJobType(job.jobType),
      status: 'active',
      createdAt: job.createdAt,
      
    }));
  }

  // T010: Fetch completed jobs (48h window)
  private async fetchCompletedJobs(teamId: string, userId: string): Promise<JobSummary[]> {
    const cutoff = new Date(Date.now() - ACTIVITY_WINDOWS.COMPLETED_JOBS_HOURS * 60 * 60 * 1000);

    const jobs = await prisma.job.findMany({
      where: { slackTeamId: teamId, slackUserId: userId, status: 'COMPLETED', createdAt: { gte: cutoff } },
      select: { id: true, jobType: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return jobs.map(job => ({
      id: job.id,
      type: this.mapJobType(job.jobType),
      status: 'completed',
      createdAt: job.createdAt,
      
    }));
  }

  // T011: Fetch failed jobs (24h window)
  private async fetchFailedJobs(teamId: string, userId: string): Promise<JobSummary[]> {
    const cutoff = new Date(Date.now() - ACTIVITY_WINDOWS.FAILED_JOBS_HOURS * 60 * 60 * 1000);

    const jobs = await prisma.job.findMany({
      where: { slackTeamId: teamId, slackUserId: userId, status: 'FAILED', createdAt: { gte: cutoff } },
      select: { id: true, jobType: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    return jobs.map(job => ({
      id: job.id,
      type: this.mapJobType(job.jobType),
      status: 'failed',
      createdAt: job.createdAt,
      
    }));
  }

  private async fetchTotalEnrichmentCount(teamId: string, userId: string): Promise<number> {
    return await prisma.job.count({ where: { slackTeamId: teamId, slackUserId: userId } });
  }

  // T028: Fetch channel history
  private async fetchChannelHistory(teamId: string, channelId: string): Promise<ChannelHistory | undefined> {
    const jobs = await prisma.job.findMany({
      where: { slackTeamId: teamId, slackChannelId: channelId, status: 'COMPLETED' },
      select: { jobType: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    if (jobs.length === 0) return undefined;

    const typeCounts: Record<string, number> = {};
    jobs.forEach(job => {
      const type = this.mapJobType(job.jobType);
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    });

    const mostCommonType = Object.entries(typeCounts).sort(([, a], [, b]) => b - a)[0][0] as 'technographic' | 'contact' | 'combined';

    return { totalJobs: jobs.length, mostCommonType, lastJobAt: jobs[0].createdAt };
  }

  // T029: Fetch channel documents
  private async fetchChannelDocuments(teamId: string, channelId: string): Promise<DocumentSummary[]> {
    const docs = await prisma.clientDocument.findMany({
      where: { slackTeamId: teamId, slackChannelId: channelId },
      select: { id: true, documentType: true, slug: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    return docs.map(doc => ({
      id: doc.id,
      documentType: doc.documentType.toLowerCase() as 'icp' | 'use_cases',
      slug: doc.slug,
      
    }));
  }

  // T030: Fetch channel presets
  private async fetchChannelPresets(teamId: string, channelId: string): Promise<PresetSummary[]> {
    // Note: EnrichmentPreset schema doesn't include slackTeamId/slackChannelId/enrichmentType
    // TODO: Update schema or remove this feature
    return [];
  }

  // T040-T041: Fetch workspace config
  async fetchWorkspaceConfig(teamId: string): Promise<WorkspaceConfig> {
    const workspace = await prisma.workspaceInstallation.findUnique({
      where: { slackTeamId: teamId },
      select: { maxBuiltwithLookups: true, maxApolloCredits: true, monthlySpendCapUsd: true },
    });

    if (!workspace) {
      return { apolloEnabled: false, apolloCreditsRemaining: 0, builtWithEnabled: false, usagePercentage: 0 };
    }

    const usagePercentage = await this.calculateUsagePercentage(teamId);

    return {
      apolloEnabled: (workspace.maxApolloCredits || 0) > 0,
      apolloCreditsRemaining: workspace.maxApolloCredits || 0,
      builtWithEnabled: (workspace.maxBuiltwithLookups || 0) > 0,
      usagePercentage,
    };
  }

  private async calculateUsagePercentage(teamId: string): Promise<number> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const usage = await prisma.apiUsageLog.aggregate({
      where: { slackTeamId: teamId, createdAt: { gte: startOfMonth } },
      _sum: { estimatedCostUsd: true },
    });

    const workspace = await prisma.workspaceInstallation.findUnique({
      where: { slackTeamId: teamId },
      select: { monthlySpendCapUsd: true },
    });

    const totalCost = Number(usage._sum?.estimatedCostUsd || 0);
    const cap = Number(workspace?.monthlySpendCapUsd || 0);

    if (cap === 0) return 0;
    return Math.min((totalCost / cap) * 100, 100);
  }

  private mapJobType(jobType: string): 'technographic' | 'contact' | 'combined' | 'tech_report' {
    const mapping: Record<string, JobSummary['type']> = {
      TECHNOGRAPHIC: 'technographic',
      CONTACT: 'contact',
      COMBINED: 'combined',
      TECH_REPORT: 'tech_report',
    };
    return mapping[jobType] || 'technographic';
  }
}

export const promptContextBuilder = new PromptContextBuilder();
