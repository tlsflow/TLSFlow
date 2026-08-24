import type { ErrorCode } from '../../common/errors/error-codes.js';

export interface ErrorResponse {
  errorCode: ErrorCode;
  message: string;
  details?: unknown;
  requestId: string;
  traceId?: string;
  timestamp: string;
}
