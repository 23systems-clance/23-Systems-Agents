import { ChatAnthropic } from '@langchain/anthropic';

const DEFAULT_MODELS = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  google: 'gemini-2.5-pro',
  ollama: 'phi4:14b',
};

/**
 * Create a LangChain chat model based on environment configuration.
 *
 * Config env vars:
 *   LLM_PROVIDER    — "anthropic" (default), "openai", "google", "ollama", "custom"
 *   LLM_MODEL       — Model name override (e.g. "claude-sonnet-4-20250514")
 *   ANTHROPIC_API_KEY — Required for anthropic provider
 *   OPENAI_API_KEY   — Required for openai provider (optional with OPENAI_BASE_URL)
 *   OPENAI_BASE_URL  — Custom OpenAI-compatible base URL (e.g. http://localhost:11434/v1 for Ollama)
 *   GOOGLE_API_KEY   — Required for google provider
 *   OLLAMA_URL       — Ollama server URL (default: http://localhost:11434)
 *   OLLAMA_MODEL     — Ollama model override (default: phi4:14b)
 *
 * @param {object} [options]
 * @param {number} [options.maxTokens=4096] - Max tokens for the response
 * @param {string} [options.provider] - Override LLM_PROVIDER for this call
 * @param {string} [options.model] - Override LLM_MODEL for this call
 * @returns {import('@langchain/core/language_models/chat_models').BaseChatModel}
 */
export async function createModel(options = {}) {
  const provider = options.provider || process.env.LLM_PROVIDER || 'anthropic';
  const modelName = options.model || process.env.LLM_MODEL || DEFAULT_MODELS[provider] || DEFAULT_MODELS.anthropic;
  const maxTokens = options.maxTokens || Number(process.env.LLM_MAX_TOKENS) || 4096;

  switch (provider) {
    case 'anthropic': {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY environment variable is required');
      }
      return new ChatAnthropic({
        modelName,
        maxTokens,
        anthropicApiKey: apiKey,
      });
    }
    case 'ollama': {
      const { ChatOpenAI } = await import('@langchain/openai');
      const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
      const ollamaModel = options.model || process.env.OLLAMA_MODEL || DEFAULT_MODELS.ollama;
      return new ChatOpenAI({
        modelName: ollamaModel,
        maxTokens,
        apiKey: 'ollama',
        configuration: { baseURL: `${ollamaUrl}/v1` },
      });
    }
    case 'custom':
    case 'openai': {
      const { ChatOpenAI } = await import('@langchain/openai');
      const apiKey = provider === 'custom'
        ? (process.env.CUSTOM_API_KEY || 'not-needed')
        : process.env.OPENAI_API_KEY;
      const baseURL = process.env.OPENAI_BASE_URL;
      if (!apiKey && !baseURL) {
        throw new Error('OPENAI_API_KEY environment variable is required (or set OPENAI_BASE_URL for local models)');
      }
      const config = { modelName, maxTokens };
      config.apiKey = apiKey || 'not-needed';
      if (baseURL) {
        config.configuration = { baseURL };
      }
      return new ChatOpenAI(config);
    }
    case 'google': {
      const { ChatGoogleGenerativeAI } = await import('@langchain/google-genai');
      const apiKey = process.env.GOOGLE_API_KEY;
      if (!apiKey) {
        throw new Error('GOOGLE_API_KEY environment variable is required');
      }
      return new ChatGoogleGenerativeAI({
        model: modelName,
        maxOutputTokens: maxTokens,
        apiKey,
      });
    }
    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}

/**
 * Create an Ollama model, falling back to the default cloud provider on failure.
 * Used for lightweight tasks (summaries, titles) where local LLM saves cost.
 *
 * @param {object} [options] - Same as createModel options
 * @returns {import('@langchain/core/language_models/chat_models').BaseChatModel}
 */
export async function createLocalModel(options = {}) {
  const ollamaUrl = process.env.OLLAMA_URL;
  if (!ollamaUrl) {
    return createModel(options);
  }

  try {
    const model = await createModel({ ...options, provider: 'ollama' });
    // Ping Ollama to verify it's running
    const response = await fetch(`${ollamaUrl}/api/tags`);
    if (!response.ok) throw new Error(`Ollama not responding: ${response.status}`);
    return model;
  } catch (err) {
    console.warn(`[model] Ollama unavailable, falling back to cloud: ${err.message}`);
    return createModel(options);
  }
}
