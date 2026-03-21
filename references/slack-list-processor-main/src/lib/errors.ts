/**
 * Base application error with a machine-readable code and HTTP status code.
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code: string, statusCode: number) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype); // Restore prototype chain
  }
}

/**
 * Thrown when user input or file content fails validation rules.
 */
export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
  }
}

/**
 * Thrown when an external API call fails (BuiltWith, Apollo, etc.).
 */
export class ApiError extends AppError {
  public readonly serviceName: string;

  constructor(message: string, serviceName: string, statusCode: number) {
    super(message, 'API_ERROR', statusCode);
    this.serviceName = serviceName;
  }
}

/**
 * Thrown when uploaded file parsing (CSV/XLSX) encounters an unrecoverable issue.
 */
export class FileParsingError extends AppError {
  constructor(message: string) {
    super(message, 'FILE_PARSING_ERROR', 400);
  }
}

/**
 * Thrown when delivering a message or file back to Slack fails.
 */
export class SlackDeliveryError extends AppError {
  constructor(message: string) {
    super(message, 'SLACK_DELIVERY_ERROR', 502);
  }
}
