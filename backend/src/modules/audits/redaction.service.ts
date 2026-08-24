import { sha256Fingerprint } from '../../common/crypto/fingerprint.js';
import { securityErrors } from '../../shared/security-error.js';

export interface RedactionMatch {
  rule: string;
  fingerprint?: string;
}

export interface RedactionResult<T> {
  value: T;
  matches: RedactionMatch[];
}

const sensitiveFieldNames = new Set([
  'password',
  'passwd',
  'token',
  'access_token',
  'refresh_token',
  'authorization',
  'secret',
  'private_key',
  'privateKey',
  'privateKeyPem',
  'private_key_pem',
  'pfx_password',
  'pfxPassword',
  'pfxBase64',
  'pkcs12Base64',
  'clientSecret',
  'ssh_key',
  'sshKey',
  'api_key',
  'apiKey',
  'cookie',
]);

export class RedactionService {
  private readonly registeredSecrets = new Map<string, string>();

  registerSensitiveValue(value: string, type = 'registered'): void {
    if (!value) {
      return;
    }
    this.registeredSecrets.set(value, type);
  }

  redact<T>(input: T): RedactionResult<T> {
    try {
      const matches: RedactionMatch[] = [];
      const value = this.redactValue(input, matches) as T;
      return { value, matches };
    } catch (error) {
      throw securityErrors.redactionFailed({ cause: error instanceof Error ? error.message : String(error) });
    }
  }

  private redactValue(value: unknown, matches: RedactionMatch[]): unknown {
    if (typeof value === 'string') {
      return this.redactText(value, matches);
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.redactValue(item, matches));
    }

    if (value && typeof value === 'object') {
      const output: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        if (this.isSensitiveField(key)) {
          const text = typeof item === 'string' ? item : JSON.stringify(item);
          const fingerprint = sha256Fingerprint(text ?? '');
          matches.push({ rule: `field:${key}`, fingerprint });
          output[key] = `[REDACTED:${key}:${fingerprint}]`;
        } else {
          output[key] = this.redactValue(item, matches);
        }
      }
      return output;
    }

    return value;
  }

  redactText(text: string, matches: RedactionMatch[]): string {
    let output = text;

    output = output.replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, (matched) => {
      const fingerprint = sha256Fingerprint(matched);
      matches.push({ rule: 'pem-private-key', fingerprint });
      return `[REDACTED:private_key:${fingerprint}]`;
    });

    output = output.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, (matched) => {
      const fingerprint = sha256Fingerprint(matched);
      matches.push({ rule: 'authorization:bearer', fingerprint });
      return `Bearer [REDACTED:token:${fingerprint}]`;
    });

    output = output.replace(/\bBasic\s+[A-Za-z0-9+/=]{8,}/gi, (matched) => {
      const fingerprint = sha256Fingerprint(matched);
      matches.push({ rule: 'authorization:basic', fingerprint });
      return `Basic [REDACTED:basic:${fingerprint}]`;
    });

    output = output.replace(/("?(?:password|passwd|token|access_token|refresh_token|authorization|secret|private_key|pfx_password|ssh_key|api_key)"?\s*[:=]\s*")([^"\n]+)(")/gi, (_all, prefix: string, secret: string, suffix: string) => {
      const fingerprint = sha256Fingerprint(secret);
      matches.push({ rule: 'text-sensitive-field', fingerprint });
      return `${prefix}[REDACTED:field:${fingerprint}]${suffix}`;
    });

    for (const [secretValue, type] of this.registeredSecrets.entries()) {
      if (!secretValue || !output.includes(secretValue)) {
        continue;
      }
      const fingerprint = sha256Fingerprint(secretValue);
      matches.push({ rule: `registered:${type}`, fingerprint });
      output = output.split(secretValue).join(`[REDACTED:${type}:${fingerprint}]`);
    }

    return output;
  }

  private isSensitiveField(key: string): boolean {
    return sensitiveFieldNames.has(key) || sensitiveFieldNames.has(key.toLowerCase());
  }
}
