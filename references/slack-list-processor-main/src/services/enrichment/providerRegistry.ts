/**
 * Provider registry for waterfall enrichment (Feature 27).
 *
 * Central registry for provider selection, validation, and waterfall ordering.
 */

import { Provider, DataType } from '@prisma/client';
import {
  getProviderConfig,
  getProvidersByPriority as getConfigsByPriority,
  validateProvider as validateProviderCapability,
  type ProviderConfig,
} from '../../config/providers.js';

/**
 * Get providers in waterfall priority order for a specific data type.
 *
 * Email waterfall: Apollo → Wiza → AI Ark
 * Phone waterfall: Apollo → Wiza → AI Ark
 *
 * @param dataType - 'EMAIL' or 'PHONE'
 * @returns Array of providers sorted by priority
 */
export function getProvidersByPriority(dataType: DataType): Provider[] {
  const configs = getConfigsByPriority(dataType);
  return configs.map((c) => c.provider);
}

/**
 * Get configuration for a specific provider.
 *
 * @param provider - Provider enum value
 * @returns Provider configuration
 */
export function getProvider(provider: Provider): ProviderConfig {
  return getProviderConfig(provider);
}

/**
 * Validate that a provider supports a specific data type.
 *
 * @param provider - Provider to validate
 * @param dataType - Data type to check
 * @throws {Error} If provider doesn't support data type
 */
export function validateProvider(
  provider: Provider,
  dataType: DataType,
): void {
  const isValid = validateProviderCapability(provider, dataType);

  if (!isValid) {
    const config = getProviderConfig(provider);
    throw new Error(
      `Provider ${provider} does not support ${dataType} enrichment. Capabilities: ${config.capabilities.join(', ')}`,
    );
  }
}

/**
 * Get all providers that support a specific data type.
 *
 * @param dataType - 'EMAIL' or 'PHONE'
 * @returns Array of providers supporting the data type
 */
export function getProvidersByCapability(dataType: DataType): Provider[] {
  const capability = dataType === 'EMAIL' ? 'email' : 'phone';
  const configs = getConfigsByPriority(dataType);

  return configs
    .filter((c) => c.capabilities.includes(capability))
    .map((c) => c.provider);
}

/**
 * Get the next provider in the waterfall sequence.
 *
 * @param dataType - 'EMAIL' or 'PHONE'
 * @param currentProvider - The provider that was just attempted (or null for first)
 * @returns Next provider to try, or null if waterfall exhausted
 */
export function getNextProvider(
  dataType: DataType,
  currentProvider: Provider | null,
): Provider | null {
  const providers = getProvidersByPriority(dataType);

  if (!currentProvider) {
    return providers[0] ?? null;
  }

  const currentIndex = providers.indexOf(currentProvider);
  if (currentIndex === -1 || currentIndex >= providers.length - 1) {
    return null; // No more providers in waterfall
  }

  return providers[currentIndex + 1];
}
