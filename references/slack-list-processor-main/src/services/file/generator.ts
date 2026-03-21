import * as XLSX from 'xlsx';
import { stringify } from 'csv-stringify/sync';

import type {
  EnrichmentStatus,
  TechSpendTier,
  PersonaType,
  ContactEnrichmentStatus,
  CallStatus,
  DncStatus,
} from '@prisma/client';

// ---------------------------------------------------------------------------
// Output format type
// ---------------------------------------------------------------------------

/** Supported output file formats. */
export type OutputFormat = 'CSV' | 'XLSX';

/** Metadata about the enrichment job, embedded in the output file. */
export interface JobMetadata {
  jobId: string;
  jobType: string;
  purpose?: string | null;
  isCosell?: boolean;
  cosellProvider?: string | null;
  listOwner?: string | null;
  additionalContext?: string | null;
  processingDate: Date;
  companiesProcessed: number;
  companiesFailed: number;
}

// ---------------------------------------------------------------------------
// Data shape interfaces (plain objects aligned with Prisma models)
// ---------------------------------------------------------------------------

/** Technology record attached to a company. */
export interface TechnologyRecord {
  name: string;
  categories: string[];
  firstDetected: Date | null;
  lastDetected: Date | null;
}

/** Contact record attached to a company via JobContact. */
export interface ContactRecord {
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  directPhone: string | null;
  businessPhone: string | null;
  jobTitle: string | null;
  personaType: PersonaType;
  seniorityLevel: string | null;
  linkedinUrl: string | null;
  apolloPersonId: string | null;
  timezoneUtc: string | null;
  timezoneLabel: string | null;
  isDecisionMaker: boolean;
  enrichmentStatus: ContactEnrichmentStatus;
  /** Raw Apollo response data for this contact (JSON). */
  apolloMetadata: Record<string, unknown> | null;
  /** Provider that found the email (Feature 27: Waterfall enrichment). */
  emailSource: string | null;
  /** Cost to enrich email (Feature 27: Waterfall enrichment). */
  emailCost: number | null;
  /** Provider that found the phone (Feature 27: Waterfall enrichment). */
  phoneSource: string | null;
  /** Cost to enrich phone (Feature 27: Waterfall enrichment). */
  phoneCost: number | null;
  /** Phone enrichment quality gate result. */
  callStatus: CallStatus | null;
  /** DNC scrub API result. */
  dncStatus: DncStatus | null;
  /** Findymail email verification result (US6). */
  emailVerified: boolean | null;
  /** Email provider detected by Findymail (US6). */
  emailProvider: string | null;
}

/** Company record with technographic enrichment data. */
export interface CompanyRecord {
  companyName: string | null;
  domain: string | null;
  resolvedDomain: string | null;
  cloudProviderPrimary: string | null;
  cloudProvidersAll: string | null;
  techSpendTier: TechSpendTier | null;
  technologyCount: number;
  enrichmentStatus: EnrichmentStatus;
  errorMessage: string | null;
  trafficRank: number | null;
  locationCity: string | null;
  locationState: string | null;
  locationCountry: string | null;
  locationZip: string | null;
  telephones: string[];
  emails: string[];
  socialProfiles: string[];
  metaNames: string[];
  vertical: string | null;
  companyNameFromApi: string | null;
  salesRevenue: number | null;
  techSpendUsd: number | null;
  employeeCount: number | null;
  productCount: number | null;
  followers: number | null;
  technologies: TechnologyRecord[];
  contacts: ContactRecord[];
}

/** Company record for tech report output (BuiltWith technology lookup). */
export interface TechReportCompanyRecord {
  domain: string;
  companyName: string | null;
  location: string | null;
  trafficRank: number | null;
  technologyFirstDetected: Date | null;
  technologyLastDetected: Date | null;
}

// ---------------------------------------------------------------------------
// Parameter interfaces
// ---------------------------------------------------------------------------

/** Parameters for technographic output generation. */
export interface TechnographicOutputParams {
  jobCompanies: CompanyRecord[];
  outputFormat: OutputFormat;
  metadata?: JobMetadata;
  channelId?: string;
  channelName?: string;
}

/** Parameters for contact output generation. */
export interface ContactOutputParams {
  jobCompanies: CompanyRecord[];
  outputFormat: OutputFormat;
  metadata?: JobMetadata;
  channelId?: string;
  channelName?: string;
}

