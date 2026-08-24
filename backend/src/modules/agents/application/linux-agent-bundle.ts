import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { AppError } from '../../../common/errors/app-error.js';

export const LINUX_AGENT_RELEASE_VERSION = '0.1.14' as const;
export const AGENT_RELEASE_SIGNING_KEY_ID = 'gcac-agent-release-v1' as const;

export interface LinuxAgentArtifactReference {
  platform: 'linux_go';
  arch: 'amd64' | 'arm64';
  artifactRef: string;
  version: string;
  digest: string;
  signature: string;
  signatureAlgorithm: 'Ed25519';
  signingKeyId: string;
}

export interface LinuxBundleFile {
  path: string;
  content: Buffer;
  mode: number;
}

export interface LinuxBundleManifestItem {
  path: string;
  mode: string;
  size: number;
  sha256: string;
}

/** 当前一键 Linux 安装入口的 bundle 固定面向主流 x86_64 主机。 */
export const LINUX_AGENT_BUNDLE_ARCH = 'amd64' as const;

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const sourceDir = resolve(rootDir, 'agents/linux-go-full-agent');

// 安装接口只暴露发布系统登记的不可变引用，不读取产物文件，也不生成压缩包或执行入口。
const pinnedLinuxArtifacts: Readonly<Record<'amd64' | 'arm64', LinuxAgentArtifactReference>> = Object.freeze({
  amd64: Object.freeze({
    platform: 'linux_go',
    arch: 'amd64',
    artifactRef: 'artifact://gcac/agents/linux-go-full-agent/0.1.13/linux-amd64/gcac-linux-agent',
    version: LINUX_AGENT_RELEASE_VERSION,
    digest: 'ecbef35328a168fa93a66685724cff966d0cd3b40d6714793951dc9d1f74d8cc',
    signature: 'artifact://gcac/signatures/agents/linux-go-full-agent/0.1.13/linux-amd64.sig',
    signatureAlgorithm: 'Ed25519',
    signingKeyId: AGENT_RELEASE_SIGNING_KEY_ID,
  }),
  arm64: Object.freeze({
    platform: 'linux_go',
    arch: 'arm64',
    artifactRef: 'artifact://gcac/agents/linux-go-full-agent/0.1.13/linux-arm64/gcac-linux-agent',
    version: LINUX_AGENT_RELEASE_VERSION,
    digest: 'fcf0470e540c4b393c76360d4ea067c5932f67e3e2eaeb8142774d4ec2a59b06',
    signature: 'artifact://gcac/signatures/agents/linux-go-full-agent/0.1.13/linux-arm64.sig',
    signatureAlgorithm: 'Ed25519',
    signingKeyId: AGENT_RELEASE_SIGNING_KEY_ID,
  }),
});

export function getLinuxAgentInstallMaterials(arch = releaseArchitecture()): LinuxAgentArtifactReference[] {
  const artifact = pinnedLinuxArtifacts[arch];
  if (!artifact) {
    throw new AppError('VALIDATION_FAILED', '当前运行架构没有固定版本的 Linux Agent Artifact 引用', { arch });
  }
  return [structuredClone(artifact)];
}

export function getLinuxAgentBundleFiles(): LinuxBundleFile[] {
  const binary = loadFile('gcac-linux-agent', 0o755);
  assertLinuxAmd64Elf(binary.content);
  return [
    binary,
    loadFile('linux/upgrade.sh', 0o755),
    loadFile('linux/rollback.sh', 0o755),
    loadFile('release/verify-signature.sh', 0o755),
    loadFile('service-control.sh', 0o755),
    loadFile('config/agent.config.template.json', 0o644),
    loadFile('linux/gcac-linux-agent.service', 0o644),
    loadFile('linux/install-systemd.sh', 0o755),
    loadFile('linux/uninstall-systemd.sh', 0o755),
    loadFile('README.md', 0o644),
  ];
}

