/**
 * CRM adapter registry singleton.
 *
 * Central registry for CRM adapter instances. Each CRM type (HubSpot, Attio,
 * Salesforce) registers its adapter at startup. The import orchestrator looks
 * up the appropriate adapter by CrmType at runtime.
 */

import type { CrmType } from '@prisma/client';
import type { CrmAdapter } from './types.js';
import logger from '../../lib/logger.js';

/** Adapter instances keyed by CRM type. */
const registry = new Map<CrmType, CrmAdapter>();

/**
 * Register a CRM adapter for a given CRM type.
 *
 * @param crmType - The CRM type this adapter handles.
 * @param adapter - The adapter instance.
 * @throws If an adapter is already registered for this CRM type.
 */
export function registerAdapter(crmType: CrmType, adapter: CrmAdapter): void {
  if (registry.has(crmType)) {
    throw new Error(`CRM adapter already registered for type: ${crmType}`);
  }

  registry.set(crmType, adapter);
  logger.info('CRM adapter registered', { crmType });
}

/**
 * Get the registered adapter for a CRM type.
 *
 * @param crmType - The CRM type to look up.
 * @returns The registered adapter.
 * @throws If no adapter is registered for this CRM type.
 */
export function getAdapter(crmType: CrmType): CrmAdapter {
  const adapter = registry.get(crmType);
  if (!adapter) {
    throw new Error(`No CRM adapter registered for type: ${crmType}. Available: ${listRegisteredAdapters().join(', ') || 'none'}`);
  }
  return adapter;
}

/**
 * List all registered CRM adapter types.
 *
 * @returns Array of registered CrmType values.
 */
export function listRegisteredAdapters(): CrmType[] {
  return Array.from(registry.keys());
}