/** Parameters for combined (technographic + contact) output generation. */
export interface CombinedOutputParams {
  jobCompanies: CompanyRecord[];
  outputFormat: OutputFormat;
  metadata?: JobMetadata;
  channelId?: string;
  channelName?: string;
}

/** Parameters for tech report output generation. */
export interface TechReportOutputParams {
  companies: TechReportCompanyRecord[];
  outputFormat: OutputFormat;
  metadata?: JobMetadata;
}

// ---------------------------------------------------------------------------
// BuiltWith Pro column constants
// ---------------------------------------------------------------------------

/**
 * Maps BuiltWith technology category strings to their corresponding
 * BuiltWith Pro export column names.
 */
const CATEGORY_TO_COLUMN: Record<string, string> = {
  'eCommerce': 'eCommerce Platform',
  'Shopping Cart': 'eCommerce Platform',
  'CMS': 'CMS Platform',
  'Blog': 'CMS Platform',
  'Wiki': 'CMS Platform',
  'CRM': 'CRM Platform',
  'Marketing Automation': 'Marketing Automation Platform',
  'Email Marketing': 'Marketing Automation Platform',
  'Payment': 'Payment Platforms',
  'Payment Processor': 'Payment Platforms',
  'Hosting': 'Hosting Provider',
  'Dedicated Hosting': 'Hosting Provider',
  'Cloud Hosting': 'Hosting Provider',
  'Cloud PaaS': 'Hosting Provider',
  'Artificial Intelligence': 'AI',
  'Machine Learning': 'AI',
  'Chatbot': 'AI',
};

