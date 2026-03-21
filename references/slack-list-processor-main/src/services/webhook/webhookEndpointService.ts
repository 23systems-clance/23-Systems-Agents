/**
 * Webhook endpoint management service.
 *
 * Handles creation, deactivation, lookup, and secret rotation for
 * webhook endpoints tied to workflow templates.
 */

import crypto from 'crypto';
import { prisma } from '../../models/index.js';
import { generateHmacSecret } from './hmacValidator.js';
import logger from '../../lib/logger.js';

/**
 * Creates a new webhook endpoint for a workflow template.
 * @param templateId - The workflow template ID.
 * @param versionId - The workflow version ID.
 * @param description - Optional description for the endpoint.
 * @returns The created endpoint with token and HMAC secret.
 */
export async function createEndpoint(
  templateId: string,
  versionId: string,
  description?: string
) {
  const token = crypto.randomBytes(24).toString('base64url');
  const hmacSecret = generateHmacSecret();

  const endpoint = await prisma.webhookEndpoint.create({
    data: {
      templateId,
      versionId,
      token,
      hmacSecret,
      description,
      status: 'ACTIVE',
    },
  });

  logger.info('Webhook endpoint created', { endpointId: endpoint.id, templateId });
  return endpoint;
}

/**
 * Deactivates all webhook endpoints for a workflow template.
 * @param templateId - The workflow template ID.
 */
export async function deactivateEndpoint(templateId: string): Promise<void> {
  await prisma.webhookEndpoint.updateMany({
    where: { templateId, status: 'ACTIVE' },
    data: { status: 'INACTIVE' },
  });
  logger.info('Webhook endpoints deactivated', { templateId });
}

/**
 * Looks up an active webhook endpoint by its token.
 * @param token - The unique webhook token from the URL path.
 * @returns The endpoint record or null if not found/inactive.
 */
export async function getEndpointByToken(token: string) {
  return prisma.webhookEndpoint.findFirst({
    where: { token, status: 'ACTIVE' },
    include: { template: true, version: true },
  });
}

/**
 * Rotates the HMAC secret for a webhook endpoint.
 * @param endpointId - The endpoint ID.
 * @returns The updated endpoint with the new secret.
 */
export async function rotateSecret(endpointId: string) {
  const hmacSecret = generateHmacSecret();
  return prisma.webhookEndpoint.update({
    where: { id: endpointId },
    data: { hmacSecret },
  });
}

/**
 * Increments the call counter and updates lastCalledAt for an endpoint.
 * @param endpointId - The endpoint ID.
 */
export async function recordCall(endpointId: string): Promise<void> {
  await prisma.webhookEndpoint.update({
    where: { id: endpointId },
    data: {
      totalCalls: { increment: 1 },
      lastCalledAt: new Date(),
    },
  });
}
