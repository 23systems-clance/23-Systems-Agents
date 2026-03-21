/**
 * ICP document processor (T066).
 *
 * Downloads files from Slack, extracts text using the document converter,
 * stores extracted text and S3 URL on the AnalysisChannel record.
 * Supports document types: icp, useCases, caseStudies, testimonials.
 */

import { prisma } from '../../models/index.js';
import { downloadSlackFile } from '../../services/file/slackFile.js';
import { uploadFile } from '../../lib/storage.js';
import { convertToMarkdown } from '../../services/document/converter.js';
import { config } from '../../config/index.js';
import logger from '../../lib/logger.js';

/** Valid ICP document types for analysis. */
export type IcpDocumentType = 'icp' | 'useCases' | 'caseStudies' | 'testimonials';

/** Maps document type to AnalysisChannel field names. */
const FIELD_MAP: Record<IcpDocumentType, { urlField: string; textField: string }> = {
  icp: { urlField: 'icpDocumentUrl', textField: 'icpExtractedText' },
  useCases: { urlField: 'useCasesDocumentUrl', textField: 'useCasesExtractedText' },
  caseStudies: { urlField: 'caseStudiesDocumentUrl', textField: 'caseStudiesExtractedText' },
  testimonials: { urlField: 'testimonialsDocumentUrl', textField: 'testimonialsExtractedText' },
};

/**
 * Processes an ICP-related document uploaded to an analysis channel.
 *
 * Downloads from Slack, converts to text, stores in S3, updates DB.
 *
 * @param slackTeamId - Workspace ID.
 * @param documentType - Type of ICP document.
 * @param fileUrl - Slack private download URL.
 * @param fileName - Original filename.
 * @param mimeType - MIME type for conversion routing.
 * @returns True if successful.
 */
export async function processIcpDocument(
  slackTeamId: string,
  documentType: IcpDocumentType,
  fileUrl: string,
  fileName: string,
  mimeType: string,
): Promise<boolean> {
  const fields = FIELD_MAP[documentType];
  if (!fields) {
    logger.error('Unknown ICP document type', { documentType });
    return false;
  }

  try {
    // Download file from Slack
    const buffer = await downloadSlackFile(fileUrl, config.slack.botToken);

    // Convert to text/markdown
    const { markdown } = await convertToMarkdown(buffer, mimeType, fileName);

    // Upload to S3 for archival
    const s3Key = `analysis/${slackTeamId}/${documentType}/${Date.now()}-${fileName}`;
    await uploadFile(s3Key, buffer, mimeType);

    // Update AnalysisChannel record
    await prisma.analysisChannel.update({
      where: { slackTeamId },
      data: {
        [fields.urlField]: s3Key,
        [fields.textField]: markdown,
        lastDocumentUploadAt: new Date(),
      },
    });

    logger.info('ICP document processed', {
      slackTeamId,
      documentType,
      fileName,
      textLength: markdown.length,
    });

    return true;
  } catch (error) {
    logger.error('Failed to process ICP document', {
      slackTeamId,
      documentType,
      fileName,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Gets the ICP context for a workspace (used by report generation).
 *
 * @param slackTeamId - Workspace ID.
 * @returns Object with extracted text for each document type, or null if no analysis channel.
 */
export async function getIcpContext(slackTeamId: string) {
  const analysisChannel = await prisma.analysisChannel.findUnique({
    where: { slackTeamId },
    select: {
      icpExtractedText: true,
      useCasesExtractedText: true,
      caseStudiesExtractedText: true,
      testimonialsExtractedText: true,
    },
  });

  if (!analysisChannel) return null;

  return {
    icpDefinition: analysisChannel.icpExtractedText ?? null,
    useCases: analysisChannel.useCasesExtractedText ?? null,
    caseStudies: analysisChannel.caseStudiesExtractedText ?? null,
    testimonials: analysisChannel.testimonialsExtractedText ?? null,
    hasContext: !!(
      analysisChannel.icpExtractedText ||
      analysisChannel.useCasesExtractedText ||
      analysisChannel.caseStudiesExtractedText ||
      analysisChannel.testimonialsExtractedText
    ),
  };
}
