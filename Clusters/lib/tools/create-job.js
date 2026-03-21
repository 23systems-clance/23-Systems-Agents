import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { githubApi } from './github.js';
import { createModel } from '../ai/model.js';

// Dispatcher adapter — default is GitHub-only (current behavior)
let _dispatcher = null;

/**
 * Set the job dispatcher. Called from instrumentation.js when JOB_DISPATCH=bullmq.
 * @param {Function} dispatcher - async (jobId, branch, title, jobDescription, options) => void
 */
export function setJobDispatcher(dispatcher) {
  _dispatcher = dispatcher;
}

/**
 * Push a GitHub branch with job config. Always called (even with BullMQ)
 * because the agent needs the branch to work on.
 */
export async function pushGitHubBranch(jobId, branch, title, jobDescription, options = {}) {
  const { GH_OWNER, GH_REPO } = process.env;
  const repo = `/repos/${GH_OWNER}/${GH_REPO}`;

  const mainRef = await githubApi(`${repo}/git/ref/heads/main`);
  const mainSha = mainRef.object.sha;
  const mainCommit = await githubApi(`${repo}/git/commits/${mainSha}`);
  const baseTreeSha = mainCommit.tree.sha;

  const config = { title, job: jobDescription };
  if (options.llmProvider) config.llm_provider = options.llmProvider;
  if (options.llmModel) config.llm_model = options.llmModel;
  if (options.agentBackend) config.agent_backend = options.agentBackend;

  const treeEntries = [
    {
      path: `logs/${jobId}/job.config.json`,
      mode: '100644',
      type: 'blob',
      content: JSON.stringify(config, null, 2),
    },
  ];

  const tree = await githubApi(`${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
  });

  const commit = await githubApi(`${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: `🤖 Agent Job: ${title}`,
      tree: tree.sha,
      parents: [mainSha],
    }),
  });

  await githubApi(`${repo}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
  });
}

/**
 * Generate a short descriptive title for a job using the LLM.
 * Uses structured output to avoid thinking-token leaks with extended-thinking models.
 * @param {string} jobDescription - The full job description
 * @returns {Promise<string>} ~10 word title
 */
async function generateJobTitle(jobDescription) {
  try {
    const model = await createModel({ maxTokens: 100 });
    const response = await model.withStructuredOutput(z.object({ title: z.string() })).invoke([
      ['system', 'Generate a descriptive ~10 word title for this agent job. The title should clearly describe what the job will do.'],
      ['human', jobDescription],
    ]);
    return response.title.trim() || jobDescription.slice(0, 80);
  } catch {
    // Fallback: first line, truncated
    const firstLine = jobDescription.split('\n').find(l => l.trim()) || jobDescription;
    return firstLine.replace(/^#+\s*/, '').trim().split(/\s+/).slice(0, 10).join(' ');
  }
}

/**
 * Create a new job branch with job.config.json
 * @param {string} jobDescription - The job description
 * @param {Object} [options] - Optional overrides
 * @param {string} [options.llmProvider] - LLM provider override (e.g. 'openai', 'anthropic')
 * @param {string} [options.llmModel] - LLM model override (e.g. 'gpt-4o', 'claude-sonnet-4-5-20250929')
 * @param {string} [options.agentBackend] - Agent backend override ('pi' or 'claude-code')
 * @returns {Promise<{job_id: string, branch: string, title: string}>} - Job ID, branch name, and title
 */
async function createJob(jobDescription, options = {}) {
  const jobId = uuidv4();
  const branch = `job/${jobId}`;

  // Generate a short descriptive title
  const title = await generateJobTitle(jobDescription);

  // Always push the GitHub branch (agent needs it to work on)
  await pushGitHubBranch(jobId, branch, title, jobDescription, options);

  // If a custom dispatcher is set (e.g. BullMQ), also enqueue there
  if (_dispatcher) {
    await _dispatcher(jobId, branch, title, jobDescription, options);
  }

  return { job_id: jobId, branch, title };
}

export { createJob };