/** Maps TechSpendTier enum values to human-readable labels. */
const SPEND_TIER_LABELS: Record<string, string> = {
  TIER_1: 'High',
  TIER_2: 'Medium',
  TIER_3: 'Low',
  UNCLASSIFIED: '',
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Formats a Date to an ISO date string (YYYY-MM-DD), or returns an empty
 * string when the value is null/undefined.
 */
function formatDate(date: Date | null | undefined): string {
  if (!date) {
    return '';
  }
  return date.toISOString().split('T')[0] ?? '';
}

/**
 * Builds an array of key-value row objects from job metadata.
 *
 * Only rows with non-empty values are included in the output. The
 * `Co-sell` field is derived from the `isCosell` / `cosellProvider`
 * combination.
 *
 * @param metadata - The job metadata to convert into rows
 * @returns Array of `{ Field, Value }` row objects
 */
function buildMetadataRows(
  metadata: JobMetadata,
): Record<string, string>[] {
  // Derive co-sell display value
  let cosellValue = '';
  if (metadata.isCosell === true) {
    cosellValue = `Yes - ${metadata.cosellProvider ?? ''}`;
  } else if (metadata.isCosell === false) {
    cosellValue = 'No';
  }

  const candidates: [string, string | undefined | null][] = [
    ['Job ID', metadata.jobId],
    ['Job Type', metadata.jobType],
    ['Purpose', metadata.purpose],
    ['Co-sell', cosellValue || undefined],
    ['List Owner', metadata.listOwner],
    ['Additional Context', metadata.additionalContext],
    ['Processing Date', formatDate(metadata.processingDate)],
    ['Companies Processed', String(metadata.companiesProcessed)],
    ['Companies Failed', String(metadata.companiesFailed)],
  ];

  return candidates
    .filter(
      (entry): entry is [string, string] =>
        entry[1] != null && entry[1] !== '',
    )
    .map(([field, value]) => ({ Field: field, Value: value }));
}

/**
 * Selects up to 4 contacts for a company, prioritising decision-makers.
 * Returns exactly a 4-element tuple (padding with null when fewer exist).
 */
function selectContacts(
  contacts: ContactRecord[],
): [ContactRecord | null, ContactRecord | null, ContactRecord | null, ContactRecord | null] {
  const sorted = [...contacts].sort((a, b) => {
    if (a.isDecisionMaker && !b.isDecisionMaker) return -1;
    if (!a.isDecisionMaker && b.isDecisionMaker) return 1;
    return 0;
  });

  return [sorted[0] ?? null, sorted[1] ?? null, sorted[2] ?? null, sorted[3] ?? null];
}

/**
 * Returns empty contact columns (one row per contact layout).
 * Column order: First Name, Last Name, Company, Title, Persona, LinkedIn, Email, Mobile.
 */
function emptyContactColumns(): Record<string, string> {
  return {
    'Contact First Name': '',
    'Contact Last Name': '',
    'Contact Company': '',
    'Job Title': '',
    'Persona Type': '',
    'Seniority': '',
    'LinkedIn URL': '',
    'Email': '',
    'Email Source': '',
    'Email Verified': '',
    'Email Provider': '',
    'Mobile Number': '',
    'Mobile Number Found': '',
    'Phone Source': '',
    'Business Phone': '',
    'Apollo Person ID': '',
    'Timezone': '',
    'Timezone Label': '',
    'Contact City': '',
    'Contact State': '',
    'Contact Country': '',
    'Allowed to Call': '',
    'DNC Status': '',
  };
}

/**
 * Maps CallStatus enum to human-readable output label.
 */
function formatCallStatus(status: CallStatus | null): string {
  switch (status) {
    case 'ACCEPTED_STATE': return 'Accepted State';
    case 'DO_NOT_CALL': return 'Do Not Call';
    case 'UNKNOWN': return 'Unknown';
    default: return '';
  }
}

/**
 * Maps DncStatus enum to human-readable output label.
 */
function formatDncStatus(status: DncStatus | null): string {
  switch (status) {
    case 'CLEAN': return 'Clean';
    case 'ON_DNC_LIST': return 'On DNC List';
    case 'NOT_CHECKED': return 'Not Checked';
    default: return '';
  }
}

/**
 * Flattens a single contact into columns using DB fields directly.
 * Reads from the stored apolloMetadata for location/org data not in dedicated columns.
 */
function flattenContact(contact: ContactRecord): Record<string, string> {
  const meta = contact.apolloMetadata ?? {};
  const org = (meta.organization ?? {}) as Record<string, unknown>;

  return {
    'Contact First Name': contact.firstName ?? '',
    'Contact Last Name': contact.lastName ?? '',
    'Contact Company': (org.name as string) ?? '',
    'Job Title': contact.jobTitle ?? '',
    'Persona Type': contact.personaType,
    'Seniority': contact.seniorityLevel ?? '',
    'LinkedIn URL': contact.linkedinUrl ?? '',
    'Email': contact.email ?? '',
    'Email Source': contact.emailSource ?? '',
    'Email Verified': contact.emailVerified != null ? (contact.emailVerified ? 'true' : 'false') : '',
    'Email Provider': contact.emailProvider ?? '',
    'Mobile Number': contact.directPhone ?? '',
    'Mobile Number Found': contact.directPhone ? 'Yes' : 'No',
    'Phone Source': contact.phoneSource ?? '',
    'Business Phone': contact.businessPhone ?? '',
    'Apollo Person ID': contact.apolloPersonId ?? '',
    'Timezone': contact.timezoneUtc ?? '',
    'Timezone Label': contact.timezoneLabel ?? '',
    'Contact City': (meta.city as string) ?? '',
    'Contact State': (meta.state as string) ?? '',
    'Contact Country': (meta.country as string) ?? '',
    'Allowed to Call': formatCallStatus(contact.callStatus),
    'DNC Status': formatDncStatus(contact.dncStatus),
  };
}

/**
 * Resolves company name with fallbacks: CSV value → BuiltWith API → Apollo
 * org name → domain. Ensures Company Name is never blank in the output.
 */
function resolveCompanyName(company: CompanyRecord): string {
  if (company.companyNameFromApi) return company.companyNameFromApi;
  if (company.companyName) return company.companyName;

  // Try extracting org name from the first contact's Apollo metadata
  for (const contact of company.contacts) {
    const org = (contact.apolloMetadata?.organization ?? {}) as Record<string, unknown>;
    const orgName = org.name as string | undefined;
    if (orgName) return orgName;
  }

  return company.resolvedDomain ?? company.domain ?? '';
}

/**
 * Groups technologies by their BuiltWith category into output column buckets.
 *
 * @returns Record mapping column name to an array of technology names.
 */
function groupTechsByColumn(
  technologies: TechnologyRecord[],
): Record<string, string[]> {
  const groups: Record<string, string[]> = {};

  for (const tech of technologies) {
    for (const category of tech.categories) {
      const column = CATEGORY_TO_COLUMN[category];
      if (column) {
        if (!groups[column]) {
          groups[column] = [];
        }
        if (!groups[column].includes(tech.name)) {
          groups[column].push(tech.name);
        }
      }
    }
  }

  return groups;
}

/**
 * Maps BuiltWith technology categories and well-known tech names to
 * use-case columns for sales intelligence.
 */
const USE_CASE_CATEGORIES: Record<string, string[]> = {
  // Security -- technologies related to security, compliance, DDoS, WAF, etc.
  security: [
    'SSL', 'Security', 'Web Application Firewall', 'DDoS Protection',
    'Identity Management', 'Authentication', 'Firewall', 'Anti-Spam',
    'Vulnerability Scanner', 'Bot Detection', 'Access Control',
  ],
  // ERP -- enterprise resource planning platforms
  erp: [
    'ERP', 'Enterprise Resource Planning', 'Accounting',
    'Supply Chain', 'Inventory Management',
  ],
  // Migration -- signals that suggest migration or multi-cloud patterns
  migration: [
    'Cloud Migration', 'Container', 'Kubernetes', 'Docker',
    'Serverless', 'Microservices', 'IaaS', 'PaaS',
  ],
  // Cost Optimization -- FinOps, monitoring, and performance tools
  costOptimization: [
    'Performance', 'Monitoring', 'Observability', 'APM',
    'CDN', 'Caching', 'Load Balancer', 'Auto Scaling',
  ],
  // Generative AI -- AI, LLM, and generative AI-specific technologies
  generativeAI: [
    'Artificial Intelligence', 'Machine Learning', 'Chatbot',
    'Natural Language Processing', 'Generative AI', 'LLM',
    'Deep Learning', 'Computer Vision',
  ],
};

/** Well-known technology names mapped directly to use-case columns. */
const TECH_NAME_TO_USE_CASE: Record<string, string> = {
  // Security
  'Cloudflare': 'security', 'reCAPTCHA': 'security', 'Sucuri': 'security',
  'Akamai': 'security', 'Imperva': 'security', 'Auth0': 'security',
  'Okta': 'security', 'CrowdStrike': 'security', 'SentinelOne': 'security',
  'Palo Alto': 'security', 'Fortinet': 'security', 'Qualys': 'security',
  // ERP
  'SAP': 'erp', 'Oracle ERP': 'erp', 'NetSuite': 'erp',
  'Microsoft Dynamics': 'erp', 'Sage': 'erp', 'Infor': 'erp',
  'Workday': 'erp', 'Epicor': 'erp',
  // Migration / Cloud
  'Kubernetes': 'migration', 'Docker': 'migration',
  'Terraform': 'migration', 'Ansible': 'migration',
  'AWS CloudFormation': 'migration',
  // Cost Optimization
  'Datadog': 'costOptimization', 'New Relic': 'costOptimization',
  'Dynatrace': 'costOptimization', 'Splunk': 'costOptimization',
  'Grafana': 'costOptimization', 'Prometheus': 'costOptimization',
  'Varnish': 'costOptimization', 'Fastly': 'costOptimization',
  // Generative AI
  'OpenAI': 'generativeAI', 'ChatGPT': 'generativeAI',
  'Google Gemini': 'generativeAI', 'Anthropic': 'generativeAI',
  'Hugging Face': 'generativeAI', 'LangChain': 'generativeAI',
  'Intercom Fin': 'generativeAI', 'Drift': 'generativeAI',
};

/**
 * Categorises technologies into use-case buckets (Security, ERP,
 * Migration, Cost Optimization, Generative AI) based on categories
 * and well-known technology names.
 */
function categorizeByUseCase(
  technologies: TechnologyRecord[],
): Record<string, string[]> {
  const result: Record<string, string[]> = {
    security: [],
    erp: [],
    migration: [],
    costOptimization: [],
    generativeAI: [],
  };

  for (const tech of technologies) {
    // Check direct name match first.
    const directUseCase = TECH_NAME_TO_USE_CASE[tech.name];
    if (directUseCase && !result[directUseCase]!.includes(tech.name)) {
      result[directUseCase]!.push(tech.name);
      continue;
    }

    // Check category-based matching.
    for (const category of tech.categories) {
      for (const [useCase, keywords] of Object.entries(USE_CASE_CATEGORIES)) {
        if (keywords.some((kw) => category.includes(kw))) {
          if (!result[useCase]!.includes(tech.name)) {
            result[useCase]!.push(tech.name);
          }
        }
      }
    }
  }

  return result;
}

/**
 * Parses social profile URLs into platform-specific buckets.
 */
function categorizeSocialProfiles(
  profiles: string[],
): { x: string; twitter: string; facebook: string; linkedin: string } {
  const result = { x: '', twitter: '', facebook: '', linkedin: '' };

  for (const url of profiles) {
    const lower = url.toLowerCase();
    if (lower.includes('x.com')) {
      result.x = result.x ? `${result.x}; ${url}` : url;
    } else if (lower.includes('twitter.com')) {
      result.twitter = result.twitter ? `${result.twitter}; ${url}` : url;
    } else if (lower.includes('facebook.com') || lower.includes('fb.com')) {
      result.facebook = result.facebook ? `${result.facebook}; ${url}` : url;
    } else if (lower.includes('linkedin.com')) {
      result.linkedin = result.linkedin ? `${result.linkedin}; ${url}` : url;
    }
  }

  return result;
}

/**
 * Builds a technographic row in BuiltWith Pro export column format.
 */
function buildTechRow(company: CompanyRecord): Record<string, string> {
  const domain = company.resolvedDomain ?? company.domain ?? '';
  const techStack = company.technologies.map((t) => t.name).join('; ');
  const techGroups = groupTechsByColumn(company.technologies);

  // Merge hosting from both cloudExtractor and category grouping.
  const hostingFromCategories = techGroups['Hosting Provider'] ?? [];
  const hostingFromCloud = company.cloudProviderPrimary
    ? [company.cloudProviderPrimary]
    : [];
  const allHosting = [...new Set([...hostingFromCloud, ...hostingFromCategories])];

  // Parse social profiles into typed buckets.
  const socialMap = categorizeSocialProfiles(company.socialProfiles);

  // Derive use-case categorizations from technologies.
  const useCases = categorizeByUseCase(company.technologies);

  return {
    'Root Domain': domain,
    'Primary Domain': domain,
    'Technology Spend': company.techSpendUsd != null ? `$${company.techSpendUsd.toLocaleString()}` : SPEND_TIER_LABELS[company.techSpendTier ?? ''] ?? '',
    'Sales Revenue': company.salesRevenue != null && company.salesRevenue > 0 ? `$${company.salesRevenue.toLocaleString()}` : '',
    'Social': company.socialProfiles.join('; '),
    'Employees': company.employeeCount != null ? String(company.employeeCount) : '',
    'Company': resolveCompanyName(company),
    'Vertical': company.vertical ?? '',
    'Telephones': company.telephones.join('; '),
    'Emails': company.emails.join('; '),
    'X': socialMap.x,
    'Twitter': socialMap.twitter,
    'Facebook': socialMap.facebook,
    'LinkedIn': socialMap.linkedin,
    'People': company.metaNames.join('; '),
    'Verified Profiles': '',
    'City': company.locationCity ?? '',
    'State': company.locationState ?? '',
    'Zip': company.locationZip ?? '',
    'Country': company.locationCountry ?? '',
    'eCommerce Platform': (techGroups['eCommerce Platform'] ?? []).join('; '),
    'CMS Platform': (techGroups['CMS Platform'] ?? []).join('; '),
    'CRM Platform': (techGroups['CRM Platform'] ?? []).join('; '),
    'Marketing Automation Platform': (techGroups['Marketing Automation Platform'] ?? []).join('; '),
    'Payment Platforms': (techGroups['Payment Platforms'] ?? []).join('; '),
    'CRuX Rank': '',
    'Cloudflare Rank': '',
    'Hosting Provider': allHosting.join('; '),
    'AI': (techGroups['AI'] ?? []).join('; '),
    'Compliance': '',
    'Security': useCases.security.join('; '),
    'ERP': useCases.erp.join('; '),
    'Migration': useCases.migration.join('; '),
    'Cost Optimization': useCases.costOptimization.join('; '),
    'Generative AI': useCases.generativeAI.join('; '),
    'Technology Stack': techStack,
    'Technology Count': String(company.technologyCount),
    'Cloud Providers (All)': company.cloudProvidersAll ?? '',
    'Error Status':
      company.enrichmentStatus === 'FAILED'
        ? company.errorMessage ?? 'Failed'
        : '',
  };
}

/**
 * Builds one row per contact for a company (one row per contact layout).
 * If a company has no contacts, emits one row with empty contact columns.
 */
function buildContactRows(company: CompanyRecord): Record<string, string>[] {
  const companyBase = {
    'Company Name': resolveCompanyName(company),
    Domain: company.resolvedDomain ?? company.domain ?? '',
  };

  const errorStatus =
    company.enrichmentStatus === 'FAILED'
      ? company.errorMessage ?? 'Failed'
      : '';

  const sorted = selectContacts(company.contacts);
  const contacts = sorted.filter((c): c is ContactRecord => c !== null);

  if (contacts.length === 0) {
    return [{ ...companyBase, ...emptyContactColumns(), 'Error Status': errorStatus }];
  }

  return contacts.map((contact) => ({
    ...companyBase,
    ...flattenContact(contact),
    'Error Status': errorStatus,
  }));
}

/**
 * Builds one row per contact for a company with tech data (combined layout).
 * Contact columns are placed after Root Domain / Company but before Technology Spend.
 */
function buildCombinedRows(company: CompanyRecord): Record<string, string>[] {
  const techRow = buildTechRow(company);

  // Split tech row: domain/company columns first, then everything else (starting at Technology Spend).
  const { 'Root Domain': rootDomain, 'Primary Domain': primaryDomain, 'Company': companyCol, ...restTech } = techRow;
  const companyBase = { 'Root Domain': rootDomain, 'Primary Domain': primaryDomain, 'Company': companyCol };

  const sorted = selectContacts(company.contacts);
  const contacts = sorted.filter((c): c is ContactRecord => c !== null);

  if (contacts.length === 0) {
    return [{ ...companyBase, ...emptyContactColumns(), ...restTech }];
  }

  return contacts.map((contact) => ({
    ...companyBase,
    ...flattenContact(contact),
    ...restTech,
  }));
}

/**
 * Converts an array of row objects into a Buffer in the requested format.
 *
 * When {@link metadata} is provided:
 * - **XLSX**: a second worksheet named "Metadata" is appended to the workbook.
 * - **CSV**: metadata key-value pairs are prepended as `#`-prefixed comment
 *   lines before the data rows.
 *
 * @param rows         - Array of flat row objects (keys = column headers)
 * @param outputFormat - 'CSV' or 'XLSX'
 * @param sheetName    - Worksheet name used for XLSX output
 * @param metadata     - Optional job metadata to embed in the output file
 */
function serialise(
  rows: Record<string, string>[],
  outputFormat: OutputFormat,
  sheetName: string = 'Results',
  metadata?: JobMetadata,
): Buffer {
  if (outputFormat === 'CSV') {
    const csv = stringify(rows, {
      header: true,
    });

    if (metadata) {
      const metaRows = buildMetadataRows(metadata);
      const metaLines = metaRows
        .map((r) => `# ${r.Field}: ${r.Value}`)
        .join('\n');
      return Buffer.from(metaLines + '\n\n' + csv, 'utf-8');
    }

    return Buffer.from(csv, 'utf-8');
  }

  // XLSX path
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

  if (metadata) {
    const metaRows = buildMetadataRows(metadata);
    const metaSheet = XLSX.utils.json_to_sheet(metaRows);
    XLSX.utils.book_append_sheet(workbook, metaSheet, 'Metadata');
  }

  const xlsxBuffer = XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
  }) as Buffer;

  return xlsxBuffer;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generates a technographic enrichment output file in BuiltWith Pro format.
 *
 * Includes one row per company with all 37 BuiltWith Pro columns plus
 * bonus columns (Technology Stack, Technology Count, Cloud Providers, Error).
 * A summary row is appended at the end with aggregate statistics.
 *
 * @param params - Companies and desired output format
 * @returns Buffer containing the CSV or XLSX file content
 */
