import { AppError } from '../../common/errors/app-error.js';
import { isSemVer } from '../../common/version.js';
import type { OutboundHttpClient } from '../../common/http/outbound-http-client.js';
import { NodeOutboundHttpClient } from '../../common/http/outbound-http-client.js';
import type {
  ReleaseChannel,
  ReleaseImageReferences,
  ReleaseManifest,
  UpdateChannel,
} from './system-update.types.js';

/** TLSFlow 官方 GitHub Releases API；生产代码固定使用该地址，不读取外部环境变量。 */
export const TLSFLOW_RELEASES_API_URL = 'https://api.github.com/repos/tlsflow/TLSFlow/releases';

const allowedRepositories = new Set([
  'tlsflow/tlsflow-backend',
  'tlsflow/tlsflow-web',
  'tlsflow/tlsflow-browser-runtime',
]);

export interface ReleaseManifestClient {
  getManifest(): Promise<ReleaseManifest>;
}

/**
 * 从 TLSFlow GitHub Releases API 读取并转换版本清单。
 *
 * GitHub Releases 页面是 HTML，不能作为 JSON 清单直接读取；这里使用同一仓库
 * 的官方 API，并依据 draft/prerelease 字段映射 stable/dev 通道。
 */
export class GitHubReleaseManifestClient implements ReleaseManifestClient {
  constructor(private readonly http: OutboundHttpClient = new NodeOutboundHttpClient()) {}

  async getManifest(): Promise<ReleaseManifest> {
    try {
      const response = await this.http.request({
        url: TLSFLOW_RELEASES_API_URL,
        method: 'GET',
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'GCAC-system-update-check',
          'x-github-api-version': '2022-11-28',
        },
        timeoutMs: 5_000,
        maxResponseBytes: 1_048_576,
      });
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`HTTP ${response.statusCode}`);
      }
      return parseGitHubReleases(response.body);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('RELEASE_MANIFEST_UNAVAILABLE', '无法读取 GitHub Releases 版本信息', {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** 保留旧导出名，避免外部测试或扩展在本次地址切换中无意义破坏。 */
export const GithubReleaseManifestClient = GitHubReleaseManifestClient;
export const ConfiguredReleaseManifestClient = GitHubReleaseManifestClient;

export class StaticReleaseManifestClient implements ReleaseManifestClient {
  constructor(private readonly manifest: unknown) {}

  async getManifest(): Promise<ReleaseManifest> {
    return parseReleaseManifest(this.manifest);
  }
}

/**
 * 将 GitHub Releases API 数组映射为内部 stable/dev 清单。
 *
 * API 默认按发布时间倒序返回，因此通道选择取第一个符合条件的非 draft
 * release。stable 排除 prerelease，dev 包含 prerelease。选中的 release 若
 * 标签或发布时间非法则整体失败关闭，避免错误地显示“无更新”。
 */
export function parseGitHubReleases(input: unknown): ReleaseManifest {
  if (!Array.isArray(input)) {
    throw new AppError('RELEASE_MANIFEST_INVALID', 'GitHub Releases API 返回值必须是数组');
  }
  const releases = input.map((release, index) => {
    if (!isRecord(release)) {
      throw new AppError('RELEASE_MANIFEST_INVALID', `GitHub Releases 第 ${index + 1} 项无效`);
    }
    return release;
  });
  const stableRelease = releases.find((release) => release.draft !== true && release.prerelease !== true);
  const devRelease = releases.find((release) => release.draft !== true);
  if (!stableRelease) {
    throw new AppError('RELEASE_MANIFEST_INVALID', 'GitHub Releases 没有可用稳定版');
  }
  if (!devRelease) {
    throw new AppError('RELEASE_MANIFEST_INVALID', 'GitHub Releases 没有可用开发版');
  }
  return {
    schemaVersion: 1,
    product: 'GCAC',
    channels: {
      stable: parseGitHubReleaseChannel(stableRelease, 'stable'),
      dev: parseGitHubReleaseChannel(devRelease, 'dev'),
    },
  };
}

export function parseReleaseManifest(input: unknown): ReleaseManifest {
  if (!isRecord(input) || input.schemaVersion !== 1 || input.product !== 'GCAC' || !isRecord(input.channels)) {
    throw new AppError('RELEASE_MANIFEST_INVALID', '版本清单基础字段无效');
  }
  const channels = {
    stable: parseReleaseChannel(input.channels.stable, 'stable'),
    dev: parseReleaseChannel(input.channels.dev, 'dev'),
  };
  return { schemaVersion: 1, product: 'GCAC', channels };
}

function parseReleaseChannel(input: unknown, channel: UpdateChannel): ReleaseChannel {
  if (!isRecord(input)) throw new AppError('RELEASE_MANIFEST_INVALID', `版本清单缺少 ${channel} 通道`);
  const version = stringValue(input.version);
  const publishedAt = stringValue(input.publishedAt);
  const releaseNotes = stringValue(input.releaseNotes);
  if (!isSemVer(version) || version === 'latest') {
    throw new AppError('RELEASE_MANIFEST_INVALID', `${channel} 通道版本不是合法 SemVer`);
  }
  if (!publishedAt || Number.isNaN(Date.parse(publishedAt))) {
    throw new AppError('RELEASE_MANIFEST_INVALID', `${channel} 通道发布时间无效`);
  }
  if (!isRecord(input.images)) throw new AppError('RELEASE_MANIFEST_INVALID', `${channel} 通道缺少镜像引用`);
  const images: ReleaseImageReferences = {
    backend: parseImage(input.images.backend, 'backend'),
    web: parseImage(input.images.web, 'web'),
    ...(input.images.browserRuntime === undefined
      ? {}
      : { browserRuntime: parseImage(input.images.browserRuntime, 'browserRuntime') }),
  };
  for (const [name, image] of Object.entries(images)) {
    if (imageTag(image) !== version) {
      throw new AppError('RELEASE_MANIFEST_INVALID', `${channel} 通道 ${name} 镜像标签必须与版本一致`);
    }
  }
  return { version, publishedAt, releaseNotes, images };
}

function parseGitHubReleaseChannel(input: Record<string, unknown>, channel: UpdateChannel): ReleaseChannel {
  const tagName = stringValue(input.tag_name);
  const version = normalizeReleaseTag(tagName);
  const publishedAt = stringValue(input.published_at);
  const releaseNotes = typeof input.body === 'string' ? input.body.trim() : '';
  return parseReleaseChannel({
    version,
    publishedAt,
    releaseNotes,
    images: {
      backend: `tlsflow/tlsflow-backend:${version}`,
      web: `tlsflow/tlsflow-web:${version}`,
      browserRuntime: `tlsflow/tlsflow-browser-runtime:${version}`,
    },
  }, channel);
}

function normalizeReleaseTag(tagName: string): string {
  return /^v(?=\d)/.test(tagName) ? tagName.slice(1) : tagName;
}

function parseImage(input: unknown, name: string): string {
  const value = stringValue(input);
  const match = /^([^:]+):([A-Za-z0-9_][A-Za-z0-9_.-]{0,127})$/.exec(value);
  if (!match || !allowedRepositories.has(match[1]) || match[2] === 'latest') {
    throw new AppError('RELEASE_MANIFEST_INVALID', `${name} 镜像引用无效`);
  }
  return value;
}

function imageTag(image: string): string {
  return image.slice(image.lastIndexOf(':') + 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
