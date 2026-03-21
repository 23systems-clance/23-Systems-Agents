/**
 * CRM adapter layer type definitions.
 *
 * Defines the abstract CrmAdapter class and supporting interfaces that all
 * CRM-specific adapters (HubSpot, Attio, Salesforce) must implement.
 */

import type { CrmType, CrmConnectionStatus, CrmFieldMapping } from '@prisma/client';
import type { CanonicalContactData } from '../canonical/types.js';
import logger from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Supporting interfaces
// ---------------------------------------------------------------------------

/** Result of a batch upsert operation against a CRM. */
export interface CrmUpsertResult {
  /** Number of records successfully upserted. */
  succeeded: number;
  /** Number of records that failed. */
  failed: number;
  /** Per-record error details. */
  errors: Array<{ email: string; error: string }>;
  /** Mapping of email → CRM-side record ID for successfully upserted records. */
  crmRecordIds: Map<string, string>;
}

/** Describes a single property/field in a CRM's schema. */
export interface CrmPropertyInfo {
  /** Internal property name in the CRM. */
  name: string;
  /** Human-readable label. */
  label: string;
  /** Data type (string, number, date, enumeration, etc.). */
  type: string;
  /** Property group or category name. */
  groupName: string;
  /** Whether this is a custom (non-default) property. */
  isCustom: boolean;
}

/** Normalized error from any CRM adapter. */
export interface CrmAdapterError {
  /** Machine-readable error code (e.g. "AUTH_FAILED", "RATE_LIMITED"). */
  code: string;
  /** Human-readable error message. */
  message: string;
  /** Which CRM produced this error. */
  crmType: CrmType;
  /** Whether this error can be retried (e.g. 429 rate limit). */
  retryable: boolean;
  /** Additional error context. */
  details?: Record<string, unknown>;
}

/** Options passed to the import orchestrator. */
export interface CrmImportOptions {
  /** Only push records changed since last push. */
  incrementalOnly?: boolean;
  /** Name for the CRM list to create/add contacts to. */
  listName?: string;
}

// ---------------------------------------------------------------------------
// Abstract CRM adapter
// ---------------------------------------------------------------------------

/**
 * Abstract base class for CRM adapters.
 *
 * Each CRM integration (HubSpot, Attio, Salesforce) extends this class and
 * implements the 7 abstract methods. The import orchestrator calls only these
 * methods — it never imports CRM-specific modules directly.
 *
 * Shared utility methods (withRetry, normalizeError) are provided by the base
 * class so adapters get consistent retry and error handling behavior.
 */
export abstract class CrmAdapter {
  /** The CRM type this adapter handles. */
  abstract readonly crmType: CrmType;

  /**
   * Verify and activate the connection (e.g. validate OAuth tokens).
   * @param connectionId - CrmConnection UUID.
   */
  abstract connect(connectionId: string): Promise<void>;

  /**
   * Cleanly disconnect (e.g. revoke tokens, update status).
   * @param connectionId - CrmConnection UUID.
   */
  abstract disconnect(connectionId: string): Promise<void>;

  /**
   * Check current connection health.
   * @param connectionId - CrmConnection UUID.
   * @returns Current connection status.
   */
  abstract getConnectionStatus(connectionId: string): Promise<CrmConnectionStatus>;

  /**
   * Batch upsert canonical contacts into the CRM.
   *
   * The adapter applies field mappings to translate canonical fields to
   * CRM-specific properties, then performs identity resolution and
   * create/update operations. Supports partial success — succeeded records
   * are committed even if some fail.
   *
   * @param connectionId - CrmConnection UUID.
   * @param contacts - Canonical contact records to push.
   * @param fieldMappings - Active field mappings for this connection.
   * @returns Upsert result with success/failure counts and CRM record IDs.
   */
  abstract upsertContacts(
    connectionId: string,
    contacts: CanonicalContactData[],
    fieldMappings: CrmFieldMapping[],
  ): Promise<CrmUpsertResult>;

  /**
   * Create a contact list in the CRM.
   * @param connectionId - CrmConnection UUID.
   * @param name - Display name for the list.
   * @returns CRM-side list ID.
   */
  abstract createList(connectionId: string, name: string): Promise<string>;

  /**
   * Add contacts to an existing CRM list.
   * @param connectionId - CrmConnection UUID.
   * @param listId - CRM-side list ID.
   * @param crmContactIds - CRM-side contact IDs to add.
   */
  abstract addContactsToList(
    connectionId: string,
    listId: string,
    crmContactIds: string[],
  ): Promise<void>;

  /**
   * Fetch all available contact properties from the CRM.
   * @param connectionId - CrmConnection UUID.
   * @returns Array of property metadata.
   */
  abstract getProperties(connectionId: string): Promise<CrmPropertyInfo[]>;

  /**
   * Ensure custom properties exist in the CRM schema.
   *
   * Creates property groups and properties that don't already exist.
   * Idempotent — safe to call multiple times.
   *
   * @param connectionId - CrmConnection UUID.
   * @param properties - Properties to ensure exist.
   */
  abstract ensureCustomProperties(
    connectionId: string,
    properties: CrmPropertyInfo[],
  ): Promise<void>;

  // -------------------------------------------------------------------------
  // Shared base methods
  // -------------------------------------------------------------------------

  /**
   * Execute a function with exponential backoff retry.
   *
   * Retries on retryable errors (rate limits, transient failures) with
   * exponential backoff and jitter. Non-retryable errors are thrown immediately.
   *
   * @param fn - Async function to execute.
   * @param maxRetries - Maximum retry attempts (default 5).
   * @returns Result of the function.
   */
  protected async withRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number = 5,
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        const normalized = this.normalizeError(err);

        if (!normalized.retryable || attempt === maxRetries) {
          throw err;
        }

        // Exponential backoff: 1s, 2s, 4s, 8s, 16s + jitter
        const baseDelay = Math.pow(2, attempt) * 1000;
        const jitter = Math.random() * 500;
        const delay = baseDelay + jitter;

        logger.warn(`CRM adapter retry (attempt ${attempt + 1}/${maxRetries})`, {
          crmType: this.crmType,
          code: normalized.code,
          delay: Math.round(delay),
        });

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  /**
   * Normalize any thrown error into a structured CrmAdapterError.
   *
   * Subclasses can override this to handle CRM-specific error formats.
   * The base implementation handles common HTTP status patterns.
   *
   * @param err - The caught error.
   * @returns Normalized CrmAdapterError.
   */
  protected normalizeError(err: unknown): CrmAdapterError {
    if (err instanceof Error) {
      const statusCode = (err as any).statusCode ?? (err as any).status ?? (err as any).code;

      // Determine retryable status
      const retryableStatuses = [429, 500, 502, 503, 504];
      const retryable = typeof statusCode === 'number' && retryableStatuses.includes(statusCode);

      // Map common status codes to error codes
      let code = 'UNKNOWN_ERROR';
      if (statusCode === 401 || statusCode === 403) code = 'AUTH_FAILED';
      else if (statusCode === 429) code = 'RATE_LIMITED';
      else if (statusCode === 404) code = 'NOT_FOUND';
      else if (typeof statusCode === 'number' && statusCode >= 500) code = 'SERVER_ERROR';

      return {
        code,
        message: err.message,
        crmType: this.crmType,
        retryable,
        details: { statusCode },
      };
    }

    return {
      code: 'UNKNOWN_ERROR',
      message: String(err),
      crmType: this.crmType,
      retryable: false,
    };
  }
}
