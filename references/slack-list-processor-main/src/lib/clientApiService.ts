/**
 * Client API key service.
 *
 * Fetches a ManagedClient and decrypts the requested platform API key.
 */

import { prisma } from '../models/index.js';
import { decrypt } from './tokenEncryption.js';
import logger from './logger.js';

type Platform = 'instantly' | 'heyreach' | 'hubspot';

const PLATFORM_KEY_FIELD: Record<Platform, 'instantlyApiKey' | 'heyreachApiKey' | 'hubspotApiKey'> = {
  instantly: 'instantlyApiKey',
  heyreach: 'heyreachApiKey',
  hubspot: 'hubspotApiKey',
};

/**
 * Fetches and decrypts a client's API key for the given platform.
 *
 * @param clientId - ManagedClient UUID
 * @param platform - Target platform ('instantly' | 'heyreach' | 'hubspot')
 * @returns Decrypted API key string, or null if not configured
 * @throws Error if client not found
 */
export async function getDecryptedKey(
  clientId: string,
  platform: Platform,
): Promise<string | null> {
  const keyField = PLATFORM_KEY_FIELD[platform];
  const client = await prisma.managedClient.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      name: true,
      instantlyApiKey: true,
      heyreachApiKey: true,
      hubspotApiKey: true,
    },
  });

  if (!client) {
    throw new Error(`Client not found: ${clientId}`);
  }

  const encryptedKey = client[keyField] as string | null;
  if (!encryptedKey) {
    logger.debug('Client has no API key for platform', { clientId, platform });
    return null;
  }

  return decrypt(encryptedKey);
}
