import type { SFTPWrapper, Stats } from 'ssh2';
import { AppError } from '../../../common/errors/app-error.js';
import type { RemoteFileClient, RemoteFileMetadata, FileTransferProtocol } from './ssh.file-transfer.js';
import type { SshSession } from './ssh.connection-manager.js';

type SftpCallback = (error?: Error | null) => void;

export class SshSftpRemoteFileClient implements RemoteFileClient {
  private readonly ready: Promise<SFTPWrapper>;

  constructor(private readonly session: SshSession) {
    this.ready = openSftp(session);
  }

  async exists(remotePath: string): Promise<boolean> {
    const sftp = await this.ready;
    return await new Promise<boolean>((resolve) => {
      sftp.stat(remotePath, (error) => resolve(!error));
    });
  }

  async stat(remotePath: string): Promise<RemoteFileMetadata> {
    const stats = await this.call<Stats>((sftp, callback) => sftp.stat(remotePath, callback));
    return {
      size: stats.size,
      mode: stats.mode === undefined ? undefined : modeToOctal(stats.mode),
      owner: stats.uid === undefined ? undefined : String(stats.uid),
      group: stats.gid === undefined ? undefined : String(stats.gid),
      mtime: stats.mtime === undefined ? undefined : new Date(stats.mtime * 1000).toISOString(),
    };
  }

  async readFile(remotePath: string): Promise<Buffer> {
    return await this.call<Buffer>((sftp, callback) => sftp.readFile(remotePath, (error, content) => callback(error, content)));
  }

  async writeFile(remotePath: string, content: Buffer, protocol: FileTransferProtocol): Promise<void> {
    if (protocol !== 'sftp') throw sftpError('SCP 降级需要独立 SCP adapter，当前真实文件传输仅支持 SFTP', 'protocol', remotePath);
    await this.callVoid((sftp, callback) => sftp.writeFile(remotePath, content, callback));
  }

  async rename(sourcePath: string, targetPath: string): Promise<void> {
    await this.callVoid((sftp, callback) => sftp.rename(sourcePath, targetPath, callback));
  }

  async deleteFile(remotePath: string): Promise<void> {
    await this.callVoid((sftp, callback) => sftp.unlink(remotePath, callback));
  }

  async chmod(remotePath: string, mode: string): Promise<void> {
    await this.callVoid((sftp, callback) => sftp.chmod(remotePath, mode, callback));
  }

  async chown(remotePath: string, owner?: string, group?: string): Promise<void> {
    const uid = parseNumericId(owner, 'owner', remotePath);
    const gid = parseNumericId(group, 'group', remotePath);
    if (uid === undefined && gid === undefined) return;
    const current = await this.call<Stats>((sftp, callback) => sftp.stat(remotePath, callback));
    await this.callVoid((sftp, callback) => sftp.chown(remotePath, uid ?? current.uid, gid ?? current.gid, callback));
  }

  private async call<T>(operation: (sftp: SFTPWrapper, callback: (error: Error | undefined, result: T) => void) => void): Promise<T> {
    const sftp = await this.ready;
    return await new Promise<T>((resolve, reject) => {
      operation(sftp, (error, result) => {
        if (error) reject(wrapSftpError(error));
        else resolve(result);
      });
    });
  }

  private async callVoid(operation: (sftp: SFTPWrapper, callback: SftpCallback) => void): Promise<void> {
    const sftp = await this.ready;
    await new Promise<void>((resolve, reject) => {
      operation(sftp, (error) => {
        if (error) reject(wrapSftpError(error));
        else resolve();
      });
    });
  }
}

function openSftp(session: SshSession): Promise<SFTPWrapper> {
  return new Promise<SFTPWrapper>((resolve, reject) => {
    session.client.sftp((error, sftp) => {
      if (error) {
        reject(sftpError('SFTP 会话打开失败', 'sftp', `${session.config.host}:${session.config.port ?? 22}`, { cause: error.message }));
        return;
      }
      resolve(sftp);
    });
  });
}

function parseNumericId(value: string | undefined, field: 'owner' | 'group', remotePath: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  if (!/^\d+$/.test(value)) {
    throw sftpError('真实 SFTP chown 只接受数字 uid/gid；用户名到 uid/gid 的解析应由上层命令节点完成', 'metadata', remotePath, { field, value });
  }
  return Number(value);
}

function modeToOctal(mode: number): string {
  return (mode & 0o7777).toString(8).padStart(4, '0');
}

function wrapSftpError(error: Error): AppError {
  return sftpError('SFTP 文件操作失败', 'sftp', undefined, { cause: error.message });
}

function sftpError(message: string, stage: string, remotePath?: string, details: Record<string, unknown> = {}): AppError {
  return new AppError('EXECUTION_TARGET_UNAVAILABLE', message, { sshErrorCode: 'SFTP_OPERATION_FAILED', stage, remotePath, ...details });
}
