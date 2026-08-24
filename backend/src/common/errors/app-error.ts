import { errorCodes, type ErrorCode } from './error-codes.js';
import { redactSensitive } from '../logging/redact.js';

export class AppError extends Error {
  readonly errorCode: ErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown;
  readonly exposeDetails: boolean;

  constructor(errorCode: ErrorCode, message?: string, details?: unknown, exposeDetails = true) {
    super(message ?? errorCodes[errorCode].message);
    this.name = 'AppError';
    this.errorCode = errorCode;
    this.httpStatus = errorCodes[errorCode].httpStatus;
    this.details = details === undefined ? undefined : redactSensitive(details);
    this.exposeDetails = exposeDetails;
  }
}
