/**
 * Bolt action handler for "Company Intelligence" button (T074).
 *
 * When triggered from enrichment results, shows a company selector,
 * then calls Apollo.io organization enrichment API to fetch job postings
 * and recent news, posting results as Block Kit messages in the thread.
 */

import type { App } from '@slack/bolt';
import { prisma } from '../../models/index.js';
import { post as apolloPost } from '../../services/apollo/client.js';
import logger from '../../lib/logger.js';

/** Apollo organization enrichment response shape. */
interface ApolloOrganizationEnrichment {
  organization?: {
    name?: string;
    website_url?: string;
    linkedin_url?: string;
    industry?: string;
    estimated_num_employees?: number;
    short_description?: string;
    annual_revenue_printed?: string;
    total_funding_printed?: string;
    latest_funding_round_date?: string;
    latest_funding_stage?: string;
    languages?: string[];
    blog_url?: string;
    primary_phone?: { number?: string };
    persona_counts?: Record<string, unknown>;
  };
}

/** Apollo people search response (for job postings context). */
interface ApolloPeopleSearch {
  people?: Array<{
    first_name?: string;
    last_name?: string;
    title?: string;
    headline?: string;
    linkedin_url?: string;
    employment_history?: Array<{
      title?: string;
      start_date?: string;
      end_date?: string;
      current?: boolean;
    }>;
  }>;
  pagination?: { total_entries?: number };
}

/**
 * Registers the company_intelligence action and follow-up handlers.
 *
 * @param app - Slack Bolt application instance.
 */
export function registerCompanyIntelligenceHandlers(app: App): void {
  // Step 1: User clicks "Company Intelligence" — show company selector
  app.action('company_intelligence', async ({ action, ack, client, body }) => {
    await ack();

    const jobId = (action as { value?: string }).value;
    if (!jobId) return;

    const channelId = (body as { channel?: { id: string } }).channel?.id;
    const threadTs = (body as { message?: { ts: string } }).message?.ts;
    if (!channelId) return;

    try {
      // Load companies with domains from this job
      const companies = await prisma.jobCompany.findMany({
        where: {
          jobId,
          enrichmentStatus: 'SUCCESS',
          OR: [
            { resolvedDomain: { not: null } },
            { domain: { not: null } },
          ],
        },
        select: {
          id: true,
          companyName: true,
          companyNameFromApi: true,
          resolvedDomain: true,
          domain: true,
        },
        take: 25,
      });

      if (companies.length === 0) {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: 'No enriched companies with domains found in this job.',
        });
        return;
      }

      // Build static_select with companies
      const options = companies.map((c) => ({
        text: {
          type: 'plain_text' as const,
          text: `${c.companyNameFromApi || c.companyName || c.resolvedDomain || c.domain || 'Unknown'}`.slice(0, 75),
        },
        value: c.id,
      }));

      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        blocks: [
          {
            type: 'section' as const,
            text: {
              type: 'mrkdwn' as const,
              text: 'Select a company to view job postings & latest news:',
            },
            accessory: {
              type: 'static_select' as const,
              action_id: 'company_intel_select',
              placeholder: { type: 'plain_text' as const, text: 'Choose a company...' },
              options,
            },
          },
        ],
        text: 'Select a company for intelligence.',
      });
    } catch (err) {
      logger.error('Failed to show company intelligence selector', {
        error: err instanceof Error ? err.message : String(err),
        jobId,
      });
    }
  });

  // Step 2: User selects a company — fetch organization data from Apollo
  app.action('company_intel_select', async ({ action, ack, client, body }) => {
    await ack();

    const selectedCompanyId = (action as { selected_option?: { value: string } }).selected_option?.value;
    if (!selectedCompanyId) return;

    const channelId = (body as { channel?: { id: string } }).channel?.id;
    const threadTs = (body as { message?: { ts: string } }).message?.ts;
    if (!channelId) return;

    try {
      // Load the selected company
      const company = await prisma.jobCompany.findUnique({
        where: { id: selectedCompanyId },
        select: {
          companyName: true,
          companyNameFromApi: true,
          resolvedDomain: true,
          domain: true,
        },
      });

      if (!company) {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: 'Company not found.',
        });
        return;
      }

      const companyName = company.companyNameFromApi || company.companyName || 'Unknown';
      const domain = company.resolvedDomain || company.domain;

      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: `Fetching intelligence for *${companyName}*... This may take a moment.`,
      });

      // Fetch organization enrichment from Apollo
      const orgResult = await apolloPost<ApolloOrganizationEnrichment>(
        '/v1/organizations/enrich',
        { domain },
      );

      // Fetch recent hires (proxy for job postings — people hired in last 6 months)
      const recentHiresResult = await apolloPost<ApolloPeopleSearch>(
        '/v1/mixed_people/search',
        {
          q_organization_domains: [domain],
          person_seniorities: ['c_suite', 'vp', 'director', 'manager'],
          per_page: 10,
          page: 1,
        },
      );

      const org = orgResult.data.organization;
      const recentHires = recentHiresResult.data.people ?? [];

      // Build and post results
      const blocks = buildCompanyIntelBlocks(companyName, domain, org, recentHires);

      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        blocks,
        text: `Company intelligence for ${companyName}`,
      });
    } catch (err) {
      logger.error('Company intelligence failed', {
        error: err instanceof Error ? err.message : String(err),
        companyId: selectedCompanyId,
      });

      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: 'Company intelligence lookup failed. Please try again later.',
      }).catch(() => {});
    }
  });
}

