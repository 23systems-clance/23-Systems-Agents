/**
 * License key generator.
 *
 * Generates cryptographically random license keys in the format:
 * SLKP-XXXX-XXXX-XXXX-XXXX
 *
 * Uses an unambiguous 32-character charset (no 0/O/1/I/l) for
 * easy manual entry and visual clarity.
 */

import crypto from 'crypto';

/**
 * Unambiguous charset (32 characters).
 * Excludes: 0, O, 1, I, l to prevent confusion.
 */
const CHARSET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** License key prefix. */
const PREFIX = 'SLKP';

/** Number of groups after the prefix. */
const GROUP_COUNT = 4;

/** Characters per group. */
const GROUP_SIZE = 4;

/**
 * Generates a unique license key in the format SLKP-XXXX-XXXX-XXXX-XXXX.
 *
 * Uses crypto.randomBytes for cryptographic randomness. Each character is
 * selected from the 32-char unambiguous charset using modulo (acceptable
 * bias for 32 = 2^5 with byte values 0-255 → uniform distribution).
 *
 * @returns Formatted license key string.
 */
export function generateLicenseKey(): string {
  const totalChars = GROUP_COUNT * GROUP_SIZE;
  const bytes = crypto.randomBytes(totalChars);

  const groups: string[] = [];
  let byteIndex = 0;

  for (let g = 0; g < GROUP_COUNT; g++) {
    let group = '';
    for (let c = 0; c < GROUP_SIZE; c++) {
      // 256 % 32 === 0, so no modulo bias
      group += CHARSET[bytes[byteIndex] % CHARSET.length];
      byteIndex++;
    }
    groups.push(group);
  }

  return `${PREFIX}-${groups.join('-')}`;
}
