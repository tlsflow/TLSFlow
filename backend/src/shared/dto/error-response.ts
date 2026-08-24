export interface ErrorResponse {
  errorCode: string;
  message: string;
  details?: unknown;
  requestId: string;
  traceId?: string;
  timestamp: string;
}
