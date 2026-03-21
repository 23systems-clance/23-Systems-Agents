/**
 * LLM routing: local Ollama for planning/chat/summary, cloud for agent execution.
 *
 * Request types:
 *   - agent_execution: Always cloud (Claude Sonnet) — runs inside the container, not here
 *   - planning, chat, summary, title: Ollama first, cloud fallback
 */

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'phi4:14b';

/**
 * Route an LLM request to the appropriate provider.
 * @param {Object} request - { type, messages, modelOverride, maxTokens }
 * @returns {Promise<string>} LLM response text
 */
export async function routeLLM(request) {
  const { type, messages, modelOverride, maxTokens } = request;

  // Agent execution always goes to cloud
  if (type === 'agent_execution') {
    return callCloud(messages, modelOverride, maxTokens);
  }

  // Planning, chat, summary, title → try Ollama first
  if (process.env.OLLAMA_URL) {
    try {
      return await callOllama(messages);
    } catch (err) {
      console.warn(`[llm-router] Ollama unreachable, falling back to cloud: ${err.message}`);
    }
  }

  return callCloud(messages, modelOverride, maxTokens);
}

/**
 * Check if Ollama is available.
 * @returns {Promise<boolean>}
 */
export async function isOllamaAvailable() {
  if (!process.env.OLLAMA_URL) return false;
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`);
    return response.ok;
  } catch {
    return false;
  }
}

async function callOllama(messages) {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status}`);
  }

  const data = await response.json();
  return data.message?.content || '';
}

async function callCloud(messages, modelOverride, maxTokens = 4096) {
  const provider = process.env.LLM_PROVIDER || 'anthropic';

  if (provider === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set for cloud fallback');

    const model = modelOverride || process.env.LLM_MODEL || 'claude-sonnet-4-20250514';
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${err}`);
    }

    const data = await response.json();
    return data.content?.map(b => b.text).join('') || '';
  }

  if (provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const model = modelOverride || process.env.LLM_MODEL || 'gpt-4o';

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${err}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  throw new Error(`Cloud fallback not implemented for provider: ${provider}`);
}
