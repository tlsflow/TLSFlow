import { AppError } from './app-error.js';
import type { ErrorResponse } from '../../shared/dto/error-response.js';
import { redactSensitive } from '../logging/redact.js';
import { structuredLogger } from '../logging/structured-logger.js';
import { getRequestContext } from '../tracing/request-context.js';
import { SecurityError } from '../../shared/security-error.js';

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

  if (error instanceof SecurityError) {
    return {
      statusCode: error.httpStatus,
      body: {
        errorCode: error.errorCode,
        message: error.message,
        details: redactSensitive(error.details),
        requestId,
        traceId,
        timestamp,
      },
    };
  }

  structuredLogger.error(
    '未处理异常，已降级为 SYSTEM_INTERNAL_ERROR',
    {
      errorName: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      cause: error instanceof Error && 'cause' in error
        ? redactSensitive((error as Error & { cause?: unknown }).cause)
        : undefined,
    },
    { module: 'error-handler' },
  );

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
