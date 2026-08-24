import { AppError } from './app-error.js';
import type { ErrorResponse } from '../../shared/dto/error-response.js';
import { redactSensitive } from '../logging/redact.js';
import { getRequestContext } from '../tracing/request-context.js';

export interface HandledError {
  statusCode: number;
  body: ErrorResponse;
}

export function toErrorResponse(error: unknown, fallbackRequestId = 'req_unknown'): HandledError {
  const context = getRequestContext();
  const requestId = context?.requestId ?? fallbackRequestId;
  const traceId = context?.traceId;
  const timestamp = new Date().toISOString();

  if (error instanceof AppError) {
    return {
      statusCode: error.httpStatus,
      body: {
        errorCode: error.errorCode,
        message: error.message,
        details: error.exposeDetails ? redactSensitive(error.details) : undefined,
        requestId,
        traceId,
        timestamp,
      },
    };
  }

  return {
    statusCode: 500,
    body: {
      errorCode: 'SYSTEM_INTERNAL_ERROR',
      message: '系统内部错误',
      requestId,
      traceId,
      timestamp,
    },
  };
}
