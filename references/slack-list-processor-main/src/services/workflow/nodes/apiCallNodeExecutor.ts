/**
 * API Call node executor for the workflow engine.
 *
 * Makes configurable HTTP requests with variable interpolation,
 * retry logic with exponential backoff, and response field mapping.
 */

import { interpolate, interpolateHeaders } from './variableInterpolator.js';
import type { ApiCallNodeConfig } from '../types.js';
import logger from '../../../lib/logger.js';

/**
 * Executes an API Call node against the execution context.
 *
 * @param config - The API Call node configuration.
 * @param context - The workflow execution context.
 * @returns Updated context with response data in the output variable.
 */
export async function executeApiCallNode(
  config: ApiCallNodeConfig,
  context: Record<string, unknown>
): Promise<void> {
  const maxRetries = config.maxRetries ?? 3;
  const retryDelayMs = config.retryDelayMs ?? 1000;
  const timeoutMs = config.timeoutMs ?? 30000;
  const outputVar = config.outputVariable || '_apiResponse';

  // Interpolate URL, headers, and body
  const url = interpolate(config.url, context);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(config.headers ? interpolateHeaders(config.headers, context) : {}),
  };

  // Apply authentication
  if (config.authType && config.authType !== 'none' && config.authConfig) {
    applyAuth(headers, config.authType, config.authConfig, context);
  }

  let body: string | undefined;
  if (config.bodyTemplate && ['POST', 'PUT'].includes(config.method)) {
    body = interpolate(config.bodyTemplate, context);
  }

  // Execute with retry logic
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        method: config.method,
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const responseText = await response.text();
      let responseBody: unknown;

      try {
        responseBody = JSON.parse(responseText);
      } catch {
        responseBody = responseText;
      }

      // Store raw response
      context[outputVar] = {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: responseBody,
      };

      // Apply response mapping if configured
      if (config.responseMapping && typeof responseBody === 'object' && responseBody !== null) {
        for (const mapping of config.responseMapping) {
          const value = resolvePath(responseBody as Record<string, unknown>, mapping.responsePath);
          if (value !== undefined) {
            context[mapping.contextVariable] = value;
          }
        }
      }

      if (!response.ok) {
        logger.warn(`API Call node: HTTP ${response.status} from ${url}`, {
          attempt: attempt + 1,
          status: response.status,
        });
        // Don't retry client errors (4xx), only server errors (5xx)
        if (response.status < 500) break;
        if (attempt < maxRetries) {
          await delay(retryDelayMs * Math.pow(2, attempt));
          continue;
        }
      }

      logger.info(`API Call node: ${config.method} ${url} -> ${response.status}`);
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.warn(`API Call node: attempt ${attempt + 1} failed`, {
        url,
        error: lastError.message,
      });

      if (attempt < maxRetries) {
        await delay(retryDelayMs * Math.pow(2, attempt));
      }
    }
  }

  // All retries exhausted
  context[outputVar] = {
    status: 0,
    error: lastError?.message || 'Request failed after retries',
  };
  logger.error(`API Call node: all ${maxRetries + 1} attempts failed for ${url}`);
}

/**
 * Applies authentication headers based on auth type.
 */
function applyAuth(
  headers: Record<string, string>,
  authType: string,
  authConfig: Record<string, string>,
  context: Record<string, unknown>
): void {
  switch (authType) {
    case 'api_key': {
      const headerName = authConfig.headerName || 'X-API-Key';
      const apiKey = interpolate(authConfig.apiKey || '', context);
      headers[headerName] = apiKey;
      break;
    }
    case 'bearer': {
      const token = interpolate(authConfig.token || '', context);
      headers['Authorization'] = `Bearer ${token}`;
      break;
    }
    case 'hmac': {
      // HMAC auth is handled by the caller providing the signature
      const signature = interpolate(authConfig.signature || '', context);
      const headerName = authConfig.headerName || 'X-Webhook-Signature';
      headers[headerName] = signature;
      break;
    }
  }
}

/**
 * Resolves a nested path from an object.
 */
function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/** Simple delay helper. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
