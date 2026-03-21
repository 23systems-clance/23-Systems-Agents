/**
 * BullMQ worker for result file generation jobs.
 *
 * Processes jobs from the 'file-generation' queue with the name
 * 'generate-result-file'. Loads enriched company/contact data from the
 * database, generates a CSV or XLSX output file, persists it to S3, and
 * delivers it to the originating Slack thread (or posts a pre-signed
 * download link when the file exceeds 1 GB).
 */

import { Worker, Job } from 'bullmq';
import { config } from '../../../config/index.js';
import { prisma } from '../../../models/index.js';
import {
  generateTechnographicOutput,
  generateContactOutput,
  generateCombinedOutput,
} from '../../file/generator.js';
import { uploadSlackFile, markThreadForBotUpload } from '../../file/slackFile.js';
import { buildListFilename } from '../../file/listNaming.js';
import { uploadFile, getPresignedUrl, downloadFile } from '../../../lib/storage.js';
import { buildContactChainBlocks } from '../../../listeners/actions/contactChain.js';
import { buildTechReportChainBlocks } from '../../../listeners/actions/techReportChain.js';
import logger from '../../../lib/logger.js';
import { logError } from '../../../services/admin/errorLogger.js';
import { publishProgress } from '../../agent/taskVisualizer.js';
import type { FileGenerationData } from '../queues.js';
import { promptContextCache } from '../../cache/promptCache.js';
import { resolveFeatureFlags, isFeatureEnabled } from '../../featureToggle/featureFlags.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 1 GB threshold (bytes). Files larger than this get a pre-signed link. */
const MAX_SLACK_FILE_BYTES = 1_073_741_824;

