/**
 * Web search tool factory for supported LLM providers.
 * Anthropic and OpenAI provide server-side web search — the provider
 * runs the search and the model's synthesized answer streams normally.
 */

export function getProvider() {
  return process.env.LLM_PROVIDER || 'anthropic';
}

export function isWebSearchAvailable() {
  if (process.env.WEB_SEARCH === 'false') return false;
  const provider = getProvider();
  return provider === 'anthropic' || provider === 'openai';
}

/**
 * Create a server-side web search tool for the current provider.
 * Returns null if the provider doesn't support it or if the import fails.
 */
export async function createWebSearchTool() {
  if (!isWebSearchAvailable()) return null;

  const provider = getProvider();

  try {
    if (provider === 'anthropic') {
      const { tools } = await import('@langchain/anthropic');
      return tools.webSearch_20250305();
    }

    if (provider === 'openai') {
      const { tools } = await import('@langchain/openai');
      return tools.webSearch();
    }

    return null;
  } catch (err) {
    console.warn(`[web-search] Failed to create web search tool for ${provider}:`, err.message);
    return null;
  }
}
