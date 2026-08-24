import { RedactionService, type RedactionResult } from '../audits/redaction.service.js';

export function redactExecutionOutput(output: string, redaction = new RedactionService()): RedactionResult<string> {
  return redaction.redact(output);
}