export function getLinuxAgentBundleManifest(version = LINUX_AGENT_RELEASE_VERSION) {
  return {
    bundleName: 'gcac-linux-agent-bundle.tar.gz',
    version,
    generatedAt: new Date().toISOString(),
    items: getLinuxAgentBundleFiles().map((file) => ({
      path: file.path,
      mode: `0${file.mode.toString(8)}`,
      size: file.content.length,
      sha256: sha256(file.content),
    }) satisfies LinuxBundleManifestItem),
  };
}

export function buildLinuxAgentBundleTarGz(): Buffer {
  const parts: Buffer[] = [];
  for (const file of getLinuxAgentBundleFiles()) {
    parts.push(buildTarHeader(file));
    parts.push(file.content);
    const remainder = file.content.length % 512;
    if (remainder !== 0) parts.push(Buffer.alloc(512 - remainder));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts), { level: 9 });
}

export function getLinuxAgentBinarySha256(): string {
  const binary = loadFile('gcac-linux-agent', 0o755);
  assertLinuxAmd64Elf(binary.content);
  return sha256(binary.content);
}

/**
 * bundle 在控制面生成时就拒绝错误平台产物，避免把 macOS/Windows 文件复制到 Linux 主机。
 * ELF e_machine=62 表示 x86_64；安装入口当前没有按架构分发，因此不能接受 arm64。
 */
export function assertLinuxAmd64Elf(content: Buffer): void {
  if (content.length < 20 || content.subarray(0, 4).toString('hex') !== '7f454c46' || content[4] !== 2 || content[5] !== 1) {
    throw new AppError('RESOURCE_VERSION_CONFLICT', 'Linux Agent bundle 必须是 little-endian ELF64 可执行文件', {
      expected: 'linux/amd64 ELF64',
    });
  }
  const machine = content.readUInt16LE(18);
  if (machine !== 0x3e) {
    throw new AppError('RESOURCE_VERSION_CONFLICT', 'Linux Agent bundle 架构不匹配', {
      expected: 'linux/amd64',
      machine,
    });
  }
}

function releaseArchitecture(): 'amd64' | 'arm64' {
  if (process.arch === 'x64') return 'amd64';
  if (process.arch === 'arm64') return 'arm64';
  throw new AppError('VALIDATION_FAILED', '当前 Node 运行架构没有 Agent Release 映射', { nodeArch: process.arch });
}

function loadFile(relativePath: string, mode: number): LinuxBundleFile {
  const fullPath = resolve(sourceDir, relativePath);
  try {
    return {
      path: relativePath.replace(/\\/gu, '/'),
      content: readFileSync(fullPath),
      mode,
    };
  } catch (error) {
    throw new AppError('RESOURCE_NOT_FOUND', 'Linux Agent bundle 文件不存在', {
      relativePath,
      fullPath,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

function buildTarHeader(file: LinuxBundleFile): Buffer {
  const header = Buffer.alloc(512, 0);
  writeString(header, 0, 100, file.path);
  writeOctal(header, 100, 8, file.mode);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, file.content.length);
  writeOctal(header, 136, 12, Math.floor(Date.now() / 1000));
  header.fill(0x20, 148, 156);
  header[156] = '0'.charCodeAt(0);
  writeString(header, 257, 6, 'ustar');
  writeString(header, 263, 2, '00');
  writeString(header, 265, 32, 'root');
  writeString(header, 297, 32, 'root');
  const checksum = header.reduce((sum, value) => sum + value, 0);
  writeOctal(header, 148, 8, checksum);
  return header;
}

function writeString(buffer: Buffer, offset: number, length: number, value: string): void {
  const bytes = Buffer.from(value, 'utf8');
  bytes.copy(buffer, offset, 0, Math.min(bytes.length, length));
}

function writeOctal(buffer: Buffer, offset: number, length: number, value: number): void {
  const text = value.toString(8).padStart(length - 1, '0');
  writeString(buffer, offset, length - 1, text);
  buffer[offset + length - 1] = 0;
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