export function generateTechnographicOutput(
  params: TechnographicOutputParams,
): Buffer {
  const { jobCompanies, outputFormat, channelId, channelName } = params;

  let dataRows = jobCompanies.map(buildTechRow);

  // Prepend Slack Channel (ID) and Channel Name columns.
  if (channelId) {
    dataRows = dataRows.map((row) => ({
      'Slack Channel': channelId,
      'Channel Name': channelName ?? '',
      ...row,
    }));
  }

  // Compute summary stats
  const total = jobCompanies.length;
  const failed = jobCompanies.filter(
    (c) => c.enrichmentStatus === 'FAILED',
  ).length;
  const processed = total - failed;
  const avgTechCount =
    processed > 0
      ? (
          jobCompanies
            .filter((c) => c.enrichmentStatus !== 'FAILED')
            .reduce((sum, c) => sum + c.technologyCount, 0) / processed
        ).toFixed(1)
      : '0';

  // Append summary row aligned to BuiltWith Pro columns
  const summaryRow: Record<string, string> = {
    ...(channelId ? { 'Slack Channel': '', 'Channel Name': '' } : {}),
    'Root Domain': '--- SUMMARY ---',
    'Company': `Total Companies: ${total}`,
    'Technology Stack': `Processed: ${processed}`,
    'Technology Count': `Failed: ${failed}`,
    'Cloud Providers (All)': `Avg Tech Count: ${avgTechCount}`,
  };

  return serialise([...dataRows, summaryRow], outputFormat, 'Technographic', params.metadata);
}

