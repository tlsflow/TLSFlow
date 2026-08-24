import { RedactionService } from '../../modules/audits/redaction.service.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface SafeLogEntry {
  level: LogLevel;
  message: string;
  meta?: unknown;
  createdAt: string;
}

export class SafeLogger {
  private readonly entries: SafeLogEntry[] = [];

  constructor(private readonly redaction = new RedactionService()) {}

  log(level: LogLevel, message: string, meta?: unknown): SafeLogEntry {
    const redactedMessage = this.redaction.redact(message).value;
    const redactedMeta = meta === undefined ? undefined : this.redaction.redact(meta).value;
    const entry = { level, message: redactedMessage, meta: redactedMeta, createdAt: new Date().toISOString() };
    this.entries.push(entry);
    return entry;
  }

  list(): SafeLogEntry[] {
    return structuredClone(this.entries);
  }
}
