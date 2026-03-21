/**
 * Provider configuration for waterfall enrichment (Feature 27).
 *
 * Defines configuration for Apollo, Wiza, and AI Ark enrichment providers
 * including authentication, endpoints, rate limits, and waterfall priorities.
 */

import { Provider, DataType } from '@prisma/client';

export interface ProviderConfig {
  name: string;
  provider: Provider;
  capabilities: ('email' | 'phone')[];
  auth: {
    type: 'api_key' | 'bearer_token' | 'custom_header';
    header: string;
    envVar: string;
  };
  api: {
    baseUrl: string;
    timeout: number;
  };
  rateLimit: {
    requestsPerSecond: number;
  };
  waterfall: {
    emailPriority: number | null; // 1 = first, null = not used
    phonePriority: number | null;
  };
}

export const apolloConfig: ProviderConfig = {
  name: 'Apollo.io',
  provider: 'APOLLO',
  capabilities: ['email', 'phone'],
  auth: {
    type: 'api_key',
    header: 'X-Api-Key',
    envVar: 'APOLLO_API_KEY',
  },
  api: {
    baseUrl: 'https://api.apollo.io/v1',
    timeout: 5000,
  },
  rateLimit: {
    requestsPerSecond: 10,
  },
  waterfall: {
    emailPriority: 1, // Try first for emails
    phonePriority: 1, // Try first for phones (extracted from people/match response)
  },
};

export const wizaConfig: ProviderConfig = {
  name: 'Wiza.co',
  provider: 'WIZA',
  capabilities: ['email', 'phone'],
  auth: {
    type: 'bearer_token',
    header: 'Authorization',
    envVar: 'WIZA_API_KEY',
  },
  api: {
    baseUrl: 'https://wiza.co/api',
    timeout: 5000,
  },
  rateLimit: {
    requestsPerSecond: 15,
  },
  waterfall: {
    emailPriority: 2, // Try second for emails
    phonePriority: 2, // Try second for phones (after Apollo)
  },
};

export const aiArkConfig: ProviderConfig = {
  name: 'AI Ark',
  provider: 'AI_ARK',
  capabilities: ['email', 'phone'],
  auth: {
    type: 'custom_header',
    header: 'X-TOKEN',
    envVar: 'AI_ARK_API_KEY',
  },
  api: {
    baseUrl: 'https://api.ai-ark.com/api/developer-portal/v1',
    timeout: 5000,
  },
  rateLimit: {
    requestsPerSecond: 5,
  },
  waterfall: {
    emailPriority: 3, // Try last for emails (most expensive)
    phonePriority: 3, // Try third for phones (after Apollo, Wiza)
  },
};

/**
 * Get all provider configurations.
 */
export const allProviders: ProviderConfig[] = [
  apolloConfig,
  wizaConfig,
  aiArkConfig,
];

/**
 * Get provider configuration by Provider enum.
 */
export function getProviderConfig(provider: Provider): ProviderConfig {
  const config = allProviders.find((p) => p.provider === provider);
  if (!config) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  return config;
}

/**
 * Get providers sorted by waterfall priority for a specific data type.
 *
 * @param dataType - 'email' or 'phone'
 * @returns Providers sorted by priority (lowest number = highest priority)
 */
export function getProvidersByPriority(
  dataType: DataType,
): ProviderConfig[] {
  const priorityKey =
    dataType === 'EMAIL' ? 'emailPriority' : 'phonePriority';

  return allProviders
    .filter((p) => p.waterfall[priorityKey] !== null)
    .sort((a, b) => {
      const aPriority = a.waterfall[priorityKey]!;
      const bPriority = b.waterfall[priorityKey]!;
      return aPriority - bPriority;
    });
}

/**
 * Validate that a provider supports a specific data type.
 */
export function validateProvider(
  provider: Provider,
  dataType: DataType,
): boolean {
  const config = getProviderConfig(provider);
  const capability = dataType === 'EMAIL' ? 'email' : 'phone';
  return config.capabilities.includes(capability);
}

/**
 * Get authentication header for a provider.
 */
export function getAuthHeader(provider: Provider): {
  name: string;
  value: string;
} {
  const config = getProviderConfig(provider);
  const apiKey = process.env[config.auth.envVar];

  if (!apiKey) {
    throw new Error(
      `Missing API key for ${provider}: ${config.auth.envVar} not set`,
    );
  }

  const headerValue =
    config.auth.type === 'bearer_token' ? `Bearer ${apiKey}` : apiKey;

  return {
    name: config.auth.header,
    value: headerValue,
  };
}
