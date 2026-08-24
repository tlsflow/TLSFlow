import { createHash } from 'node:crypto';

export function sha256Fingerprint(value: string | Buffer, prefixLength = 16): string {
  return createHash('sha256').update(value).digest('hex').slice(0, prefixLength);
}
