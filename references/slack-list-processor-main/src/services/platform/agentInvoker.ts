/**
 * Agent Invoker Service (Feature 39 - Vertical Pack Platform)
 *
 * Invokes AI agents by loading their AgentVersion configuration,
 * building Anthropic API messages, enforcing maxTokens cap (FR-005a),
 * and returning structured output with usage metrics.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config/index.js';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';
import { calculateAiCost } from '../ai/costCalculator.js';

const log = logger.withContext({ service: 'agentInvoker' });

const anthropic = new Anthropic({
  apiKey: config.anthropic.apiKey,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InvocationResult {
  output: unknown;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
  durationMs: number;
  modelId: string;
  toolCallsMade: Array<{ toolName: string; input: unknown; output: unknown }>;
}

export interface TestResult extends InvocationResult {
  agentId: string;
  versionId: string;
  versionNumber: number;
}

// ---------------------------------------------------------------------------
// Core Invocation (T012)
// ---------------------------------------------------------------------------

/**
 * Invoke an agent version with the given input.
 * Loads the AgentVersion, builds the Anthropic message, enforces maxTokens,
 * and returns structured output with token counts and cost.
 */
export async function invokeAgent(
  agentVersionId: string,
  input: Record<string, unknown>,
): Promise<InvocationResult> {
  const agentVersion = await prisma.agentVersion.findUnique({
    where: { id: agentVersionId },
    include: { agent: true },
  });

  if (!agentVersion) {
    throw new Error(`AgentVersion ${agentVersionId} not found`);
  }

  if (agentVersion.status !== 'PUBLISHED' && agentVersion.status !== 'TESTING') {
    throw new Error(`AgentVersion ${agentVersionId} is ${agentVersion.status}, must be PUBLISHED or TESTING`);
  }

  return executeAgentCall(agentVersion, input);
}

/**
 * Test an agent in sandbox mode without credit deduction (FR-003).
 * Can test a specific version or defaults to the latest.
 */
export async function testAgent(
  agentId: string,
  input: Record<string, unknown>,
  versionId?: string,
): Promise<TestResult> {
  let agentVersion;

  if (versionId) {
    agentVersion = await prisma.agentVersion.findUnique({
      where: { id: versionId },
      include: { agent: true },
    });
  } else {
    // Get the latest version regardless of status (for testing)
    agentVersion = await prisma.agentVersion.findFirst({
      where: { agentId },
      orderBy: { version: 'desc' },
      include: { agent: true },
    });
  }

  if (!agentVersion) {
    throw new Error(`No version found for agent ${agentId}`);
  }

  const result = await executeAgentCall(agentVersion, input);

  return {
    ...result,
    agentId,
    versionId: agentVersion.id,
    versionNumber: agentVersion.version,
  };
}

// ---------------------------------------------------------------------------
// Internal execution
// ---------------------------------------------------------------------------

interface AgentVersionWithAgent {
  id: string;
  systemPrompt: string;
  modelId: string;
  maxTokens: number;
  toolIds: string[];
  inputSchema: unknown;
  outputSchema: unknown;
  agent: { name: string; slug: string };
}

async function executeAgentCall(
  agentVersion: AgentVersionWithAgent,
  input: Record<string, unknown>,
): Promise<InvocationResult> {
  const startTime = Date.now();
  const toolCallsMade: InvocationResult['toolCallsMade'] = [];

  // Build tools from MCP tool definitions if toolIds are set
  const tools = await buildToolDefinitions(agentVersion.toolIds);

  // Build the user message from input
  const userMessage = typeof input.message === 'string'
    ? input.message
    : JSON.stringify(input, null, 2);

  log.debug('Invoking agent', {
    agentSlug: agentVersion.agent.slug,
    modelId: agentVersion.modelId,
    maxTokens: agentVersion.maxTokens,
    toolCount: tools.length,
  });

  try {
    const response = await anthropic.messages.create({
      model: agentVersion.modelId,
      max_tokens: agentVersion.maxTokens,
      system: agentVersion.systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      ...(tools.length > 0 && { tools }),
    });

    const tokensInput = response.usage.input_tokens;
    const tokensOutput = response.usage.output_tokens;
    const costUsd = calculateAiCost(tokensInput, tokensOutput);
    const durationMs = Date.now() - startTime;

    // Extract output from response content blocks
    let output: unknown = null;
    for (const block of response.content) {
      if (block.type === 'text') {
        output = block.text;
      } else if (block.type === 'tool_use') {
        toolCallsMade.push({
          toolName: block.name,
          input: block.input,
          output: null, // Would be populated in multi-turn execution
        });
        // If the agent used a tool, the tool input is the structured output
        if (!output) output = block.input;
      }
    }

    log.info('Agent invocation complete', {
      agentSlug: agentVersion.agent.slug,
      tokensInput,
      tokensOutput,
      costUsd: costUsd.toFixed(6),
      durationMs,
      toolCalls: toolCallsMade.length,
    });

    return {
      output,
      tokensInput,
      tokensOutput,
      costUsd,
      durationMs,
      modelId: agentVersion.modelId,
      toolCallsMade,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    log.error('Agent invocation failed', {
      agentSlug: agentVersion.agent.slug,
      error: error instanceof Error ? error.message : String(error),
      durationMs,
    });
    throw error;
  }
}

/**
 * Build Anthropic tool definitions from McpTool records.
 * Returns empty array if no toolIds are specified.
 */
async function buildToolDefinitions(
  toolIds: string[],
): Promise<Anthropic.Messages.Tool[]> {
  if (!toolIds || toolIds.length === 0) return [];

  const mcpTools = await prisma.mcpTool.findMany({
    where: { id: { in: toolIds } },
  });

  return mcpTools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? `Tool: ${tool.name}`,
    input_schema: (tool.inputSchema as Anthropic.Messages.Tool['input_schema']) ?? {
      type: 'object' as const,
      properties: {},
    },
  }));
}
