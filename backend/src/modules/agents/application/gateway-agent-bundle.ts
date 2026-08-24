import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { AppError } from '../../../common/errors/app-error.js';
import type { LinuxBundleFile } from './linux-agent-bundle.js';

/**
 * 独立 Gateway Agent（agents/go-gateway-agent）的固定版本安装引用与 Linux bundle。
 * Gateway Agent 与 Full Agent 完全独立：独立二进制、独立配置、独立端口与安装路径。
 */

export const GATEWAY_AGENT_RELEASE_VERSION = '0.1.0' as const;
export const GATEWAY_AGENT_RELEASE_SIGNING_KEY_ID = 'gcac-agent-release-v1' as const;

export interface GatewayAgentArtifactReference {
  platform: 'linux_go' | 'windows_go';
  arch: 'amd64' | 'arm64';
  artifactRef: string;
  version: string;
  digest: string;
  signature: string;
  signatureAlgorithm: 'Ed25519';
  signingKeyId: string;
}

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const sourceDir = resolve(rootDir, 'agents/go-gateway-agent');
const distDir = resolve(sourceDir, 'dist');

const pinnedGatewayArtifacts: Readonly<Record<'linux_go' | 'windows_go', Readonly<Record<'amd64' | 'arm64', GatewayAgentArtifactReference>>>> = Object.freeze({
  linux_go: Object.freeze({
    amd64: Object.freeze({
      platform: 'linux_go',
      arch: 'amd64',
      artifactRef: 'artifact://gcac/agents/go-gateway-agent/0.1.0/linux-amd64/gcac-gateway-agent',
      version: GATEWAY_AGENT_RELEASE_VERSION,
      digest: '7680c625404ecc4da0dc0d76e93169f8bbd7bf0bef459365256152dfd2792462',
      signature: 'artifact://gcac/signatures/agents/go-gateway-agent/0.1.0/linux-amd64.sig',
      signatureAlgorithm: 'Ed25519',
      signingKeyId: GATEWAY_AGENT_RELEASE_SIGNING_KEY_ID,
    }),
    arm64: Object.freeze({
      platform: 'linux_go',
      arch: 'arm64',
      artifactRef: 'artifact://gcac/agents/go-gateway-agent/0.1.0/linux-arm64/gcac-gateway-agent',
      version: GATEWAY_AGENT_RELEASE_VERSION,
      digest: '796f316eec1aff5d8eae6ebee2f4e3e77e257360489468b0d156f905426cfdda',
      signature: 'artifact://gcac/signatures/agents/go-gateway-agent/0.1.0/linux-arm64.sig',
      signatureAlgorithm: 'Ed25519',
      signingKeyId: GATEWAY_AGENT_RELEASE_SIGNING_KEY_ID,
    }),
  }),
  windows_go: Object.freeze({
    amd64: Object.freeze({
      platform: 'windows_go',
      arch: 'amd64',
      artifactRef: 'artifact://gcac/agents/go-gateway-agent/0.1.0/windows-amd64/gcac-gateway-agent.exe',
      version: GATEWAY_AGENT_RELEASE_VERSION,
      digest: '5307d8c34655698e76d4dbd17e8cbf8c3a39c815f7341300704e4eef2dfa58db',
      signature: 'artifact://gcac/signatures/agents/go-gateway-agent/0.1.0/windows-amd64.sig',
      signatureAlgorithm: 'Ed25519',
      signingKeyId: GATEWAY_AGENT_RELEASE_SIGNING_KEY_ID,
    }),
    arm64: Object.freeze({
      platform: 'windows_go',
      arch: 'arm64',
      artifactRef: 'artifact://gcac/agents/go-gateway-agent/0.1.0/windows-arm64/gcac-gateway-agent.exe',
      version: GATEWAY_AGENT_RELEASE_VERSION,
      digest: 'cd8d1d09df6eb5f6d44504a7650ad9e08d6eaf88f2fa0848a945b6cb5b1f8de8',
      signature: 'artifact://gcac/signatures/agents/go-gateway-agent/0.1.0/windows-arm64.sig',
      signatureAlgorithm: 'Ed25519',
      signingKeyId: GATEWAY_AGENT_RELEASE_SIGNING_KEY_ID,
    }),
  }),
});

