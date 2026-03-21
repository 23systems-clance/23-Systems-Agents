/**
 * CRM adapter registration.
 *
 * Registers all available CRM adapters with the adapter registry at
 * application startup. Import this module early in the app lifecycle
 * (e.g. from server.ts) to ensure adapters are available before any
 * CRM import operations.
 */

import { registerAdapter } from './crmAdapterRegistry.js';
import { HubSpotAdapter } from './adapters/hubspot/hubspotAdapter.js';

/** Register all CRM adapters. Call once at app startup. */
export function initCrmAdapters(): void {
  registerAdapter('HUBSPOT', new HubSpotAdapter());
}