/** Content-type mapping for S3 uploads. */
const CONTENT_TYPE_MAP: Record<string, string> = {
  CSV: 'text/csv',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

// ---------------------------------------------------------------------------
// Worker processor
// ---------------------------------------------------------------------------

/**
 * Processes a single file generation job.
 *
 * Steps:
 *   1. Load the parent Job with all company, technology, and contact data.
 *   2. Generate the output buffer using the appropriate generator function.
 *   3. Upload the file to S3.
 *   4. If file exceeds 1 GB, generate a pre-signed URL (7-day expiry) and
 *      post the download link to Slack instead of uploading the file directly.
 *   5. Otherwise, upload the file to Slack via uploadV2.
 *   6. Update the job status to COMPLETED with the S3 result file URL.
 *   7. Post a summary message to the Slack thread.
 *
 * @param job         - BullMQ job containing {@link FileGenerationData}.
 * @param slackClient - Authenticated Slack WebClient for posting messages
 *                       and uploading files.
 */
async function processFileGenerationJob(
  job: Job<FileGenerationData>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  slackClient: any,
): Promise<void> {
  const { jobId, outputFormat, channelId, threadTs } = job.data;
  const jobLogger = logger.withContext({ jobId, channelId });

  jobLogger.info('File generation started', { outputFormat });

  // Notify agent of generate stage start
  await publishProgress({ jobId, stage: 'generate', status: 'in_progress', detail: 'Generating output file' });

  // ---------------------------------------------------------------------------
  // Step 1: Load job data with all relations
  // ---------------------------------------------------------------------------
  const dbJob = await prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    include: {
      companies: {
        include: {
          technologies: true,
          contacts: true,
        },
        orderBy: { rowIndex: 'asc' },
      },
    },
  });

  // Map DB records to the generator's CompanyRecord shape
  const companyRecords = dbJob.companies.map((c) => ({
    companyName: c.companyName,
    domain: c.domain,
    resolvedDomain: c.resolvedDomain,
    cloudProviderPrimary: c.cloudProviderPrimary,
    cloudProvidersAll: c.cloudProvidersAll,
    techSpendTier: c.techSpendTier,
    technologyCount: c.technologyCount,
    enrichmentStatus: c.enrichmentStatus,
    errorMessage: c.errorMessage,
    trafficRank: c.trafficRank,
    locationCity: c.locationCity,
    locationState: c.locationState,
    locationCountry: c.locationCountry,
    locationZip: c.locationZip,
    telephones: c.telephones,
    emails: c.emails,
    socialProfiles: c.socialProfiles,
    metaNames: c.metaNames,
    vertical: c.vertical,
    companyNameFromApi: c.companyNameFromApi,
    salesRevenue: c.salesRevenue,
    techSpendUsd: c.techSpendUsd,
    employeeCount: c.employeeCount,
    productCount: c.productCount,
    followers: c.followers,
    technologies: c.technologies.map((t) => ({
      name: t.name,
      categories: t.categories,
      firstDetected: t.firstDetected,
      lastDetected: t.lastDetected,
    })),
    contacts: c.contacts.map((ct) => ({
      fullName: ct.fullName,
      firstName: ct.firstName,
      lastName: ct.lastName,
      email: ct.email,
      directPhone: ct.directPhone,
      businessPhone: ct.businessPhone,
      jobTitle: ct.jobTitle,
      personaType: ct.personaType,
      seniorityLevel: ct.seniorityLevel,
      linkedinUrl: ct.linkedinUrl,
      apolloPersonId: ct.apolloPersonId,
      timezoneUtc: ct.timezoneUtc,
      timezoneLabel: ct.timezoneLabel,
      isDecisionMaker: ct.isDecisionMaker,
      enrichmentStatus: ct.enrichmentStatus,
      apolloMetadata: ct.apolloMetadata as Record<string, unknown> | null,
      emailSource: ct.emailSource ?? null,
      emailCost: ct.emailCost ?? null,
      phoneSource: ct.phoneSource ?? null,
      phoneCost: ct.phoneCost ?? null,
      callStatus: ct.callStatus ?? null,
      dncStatus: ct.dncStatus ?? null,
      emailVerified: ct.emailVerified ?? null,
      emailProvider: ct.emailProvider ?? null,
    })),
  }));

  // ---------------------------------------------------------------------------
  // Step 1b: Resolve Slack channel name from channel ID
  // ---------------------------------------------------------------------------
  let channelName = dbJob.slackChannelName ?? channelId;
  if (channelName === channelId) {
    // Fallback: try resolving from Slack API if not stored on the Job record.
    try {
      const channelInfo = await slackClient.conversations.info({ channel: channelId });
      channelName = channelInfo.channel?.name ?? channelId;
    } catch (err) {
      jobLogger.warn('Failed to resolve channel name, using channel ID', {
        channelId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Step 1c: Post error summary if there were failures
  // ---------------------------------------------------------------------------
  if (dbJob.errorMessage && dbJob.companiesFailed > 0) {
    try {
      await slackClient.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: `Enrichment completed with errors:\n${dbJob.errorMessage}\n\nResults file will still be generated for successful companies.`,
      });
    } catch (err) {
      jobLogger.warn('Failed to post error summary to Slack', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Step 2: Generate output file based on job type
  // ---------------------------------------------------------------------------
  let fileBuffer: Buffer;

  switch (dbJob.jobType) {
    case 'TECHNOGRAPHIC':
      fileBuffer = generateTechnographicOutput({
        jobCompanies: companyRecords,
        outputFormat,
        channelId,
        channelName,
      });
      break;

    case 'CONTACT':
      fileBuffer = generateContactOutput({
        jobCompanies: companyRecords,
        outputFormat,
        channelId,
        channelName,
      });
      break;

    case 'COMBINED':
      fileBuffer = generateCombinedOutput({
        jobCompanies: companyRecords,
        outputFormat,
        channelId,
        channelName,
      });
      break;

    case 'TECH_REPORT':
      // Tech report files are already generated and uploaded to S3 by the
      // techReport worker. Download the existing file for Slack delivery.
      if (!dbJob.resultFileUrl) {
        throw new Error('TECH_REPORT job is missing resultFileUrl');
      }
      fileBuffer = await downloadFile(dbJob.resultFileUrl);
      break;

    default:
      throw new Error(`Unsupported job type for file generation: ${dbJob.jobType}`);
  }

  const fileExtension = outputFormat === 'XLSX' ? 'xlsx' : 'csv';
  const s3Key = `results/${jobId}.${fileExtension}`;

  // Build filename using the shared naming utility.
  // When campaignName is set: MMDD [CLIENT] Campaign Name : Co-Sell Name.ext
  // Otherwise falls back to: MMDD CONTACTS - sourceBaseName.ext
  const sourceBaseName = dbJob.sourceFileName
    ? dbJob.sourceFileName.replace(/\.[^.]+$/, '') // strip original extension
    : `enrichment-results-${jobId.slice(0, 8)}`;
  const filename = buildListFilename({
    channelName,
    campaignName: dbJob.campaignName,
    cosellName: dbJob.cosellProvider,
    extension: fileExtension,
    jobType: dbJob.jobType,
    sourceBaseName,
  });
  const contentType = CONTENT_TYPE_MAP[outputFormat] ?? 'application/octet-stream';

  // ---------------------------------------------------------------------------
  // Step 3: Upload to S3
  // ---------------------------------------------------------------------------
  await uploadFile(s3Key, fileBuffer, contentType);
  jobLogger.info('File uploaded to S3', { s3Key, sizeBytes: fileBuffer.length });

  // ---------------------------------------------------------------------------
  // Step 4/5: Deliver to Slack
  // ---------------------------------------------------------------------------
  const companiesProcessed = dbJob.companiesProcessed;
  const companiesFailed = dbJob.companiesFailed;
  const contactsFound = dbJob.contactsFound;

  const summaryText = buildSummaryMessage(
    companiesProcessed,
    companiesFailed,
    contactsFound,
    dbJob.jobType,
    dbJob.cacheHits,
    dbJob.cacheMisses,
    dbJob.apolloSearchCacheHits,
    dbJob.apolloSearchCacheMisses,
    dbJob.apolloContactCacheHits,
    dbJob.apolloContactCacheMisses,
  );

  if (fileBuffer.length > MAX_SLACK_FILE_BYTES) {
    // File is too large for Slack -- generate a pre-signed download URL
    const downloadUrl = await getPresignedUrl(s3Key);

    jobLogger.info('File exceeds 1 GB, posting pre-signed URL', {
      sizeBytes: fileBuffer.length,
    });

    await slackClient.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text:
        `${summaryText}\n\n` +
        `The result file is too large to upload directly. ` +
        `Download it here (link expires in 7 days):\n${downloadUrl}`,
    });
  } else {
    // Mark thread BEFORE upload so file_shared handler can skip bot files.
    // This avoids the race condition where file_shared fires before uploadV2 resolves.
    markThreadForBotUpload(channelId, threadTs);

    // Upload file directly to Slack
    await uploadSlackFile({
      client: slackClient,
      channelId,
      threadTs,
      fileBuffer,
      filename,
      title: `Enrichment Results - ${dbJob.jobType}`,
      initialComment: summaryText,
    });

    jobLogger.info('File uploaded to Slack', { filename });
  }

  // ---------------------------------------------------------------------------
  // Step 6: Update job status to COMPLETED
  // ---------------------------------------------------------------------------
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: 'COMPLETED',
      resultFileUrl: s3Key,
      resultFileName: filename,
      completedAt: new Date(),
    },
  });

  // T027: Invalidate prompt context cache on job completion
  await promptContextCache.invalidate(dbJob.slackTeamId, dbJob.slackUserId);

  // Notify agent of generate stage completion
  await publishProgress({ jobId, stage: 'generate', status: 'complete', detail: `File ready: ${filename}` });

  jobLogger.info('File generation job complete', { s3Key, filename });

  // ---------------------------------------------------------------------------
  // Detect intermediate step in "Get Both" (combined) flow.
  // When enrichIntent === 'combined' and this is the TECHNOGRAPHIC phase,
  // the workflow isn't finished yet — skip interactive buttons (Send Copy To,
  // Analyze Personality, Company Intelligence, DM notification, HubSpot)
  // and only post the enrichment data selection prompt (Step 7).
  // ---------------------------------------------------------------------------
  const { getConversation } = await import('../../state/conversationStore.js');
  const conversation = await getConversation(channelId, threadTs);
  const isIntermediateCombinedStep =
    dbJob.jobType === 'TECHNOGRAPHIC' && conversation?.enrichIntent === 'combined';

  if (isIntermediateCombinedStep) {
    jobLogger.info('Combined flow intermediate step — skipping interactive buttons', { jobId });
  }

  // ---------------------------------------------------------------------------
  // Step 6.1: Post "Send Copy To" button (Feature 35 — T035)
  // Skip for intermediate combined-flow steps — buttons only appear at the end.
  // ---------------------------------------------------------------------------
  if (!isIntermediateCombinedStep) {
    try {
      await slackClient.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        blocks: [
          {
            type: 'actions' as const,
            elements: [
              {
                type: 'button' as const,
                text: { type: 'plain_text' as const, text: 'Send Copy To' },
                action_id: 'send_copy_to_open',
                value: jobId,
              },
            ],
          },
        ],
        text: 'Send a copy of these results via email or Slack channel.',
      });
    } catch (err) {
      jobLogger.warn('Failed to post Send Copy To button', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Step 6.2: Post optional "Analyze Personality" & "Company Intelligence" buttons (T071/T073)
  // Skip for intermediate combined-flow steps — buttons only appear at the end.
  // ---------------------------------------------------------------------------
  if (!isIntermediateCombinedStep) {
    try {
      const workspace = await prisma.workspaceInstallation.findUnique({
        where: { slackTeamId: dbJob.slackTeamId },
        select: { featureFlags: true },
      });
      const flags = resolveFeatureFlags(
        dbJob.slackTeamId,
        workspace?.featureFlags as Record<string, unknown> | null,
      );

      // Collect contacts that have LinkedIn URLs for personality analysis
      const contactsWithLinkedIn = dbJob.companies
        .flatMap((c) => c.contacts)
        .filter((ct) => ct.linkedinUrl);

      if (isFeatureEnabled(flags, 'personalityAnalysis') && contactsWithLinkedIn.length > 0) {
        await slackClient.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          blocks: [
            {
              type: 'section' as const,
              text: {
                type: 'mrkdwn' as const,
                text: `Want to analyze a contact's personality? ${contactsWithLinkedIn.length} contact(s) with LinkedIn profiles available.`,
              },
              accessory: {
                type: 'button' as const,
                text: { type: 'plain_text' as const, text: 'Analyze Personality' },
                action_id: 'personality_analyze',
                value: jobId,
              },
            },
          ],
          text: 'Analyze contact personality via AIARC.',
        });
      }

      // Company intelligence button (job postings & news)
      const companiesWithDomains = dbJob.companies.filter(
        (c) => c.resolvedDomain || c.domain,
      );
      if (isFeatureEnabled(flags, 'icpAnalysis') && companiesWithDomains.length > 0) {
        await slackClient.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          blocks: [
            {
              type: 'section' as const,
              text: {
                type: 'mrkdwn' as const,
                text: `View job postings & latest news for enriched companies? ${companiesWithDomains.length} companies available.`,
              },
              accessory: {
                type: 'button' as const,
                text: { type: 'plain_text' as const, text: 'Company Intelligence' },
                action_id: 'company_intelligence',
                value: jobId,
              },
            },
          ],
          text: 'View job postings and company news.',
        });
      }
    } catch (err) {
      jobLogger.warn('Failed to post personality/intelligence buttons', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Step 6a: Auto-filter if postEnrichmentFilter is configured (smart file upload)
  // ---------------------------------------------------------------------------
  const parsedIntent = dbJob.parsedIntent as Record<string, unknown> | null;
  const postFilter = parsedIntent?.postEnrichmentFilter as {
    filterExpression: string;
    technology?: string;
  } | undefined;

  if (postFilter && dbJob.jobType === 'TECHNOGRAPHIC') {
    try {
      const { parseFilterCriteria } = await import('../../ai/filterParser.js');
      const { applyFilters } = await import('../../filter/filterEngine.js');

      // Load enriched company data with technologies for filtering
      const enrichedCompanies = await prisma.jobCompany.findMany({
        where: { jobId, enrichmentStatus: 'SUCCESS' },
        include: { technologies: true },
      });

      if (enrichedCompanies.length > 0) {
        const headers = [
          'Company Name', 'Domain', 'Cloud Provider', 'Tech Spend Tier',
          'Tech Spend Score', 'Technology Count', 'Enterprise Tech Count',
          'Employee Count', 'Vertical', 'City', 'State', 'Country',
          'Technologies',
        ];

        const rows = enrichedCompanies.map((c) => ({
          'Company Name': c.companyName || '',
          'Domain': c.resolvedDomain || c.domain || '',
          'Cloud Provider': c.cloudProviderPrimary || '',
          'Tech Spend Tier': c.techSpendTier || '',
          'Tech Spend Score': c.techSpendScore?.toString() || '',
          'Technology Count': c.technologyCount?.toString() || '',
          'Enterprise Tech Count': c.enterpriseTechCount?.toString() || '',
          'Employee Count': c.employeeCount?.toString() || '',
          'Vertical': c.vertical || '',
          'City': c.locationCity || '',
          'State': c.locationState || '',
          'Country': c.locationCountry || '',
          'Technologies': c.technologies.map((t) => t.name).join(', '),
        }));

        const filterExpression = postFilter.technology
          ? `only include companies that use ${postFilter.technology}`
          : postFilter.filterExpression;

        const parseResult = await parseFilterCriteria(filterExpression, headers, rows.slice(0, 3));

        if (parseResult.understood && parseResult.filters.length > 0) {
          const filterResult = applyFilters(rows, parseResult.filters, headers);

          if (filterResult.filtered.length > 0) {
            // Generate filtered CSV
            const { stringify } = await import('csv-stringify/sync');
            const csvContent = stringify(
              [headers, ...filterResult.filtered.map((row) => headers.map((h) => row[h] || ''))],
            );
            const filteredBuffer = Buffer.from(csvContent, 'utf-8');

            const techLabel = postFilter.technology || 'filtered';
            const filteredFilename = `${techLabel.toLowerCase().replace(/\s+/g, '-')}-companies-${jobId.slice(0, 8)}.csv`;

            // Upload filtered file to Slack thread
            markThreadForBotUpload(channelId, threadTs);
            await uploadSlackFile({
              client: slackClient,
              channelId,
              threadTs,
              fileBuffer: filteredBuffer,
              filename: filteredFilename,
              title: `Filtered: ${postFilter.technology || 'Custom Filter'}`,
              initialComment: `*${filterResult.filtered.length}* of *${filterResult.originalCount}* companies match${postFilter.technology ? ` "${postFilter.technology}"` : ' your filter'}.\n\nThe full enriched file with all ${filterResult.originalCount} companies is above.`,
            });

            jobLogger.info('Post-enrichment auto-filter applied', {
              technology: postFilter.technology,
              original: filterResult.originalCount,
              filtered: filterResult.filtered.length,
            });
          } else {
            // No matches found
            await slackClient.chat.postMessage({
              channel: channelId,
              thread_ts: threadTs,
              text: `I filtered for ${postFilter.technology ? `"${postFilter.technology}"` : 'your criteria'} but found *0 matches* out of ${filterResult.originalCount} companies. The full enriched file is above with all data.`,
            });
          }
        }
      }
    } catch (filterError) {
      jobLogger.warn('Post-enrichment auto-filter failed (non-fatal)', {
        error: filterError instanceof Error ? filterError.message : String(filterError),
        jobId,
      });
      // Non-fatal: the full enriched file was already delivered
      await slackClient.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: `I couldn't automatically filter the results${postFilter.technology ? ` for "${postFilter.technology}"` : ''}. You can filter manually by telling the agent to "filter for ${postFilter.technology || 'your criteria'}".`,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Step 6b: Send DM notification to the requesting user
  // Skip for intermediate combined-flow steps — DM only sent at the end.
  // ---------------------------------------------------------------------------
  if (!isIntermediateCombinedStep && dbJob.slackUserId) {
    try {
      const threadLink = `https://slack.com/archives/${channelId}/p${threadTs.replace('.', '')}`;
      await slackClient.chat.postMessage({
        channel: dbJob.slackUserId,
        text: `Your enrichment job is complete! ${companiesProcessed} companies processed.\n<${threadLink}|View results>`,
      });
      jobLogger.info('DM completion notification sent', { userId: dbJob.slackUserId });
    } catch (err) {
      jobLogger.warn('Failed to send DM completion notification', {
        userId: dbJob.slackUserId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Step 7: For TECHNOGRAPHIC jobs, check for BOTH flow or offer chain prompt
  // ---------------------------------------------------------------------------
  if (dbJob.jobType === 'TECHNOGRAPHIC') {
    // conversation already loaded above for isIntermediateCombinedStep check
    if (conversation?.enrichIntent === 'combined') {
      // BOTH flow: show enrichment data selection for contact enrichment
      jobLogger.info('BOTH flow: technographic complete, showing enrichment data selection', {
        technographicJobId: jobId,
      });

      try {
        const { buildEnrichmentDataBlocks } = await import('../../../listeners/actions/enrichmentDataSelection.js');

        await slackClient.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          blocks: buildEnrichmentDataBlocks(),
          text: 'What would you like to enrich?',
        });

        jobLogger.info('BOTH flow: enrichment data selection posted', { jobId });
      } catch (err) {
        jobLogger.error('Failed to post enrichment data selection for BOTH flow', {
          error: err instanceof Error ? err.message : String(err),
          jobId,
        });
      }
    } else {
      // Normal technographic-only flow: ask user if they want contact enrichment
      try {
        await slackClient.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          blocks: buildContactChainBlocks(jobId),
          text: 'Would you like me to get contacts for this list?',
        });
        jobLogger.info('Contact chain prompt posted', { jobId });
      } catch (err) {
        jobLogger.warn('Failed to post contact chain prompt', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Step 7b: For TECH_REPORT jobs, offer enrichment chain
  // ---------------------------------------------------------------------------
  if (dbJob.jobType === 'TECH_REPORT') {
    try {
      await slackClient.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        blocks: buildTechReportChainBlocks(jobId),
        text: 'Would you like to enrich this list further?',
      });
      jobLogger.info('Tech report enrichment chain prompt posted', { jobId });
    } catch (err) {
      jobLogger.warn('Failed to post tech report chain prompt', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Step 8: Offer HubSpot import if channel client has active connection
  // Skip for intermediate combined-flow steps — offer only at the end.
  // ---------------------------------------------------------------------------
  if (!isIntermediateCombinedStep) {
    try {
      const channelMapping = await prisma.channelClientMapping.findFirst({
        where: { slackChannelId: channelId },
        select: { clientId: true },
      });

      if (channelMapping) {
        const hubspotConn = await prisma.hubSpotConnection.findUnique({
          where: { clientId: channelMapping.clientId },
          select: { status: true },
        });

        if (hubspotConn?.status === 'ACTIVE') {
          await slackClient.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            blocks: [
              {
                type: 'section' as const,
                text: {
                  type: 'mrkdwn' as const,
                  text: 'Want to import these contacts to HubSpot?',
                },
                accessory: {
                  type: 'button' as const,
                  text: { type: 'plain_text' as const, text: 'Import to HubSpot' },
                  action_id: 'hubspot_import_from_enrichment',
                  value: jobId,
                  style: 'primary' as const,
                },
              },
            ],
            text: 'Import contacts to HubSpot?',
          });
          jobLogger.info('HubSpot import button posted', { jobId });
        }
      }
    } catch (err) {
      jobLogger.warn('Failed to check HubSpot connection for inline import', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a human-readable summary message for the Slack thread.
 *
 * @param processed           - Number of companies successfully enriched.
 * @param failed              - Number of companies that failed enrichment.
 * @param contacts            - Number of contacts found (0 for technographic-only).
 * @param jobType             - The type of enrichment job.
 * @param cacheHits           - Domains served from domain enrichment cache (Feature 17).
 * @param cacheMisses         - Domains that required fresh BuiltWith lookup (Feature 17).
 * @param searchCacheHits     - Companies served from Apollo search cache (Feature 22).
 * @param searchCacheMisses   - Companies that required fresh Apollo search (Feature 22).
 * @param contactCacheHits    - Contacts served from Apollo contact cache (Feature 22).
 * @param contactCacheMisses  - Contacts that required fresh bulk enrichment (Feature 22).
 * @returns Formatted summary string.
 */
function buildSummaryMessage(
  processed: number,
  failed: number,
  contacts: number,
  jobType: string,
  cacheHits = 0,
  cacheMisses = 0,
  searchCacheHits = 0,
  searchCacheMisses = 0,
  contactCacheHits = 0,
  contactCacheMisses = 0,
): string {
  const total = processed + failed;
  const lines: string[] = [
    `Enrichment complete! Here are your results:`,
    `- Companies processed: ${processed}/${total}`,
  ];

  if (failed > 0) {
    lines.push(`- Companies failed: ${failed}`);
  }

  if (cacheHits > 0) {
    const totalDomains = cacheHits + cacheMisses;
    lines.push(`- Domains enriched: ${totalDomains} (${cacheHits} from cache, ${cacheMisses} fresh lookups)`);
  }

  if (jobType === 'CONTACT' || jobType === 'COMBINED') {
    lines.push(`- Contacts found: ${contacts}`);

    if (searchCacheHits > 0) {
      lines.push(`- Apollo search: ${searchCacheHits + searchCacheMisses} companies searched (${searchCacheHits} from cache, ${searchCacheMisses} fresh)`);
    }

    if (contactCacheHits > 0) {
      lines.push(`- Apollo enrichment: ${contactCacheHits + contactCacheMisses} contacts enriched (${contactCacheHits} from cache, ${contactCacheMisses} fresh, ~${contactCacheHits} credits saved)`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates and returns a BullMQ Worker that listens on the 'file-generation'
 * queue for jobs named 'generate-result-file'.
 *
 * The Slack WebClient is injected at creation time so that the worker can
 * upload files and post messages. Pass the Bolt app's `client` property
 * when starting the worker from app.ts.
 *
 * @param slackClient - Authenticated Slack WebClient instance. The Bolt
 *                       app's `client` will be injected when the worker is
 *                       started from app.ts.
 * @returns A configured BullMQ {@link Worker} instance.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createFileGenerationWorker(slackClient: any): Worker {
  const worker = new Worker<FileGenerationData>(
    'file-generation',
    async (job: Job<FileGenerationData>) => {
      if (job.name !== 'generate-result-file') {
        logger.debug('Skipping non-file-generation job', {
          jobName: job.name,
        });
        return;
      }

      await processFileGenerationJob(job, slackClient);
    },
    {
      connection: { url: config.redis.url },
      concurrency: 1,
    },
  );

  worker.on('completed', (job: Job<FileGenerationData>) => {
    logger.info('File generation job completed', {
      bullmqJobId: job.id,
      jobId: job.data.jobId,
    });
  });

  worker.on('failed', (job: Job<FileGenerationData> | undefined, err: Error) => {
    logger.error('File generation job failed', {
      bullmqJobId: job?.id,
      jobId: job?.data.jobId,
      error: err.message,
    });
    logError({
      category: 'QUEUE_ERROR',
      service: 'queue:file-generation',
      message: err.message,
      stackTrace: err.stack,
      jobId: job?.data.jobId,
    });

    if (job?.data.jobId) {
      // Attempt to mark the job as FAILED in the database.
      prisma.job
        .update({
          where: { id: job.data.jobId },
          data: {
            status: 'FAILED',
            errorMessage: `File generation failed: ${err.message}`,
            completedAt: new Date(),
          },
          select: { slackTeamId: true, slackUserId: true },
        })
        .then((updatedJob) => {
          // T027: Invalidate prompt context cache on job failure
          return promptContextCache.invalidate(updatedJob.slackTeamId, updatedJob.slackUserId);
        })
        .catch((updateErr: unknown) => {
          logger.error('Failed to update job status after file generation failure', {
            jobId: job.data.jobId,
            error: updateErr instanceof Error ? updateErr.message : String(updateErr),
          });
        });

      // Post error notification to Slack thread.
      slackClient.chat
        .postMessage({
          channel: job.data.channelId,
          thread_ts: job.data.threadTs,
          text: `Failed to generate results file: ${err.message}. Please try again or contact support.`,
        })
        .catch((slackErr: unknown) => {
          logger.error('Failed to post error notification to Slack', {
            jobId: job.data.jobId,
            error: slackErr instanceof Error ? slackErr.message : String(slackErr),
          });
        });

      // Send DM failure notification to the requesting user.
      prisma.job
        .findUnique({ where: { id: job.data.jobId }, select: { slackUserId: true } })
        .then((dbJob) => {
          if (dbJob?.slackUserId) {
            return slackClient.chat.postMessage({
              channel: dbJob.slackUserId,
              text: `Your enrichment job failed: ${err.message}. Please try again or contact support.`,
            });
          }
        })
        .catch((dmErr: unknown) => {
          logger.warn('Failed to send DM failure notification', {
            jobId: job.data.jobId,
            error: dmErr instanceof Error ? dmErr.message : String(dmErr),
          });
        });
    }
  });

  return worker;
}
