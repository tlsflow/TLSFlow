import { AppError } from '../../../common/errors/app-error.js';

export type PrivateWebhookPlatform = 'wecom' | 'feishu' | 'dingtalk';

export interface PlatformWebhookEndpoint {
  trustedPrivateOrigins: string[];
  isPrivateDeployment: boolean;
}

export function validatePlatformWebhookEndpoint(
  platform: PrivateWebhookPlatform,
  rawUrl: string,
  configuredOrigins: readonly string[] = [],
): PlatformWebhookEndpoint {
  const url = parseHttpsUrl(rawUrl, platform);
  if (isOfficialPublicEndpoint(platform, url)) {
    return { trustedPrivateOrigins: [], isPrivateDeployment: false };
  }
  const trustedPrivateOrigins = normalizePrivateOrigins(configuredOrigins);
  if (!trustedPrivateOrigins.includes(url.origin)) {
    throw invalidEndpoint(platform, 'Webhook URL 不属于此渠道配置的私有化 Origin');
  }
  return { trustedPrivateOrigins, isPrivateDeployment: true };
}

export function validatePrivateOrigins(origins: readonly string[]): string[] {
  return normalizePrivateOrigins(origins);
}

function parseHttpsUrl(rawUrl: string, platform: PrivateWebhookPlatform): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw invalidEndpoint(platform, 'Webhook URL 无效');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw invalidEndpoint(platform, 'Webhook URL 必须使用 HTTPS 且不能包含用户信息');
  }
  return url;
}

function isOfficialPublicEndpoint(platform: PrivateWebhookPlatform, url: URL): boolean {
  if (platform === 'wecom') return url.hostname === 'qyapi.weixin.qq.com' && url.pathname === '/cgi-bin/webhook/send';
  if (platform === 'feishu') {
    return (url.hostname === 'open.feishu.cn' || url.hostname === 'open.larksuite.com')
      && url.pathname.startsWith('/open-apis/bot/v2/hook/');
  }
  return url.hostname === 'oapi.dingtalk.com' && url.pathname === '/robot/send';
}

function normalizePrivateOrigins(origins: readonly string[]): string[] {
  return [...new Set(origins.map((item) => item.trim()).filter(Boolean).map((item) => {
    let url: URL;
    try {
      url = new URL(item);
    } catch {
      throw new AppError('NOTIFICATION_CHANNEL_INVALID', '通知私有化 Origin 格式无效');
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new AppError('NOTIFICATION_CHANNEL_INVALID', '通知私有化 Origin 必须是精确 HTTPS Origin');
    }
    return url.origin;
  }))];
}

function invalidEndpoint(platform: PrivateWebhookPlatform, message: string): AppError {
  return new AppError('NOTIFICATION_CHANNEL_INVALID', `${platform} ${message}`);
}
