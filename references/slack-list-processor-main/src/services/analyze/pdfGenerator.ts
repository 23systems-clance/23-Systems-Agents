/**
 * PDF report generator using pdfmake.
 *
 * Produces a styled Account Analysis Report PDF matching the reference
 * report layout: title page, TOC, 12 sections with tables and
 * formatted narrative text.
 */

// pdfmake server-side API (PdfPrinter class) is not covered by @types/pdfmake
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const PdfPrinter = require('pdfmake/js/Printer').default;
import type { TDocumentDefinitions, Content, TableCell } from 'pdfmake/interfaces.js';
import type { ReportData } from '../ai/reportAnalyzer.js';
import type { ScoredCompany } from '../ai/opportunityScorer.js';
import { DOC_TYPE_LABELS } from './configDocService.js';

// ---------------------------------------------------------------------------
// Font configuration (standard fonts bundled with pdfmake)
// ---------------------------------------------------------------------------

const fonts = {
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-call
const printer = new PdfPrinter(fonts) as { createPdfKitDocument: (docDefinition: TDocumentDefinitions) => Promise<NodeJS.ReadWriteStream> };

// ---------------------------------------------------------------------------
// Style definitions
// ---------------------------------------------------------------------------

const STYLES = {
  title: { fontSize: 28, bold: true, color: '#1a365d', margin: [0, 0, 0, 10] as [number, number, number, number] },
  subtitle: { fontSize: 16, color: '#2b6cb0', margin: [0, 0, 0, 20] as [number, number, number, number] },
  sectionHeader: { fontSize: 18, bold: true, color: '#1a365d', margin: [0, 20, 0, 10] as [number, number, number, number] },
  subsectionHeader: { fontSize: 14, bold: true, color: '#2b6cb0', margin: [0, 10, 0, 5] as [number, number, number, number] },
  bodyText: { fontSize: 10, lineHeight: 1.4, margin: [0, 0, 0, 8] as [number, number, number, number] },
  tableHeader: { fontSize: 9, bold: true, color: '#ffffff', fillColor: '#1a365d' },
  tableCell: { fontSize: 9 },
  callout: { fontSize: 10, italics: true, color: '#2d3748', margin: [10, 5, 10, 5] as [number, number, number, number] },
  metricValue: { fontSize: 24, bold: true, color: '#1a365d', alignment: 'center' as const },
  metricLabel: { fontSize: 9, color: '#718096', alignment: 'center' as const },
  tierExcellent: { fontSize: 10, bold: true, color: '#38a169' },
  tierStrong: { fontSize: 10, bold: true, color: '#3182ce' },
};

// ---------------------------------------------------------------------------
// Table helpers
// ---------------------------------------------------------------------------

/**
 * Creates a table header row.
 */
function tableHeaderRow(labels: string[]): TableCell[] {
  return labels.map((label) => ({
    text: label,
    style: 'tableHeader',
    alignment: 'left' as const,
  }));
}

/**
 * Creates a standard data table.
 */
function dataTable(headers: string[], rows: string[][], widths?: (string | number)[]): Content {
  return {
    table: {
      headerRows: 1,
      widths: widths ?? headers.map(() => '*'),
      body: [
        tableHeaderRow(headers),
        ...rows.map((row) =>
          row.map((cell) => ({ text: cell, style: 'tableCell' })),
        ),
      ],
    },
    layout: {
      hLineColor: () => '#e2e8f0',
      vLineColor: () => '#e2e8f0',
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      paddingLeft: () => 6,
      paddingRight: () => 6,
      paddingTop: () => 4,
      paddingBottom: () => 4,
    },
    margin: [0, 5, 0, 10] as [number, number, number, number],
  };
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

/**
 * Builds the title page content.
 */
function buildTitlePage(report: ReportData): Content[] {
  return [
    { text: '', margin: [0, 80, 0, 0] as [number, number, number, number] },
    { text: report.title, style: 'title' },
    { text: report.subtitle, style: 'subtitle' },
    { text: '', margin: [0, 30, 0, 0] as [number, number, number, number] },
    { text: `Report Date: ${report.reportDate}`, style: 'bodyText' },
    { text: `Data Sources: ${report.dataSources}`, style: 'bodyText' },
    { text: `Total Accounts Analyzed: ${report.totalAccounts}`, style: 'bodyText' },
    { text: `Prepared By: ${report.preparedBy}`, style: 'bodyText' },
    { text: `Prepared For: ${report.preparedFor}`, style: 'bodyText' },
    { text: '', pageBreak: 'after' },
  ];
}

/**
 * Builds the executive summary section.
 */
function buildExecutiveSummary(report: ReportData): Content[] {
  const { keyMetrics } = report;
  return [
    { text: '1. Executive Summary & Key Metrics', style: 'sectionHeader' },
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineColor: '#e2e8f0' }] },
    {
      columns: [
        { text: String(keyMetrics.totalAccounts), style: 'metricValue', width: '*' },
        { text: String(keyMetrics.enrichedContacts), style: 'metricValue', width: '*' },
        { text: String(keyMetrics.migrationTargets), style: 'metricValue', width: '*' },
        { text: String(keyMetrics.aiEnabled), style: 'metricValue', width: '*' },
        { text: String(keyMetrics.highOpportunity), style: 'metricValue', width: '*' },
      ],
      margin: [0, 10, 0, 0] as [number, number, number, number],
    },
    {
      columns: [
        { text: 'Total Accounts', style: 'metricLabel', width: '*' },
        { text: 'Enriched Contacts', style: 'metricLabel', width: '*' },
        { text: 'Migration Targets', style: 'metricLabel', width: '*' },
        { text: 'AI-Enabled', style: 'metricLabel', width: '*' },
        { text: 'High-Opp (85+)', style: 'metricLabel', width: '*' },
      ],
      margin: [0, 0, 0, 15] as [number, number, number, number],
    },
    { text: report.executiveSummary, style: 'bodyText' },
  ];
}

