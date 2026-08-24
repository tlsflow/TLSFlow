import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { AppError } from '../../../common/errors/app-error.js';

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

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');

export function getLinuxAgentBundleFiles(): LinuxBundleFile[] {
  const sourceDir = resolveLinuxAgentBundleSource();
  return [
    loadBinaryFile(sourceDir, 'gcac-linux-agent', 0o755, assertLinuxExecutable),
    loadFile(sourceDir, 'build.sh', 0o755),
    loadFile(sourceDir, 'service-control.sh', 0o755),
    loadFile(sourceDir, 'config/agent.config.template.json', 0o644),
    loadFile(sourceDir, 'linux/gcac-linux-agent.service', 0o644),
    loadFile(sourceDir, 'linux/gcac-nginx-helper.sh', 0o755),
    loadFile(sourceDir, 'linux/install-systemd.sh', 0o755),
    loadFile(sourceDir, 'linux/uninstall-systemd.sh', 0o755),
    loadFile(sourceDir, 'README.md', 0o644),
  ];
}

export function getLinuxAgentBundleManifest(version = process.env.GCAC_RELEASE_VERSION?.trim() || '0.1.0') {
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

function loadFile(sourceDir: string, relativePath: string, mode: number): LinuxBundleFile {
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

function loadBinaryFile(sourceDir: string, relativePath: string, mode: number, validator: (content: Buffer, fullPath: string) => void): LinuxBundleFile {
  const file = loadFile(sourceDir, relativePath, mode);
  validator(file.content, resolve(sourceDir, relativePath));
  return file;
}

function resolveLinuxAgentBundleSource(): string {
  const configuredRoot = process.env.GCAC_AGENT_RELEASE_BUNDLE_ROOT?.trim();
  if (configuredRoot) return resolve(configuredRoot, 'linux', architectureName());
  return resolve(rootDir, 'agents/linux-go-full-agent');
}

function architectureName(): 'amd64' | 'arm64' {
  if (process.arch === 'x64') return 'amd64';
  if (process.arch === 'arm64') return 'arm64';
  throw new AppError('VALIDATION_FAILED', '当前 Node 运行架构没有 Agent Release Bundle 映射', { nodeArch: process.arch });
}

function assertLinuxExecutable(content: Buffer, fullPath: string): void {
  if (content.length < 4) {
    throw new AppError('VALIDATION_FAILED', 'Linux Agent bundle 二进制文件过小，无法识别格式', {
      fullPath,
      size: content.length,
    });
  }
  if (content[0] === 0x7f && content[1] === 0x45 && content[2] === 0x4c && content[3] === 0x46) {
    return;
  }
  if (content[0] === 0x4d && content[1] === 0x5a) {
    throw new AppError('VALIDATION_FAILED', 'Linux Agent bundle 产物错误：检测到 Windows PE 可执行文件，不能下发到 Linux', {
      fullPath,
      detectedFormat: 'pe',
    });
  }
  throw new AppError('VALIDATION_FAILED', 'Linux Agent bundle 产物错误：gcac-linux-agent 不是 ELF 可执行文件', {
    fullPath,
    headerHex: content.subarray(0, 8).toString('hex'),
  });
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