/**
 * Generates a contact enrichment output file.
 *
 * One row per contact. Company data (name, domain) is repeated on each
 * row. Decision-maker contacts are prioritised. Up to 4 contacts per company.
 *
 * @param params - Companies (with nested contacts) and desired output format
 * @returns Buffer containing the CSV or XLSX file content
 */
export function generateContactOutput(params: ContactOutputParams): Buffer {
  const { jobCompanies, outputFormat, channelId, channelName } = params;

  let dataRows = jobCompanies.flatMap(buildContactRows);

  // Prepend Slack Channel (ID) and Channel Name columns.
  if (channelId) {
    dataRows = dataRows.map((row) => ({
      'Slack Channel': channelId,
      'Channel Name': channelName ?? '',
      ...row,
    }));
  }

  // Compute summary stats
  const total = jobCompanies.length;
  const failed = jobCompanies.filter(
    (c) => c.enrichmentStatus === 'FAILED',
  ).length;
  const processed = total - failed;
  const totalContacts = jobCompanies.reduce(
    (sum, c) => sum + c.contacts.length,
    0,
  );

  const summaryRow: Record<string, string> = {
    ...(channelId ? { 'Slack Channel': '', 'Channel Name': '' } : {}),
    'Company Name': '--- SUMMARY ---',
    Domain: `Total Companies: ${total}`,
    'Contact First Name': `Processed: ${processed}`,
    'Contact Last Name': `Failed: ${failed}`,
    'Job Title': `Total Contacts: ${totalContacts}`,
    'Error Status': '',
  };

  return serialise([...dataRows, summaryRow], outputFormat, 'Contacts', params.metadata);
}

