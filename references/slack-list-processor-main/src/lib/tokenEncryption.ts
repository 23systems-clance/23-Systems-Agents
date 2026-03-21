import crypto from 'crypto';
import { config } from '../config/index.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Encrypts a plaintext string using AES-256-GCM encryption.
 *
 * @param plaintext - The string to encrypt (e.g., bot token)
 * @returns Encrypted string in format "iv:authTag:ciphertext" (hex-encoded)
 * @throws Error if encryption key is not configured or invalid
 */
export function encrypt(plaintext: string): string {
  if (!config.encryption.tokenKey) {
    throw new Error('TOKEN_ENCRYPTION_KEY not configured');
  }

  // Convert hex key to buffer (64 hex chars = 32 bytes)
  const key = Buffer.from(config.encryption.tokenKey, 'hex');

  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex characters)');
  }

  // Generate random IV
  const iv = crypto.randomBytes(IV_LENGTH);

  // Create cipher
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  // Encrypt the plaintext
  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');

  // Get authentication tag
  const authTag = cipher.getAuthTag();

  // Return format: iv:authTag:ciphertext (all hex-encoded)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext}`;
}

/**
 * Decrypts an encrypted string using AES-256-GCM decryption.
 *
 * @param encrypted - Encrypted string in format "iv:authTag:ciphertext" (hex-encoded)
 * @returns Decrypted plaintext string
 * @throws Error if decryption key is not configured, format is invalid, or authentication fails
 */
export function decrypt(encrypted: string): string {
  if (!config.encryption.tokenKey) {
    throw new Error('TOKEN_ENCRYPTION_KEY not configured');
  }

  // Convert hex key to buffer
  const key = Buffer.from(config.encryption.tokenKey, 'hex');

  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex characters)');
  }

  // Parse the encrypted string
  const parts = encrypted.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted string format. Expected "iv:authTag:ciphertext"');
  }

  const [ivHex, authTagHex, ciphertext] = parts;

  // Convert hex strings to buffers
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  if (iv.length !== IV_LENGTH) {
    throw new Error(`Invalid IV length. Expected ${IV_LENGTH} bytes`);
  }

  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error(`Invalid auth tag length. Expected ${AUTH_TAG_LENGTH} bytes`);
  }

  // Create decipher
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  // Decrypt the ciphertext
  let plaintext = decipher.update(ciphertext, 'hex', 'utf8');
  plaintext += decipher.final('utf8');

  return plaintext;
}
