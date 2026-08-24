import { RedactionService } from '../../audits/redaction.service.js';

const redaction = new RedactionService();

export function sanitizeExecutionErrorDetails(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  return redaction.redact(structuredClone(value)).value;
}
