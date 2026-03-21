/**
 * Shared utilities for building standardised list filenames.
 *
 * Naming convention:
 *   MMDD [CLIENT] Campaign Name / Target List : Co-Sell Name
 *
 * - MMDD          auto-filled from today's date
 * - [CLIENT]      parsed from the Slack channel name
 * - Campaign Name user-provided (or falls back to source filename)
 * - Co-Sell Name  optional; omitted when empty
 */

// ---------------------------------------------------------------------------
// Channel name → client name
// ---------------------------------------------------------------------------

/** Suffixes commonly appended to client channel names. */
const CHANNEL_SUFFIXES = [
  '-enrichment',
  '-enrichments',
  '-lists',
  '-list',
  '-data',
  '-docs',
  '-documents',
  '-sales',
  '-outbound',
  '-campaigns',
  '-campaign',
  '-bdrs',
  '-bdr',
];

/**
 * Extracts a human-readable client name from a Slack channel name.
 *
 * @example
 *   parseClientFromChannelName('acme-corp-enrichment') // => 'Acme Corp'
 *   parseClientFromChannelName('big-co-lists')         // => 'Big Co'
 *   parseClientFromChannelName('general')              // => 'General'
 *
 * @param channelName - Raw Slack channel name (no `#` prefix)
 * @returns Title-cased client name
 */
export function parseClientFromChannelName(channelName: string): string {
  let name = channelName.toLowerCase().trim();

  // Strip known suffixes (longest match first to avoid partial strips)
  const sorted = [...CHANNEL_SUFFIXES].sort((a, b) => b.length - a.length);
  for (const suffix of sorted) {
    if (name.endsWith(suffix)) {
      name = name.slice(0, -suffix.length);
      break;
    }
  }

  // Replace hyphens/underscores with spaces and title-case
  const titleCased = name
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return titleCased || channelName;
}

// ---------------------------------------------------------------------------
// Filename builder
// ---------------------------------------------------------------------------

export interface BuildListFilenameParams {
  /** Slack channel name for client extraction. */
  channelName: string;
  /** User-provided campaign / target list name. */
  campaignName?: string | null;
  /** Optional co-sell partner name. */
  cosellName?: string | null;
  /** File extension without dot (e.g. 'csv', 'xlsx'). */
  extension: string;
  /** Override the date (defaults to now). */
  date?: Date;
  /** Job type — used for the legacy CONTACTS prefix fallback. */
  jobType?: string;
  /** Original source filename (extension already stripped). Used as fallback. */
  sourceBaseName?: string;
}

/**
 * Builds a list filename following the project naming convention.
 *
 * When `campaignName` is provided:
 *   `MMDD [CLIENT] Campaign Name.ext`
 *   `MMDD [CLIENT] Campaign Name : Co-Sell Name.ext`
 *
 * When `campaignName` is NOT provided (legacy fallback):
 *   `MMDD CONTACTS - sourceBaseName.ext`  (for CONTACT jobs)
 *   `MMDD sourceBaseName.ext`             (for other jobs)
 *
 * @returns The formatted filename string.
 */
export function buildListFilename(params: BuildListFilenameParams): string {
  const {
    channelName,
    campaignName,
    cosellName,
    extension,
    date,
    jobType,
    sourceBaseName,
  } = params;

  const now = date ?? new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const datePrefix = `${mm}${dd}`;

  // New naming pattern when campaign name is available
  if (campaignName) {
    const client = parseClientFromChannelName(channelName);
    const cosellSuffix = cosellName ? ` : ${cosellName}` : '';
    return `${datePrefix} [${client}] ${campaignName}${cosellSuffix}.${extension}`;
  }

  // Legacy fallback — preserves existing behaviour
  const base = sourceBaseName || `enrichment-results`;
  const jobTypePrefix = jobType === 'CONTACT' ? 'CONTACTS - ' : '';
  return `${datePrefix} ${jobTypePrefix}${base}.${extension}`;
}
