/**
 * HMAC-SHA256 webhook validation utility.
 *
 * Provides functions to generate secrets, compute signatures, and validate
 * incoming webhook requests using timing-safe comparison to prevent
 * timing attacks.
 */

import crypto from 'crypto';

/**
 * Generates a cryptographically random HMAC secret.
 * @returns A 32-byte hex string suitable for HMAC-SHA256 signing.
 */
export function generateHmacSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Computes an HMAC-SHA256 signature for the given payload.
 * @param secret - The HMAC secret key.
 * @param payload - The raw request body as a string or Buffer.
 * @returns The hex-encoded HMAC-SHA256 signature.
 */
export function computeSignature(secret: string, payload: string | Buffer): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Validates an HMAC-SHA256 signature using timing-safe comparison.
 * @param secret - The HMAC secret key.
 * @param payload - The raw request body as a string or Buffer.
 * @param providedSignature - The signature from the X-Webhook-Signature header.
 * @returns True if the signature is valid, false otherwise.
 */
export function validateSignature(
  secret: string,
  payload: string | Buffer,
  providedSignature: string
): boolean {
  const computed = computeSignature(secret, payload);
  if (computed.length !== providedSignature.length) {
    return false;
  }
  try {
    return crypto.timingSafeEqual(
      Buffer.from(computed, 'hex'),
      Buffer.from(providedSignature, 'hex')
    );
  } catch {
    return false;
  }
}
