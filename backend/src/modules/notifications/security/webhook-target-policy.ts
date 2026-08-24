import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { AppError } from '../../../common/errors/app-error.js';

const blockedHostnames = new Set(['localhost', 'localhost.localdomain', 'metadata.google.internal']);

export interface WebhookTargetPolicyOptions {
  trustedPrivateOrigins?: string[];
}

type AddressResolver = (hostname: string) => Promise<string[]>;

export class WebhookTargetPolicy {
  constructor(private readonly resolveAddresses: AddressResolver = resolveHostAddresses) {}

  async validateUrl(rawUrl: string, options: WebhookTargetPolicyOptions = {}): Promise<{ url: URL; addresses: string[]; allowPrivateNetwork: boolean }> {
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
    const trustedPrivateOrigins = normalizeTrustedOrigins(options.trustedPrivateOrigins ?? []);
    const allowPrivateNetwork = trustedPrivateOrigins.has(url.origin);
    const addresses = isIP(hostname)
      ? [hostname]
      : await this.resolveAddresses(hostname);
    if (!addresses.length || addresses.some((address) => isBlockedAddress(address, allowPrivateNetwork))) {
      throw blocked('Webhook 目标地址被安全策略阻止');
    }
    return { url, addresses, allowPrivateNetwork };
  }

  assertResolvedAddress(address: string, expected: string[], allowPrivateNetwork = false): void {
    if (isBlockedAddress(address, allowPrivateNetwork) || !expected.includes(address)) throw blocked('Webhook DNS 解析结果发生不安全变化');
  }

  assertRedirect(from: URL, to: URL): void {
    if (from.origin.toLowerCase() !== to.origin.toLowerCase()) throw blocked('Webhook 不允许跨 Origin 重定向');
  }
}

export function isBlockedAddress(address: string, allowPrivateNetwork = false): boolean {
  const normalized = address.toLowerCase().split('%')[0]!;
  if (normalized === '::' || normalized === '::1' || normalized === '0.0.0.0') return true;
  if (normalized.startsWith('::ffff:')) return isBlockedAddress(normalized.slice(7), allowPrivateNetwork);
  if (normalized.includes(':')) {
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return !allowPrivateNetwork;
    return normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea')
      || normalized.startsWith('feb') || normalized.startsWith('ff') || normalized.startsWith('2001:db8');
  }
  const octets = normalized.split('.').map(Number);
  if (octets.length !== 4 || octets.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) return true;
  const [a, b] = octets;
  const privateAddress = a === 10 || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168);
  if (privateAddress) return !allowPrivateNetwork;
  return a === 0 || a === 127 || a! >= 224
    || (a === 100 && b! >= 64 && b! <= 127)
    || (a === 169 && b === 254)
    || (a === 192 && b === 0)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51)
    || (a === 203 && b === 0);
}

function normalizeTrustedOrigins(values: string[]): Set<string> {
  return new Set(values.map((value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw blocked('受信任私有化 Origin 配置无效');
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw blocked('受信任私有化 Origin 必须是精确 HTTPS Origin');
    }
    return url.origin;
  }));
}

async function resolveHostAddresses(hostname: string): Promise<string[]> {
  return (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
}

function blocked(message: string): AppError {
  return new AppError('NOTIFICATION_SECURITY_BLOCKED', message);
}