export function getGatewayAgentInstallMaterials(platform: 'linux_go' | 'windows_go', arch: 'amd64' | 'arm64'): GatewayAgentArtifactReference {
  const artifact = pinnedGatewayArtifacts[platform]?.[arch];
  if (!artifact) {
    throw new AppError('VALIDATION_FAILED', '没有对应平台/架构的固定版本 Gateway Agent Artifact 引用', { platform, arch });
  }
  return structuredClone(artifact);
}

export function getGatewayAgentBundleFiles(): LinuxBundleFile[] {
  return [
    loadGatewayFile('gcac-gateway-agent', 0o755),
    loadGatewayFile('service-control.sh', 0o755),
    loadGatewayFile('config/agent.config.template.json', 0o644),
    loadGatewayFile('linux/gcac-gateway-agent.service', 0o644),
    loadGatewayFile('linux/install-systemd.sh', 0o755),
    loadGatewayFile('linux/uninstall-systemd.sh', 0o755),
    loadGatewayFile('README.md', 0o644),
  ];
}

export function getGatewayAgentBundleManifest(version = GATEWAY_AGENT_RELEASE_VERSION) {
  return {
    bundleName: 'gcac-gateway-agent-bundle.tar.gz',
    version,
    generatedAt: new Date().toISOString(),
    items: getGatewayAgentBundleFiles().map((file) => ({
      path: file.path,
      mode: `0${file.mode.toString(8)}`,
      size: file.content.length,
      sha256: sha256(file.content),
    })),
  };
}

export function buildGatewayAgentBundleTarGz(): Buffer {
  const parts: Buffer[] = [];
  for (const file of getGatewayAgentBundleFiles()) {
    parts.push(buildGatewayTarHeader(file));
    parts.push(file.content);
    const remainder = file.content.length % 512;
    if (remainder !== 0) parts.push(Buffer.alloc(512 - remainder));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts), { level: 9 });
}

export function getGatewayLinuxAgentBinarySha256(): string {
  return sha256(loadGatewayFile('gcac-gateway-agent', 0o755).content);
}

export async function loadGatewayWindowsAgentArtifacts(): Promise<Array<{ path: string; content: string; encoding?: 'utf8' | 'base64' }>> {
  const artifacts: Array<{ path: string; content: string; encoding?: 'utf8' | 'base64' }> = [
    { path: 'gcac-gateway-agent.exe', content: readFileSync(resolve(distDir, 'gcac-gateway-agent.windows-amd64.exe')).toString('base64'), encoding: 'base64' },
    { path: 'config/agent.config.template.json', content: readFileSync(resolve(sourceDir, 'config', 'agent.config.template.json'), 'utf8') },
    { path: 'README.md', content: readFileSync(resolve(sourceDir, 'README.md'), 'utf8') },
  ];
  return artifacts;
}

function loadGatewayFile(relativePath: string, mode: number): LinuxBundleFile {
  const fullPath = resolve(sourceDir, relativePath);
  try {
    return {
      path: relativePath.replace(/\\/gu, '/'),
      content: readFileSync(fullPath),
      mode,
    };
  } catch (error) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Gateway Agent bundle 文件不存在', {
      relativePath,
      fullPath,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

function buildGatewayTarHeader(file: LinuxBundleFile): Buffer {
  const header = Buffer.alloc(512, 0);
  writeGatewayString(header, 0, 100, file.path);
  writeGatewayOctal(header, 100, 8, file.mode);
  writeGatewayOctal(header, 108, 8, 0);
  writeGatewayOctal(header, 116, 8, 0);
  writeGatewayOctal(header, 124, 12, file.content.length);
  writeGatewayOctal(header, 136, 12, Math.floor(Date.now() / 1000));
  header.fill(0x20, 148, 156);
  header[156] = '0'.charCodeAt(0);
  writeGatewayString(header, 257, 6, 'ustar');
  writeGatewayString(header, 263, 2, '00');
  writeGatewayString(header, 265, 32, 'root');
  writeGatewayString(header, 297, 32, 'root');
  const checksum = header.reduce((sum, value) => sum + value, 0);
  writeGatewayOctal(header, 148, 8, checksum);
  return header;
}

function writeGatewayString(buffer: Buffer, offset: number, length: number, value: string): void {
  const bytes = Buffer.from(value, 'utf8');
  bytes.copy(buffer, offset, 0, Math.min(bytes.length, length));
}

function writeGatewayOctal(buffer: Buffer, offset: number, length: number, value: number): void {
  const text = value.toString(8).padStart(length - 1, '0');
  writeGatewayString(buffer, offset, length - 1, text);
  buffer[offset + length - 1] = 0;
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
