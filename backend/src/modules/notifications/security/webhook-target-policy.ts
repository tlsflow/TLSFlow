import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { AppError } from '../../../common/errors/app-error.js';

const blockedHostnames = new Set(['localhost', 'localhost.localdomain', 'metadata.google.internal']);

export class WebhookTargetPolicy {
  async validateUrl(rawUrl: string): Promise<{ url: URL; addresses: string[] }> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw blocked('Webhook URL 无效');
    }
    if (!['http:', 'https:'].includes(url.protocol)) throw blocked('Webhook 仅允许 HTTP 或 HTTPS');
    if (url.username || url.password) throw blocked('Webhook URL 不允许包含用户信息');
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    if (blockedHostnames.has(hostname) || hostname.endsWith('.localhost')) throw blocked('Webhook 目标主机被安全策略阻止');
    const addresses = isIP(hostname)
      ? [hostname]
      : (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
    if (!addresses.length || addresses.some(isBlockedAddress)) throw blocked('Webhook 目标地址被安全策略阻止');
    return { url, addresses };
  }

  assertResolvedAddress(address: string, expected: string[]): void {
    if (isBlockedAddress(address) || !expected.includes(address)) throw blocked('Webhook DNS 解析结果发生不安全变化');
  }

  assertRedirect(from: URL, to: URL): void {
    if (from.hostname.toLowerCase() !== to.hostname.toLowerCase()) throw blocked('Webhook 不允许跨主机重定向');
  }
}

export function isBlockedAddress(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0]!;
  if (normalized === '::' || normalized === '::1' || normalized === '0.0.0.0') return true;
  if (normalized.startsWith('::ffff:')) return isBlockedAddress(normalized.slice(7));
  if (normalized.includes(':')) {
    return normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8')
      || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')
      || normalized.startsWith('ff') || normalized.startsWith('2001:db8');
  }
  const octets = normalized.split('.').map(Number);
  if (octets.length !== 4 || octets.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) return true;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || a! >= 224
    || (a === 100 && b! >= 64 && b! <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b! >= 16 && b! <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51)
    || (a === 203 && b === 0);
}

function blocked(message: string): AppError {
  return new AppError('NOTIFICATION_SECURITY_BLOCKED', message);
}
