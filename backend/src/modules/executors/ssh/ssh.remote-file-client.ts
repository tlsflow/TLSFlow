import type { RemoteFileClient, RemoteFileMetadata, FileTransferProtocol } from './ssh.file-transfer.js';
import type { SshSession } from './ssh.connection-manager.js';
import { SshScpRemoteFileClient } from './ssh.scp-client.js';
import { SshSftpRemoteFileClient } from './ssh.sftp-client.js';

export class SshRemoteFileClient implements RemoteFileClient {
  private sftp?: SshSftpRemoteFileClient;
  private scp?: SshScpRemoteFileClient;

  constructor(private readonly session: SshSession, private readonly options: { sftp?: boolean; scp?: boolean } = {}) {}

  async exists(remotePath: string): Promise<boolean> {
    return await this.preferSftp(() => this.sftpClient().exists(remotePath), () => this.scpClient().exists(remotePath));
  }

  async stat(remotePath: string): Promise<RemoteFileMetadata> {
    return await this.preferSftp(() => this.sftpClient().stat(remotePath), () => this.scpClient().stat(remotePath));
  }

  async readFile(remotePath: string): Promise<Buffer> {
    return await this.preferSftp(() => this.sftpClient().readFile(remotePath), () => this.scpClient().readFile(remotePath));
  }

  async writeFile(remotePath: string, content: Buffer, protocol: FileTransferProtocol): Promise<void> {
    if (protocol === 'scp' || this.options.sftp === false) {
      await this.scpClient().writeFile(remotePath, content, protocol);
      return;
    }
    await this.sftpClient().writeFile(remotePath, content, protocol);
  }

  async rename(sourcePath: string, targetPath: string): Promise<void> {
    await this.preferSftp(() => this.sftpClient().rename(sourcePath, targetPath), () => this.scpClient().rename(sourcePath, targetPath));
  }

  async deleteFile(remotePath: string): Promise<void> {
    await this.preferSftp(() => this.sftpClient().deleteFile(remotePath), () => this.scpClient().deleteFile(remotePath));
  }

  async chmod(remotePath: string, mode: string): Promise<void> {
    await this.preferSftp(() => this.sftpClient().chmod(remotePath, mode), () => this.scpClient().chmod(remotePath, mode));
  }

  async chown(remotePath: string, owner?: string, group?: string): Promise<void> {
    await this.preferSftp(() => this.sftpClient().chown(remotePath, owner, group), () => this.scpClient().chown(remotePath, owner, group));
  }

  private async preferSftp<T>(sftpOperation: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
    if (this.options.sftp === false) return await fallback();
    try {
      return await sftpOperation();
    } catch {
      if (this.options.scp === false) throw new Error('SFTP 不可用，且当前客户端未启用 SCP fallback');
      return await fallback();
    }
  }

  private sftpClient(): SshSftpRemoteFileClient {
    this.sftp ??= new SshSftpRemoteFileClient(this.session);
    return this.sftp;
  }

  private scpClient(): SshScpRemoteFileClient {
    this.scp ??= new SshScpRemoteFileClient(this.session);
    return this.scp;
  }
}
