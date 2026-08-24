import { AppError } from '../../../common/errors/app-error.js';

export type PrivateWebhookPlatform = 'wecom' | 'feishu' | 'dingtalk';

const privateOriginEnvironmentKeys: Record<PrivateWebhookPlatform, string> = {
  wecom: 'GCAC_NOTIFICATION_WECOM_PRIVATE_ORIGINS',
  feishu: 'GCAC_NOTIFICATION_FEISHU_PRIVATE_ORIGINS',
  dingtalk: 'GCAC_NOTIFICATION_DINGTALK_PRIVATE_ORIGINS',
};

export interface PlatformWebhookEndpoint {
  trustedPrivateOrigins: string[];
  isPrivateDeployment: boolean;
}

export function validatePlatformWebhookEndpoint(
  platform: PrivateWebhookPlatform,
  rawUrl: string,
  environment: NodeJS.ProcessEnv = process.env,
): PlatformWebhookEndpoint {
  const url = parseHttpsUrl(rawUrl, platform);
  if (isOfficialPublicEndpoint(platform, url)) {
    return { trustedPrivateOrigins: [], isPrivateDeployment: false };
  }
  const trustedPrivateOrigins = parsePrivateOrigins(environment[privateOriginEnvironmentKeys[platform]]);
  if (!trustedPrivateOrigins.includes(url.origin)) {
    throw invalidEndpoint(platform, 'Webhook URL 未被运维私有化 Origin 白名单批准');
  }
  return { trustedPrivateOrigins, isPrivateDeployment: true };
}

export function configuredPrivateOrigins(platform: PrivateWebhookPlatform, environment: NodeJS.ProcessEnv = process.env): string[] {
  return parsePrivateOrigins(environment[privateOriginEnvironmentKeys[platform]]);
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

function parsePrivateOrigins(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean).map((item) => {
    let url: URL;
    try {
      url = new URL(item);
    } catch {
      throw new AppError('NOTIFICATION_CHANNEL_INVALID', '通知私有化 Origin 环境变量格式无效');
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new AppError('NOTIFICATION_CHANNEL_INVALID', '通知私有化 Origin 必须是精确 HTTPS Origin');
    }
    return url.origin;
  });
}

function invalidEndpoint(platform: PrivateWebhookPlatform, message: string): AppError {
  return new AppError('NOTIFICATION_CHANNEL_INVALID', `${platform} ${message}`);
}