/**
 * Builds the cloud distribution section.
 */
function buildCloudDistribution(report: ReportData): Content[] {
  const rows = report.cloudDistribution.map((c) => [
    c.provider,
    String(c.count),
    `${c.percentage.toFixed(1)}%`,
    c.opportunity,
  ]);

  return [
    { text: '2. Cloud Provider Distribution', style: 'sectionHeader' },
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineColor: '#e2e8f0' }] },
    { text: report.cloudAnalysis, style: 'bodyText' },
    dataTable(
      ['Cloud Provider', 'Accounts', '% of Total', 'Opportunity'],
      rows,
      [130, 60, 60, '*'],
    ),
  ];
}

/**
 * Builds the industry vertical section.
 */
function buildIndustryVerticals(report: ReportData): Content[] {
  const rows = report.industryVerticals.slice(0, 12).map((v) => [
    v.vertical,
    String(v.count),
    `${v.percentage.toFixed(1)}%`,
    v.cloudPlay,
  ]);

  return [
    { text: '3. Industry Vertical Analysis', style: 'sectionHeader' },
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineColor: '#e2e8f0' }] },
    { text: report.industryAnalysis, style: 'bodyText' },
    dataTable(
      ['Vertical', 'Accounts', '% of Total', 'Cloud Play'],
      rows,
      [130, 60, 60, '*'],
    ),
  ];
}

/**
 * Builds the AI adoption landscape section.
 */
function buildAiLandscape(report: ReportData): Content[] {
  const rows = report.aiLandscape.map((a) => [
    a.tool,
    String(a.count),
    `${a.percentage.toFixed(1)}%`,
    a.competitivePosition,
  ]);

  return [
    { text: '4. AI Adoption Landscape', style: 'sectionHeader' },
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineColor: '#e2e8f0' }] },
    { text: report.aiAnalysis, style: 'bodyText' },
    dataTable(
      ['AI Tool', 'Count', '% of AI Accounts', 'Competitive Position'],
      rows,
      [100, 50, 80, '*'],
    ),
  ];
}

