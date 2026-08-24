const sensitiveKeyPattern = /(password|secret|token|privateKey|cookie|authorization|credential|pfxPassword|jksPassword|sshPrivateKey)/i;
const sensitiveTextPattern = /(-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._~+\/-]+=*)/gi;

export const REDACTED_VALUE = '[REDACTED]';

export function redactSensitive(input: unknown): unknown {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') return input.replace(sensitiveTextPattern, REDACTED_VALUE);
  if (typeof input !== 'object') return input;
  if (Array.isArray(input)) return input.map((item) => redactSensitive(item));

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    output[key] = sensitiveKeyPattern.test(key) ? REDACTED_VALUE : redactSensitive(value);
  }
  return output;
}
