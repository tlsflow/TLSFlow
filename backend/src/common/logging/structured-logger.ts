import { getRequestContext } from '../tracing/request-context.js';
import { redactSensitive } from './redact.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEvent {
  timestamp: string;
  level: LogLevel;
  requestId?: string;
  traceId?: string;
  tenantId?: string;
  actorId?: string;
  module?: string;
  resourceType?: string;
  resourceId?: string;
  message: string;
  details?: unknown;
}

export class StructuredLogger {
  constructor(private readonly sink: (event: LogEvent) => void = (event) => console.log(JSON.stringify(event))) {}

  debug(message: string, details?: unknown, fields?: Partial<LogEvent>): void {
    this.write('debug', message, details, fields);
  }

  info(message: string, details?: unknown, fields?: Partial<LogEvent>): void {
    this.write('info', message, details, fields);
  }

  warn(message: string, details?: unknown, fields?: Partial<LogEvent>): void {
    this.write('warn', message, details, fields);
  }

  error(message: string, details?: unknown, fields?: Partial<LogEvent>): void {
    this.write('error', message, details, fields);
  }

  private write(level: LogLevel, message: string, details?: unknown, fields?: Partial<LogEvent>): void {
    const context = getRequestContext();
    this.sink({
      timestamp: new Date().toISOString(),
      level,
      requestId: context?.requestId,
      traceId: context?.traceId,
      tenantId: context?.tenantId,
      actorId: context?.actorId,
      ...fields,
      message,
      details: redactSensitive(details),
    });
  }
}

export const structuredLogger = new StructuredLogger();
