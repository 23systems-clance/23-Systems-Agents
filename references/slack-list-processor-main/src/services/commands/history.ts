/**
 * Job history service for the /enrich slash command.
 *
 * Retrieves the most recent enrichment jobs for a given Slack user
 * and returns a formatted mrkdwn string.
 */

import { prisma } from '../../models/index.js';

/**
 * Retrieves the 10 most recent enrichment jobs for a given Slack user.
 *
 * @param userId - Slack user ID to query jobs for.
 * @returns Formatted mrkdwn string of job history, or a "no jobs" message.
 */
export async function getJobHistory(userId: string): Promise<string> {
  const recentJobs = await prisma.job.findMany({
    where: { slackUserId: userId },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      jobType: true,
      status: true,
      sourceFileName: true,
      createdAt: true,
      companiesProcessed: true,
      resultFileUrl: true,
    },
  });

  if (recentJobs.length === 0) {
    return 'No enrichment jobs found. Upload a CSV/XLSX file and follow the prompts to get started!';
  }

  const jobLines = recentJobs
    .map((j) => {
      const date = j.createdAt.toISOString().split('T')[0];
      const status = j.status === 'COMPLETED' ? 'Done' : j.status;
      return `- *${j.jobType}* | ${j.sourceFileName ?? 'N/A'} | ${status} | ${date} | ${j.companiesProcessed ?? 0} companies`;
    })
    .join('\n');

  return `Your recent enrichment jobs:\n${jobLines}`;
}
