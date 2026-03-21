/**
 * GitHub Issues tool service for the autonomous agent framework (T023).
 *
 * Creates GitHub issues in the slack-list-processor repository when autonomous
 * agents detect code bugs or need to escalate problems for human review.
 */

import { Octokit } from '@octokit/rest';
import logger from '../../../lib/logger.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GITHUB_OWNER = 'developerlabsai';
const GITHUB_REPO = 'slack-list-processor';

// ---------------------------------------------------------------------------
// Client (lazy initialisation)
// ---------------------------------------------------------------------------

const log = logger.withContext({ service: 'githubIssues' });

let octokitInstance: Octokit | null = null;

/**
 * Returns a lazily-initialised Octokit client.
 *
 * @throws Error if the GITHUB_PAT environment variable is not set.
 */
function getOctokit(): Octokit {
  if (octokitInstance) {
    return octokitInstance;
  }

  const token = process.env.GITHUB_PAT;
  if (!token) {
    const message =
      'GITHUB_PAT environment variable is not set. ' +
      'GitHub issue creation requires a personal access token with repo scope.';
    log.warn(message);
    throw new Error(message);
  }

  octokitInstance = new Octokit({ auth: token });
  return octokitInstance;
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Parameters for creating a GitHub issue. */
interface CreateIssueParams {
  /** Issue title. */
  title: string;
  /** Markdown issue body. */
  body: string;
  /** Labels to apply (e.g., ["autonomous-agent", "bug"]). */
  labels: string[];
  /** GitHub usernames to assign. */
  assignees?: string[];
}

/** Result of a successfully created GitHub issue. */
interface CreateIssueResult {
  /** GitHub issue number. */
  issueNumber: number;
  /** Full URL to the issue on github.com. */
  url: string;
}

/** Parameters for building a formatted issue body. */
interface BuildIssueBodyParams {
  /** Name of the autonomous agent that triggered the issue. */
  agentName: string;
  /** Free-form analysis or summary produced by the agent. */
  analysis: string;
  /** Structured task details (ECS task ARN, exit code, etc.). */
  taskDetails?: Record<string, unknown>;
  /** CloudWatch console deep link to relevant logs. */
  logLink?: string;
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Creates a new GitHub issue in the slack-list-processor repository.
 *
 * @param params - Issue title, body, labels, and optional assignees.
 * @returns The created issue number and URL.
 * @throws Error if GITHUB_PAT is not configured or the API call fails.
 */
export async function createIssue(
  params: CreateIssueParams,
): Promise<CreateIssueResult> {
  try {
    const octokit = getOctokit();

    log.info('Creating GitHub issue', {
      title: params.title,
      labelCount: params.labels.length,
    });

    const response = await octokit.issues.create({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      title: params.title,
      body: params.body,
      labels: params.labels,
      assignees: params.assignees,
    });

    const result: CreateIssueResult = {
      issueNumber: response.data.number,
      url: response.data.html_url,
    };

    log.info('GitHub issue created', {
      issueNumber: result.issueNumber,
      url: result.url,
    });

    return result;
  } catch (error) {
    log.error('Failed to create GitHub issue', {
      title: params.title,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Builds a formatted Markdown body for a GitHub issue created by an
 * autonomous agent.
 *
 * The body includes the following sections:
 * - **Agent Analysis** -- the agent's narrative summary
 * - **Task Details** -- structured data rendered as a key/value table
 * - **CloudWatch Logs** -- a direct link to the relevant log stream
 *
 * @param params - Agent name, analysis text, optional task details and log link.
 * @returns A Markdown string suitable for the GitHub issue body.
 */
export function buildIssueBody(params: BuildIssueBodyParams): string {
  const sections: string[] = [];

  // Header
  sections.push(
    `> Automatically created by the **${params.agentName}** autonomous agent.`,
  );

  // Agent Analysis
  sections.push('## Agent Analysis');
  sections.push(params.analysis);

  // Task Details (optional)
  if (params.taskDetails && Object.keys(params.taskDetails).length > 0) {
    sections.push('## Task Details');
    sections.push('| Key | Value |');
    sections.push('| --- | --- |');

    for (const [key, value] of Object.entries(params.taskDetails)) {
      const displayValue =
        typeof value === 'string' ? value : JSON.stringify(value);
      sections.push(`| \`${key}\` | ${displayValue} |`);
    }
  }

  // CloudWatch Logs link (optional)
  if (params.logLink) {
    sections.push('## CloudWatch Logs');
    sections.push(`[View logs in CloudWatch Console](${params.logLink})`);
  }

  // Footer
  sections.push('---');
  sections.push('*This issue was auto-generated by the autonomous agent framework.*');

  return sections.join('\n\n');
}
