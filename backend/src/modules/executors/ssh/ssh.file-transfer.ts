import { createHash, randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import { AppError } from '../../../common/errors/app-error.js';

export type FileTransferDirection = 'upload' | 'download';
export type FileTransferProtocol = 'sftp' | 'scp';

export interface RemoteFileMetadata {
  size: number;
  mode?: string;
  owner?: string;
  group?: string;
  mtime?: string;
  hash?: string;
}

export interface RemoteFileClient {
  exists(remotePath: string): Promise<boolean>;
  stat(remotePath: string): Promise<RemoteFileMetadata>;
  readFile(remotePath: string): Promise<Buffer>;
  writeFile(remotePath: string, content: Buffer, protocol: FileTransferProtocol): Promise<void>;
  rename(sourcePath: string, targetPath: string): Promise<void>;
  deleteFile(remotePath: string): Promise<void>;
  chmod(remotePath: string, mode: string): Promise<void>;
  chown(remotePath: string, owner?: string, group?: string): Promise<void>;
}

export interface LocalFileStore {
  readFile(localPath: string): Promise<Buffer>;
  writeFile(localPath: string, content: Buffer): Promise<void>;
}

export interface FileTransferPlan {
  direction: FileTransferDirection;
  localPath: string;
  remotePath: string;
  content?: Buffer | string;
  temporaryPath?: string;
  expectedHash?: string;
  expectedSize?: number;
  verifyHash?: boolean;
  mode?: string;
  owner?: string;
  group?: string;
  allowScpFallback?: boolean;
}

export interface FileTransferCapabilities {
  sftp: boolean;
  scp: boolean;
}

export interface FileTransferAuditDetail {
  event: 'scp_fallback' | 'rename_overwrite_fallback';
  risk: 'high';
  reason: string;
  remotePath: string;
  temporaryPath?: string;
}

export interface FileTransferResult {
  direction: FileTransferDirection;
  protocol: FileTransferProtocol;
  remotePath: string;
  localPath: string;
  temporaryPath?: string;
  size: number;
  hash: string;
  metadata?: RemoteFileMetadata;
  auditDetails: FileTransferAuditDetail[];
}

export class FileTransferService {
  constructor(private readonly client: RemoteFileClient, private readonly localStore?: LocalFileStore) {}

  async transfer(plan: FileTransferPlan, capabilities: FileTransferCapabilities): Promise<FileTransferResult> {
    validateTransferPlan(plan);
    return plan.direction === 'upload'
      ? this.upload(plan, capabilities)
      : this.download(plan, capabilities);
  }

  async upload(plan: FileTransferPlan, capabilities: FileTransferCapabilities): Promise<FileTransferResult> {
    validateTransferPlan(plan);
    const remotePath = normalizeRemotePath(plan.remotePath);
    const protocol = chooseProtocol(plan, capabilities);
    const content = await this.resolveUploadContent(plan);
    const expectedHash = plan.expectedHash ?? sha256(content);
    const expectedSize = plan.expectedSize ?? content.byteLength;
    if (content.byteLength !== expectedSize) {
      throw transferError('上传内容大小与计划不一致', 'size_verify', remotePath, { expectedSize, actualSize: content.byteLength });
    }

    const temporaryPath = plan.temporaryPath ? normalizeRemotePath(plan.temporaryPath) : defaultTemporaryPath(remotePath);
    assertSameDirectory(remotePath, temporaryPath);
    await this.client.writeFile(temporaryPath, content, protocol);

    if (plan.mode) await this.client.chmod(temporaryPath, plan.mode);
    if (plan.owner || plan.group) await this.client.chown(temporaryPath, plan.owner, plan.group);

    const temporaryContent = await this.client.readFile(temporaryPath);
    verifyContent(remotePath, temporaryContent, expectedSize, expectedHash, plan.verifyHash !== false);

    const renameFallback = await this.renameWithOverwriteFallback(temporaryPath, remotePath);
    if (!renameFallback.success) {
      throw transferError('远程 rename 原子替换失败，临时文件已保留用于诊断', 'rename', remotePath, {
        temporaryPath,
        cause: renameFallback.cause,
        fallbackCause: renameFallback.fallbackCause,
      });
    }

    const finalContent = await this.client.readFile(remotePath);
    verifyContent(remotePath, finalContent, expectedSize, expectedHash, plan.verifyHash !== false);
    const metadata = await safeStat(this.client, remotePath);

    return {
      direction: 'upload',
      protocol,
      remotePath,
      localPath: plan.localPath,
      temporaryPath,
      size: expectedSize,
      hash: expectedHash,
      metadata,
      auditDetails: [...scpAudit(protocol, remotePath), ...renameFallback.auditDetails],
    };
  }

  async download(plan: FileTransferPlan, capabilities: FileTransferCapabilities): Promise<FileTransferResult> {
    validateTransferPlan(plan);
    const remotePath = normalizeRemotePath(plan.remotePath);
    const protocol = chooseProtocol(plan, capabilities);
    const content = await this.client.readFile(remotePath);
    const hash = sha256(content);
    verifyContent(remotePath, content, plan.expectedSize, plan.expectedHash, plan.verifyHash !== false);
    if (!this.localStore) {
      throw transferError('下载需要 LocalFileStore 写入本地文件', 'download', remotePath);
    }
    await this.localStore.writeFile(plan.localPath, content);
    return {
      direction: 'download',
      protocol,
      remotePath,
      localPath: plan.localPath,
      size: content.byteLength,
      hash,
      metadata: await safeStat(this.client, remotePath),
      auditDetails: scpAudit(protocol, remotePath),
    };
  }

  private async resolveUploadContent(plan: FileTransferPlan): Promise<Buffer> {
    if (Buffer.isBuffer(plan.content)) return Buffer.from(plan.content);
    if (typeof plan.content === 'string') return Buffer.from(plan.content, 'utf8');
    if (!this.localStore) throw transferError('上传需要 content 或 LocalFileStore', 'upload', plan.remotePath);
    return this.localStore.readFile(plan.localPath);
  }

  private async renameWithOverwriteFallback(temporaryPath: string, remotePath: string): Promise<{ success: true; auditDetails: FileTransferAuditDetail[] } | { success: false; cause: string; fallbackCause?: string; auditDetails: [] }> {
    const targetExisted = await this.client.exists(remotePath);
    try {
      await this.client.rename(temporaryPath, remotePath);
      return { success: true, auditDetails: [] };
    } catch (error) {
      const cause = errorMessage(error);
      if (!targetExisted) return { success: false, cause, auditDetails: [] };
      try {
        await this.client.deleteFile(remotePath);
        await this.client.rename(temporaryPath, remotePath);
        return {
          success: true,
          auditDetails: [{
            event: 'rename_overwrite_fallback',
            risk: 'high',
            reason: '目标 SFTP 服务不支持 rename 覆盖已有文件，已删除旧目标后重试替换；该降级路径不具备原子性',
            remotePath,
            temporaryPath,
          }],
        };
      } catch (fallbackError) {
        return { success: false, cause, fallbackCause: errorMessage(fallbackError), auditDetails: [] };
      }
    }
  }
}

export function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export function defaultTemporaryPath(remotePath: string): string {
  const dir = posix.dirname(remotePath);
  const name = posix.basename(remotePath);
  return posix.join(dir === '.' ? '/' : dir, `.${name}.gcac-${randomUUID()}.tmp`);
}

function chooseProtocol(plan: FileTransferPlan, capabilities: FileTransferCapabilities): FileTransferProtocol {
  if (capabilities.sftp) return 'sftp';
  if (capabilities.scp && plan.allowScpFallback === true) return 'scp';
  if (capabilities.scp) throw transferError('SFTP 不可用，且策略未允许 SCP 降级', 'protocol', plan.remotePath);
  throw transferError('目标不支持 SFTP/SCP 文件传输', 'protocol', plan.remotePath);
}

function verifyContent(remotePath: string, content: Buffer, expectedSize: number | undefined, expectedHash: string | undefined, verifyHash: boolean): void {
  if (expectedSize !== undefined && content.byteLength !== expectedSize) {
    throw transferError('远程文件大小校验失败', 'verify', remotePath, { expectedSize, actualSize: content.byteLength });
  }
  if (verifyHash && expectedHash && sha256(content) !== expectedHash) {
    throw transferError('远程文件 hash 校验失败', 'verify', remotePath, { expectedHash, actualHash: sha256(content) });
  }
}

function validateTransferPlan(plan: FileTransferPlan): void {
  normalizeRemotePath(plan.remotePath);
  if (!plan.localPath.trim() || /[\0\r\n]/.test(plan.localPath) || plan.localPath.includes('..')) {
    throw transferError('本地路径不合法', 'validate', plan.remotePath, { localPath: plan.localPath });
  }
  if (plan.temporaryPath) normalizeRemotePath(plan.temporaryPath);
  if (plan.mode && !/^[0-7]{3,4}$/.test(plan.mode)) throw transferError('chmod mode 不合法', 'metadata', plan.remotePath, { mode: plan.mode });
  if ((plan.owner && /[\0\r\n:]/.test(plan.owner)) || (plan.group && /[\0\r\n:]/.test(plan.group))) {
    throw transferError('chown owner/group 不合法', 'metadata', plan.remotePath);
  }
}

export function normalizeRemotePath(remotePath: string): string {
  const normalized = remotePath.trim().replace(/\\/g, '/');
  if (!normalized.startsWith('/') || normalized.includes('..') || /[\0\r\n]/.test(normalized)) {
    throw new AppError('VALIDATION_FAILED', '远程路径不合法', { remotePath });
  }
  return normalized;
}

function assertSameDirectory(remotePath: string, temporaryPath: string): void {
  if (posix.dirname(remotePath) !== posix.dirname(temporaryPath)) {
    throw transferError('临时文件必须与目标文件位于同一目录，才能保证 rename 原子性', 'validate', remotePath, { temporaryPath });
  }
}

function scpAudit(protocol: FileTransferProtocol, remotePath: string): FileTransferAuditDetail[] {
  return protocol === 'scp'
    ? [{ event: 'scp_fallback', risk: 'high', reason: 'SFTP 不可用且策略允许 SCP 降级，原子性和错误诊断弱于 SFTP', remotePath }]
    : [];
}

async function safeStat(client: RemoteFileClient, remotePath: string): Promise<RemoteFileMetadata | undefined> {
  try {
    return await client.stat(remotePath);
  } catch {
    return undefined;
  }
}

function transferError(message: string, stage: string, remotePath: string, details: Record<string, unknown> = {}): AppError {
  return new AppError('VALIDATION_FAILED', message, { stage, remotePath, ...details });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
