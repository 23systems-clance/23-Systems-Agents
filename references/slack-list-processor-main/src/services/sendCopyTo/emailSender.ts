/**
 * Email sender service for "Send Copy To" (T031).
 *
 * Sends enrichment result files as email attachments via Resend.
 * Downloads the result file from S3, attaches it to the email, and
 * includes an enrichment summary in the body.
 */

import { Resend } from 'resend';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { prisma } from '../../models/index.js';
import { config } from '../../config/index.js';
import logger from '../../lib/logger.js';

const resend = new Resend(config.billing.resendApiKey);
const s3 = new S3Client({ region: config.s3.region });

/**
 * Sends an enrichment result file to one or more email recipients.
 *
 * @param jobId           - Enrichment job ID for file lookup.
 * @param recipientEmails - Array of recipient email addresses.
 * @param slackTeamId     - Workspace team ID for context.
 * @returns True if sent successfully.
 */
export async function sendResultByEmail(
  jobId: string,
  recipientEmails: string[],
  slackTeamId: string,
): Promise<boolean> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      jobType: true,
      sourceRowCount: true,
      resultFileName: true,
      resultFileUrl: true,
      createdAt: true,
      slackTeamId: true,
    },
  });

  if (!job || job.slackTeamId !== slackTeamId) {
    logger.warn('sendResultByEmail: job not found or unauthorized', { jobId, slackTeamId });
    return false;
  }

  if (!job.resultFileUrl) {
    logger.warn('sendResultByEmail: no result file for job', { jobId });
    return false;
  }

  try {
    // Download file from S3
    const s3Response = await s3.send(new GetObjectCommand({
      Bucket: config.s3.bucket,
      Key: job.resultFileUrl,
    }));

    const fileBuffer = Buffer.from(await s3Response.Body!.transformToByteArray());
    const fileName = job.resultFileName || `enrichment-${jobId}.csv`;

    // Look up workspace name for email context
    const workspace = await prisma.workspaceInstallation.findUnique({
      where: { slackTeamId },
      select: { slackTeamName: true },
    });

    const fromEmail = config.licensing.resendFromEmail || 'noreply@example.com';
    const teamName = workspace?.slackTeamName ?? slackTeamId;

    await resend.emails.send({
      from: `List Enrichment Agent <${fromEmail}>`,
      to: recipientEmails,
      subject: `Enrichment Results: ${fileName}`,
      html: `
        <h2>Enrichment Results</h2>
        <p>Your enrichment results are attached.</p>
        <ul>
          <li><strong>File:</strong> ${fileName}</li>
          <li><strong>Type:</strong> ${job.jobType}</li>
          <li><strong>Rows:</strong> ${job.sourceRowCount ?? 'N/A'}</li>
          <li><strong>Date:</strong> ${job.createdAt.toISOString().split('T')[0]}</li>
          <li><strong>Workspace:</strong> ${teamName}</li>
        </ul>
      `,
      attachments: [
        {
          filename: fileName,
          content: fileBuffer,
        },
      ],
    });

    logger.info('Enrichment result sent via email', {
      jobId,
      recipientCount: recipientEmails.length,
      slackTeamId,
    });

    return true;
  } catch (error) {
    logger.error('Failed to send enrichment result via email', {
      jobId,
      slackTeamId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