/**
 * Builds the contact coverage section.
 */
function buildContactCoverage(report: ReportData): Content[] {
  const { contactCoverage } = report;
  const seniorityRows = contactCoverage.seniorityDistribution.map((s) => [
    s.level,
    String(s.count),
    `${s.percentage.toFixed(1)}%`,
    s.priority,
  ]);

  return [
    { text: '6. Contact Coverage Analysis', style: 'sectionHeader' },
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineColor: '#e2e8f0' }] },
    {
      text: `${contactCoverage.companiesWithContacts} of ${report.totalAccounts} accounts (${contactCoverage.coveragePercentage.toFixed(1)}%) have enriched contact data, providing ${contactCoverage.totalContacts} total contacts for BDR outreach.`,
      style: 'bodyText',
    },
    { text: report.contactAnalysis, style: 'bodyText' },
    { text: 'Contact Seniority Distribution', style: 'subsectionHeader' },
    dataTable(
      ['Seniority Level', 'Count', '% of Contacts', 'Outreach Priority'],
      seniorityRows,
      [120, 50, 80, '*'],
    ),
  ];
}

/**
 * Builds a single account card for the top opportunities section.
 */
function buildAccountCard(company: ScoredCompany, rank: number, companyData?: Record<string, unknown>): Content[] {
  const tierColor = company.tier === 'EXCELLENT' ? '#38a169' : '#3182ce';

  return [
    {
      text: `#${rank}  ${company.companyName ?? 'Unknown'}  (${company.domain ?? 'N/A'})    [Score: ${company.score} - ${company.tier}]`,
      style: company.tier === 'EXCELLENT' ? 'tierExcellent' : 'tierStrong',
      margin: [0, 10, 0, 5] as [number, number, number, number],
    },
    {
      text: `Opportunity Signals: ${company.signals.join(' | ')}`,
      fontSize: 8,
      color: '#4a5568',
      margin: [0, 0, 0, 5] as [number, number, number, number],
    },
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineColor: '#e2e8f0', lineWidth: 0.3 }] },
  ];
}

/**
 * Builds the top opportunities section.
 */
function buildTopOpportunities(report: ReportData): Content[] {
  const content: Content[] = [
    { text: '7. Top Opportunity Accounts (Score 85+)', style: 'sectionHeader' },
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineColor: '#e2e8f0' }] },
    {
      text: `${report.scoringSummary.highOpportunityCount} accounts score 85 or higher on the opportunity model. These represent the highest-priority targets combining cloud migration potential, AI readiness, organizational scale, and outreach readiness.`,
      style: 'bodyText',
    },
  ];

  // Tier A: Excellent (100+)
  const excellent = report.topOpportunities.filter((c) => c.tier === 'EXCELLENT');
  if (excellent.length > 0) {
    content.push({ text: 'Tier A: Excellent Opportunity (Score 100+)', style: 'subsectionHeader' });
    excellent.forEach((c, i) => content.push(...buildAccountCard(c, i + 1)));
  }

  // Tier B: Strong (85-99)
  const strong = report.topOpportunities.filter((c) => c.tier === 'STRONG');
  if (strong.length > 0) {
    content.push({ text: 'Tier B: Strong Opportunity (Score 85-99)', style: 'subsectionHeader' });
    strong.forEach((c, i) => content.push(...buildAccountCard(c, excellent.length + i + 1)));
  }

  return content;
}

/**
 * Builds the scoring methodology section.
 */