/**
 * Generates a combined technographic + contact output file.
 *
 * One row per contact. Each row includes full BuiltWith Pro tech columns
 * plus one contact. Tech data is repeated for each contact row.
 *
 * @param params - Companies (with tech + contact data) and desired output format
 * @returns Buffer containing the CSV or XLSX file content
 */
export function generateCombinedOutput(params: CombinedOutputParams): Buffer {
  const { jobCompanies, outputFormat, channelId, channelName } = params;

  let dataRows = jobCompanies.flatMap(buildCombinedRows);

  // Prepend Slack Channel (ID) and Channel Name columns.
  if (channelId) {
    dataRows = dataRows.map((row) => ({
      'Slack Channel': channelId,
      'Channel Name': channelName ?? '',
      ...row,
    }));
  }

  return serialise(dataRows, outputFormat, 'Combined', params.metadata);
}

/**
 * Generates a tech report output file listing companies that use a
 * specific technology (BuiltWith technology lookup results).
 *
 * @param params - Tech report companies and desired output format
 * @returns Buffer containing the CSV or XLSX file content
 */
export function generateTechReportOutput(
  params: TechReportOutputParams,
): Buffer {
  const { companies, outputFormat } = params;

  const dataRows = companies.map(
    (company): Record<string, string> => ({
      Domain: company.domain,
      'Company Name': company.companyName ?? '',
      Location: company.location ?? '',
      'Traffic Rank': company.trafficRank != null
        ? String(company.trafficRank)
        : '',
      'Technology First Detected': formatDate(company.technologyFirstDetected),
      'Technology Last Detected': formatDate(company.technologyLastDetected),
    }),
  );

  return serialise(dataRows, outputFormat, 'Tech Report', params.metadata);
}
