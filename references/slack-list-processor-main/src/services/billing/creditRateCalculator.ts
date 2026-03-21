/**
 * Credit rate calculator service.
 *
 * Computes effective costs (base cost + markup) for each enrichment
 * operation type and creates point-in-time rate snapshots stored on
 * Job records so in-progress jobs are billed at their original rates.
 */

import { prisma } from '../../models/index.js';
import type { CreditRateConfig } from '@prisma/client';

export type OperationType =
  | 'BUILTWITH_CTU_LOOKUP'
  | 'BUILTWITH_DOMAIN_LOOKUP'
  | 'APOLLO_PEOPLE_SEARCH'
  | 'APOLLO_BULK_ENRICH';

export interface CreditRateSnapshot {
  builtWithCtuLookup: number;
  builtWithDomainLookup: number;
  apolloPeopleSearch: number;
  apolloBulkEnrich: number;
  markupPercent: number;
  snapshotAt: string;
}

/**
 * Maps operation type to the corresponding base cost field on CreditRateConfig.
 */
const OPERATION_COST_FIELD: Record<OperationType, keyof Pick<
  CreditRateConfig,
  'builtWithCtuLookupCost' | 'builtWithDomainLookupCost' | 'apolloPeopleSearchCost' | 'apolloBulkEnrichCost'
>> = {
  BUILTWITH_CTU_LOOKUP: 'builtWithCtuLookupCost',
  BUILTWITH_DOMAIN_LOOKUP: 'builtWithDomainLookupCost',
  APOLLO_PEOPLE_SEARCH: 'apolloPeopleSearchCost',
  APOLLO_BULK_ENRICH: 'apolloBulkEnrichCost',
};

/**
 * Calculate effective cost for a single operation.
 * Formula: ceil(baseCost * (1 + markupPercent / 100))
 */
export function getEffectiveCost(
  operationType: OperationType,
  config: CreditRateConfig,
): number {
  const field = OPERATION_COST_FIELD[operationType];
  const baseCost = config[field];
  return Math.ceil(baseCost * (1 + config.markupPercent / 100));
}

/**
 * Compute effective costs for all operation types given a config.
 */
export function computeEffectiveCosts(config: CreditRateConfig): Record<string, number> {
  return {
    builtWithCtuLookup: getEffectiveCost('BUILTWITH_CTU_LOOKUP', config),
    builtWithDomainLookup: getEffectiveCost('BUILTWITH_DOMAIN_LOOKUP', config),
    apolloPeopleSearch: getEffectiveCost('APOLLO_PEOPLE_SEARCH', config),
    apolloBulkEnrich: getEffectiveCost('APOLLO_BULK_ENRICH', config),
  };
}

/**
 * Fetch the currently active CreditRateConfig.
 * Throws if no active config exists.
 */
export async function getActiveConfig(): Promise<CreditRateConfig> {
  const config = await prisma.creditRateConfig.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
  });

  if (!config) {
    throw new Error('No active credit rate configuration found');
  }

  return config;
}

/**
 * Create a rate snapshot from the current active config.
 * Stored on Job records for billing consistency.
 */
export async function createRateSnapshot(): Promise<CreditRateSnapshot> {
  const config = await getActiveConfig();
  return {
    builtWithCtuLookup: getEffectiveCost('BUILTWITH_CTU_LOOKUP', config),
    builtWithDomainLookup: getEffectiveCost('BUILTWITH_DOMAIN_LOOKUP', config),
    apolloPeopleSearch: getEffectiveCost('APOLLO_PEOPLE_SEARCH', config),
    apolloBulkEnrich: getEffectiveCost('APOLLO_BULK_ENRICH', config),
    markupPercent: config.markupPercent,
    snapshotAt: new Date().toISOString(),
  };
}

/**
 * Estimate total credits for a job based on row count and operation types.
 */
export async function estimateJobCredits(
  rowCount: number,
  operationTypes: OperationType[],
  config?: CreditRateConfig,
): Promise<number> {
  const activeConfig = config ?? await getActiveConfig();
  let total = 0;
  for (const opType of operationTypes) {
    total += rowCount * getEffectiveCost(opType, activeConfig);
  }
  return total;
}