/**
 * Builds Block Kit blocks for company intelligence results.
 */
function buildCompanyIntelBlocks(
  companyName: string,
  domain: string | null,
  org: ApolloOrganizationEnrichment['organization'] | undefined,
  recentHires: ApolloPeopleSearch['people'],
): import('@slack/types').KnownBlock[] {
  const blocks: import('@slack/types').KnownBlock[] = [];

  // Header
  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: `Company Intelligence: ${companyName}` },
  });

  // Organization overview
  if (org) {
    const overviewLines: string[] = [];
    if (org.industry) overviewLines.push(`*Industry:* ${org.industry}`);
    if (org.estimated_num_employees) overviewLines.push(`*Employees:* ${org.estimated_num_employees.toLocaleString()}`);
    if (org.annual_revenue_printed) overviewLines.push(`*Annual Revenue:* ${org.annual_revenue_printed}`);
    if (org.total_funding_printed) overviewLines.push(`*Total Funding:* ${org.total_funding_printed}`);
    if (org.latest_funding_stage) {
      const fundingInfo = org.latest_funding_round_date
        ? `${org.latest_funding_stage} (${org.latest_funding_round_date})`
        : org.latest_funding_stage;
      overviewLines.push(`*Latest Funding:* ${fundingInfo}`);
    }
    if (org.website_url) overviewLines.push(`*Website:* ${org.website_url}`);
    if (org.linkedin_url) overviewLines.push(`*LinkedIn:* ${org.linkedin_url}`);

    if (org.short_description) {
      overviewLines.unshift(org.short_description);
    }

    if (overviewLines.length > 0) {
      blocks.push(
        { type: 'divider' },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*Company Overview*\n${overviewLines.join('\n')}` },
        },
      );
    }
  } else {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `_No organization data found for ${domain ?? companyName}_` },
    });
  }

  // Key people / recent hires (proxy for job postings activity)
  if (recentHires && recentHires.length > 0) {
    const peopleLines = recentHires.map((p) => {
      const name = [p.first_name, p.last_name].filter(Boolean).join(' ');
      const title = p.title || p.headline || 'Unknown role';
      const linkedIn = p.linkedin_url ? ` (<${p.linkedin_url}|LinkedIn>)` : '';
      return `- *${name}* — ${title}${linkedIn}`;
    });

    blocks.push(
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Key People & Decision Makers*\n${peopleLines.join('\n')}`,
        },
      },
    );
  }

  // Hiring signals
  if (recentHires && recentHires.length > 0) {
    const hiringSignals = recentHires
      .filter((p) => p.employment_history?.some((e) => e.current))
      .map((p) => {
        const name = [p.first_name, p.last_name].filter(Boolean).join(' ');
        const currentRole = p.employment_history?.find((e) => e.current);
        return currentRole?.start_date
          ? `- ${name}: ${currentRole.title} (since ${currentRole.start_date})`
          : null;
      })
      .filter(Boolean);

    if (hiringSignals.length > 0) {
      blocks.push(
        { type: 'divider' },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Hiring Signals*\n${hiringSignals.join('\n')}`,
          },
        },
      );
    }
  }

  return blocks;
}
