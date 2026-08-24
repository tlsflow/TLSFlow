const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /(password\s*=\s*)[^\s;&|]+/gi,
  /(token\s*=\s*)[^\s;&|]+/gi,
  /(api[_-]?key\s*=\s*)[^\s;&|]+/gi,
  /bearer\s+[a-z0-9._-]{10,}/gi,
];

export function redactSshText(value: string, sensitiveValues: string[] = []): string {
  let redacted = value;
  for (const secret of sensitiveValues) {
    if (!secret) continue;
    redacted = redacted.split(secret).join('[REDACTED]');
  }
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, (matched, prefix: string | undefined) => prefix ? `${prefix}[REDACTED]` : '[REDACTED]');
  }
  return redacted;
}

export function assertNoInlineSshSecret(value: unknown): void {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return;
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|password\s*=|token\s*=|api[_-]?key\s*=|bearer\s+[a-z0-9._-]{10,}/i.test(text)) {
    throw new Error('SSH 请求包含疑似明文敏感信息');
  }
}
