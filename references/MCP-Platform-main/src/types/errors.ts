/**
 * Custom error types for BuildWith MCP Server
 */

export enum ErrorCategory {
  RATE_LIMIT = 'RATE_LIMIT',
  AUTHENTICATION = 'AUTH',
  VALIDATION = 'VALIDATION',
  SERVER_ERROR = 'SERVER',
  NETWORK = 'NETWORK',
  CLIENT = 'CLIENT',
  TIMEOUT = 'TIMEOUT',
  MAX_RETRIES = 'MAX_RETRIES',
}

export class BuildWithError extends Error {
  public readonly category: ErrorCategory;
  public readonly isRetryable: boolean;
  public readonly statusCode?: number;

  constructor(
    message: string,
    category: ErrorCategory,
    isRetryable: boolean = false,
    statusCode?: number
  ) {
    super(message);
    this.name = 'BuildWithError';
    this.category = category;
    this.isRetryable = isRetryable;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, BuildWithError.prototype);
  }
}

export class RateLimitError extends BuildWithError {
  constructor(message: string = 'Rate limit exceeded') {
    super(message, ErrorCategory.RATE_LIMIT, true, 429);
    this.name = 'RateLimitError';
  }
}

export class AuthenticationError extends BuildWithError {
  constructor(message: string = 'Authentication failed') {
    super(message, ErrorCategory.AUTHENTICATION, false, 401);
    this.name = 'AuthenticationError';
  }
}

export class ValidationError extends BuildWithError {
  constructor(message: string) {
    super(message, ErrorCategory.VALIDATION, false, 400);
    this.name = 'ValidationError';
  }
}

export class ServerError extends BuildWithError {
  constructor(message: string, statusCode?: number) {
    super(message, ErrorCategory.SERVER_ERROR, true, statusCode);
    this.name = 'ServerError';
  }
}

export class NetworkError extends BuildWithError {
  constructor(message: string) {
    super(message, ErrorCategory.NETWORK, true);
    this.name = 'NetworkError';
  }
}

export class TimeoutError extends BuildWithError {
  constructor(message: string = 'Request timeout') {
    super(message, ErrorCategory.TIMEOUT, true);
    this.name = 'TimeoutError';
  }
}

export class MaxRetriesError extends BuildWithError {
  public readonly lastError: Error;

  constructor(message: string, lastError: Error) {
    super(message, ErrorCategory.MAX_RETRIES, false);
    this.name = 'MaxRetriesError';
    this.lastError = lastError;
  }
}
