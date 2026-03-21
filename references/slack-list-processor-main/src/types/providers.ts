/**
 * Type definitions for waterfall enrichment providers (Feature 27).
 */

import { Provider, DataType, AttemptStatus } from '@prisma/client';

/**
 * Input for creating a provider attempt record.
 */
export interface ProviderAttemptInput {
  jobId: string;
  contactId: string;
  provider: Provider;
  dataType: DataType;
  requestId?: string;
  requestPayload?: any;
}

/**
 * Result from a provider enrichment attempt.
 */
export interface ProviderAttemptResult {
  provider: Provider;
  dataType: DataType;
  status: AttemptStatus;
  emailFound?: string;
  phoneFound?: string;
  cost?: number;
  creditsConsumed?: number;
  errorMessage?: string;
  httpStatus?: number;
  durationMs?: number;
}

/**
 * Standardized response from any provider API call.
 */
export interface ProviderResponse {
  success: boolean;
  provider: Provider;
  dataType: DataType;
  email?: string;
  phone?: string;
  requestId?: string; // For webhook correlation
  errorMessage?: string;
  httpStatus?: number;
}

/**
 * Result of waterfall enrichment for a single data type.
 */
export interface WaterfallResult {
  dataType: DataType;
  value: string | null; // Email or phone found
  provider: Provider | null; // Provider that found the data
  attempts: ProviderAttemptResult[];
  totalCost: number;
  success: boolean;
}

/**
 * Contact data for enrichment.
 */
export interface EnrichmentContact {
  id: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  domain?: string;
  companyName?: string;
  linkedinUrl?: string;
}

/**
 * Type guard to check if response is successful.
 */
export function isSuccessResponse(
  response: ProviderResponse,
): response is ProviderResponse & { success: true } {
  return response.success === true;
}

/**
 * Type guard to check if attempt was successful.
 */
export function isSuccessAttempt(
  result: ProviderAttemptResult,
): boolean {
  return result.status === 'SUCCESS';
}

/**
 * Extract email from provider response.
 */
export function extractEmail(response: ProviderResponse): string | null {
  return response.success && response.email ? response.email : null;
}

/**
 * Extract phone from provider response.
 */
export function extractPhone(response: ProviderResponse): string | null {
  return response.success && response.phone ? response.phone : null;
}