function buildScoringMethodology(): Content[] {
  const scoringRows = [
    ['AI Adoption Signal', '+25 pts', 'Organizations investing in AI are receptive to integrated AI platforms'],
    ['On AWS (migration)', '+20 pts', 'Direct migration target with proven cloud maturity'],
    ['On Azure (migration)', '+20 pts', 'Direct migration target, position GCP data/AI strengths'],
    ['Multi-Cloud (no Google)', '+18 pts', 'Sophisticated cloud strategy, open to adding Google Cloud'],
    ['Other Hosting (greenfield)', '+15 pts', 'Greenfield cloud adoption opportunity'],
    ['Already on Google Cloud', '+15 pts', 'Expand/upsell advanced services (Vertex AI, BigQuery, Gemini)'],
    ['Enterprise Revenue ($100M+)', '+15 pts', 'Large deal potential with meaningful cloud spend'],
    ['Enriched Contacts Available', '+10 pts', 'Outreach-ready with verified contact data'],
    ['US-Based', '+10 pts', 'Primary geographic focus for outreach'],
    ['Workforce Size', 'up to +10 pts', '50+ = +3pts, 200+ = +5pts, 500+ = +8pts, 1000+ = +10pts'],
    ['Social Presence', 'up to +15 pts', 'Active digital presence indicates technology-forward culture'],
    ['Technology Spend', 'up to +10 pts', '$1K+ = +5pts, $10K+ = +10pts (digital maturity)'],
    ['High-Value Vertical', '+10 pts', 'Technology, Healthcare, Finance, Business & Industrial'],
  ];

  return [
    { text: '12. Scoring Methodology', style: 'sectionHeader', pageBreak: 'before' },
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineColor: '#e2e8f0' }] },
    {
      text: 'Each account is scored on a composite model designed to identify the strongest opportunities. The scoring weights reflect migration potential, AI readiness, organizational scale, and outreach capability.',
      style: 'bodyText',
    },
    dataTable(
      ['Signal', 'Weight', 'Rationale'],
      scoringRows,
      [130, 70, '*'],
    ),
    {
      text: 'Maximum possible score: ~145 points. Tier classifications: Tier A (Excellent): 100+ | Tier B (Strong): 85-99 | Tier C (Good): 70-84 | Tier D (Moderate): Below 70',
      style: 'bodyText',
      margin: [0, 10, 0, 0] as [number, number, number, number],
    },
  ];
}

/**
 * Builds the missing docs section (only if docs are missing).
 */
function buildMissingDocsSection(missingDocs: ReportData['missingDocs']): Content[] {
  if (missingDocs.length === 0) return [];

  const rows = missingDocs.map((d) => [d.label, d.improvement]);

  return [
    { text: 'Missing Configuration Documents', style: 'sectionHeader' },
    {
      text: 'The following configuration documents were not found for this channel. Adding them will enhance future analysis reports.',
      style: 'bodyText',
    },
    dataTable(['Document', 'How It Would Improve the Report'], rows, [130, '*']),
    {
      text: 'Upload with: /analyze upload <document_type>',
      style: 'callout',
    },
  ];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generates a complete PDF report buffer from structured report data.
 */
export async function generateReportPdfAsync(report: ReportData): Promise<Buffer> {
  const docDefinition: TDocumentDefinitions = {
    content: [
      ...buildTitlePage(report),
      ...buildExecutiveSummary(report),
      ...buildCloudDistribution(report),
      ...buildIndustryVerticals(report),
      ...buildAiLandscape(report),
      ...buildContactCoverage(report),
      ...buildTopOpportunities(report),
      ...buildScoringMethodology(),
      ...(report.icpRecommendations
        ? [
            { text: 'ICP-Guided Targeting Recommendations', style: 'sectionHeader' } as Content,
            { text: report.icpRecommendations, style: 'bodyText' } as Content,
          ]
        : []),
      ...buildMissingDocsSection(report.missingDocs),
    ],
    defaultStyle: { font: 'Helvetica', fontSize: 10 },
    styles: STYLES,
    pageMargins: [40, 40, 40, 40],
    footer: (currentPage, pageCount) => ({
      text: `Page ${currentPage} of ${pageCount}`,
      alignment: 'center',
      fontSize: 8,
      color: '#a0aec0',
      margin: [0, 10, 0, 0],
    }),
  };

  const pdfDoc = await printer.createPdfKitDocument(docDefinition);

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
    pdfDoc.on('error', reject);
    pdfDoc.end();
  });
}
