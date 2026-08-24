import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import { FileTransferService, type FileTransferProtocol, type RemoteFileClient, type RemoteFileMetadata, sha256 } from './ssh.file-transfer.js';
import { RemoteBackupService } from './ssh.remote-backup.js';
import { RemoteRollbackService } from './ssh.rollback.js';
import { SSHExecutor } from './ssh.executor.js';
import type { SshConnectionManager, SshSession } from './ssh.connection-manager.js';
import { SshScpRemoteFileClient } from './ssh.scp-client.js';
import { SshRemoteFileClient } from './ssh.remote-file-client.js';
import { SshSftpRemoteFileClient } from './ssh.sftp-client.js';

describe('spec015 SSH 文件传输、备份和回滚服务', () => {
  it('SFTP 上传使用临时文件、校验 hash/size、设置 chmod/chown 并 rename 原子替换', async () => {
    const remote = new MemoryRemoteFileClient();
    const service = new FileTransferService(remote);
    const content = Buffer.from('certificate-body');
    const result = await service.upload({
      direction: 'upload',
      localPath: '/artifact/cert.pem',
      remotePath: '/etc/nginx/cert.pem',
      temporaryPath: '/etc/nginx/.cert.pem.tmp',
      content,
      expectedHash: sha256(content),
      expectedSize: content.byteLength,
      mode: '0644',
      owner: 'root',
      group: 'nginx',
    }, { sftp: true, scp: true });

    assert.equal(result.protocol, 'sftp');
    assert.equal((await remote.readFile('/etc/nginx/cert.pem')).toString('utf8'), 'certificate-body');
    assert.deepEqual(await remote.stat('/etc/nginx/cert.pem'), { size: content.byteLength, mode: '0644', owner: 'root', group: 'nginx', hash: sha256(content) });
    assert.deepEqual(remote.operations, [
      'write:sftp:/etc/nginx/.cert.pem.tmp',
      'chmod:/etc/nginx/.cert.pem.tmp:0644',
      'chown:/etc/nginx/.cert.pem.tmp:root:nginx',
      'rename:/etc/nginx/.cert.pem.tmp:/etc/nginx/cert.pem',
    ]);
  });

  it('下载远程文件并校验 hash 后写入本地 store', async () => {
    const remote = new MemoryRemoteFileClient();
    const local = new MemoryLocalFileStore();
    await remote.writeFile('/etc/nginx/cert.pem', Buffer.from('download-me'), 'sftp');
    const service = new FileTransferService(remote, local);

    const result = await service.download({
      direction: 'download',
      localPath: '/artifact/cert.pem',
      remotePath: '/etc/nginx/cert.pem',
      expectedHash: sha256(Buffer.from('download-me')),
    }, { sftp: true, scp: false });

    assert.equal(result.protocol, 'sftp');
    assert.equal((await local.readFile('/artifact/cert.pem')).toString('utf8'), 'download-me');
  });

  it('hash mismatch 和 rename 失败都返回明确错误，rename 失败保留临时文件', async () => {
    const remote = new MemoryRemoteFileClient();
    const service = new FileTransferService(remote);

    await assert.rejects(
      () => service.upload({
        direction: 'upload',
        localPath: '/artifact/key.pem',
        remotePath: '/etc/nginx/key.pem',
        temporaryPath: '/etc/nginx/.key.pem.tmp',
        content: 'private-key-body',
        expectedHash: sha256(Buffer.from('different')),
      }, { sftp: true, scp: false }),
      /hash 校验失败/,
    );

    remote.failRename = true;
    await assert.rejects(
      () => service.upload({
        direction: 'upload',
        localPath: '/artifact/key.pem',
        remotePath: '/etc/nginx/key.pem',
        temporaryPath: '/etc/nginx/.key.pem.tmp',
        content: 'private-key-body',
        expectedHash: sha256(Buffer.from('private-key-body')),
      }, { sftp: true, scp: false }),
      /rename 原子替换失败/,
    );
    assert.equal((await remote.readFile('/etc/nginx/.key.pem.tmp')).toString('utf8'), 'private-key-body');
  });

  it('目标已存在且 SFTP rename 不支持覆盖时删除旧目标后重试替换', async () => {
    const remote = new MemoryRemoteFileClient();
    await remote.writeFile('/etc/nginx/cert.pem', Buffer.from('old-cert'), 'sftp');
    remote.failRenameCount = 1;
    const service = new FileTransferService(remote);

    const result = await service.upload({
      direction: 'upload',
      localPath: '/artifact/cert.pem',
      remotePath: '/etc/nginx/cert.pem',
      temporaryPath: '/etc/nginx/.cert.pem.tmp',
      content: 'new-cert',
      expectedHash: sha256(Buffer.from('new-cert')),
    }, { sftp: true, scp: false });

    assert.equal((await remote.readFile('/etc/nginx/cert.pem')).toString('utf8'), 'new-cert');
    assert.equal(result.auditDetails[0]?.event, 'rename_overwrite_fallback');
    assert.deepEqual(remote.operations, [
      'write:sftp:/etc/nginx/cert.pem',
      'write:sftp:/etc/nginx/.cert.pem.tmp',
      'delete:/etc/nginx/cert.pem',
      'rename:/etc/nginx/.cert.pem.tmp:/etc/nginx/cert.pem',
    ]);
  });

  it('只有策略允许时才 SCP 降级，并返回高风险审计 detail', async () => {
    const remote = new MemoryRemoteFileClient();
    const service = new FileTransferService(remote);

    await assert.rejects(
      () => service.upload({
        direction: 'upload',
        localPath: '/artifact/cert.pem',
        remotePath: '/etc/nginx/cert.pem',
        content: 'cert',
      }, { sftp: false, scp: true }),
      /策略未允许 SCP 降级/,
    );

    const result = await service.upload({
      direction: 'upload',
      localPath: '/artifact/cert.pem',
      remotePath: '/etc/nginx/cert.pem',
      temporaryPath: '/etc/nginx/.cert.pem.tmp',
      content: 'cert',
      allowScpFallback: true,
    }, { sftp: false, scp: true });

    assert.equal(result.protocol, 'scp');
    assert.equal(result.auditDetails[0]?.risk, 'high');
    assert.match(result.auditDetails[0]?.reason ?? '', /SCP 降级/);
  });

  it('覆盖前备份内容和元数据，原文件不存在时记录 missing', async () => {
    const remote = new MemoryRemoteFileClient();
    await remote.writeFile('/etc/nginx/cert.pem', Buffer.from('old-cert'), 'sftp');
    await remote.chmod('/etc/nginx/cert.pem', '0600');
    await remote.chown('/etc/nginx/cert.pem', 'root', 'nginx');

    const backup = new RemoteBackupService(remote);
    const manifest = await backup.createManifest({
      targetHostId: 'web-01',
      taskId: 'task-1',
      items: [
        { remotePath: '/etc/nginx/cert.pem', backupRef: '/var/backups/cert.pem.bak' },
        { remotePath: '/etc/nginx/missing.pem', backupRef: '/var/backups/missing.pem.bak' },
      ],
      createdAt: '2026-07-02T00:00:00.000Z',
    });

    assert.equal(manifest.items[0]?.existed, true);
    assert.equal(manifest.items[0]?.hash, sha256(Buffer.from('old-cert')));
    assert.equal(manifest.items[0]?.mode, '0600');
    assert.equal(manifest.items[1]?.existed, false);
    assert.equal((await remote.readFile('/var/backups/cert.pem.bak')).toString('utf8'), 'old-cert');
  });

  it('按 BackupManifest 恢复文件，missing 原文件回滚时删除新文件，失败诊断不泄露私钥', async () => {
    const remote = new MemoryRemoteFileClient();
    await remote.writeFile('/etc/nginx/cert.pem', Buffer.from('old-cert'), 'sftp');
    const backup = new RemoteBackupService(remote);
    const manifest = await backup.createManifest({
      targetHostId: 'web-01',
      taskId: 'task-1',
      items: [
        { remotePath: '/etc/nginx/cert.pem', backupRef: '/var/backups/cert.pem.bak' },
        { remotePath: '/etc/nginx/new-key.pem', backupRef: '/var/backups/new-key.pem.bak' },
      ],
      createdAt: '2026-07-02T00:00:00.000Z',
    });

    await remote.writeFile('/etc/nginx/cert.pem', Buffer.from('new-cert'), 'sftp');
    await remote.writeFile('/etc/nginx/new-key.pem', Buffer.from('new-key'), 'sftp');
    const rollback = new RemoteRollbackService(remote);
    const result = await rollback.restore(manifest);

    assert.equal(result.success, true);
    assert.equal((await remote.readFile('/etc/nginx/cert.pem')).toString('utf8'), 'old-cert');
    assert.equal(await remote.exists('/etc/nginx/new-key.pem'), false);
    assert.deepEqual(result.items.map((item) => item.action), ['restored', 'deleted_new_file']);

    const brokenRemote = new MemoryRemoteFileClient('-----BEGIN PRIVATE KEY-----secret-----END PRIVATE KEY----- password=plain');
    const brokenRollback = new RemoteRollbackService(brokenRemote);
    const broken = await brokenRollback.restore(manifest);
    assert.equal(broken.success, false);
    assert.doesNotMatch(JSON.stringify(broken), /PRIVATE KEY|password=plain/);
  });

  it('SSHExecutor 将文件计划接入文件步骤执行路径', async () => {
    const remote = new MemoryRemoteFileClient();
    await remote.writeFile('/etc/nginx/cert.pem', Buffer.from('old-cert'), 'sftp');
    const executor = new SSHExecutor({
      fileTransfer: new FileTransferService(remote),
      remoteBackup: new RemoteBackupService(remote),
      rollback: new RemoteRollbackService(remote),
    });

    const result = await executor.executeStep({
      dryRun: false,
      runType: 'deployment',
      step: {
        id: 'step-1',
        tenantId: 'tenant-1',
        executionRunId: 'run-1',
        attemptCount: 0,
        stepType: 'INSTALL',
        inputSnapshot: {
          sshRequest: {
            idempotencyKey: 'idem_file_step',
            connection: { host: 'web-01', username: 'deploy', credentialSecretRef: 'secret://ssh/web-01', expectedHostKeyFingerprint: 'aabbccddeeff0011' },
            backup: [{ remotePath: '/etc/nginx/cert.pem', backupRef: '/var/backups/cert.pem.bak' }],
            sftp: [{
              direction: 'upload',
              localPath: '/artifact/cert.pem',
              remotePath: '/etc/nginx/cert.pem',
              temporaryPath: '/etc/nginx/.cert.pem.tmp',
              content: 'new-cert',
              expectedHash: sha256(Buffer.from('new-cert')),
            }],
            fileTransferCapabilities: { sftp: true, scp: true },
          },
        },
      } as any,
    });

    assert.equal(result.success, true);
    assert.equal((await remote.readFile('/etc/nginx/cert.pem')).toString('utf8'), 'new-cert');
    const detail = result.detail as { transferResults: Array<{ protocol: string }>; generatedBackupManifest: { items: Array<{ hash?: string }> } };
    assert.equal(detail.transferResults[0]?.protocol, 'sftp');
    assert.equal(detail.generatedBackupManifest.items[0]?.hash, sha256(Buffer.from('old-cert')));
  });

  it('真实 SFTP adapter 通过 ssh2 sftp session 执行远端文件操作', async () => {
    const sftp = new FakeSftpWrapper();
    const client = new SshSftpRemoteFileClient(fakeSftpSession(sftp));

    await client.writeFile('/etc/nginx/cert.pem', Buffer.from('cert'), 'sftp');
    await client.chmod('/etc/nginx/cert.pem', '0644');
    await client.chown('/etc/nginx/cert.pem', '0', '0');
    const content = await client.readFile('/etc/nginx/cert.pem');
    const metadata = await client.stat('/etc/nginx/cert.pem');

    assert.equal(sftp.openCount, 1);
    assert.equal(content.toString('utf8'), 'cert');
    assert.equal(metadata.size, 4);
    assert.equal(metadata.mode, '0644');
    assert.equal(metadata.owner, '0');
    assert.equal(metadata.group, '0');
  });

  it('SSHExecutor 未注入文件服务时默认创建真实 SFTP 文件服务', async () => {
    const sftp = new FakeSftpWrapper();
    sftp.files.set('/etc/nginx/cert.pem', { content: Buffer.from('old-cert'), mode: '0600', uid: 0, gid: 0, mtime: 1_783_036_800 });
    const executor = new SSHExecutor({
      connectionManager: new FakeSftpConnectionManager(sftp) as unknown as SshConnectionManager,
    });

    const result = await executor.execute({
      idempotencyKey: 'idem_default_sftp',
      connection: { host: 'web-01', username: 'deploy', credentialSecretRef: 'secret://ssh/web-01', expectedHostKeyFingerprint: 'aabbccddeeff0011' },
      backup: [{ remotePath: '/etc/nginx/cert.pem', backupRef: '/var/backups/cert.pem.bak' }],
      sftp: [{
        direction: 'upload',
        localPath: '/artifact/cert.pem',
        remotePath: '/etc/nginx/cert.pem',
        temporaryPath: '/etc/nginx/.cert.pem.tmp',
        content: 'new-cert',
        expectedHash: sha256(Buffer.from('new-cert')),
      }],
    });

    assert.equal(result.success, true);
    assert.equal(result.transferResults?.[0]?.protocol, 'sftp');
    assert.equal(result.generatedBackupManifest?.items[0]?.hash, sha256(Buffer.from('old-cert')));
    assert.equal(sftp.files.get('/etc/nginx/cert.pem')?.content.toString('utf8'), 'new-cert');
    assert.equal(sftp.closed, true);
  });

  it('真实 SCP adapter 通过 scp 与 shell 补偿执行远端文件操作', async () => {
    const state = new FakeScpState();
    const client = new SshScpRemoteFileClient(fakeScpSession(state));

    await client.writeFile('/etc/nginx/cert.pem', Buffer.from('cert'), 'scp');
    await client.chmod('/etc/nginx/cert.pem', '0644');
    await client.chown('/etc/nginx/cert.pem', 'root', 'nginx');
    const content = await client.readFile('/etc/nginx/cert.pem');
    const metadata = await client.stat('/etc/nginx/cert.pem');

    assert.equal(content.toString('utf8'), 'cert');
    assert.equal(metadata.size, 4);
    assert.equal(metadata.mode, '0644');
    assert.equal(metadata.owner, 'root');
    assert.equal(metadata.group, 'nginx');
    assert.equal(state.execCommands.some((command) => command.startsWith("scp -t -- '/etc/nginx/cert.pem'")), true);
    assert.equal(state.execCommands.some((command) => command.startsWith("scp -f -- '/etc/nginx/cert.pem'")), true);
  });

  it('SSHExecutor 未注入文件服务时默认创建真实 SCP 路径，并在 SFTP 不可用时闭环执行', async () => {
    const state = new FakeScpState();
    state.files.set('/etc/nginx/cert.pem', { content: Buffer.from('old-cert'), mode: '0600', owner: 'root', group: 'root', mtime: 1_783_036_800 });
    const executor = new SSHExecutor({
      connectionManager: new FakeScpConnectionManager(state) as unknown as SshConnectionManager,
    });

    const result = await executor.execute({
      idempotencyKey: 'idem_default_scp',
      connection: { host: 'web-01', username: 'deploy', credentialSecretRef: 'secret://ssh/web-01', expectedHostKeyFingerprint: 'aabbccddeeff0011' },
      backup: [{ remotePath: '/etc/nginx/cert.pem', backupRef: '/var/backups/cert.pem.bak' }],
      scp: [{
        direction: 'upload',
        localPath: '/artifact/cert.pem',
        remotePath: '/etc/nginx/cert.pem',
        temporaryPath: '/etc/nginx/.cert.pem.tmp',
        content: 'new-cert',
        expectedHash: sha256(Buffer.from('new-cert')),
      }],
      fileTransferCapabilities: { sftp: false, scp: true },
    });

    assert.equal(result.success, true);
    assert.equal(result.transferResults?.[0]?.protocol, 'scp');
    assert.equal(result.generatedBackupManifest?.items[0]?.hash, sha256(Buffer.from('old-cert')));
    assert.equal(state.files.get('/etc/nginx/cert.pem')?.content.toString('utf8'), 'new-cert');
    assert.equal(state.closed, true);
  });

  it('混合 RemoteFileClient 优先 SFTP，失败后回退到 SCP/shell', async () => {
    const state = new FakeScpState();
    state.files.set('/etc/nginx/cert.pem', { content: Buffer.from('hybrid-cert'), mode: '0640', owner: 'root', group: 'root', mtime: 1_783_036_800 });
    const client = new SshRemoteFileClient(fakeScpSession(state));

    const exists = await client.exists('/etc/nginx/cert.pem');
    const content = await client.readFile('/etc/nginx/cert.pem');

    assert.equal(exists, true);
    assert.equal(content.toString('utf8'), 'hybrid-cert');
    assert.equal(state.execCommands.some((command) => command.startsWith("scp -f -- '/etc/nginx/cert.pem'")), true);
  });
});

class MemoryRemoteFileClient implements RemoteFileClient {
  readonly files = new Map<string, { content: Buffer; metadata: Omit<RemoteFileMetadata, 'size' | 'hash'> }>();
  readonly operations: string[] = [];
  failRename = false;
  failRenameCount = 0;

  constructor(private readonly failureMessage?: string) {}

  async exists(remotePath: string): Promise<boolean> {
    return this.files.has(remotePath);
  }

  async stat(remotePath: string): Promise<RemoteFileMetadata> {
    const file = this.file(remotePath);
    return { size: file.content.byteLength, ...file.metadata, hash: sha256(file.content) };
  }

  async readFile(remotePath: string): Promise<Buffer> {
    if (this.failureMessage) throw new Error(this.failureMessage);
    return Buffer.from(this.file(remotePath).content);
  }

  async writeFile(remotePath: string, content: Buffer, protocol: FileTransferProtocol): Promise<void> {
    this.operations.push(`write:${protocol}:${remotePath}`);
    this.files.set(remotePath, { content: Buffer.from(content), metadata: this.files.get(remotePath)?.metadata ?? {} });
  }

  async rename(sourcePath: string, targetPath: string): Promise<void> {
    if (this.failRenameCount > 0) {
      this.failRenameCount -= 1;
      throw new Error('rename denied');
    }
    if (this.failRename) throw new Error('rename denied');
    this.operations.push(`rename:${sourcePath}:${targetPath}`);
    const file = this.file(sourcePath);
    this.files.set(targetPath, { content: Buffer.from(file.content), metadata: { ...file.metadata } });
    this.files.delete(sourcePath);
  }

  async deleteFile(remotePath: string): Promise<void> {
    this.operations.push(`delete:${remotePath}`);
    this.files.delete(remotePath);
  }

  async chmod(remotePath: string, mode: string): Promise<void> {
    this.operations.push(`chmod:${remotePath}:${mode}`);
    const file = this.file(remotePath);
    file.metadata.mode = mode;
  }

  async chown(remotePath: string, owner?: string, group?: string): Promise<void> {
    this.operations.push(`chown:${remotePath}:${owner ?? ''}:${group ?? ''}`);
    const file = this.file(remotePath);
    file.metadata.owner = owner;
    file.metadata.group = group;
  }

  private file(remotePath: string): { content: Buffer; metadata: Omit<RemoteFileMetadata, 'size' | 'hash'> } {
    const file = this.files.get(remotePath);
    if (!file) throw new Error(`file not found: ${remotePath}`);
    return file;
  }
}

class MemoryLocalFileStore {
  readonly files = new Map<string, Buffer>();

  async readFile(localPath: string): Promise<Buffer> {
    const file = this.files.get(localPath);
    if (!file) throw new Error(`local file not found: ${localPath}`);
    return Buffer.from(file);
  }

  async writeFile(localPath: string, content: Buffer): Promise<void> {
    this.files.set(localPath, Buffer.from(content));
  }
}

class FakeSftpConnectionManager {
  constructor(private readonly sftp: FakeSftpWrapper) {}

  async connect(): Promise<SshSession> {
    return fakeSftpSession(this.sftp);
  }
}

class FakeScpConnectionManager {
  constructor(private readonly state: FakeScpState) {}

  async connect(): Promise<SshSession> {
    return fakeScpSession(this.state);
  }
}

function fakeSftpSession(sftp: FakeSftpWrapper): SshSession {
  return {
    client: {
      sftp: (callback: (error: Error | undefined, wrapper: FakeSftpWrapper) => void) => {
        sftp.openCount += 1;
        callback(undefined, sftp);
      },
    } as any,
    config: {
      host: 'web-01',
      username: 'deploy',
      credentialSecretRef: 'secret://ssh/web-01',
      credential: { kind: 'password', username: 'deploy', password: 'secret', secretRefs: [] },
    },
    hostKeyDecision: 'verified',
    sensitiveValues: ['secret'],
    close: () => {
      sftp.closed = true;
    },
  };
}

function fakeScpSession(state: FakeScpState): SshSession {
  return {
    client: new FakeScpClient(state) as any,
    config: {
      host: 'web-01',
      username: 'deploy',
      credentialSecretRef: 'secret://ssh/web-01',
      credential: { kind: 'password', username: 'deploy', password: 'secret', secretRefs: [] },
    },
    hostKeyDecision: 'verified',
    sensitiveValues: ['secret'],
    close: () => {
      state.closed = true;
    },
  };
}

class FakeSftpWrapper {
  readonly files = new Map<string, { content: Buffer; mode?: string; uid?: number; gid?: number; mtime?: number }>();
  openCount = 0;
  closed = false;

  stat(path: string, callback: (error: Error | undefined, stats: any) => void): void {
    const file = this.files.get(path);
    if (!file) {
      callback(new Error(`file not found: ${path}`), undefined);
      return;
    }
    callback(undefined, {
      size: file.content.byteLength,
      mode: Number.parseInt(file.mode ?? '0644', 8),
      uid: file.uid ?? 0,
      gid: file.gid ?? 0,
      mtime: file.mtime ?? 1_783_036_800,
    });
  }

  readFile(path: string, callback: (error: Error | undefined, content: Buffer) => void): void {
    const file = this.files.get(path);
    if (!file) {
      callback(new Error(`file not found: ${path}`), Buffer.alloc(0));
      return;
    }
    callback(undefined, Buffer.from(file.content));
  }

  writeFile(path: string, content: Buffer, callback: (error?: Error | null) => void): void {
    const current = this.files.get(path);
    this.files.set(path, {
      content: Buffer.from(content),
      mode: current?.mode,
      uid: current?.uid,
      gid: current?.gid,
      mtime: current?.mtime ?? 1_783_036_800,
    });
    callback();
  }

  rename(sourcePath: string, targetPath: string, callback: (error?: Error | null) => void): void {
    const file = this.files.get(sourcePath);
    if (!file) {
      callback(new Error(`file not found: ${sourcePath}`));
      return;
    }
    this.files.set(targetPath, { ...file, content: Buffer.from(file.content) });
    this.files.delete(sourcePath);
    callback();
  }

  unlink(path: string, callback: (error?: Error | null) => void): void {
    this.files.delete(path);
    callback();
  }

  chmod(path: string, mode: string, callback: (error?: Error | null) => void): void {
    const file = this.files.get(path);
    if (!file) {
      callback(new Error(`file not found: ${path}`));
      return;
    }
    file.mode = mode;
    callback();
  }

  chown(path: string, uid: number, gid: number, callback: (error?: Error | null) => void): void {
    const file = this.files.get(path);
    if (!file) {
      callback(new Error(`file not found: ${path}`));
      return;
    }
    file.uid = uid;
    file.gid = gid;
    callback();
  }
}

class FakeScpState {
  readonly files = new Map<string, { content: Buffer; mode?: string; owner?: string; group?: string; mtime?: number }>();
  readonly execCommands: string[] = [];
  closed = false;
}

class FakeScpClient {
  constructor(private readonly state: FakeScpState) {}

  sftp(callback: (error: Error, wrapper?: unknown) => void): void {
    callback(new Error('sftp disabled'));
  }

  exec(command: string, callback: (error: Error | undefined, stream: FakeExecChannel) => void): void {
    this.state.execCommands.push(command);
    if (command.startsWith('scp -t -- ')) {
      callback(undefined, new FakeScpUploadChannel(this.state, parseQuoted(command)[0] ?? ''));
      return;
    }
    if (command.startsWith('scp -f -- ')) {
      callback(undefined, new FakeScpDownloadChannel(this.state, parseQuoted(command)[0] ?? ''));
      return;
    }
    callback(undefined, new FakeShellChannel(this.state, command));
  }
}

class FakeExecChannel extends EventEmitter {
  readonly stderr = new EventEmitter();
  private closed = false;

  write(_chunk: Buffer | string): boolean {
    return true;
  }

  end(): void {
    this.finish(0);
  }

  close(): void {
    this.finish(1);
  }

  protected finish(code: number | null): void {
    if (this.closed) return;
    this.closed = true;
    queueMicrotask(() => {
      this.emit('close', code);
      this.emit('end');
    });
  }
}

class FakeShellChannel extends FakeExecChannel {
  constructor(state: FakeScpState, command: string) {
    super();
    setTimeout(() => {
      const result = executeFakeShell(state, command);
      if (result.stdout) this.emit('data', Buffer.from(result.stdout));
      if (result.stderr) this.stderr.emit('data', Buffer.from(result.stderr));
      this.finish(result.exitCode);
    }, 0);
  }
}

class FakeScpUploadChannel extends FakeExecChannel {
  private buffer = Buffer.alloc(0);
  private size = 0;
  private content = Buffer.alloc(0);
  private headerParsed = false;
  private done = false;

  constructor(private readonly state: FakeScpState, private readonly remotePath: string) {
    super();
    queueMicrotask(() => this.emit('data', Buffer.from([0])));
  }

  override write(chunk: Buffer | string): boolean {
    if (this.done) return true;
    const data = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk);
    this.buffer = Buffer.concat([this.buffer, data]);
    this.process();
    return true;
  }

  private process(): void {
    if (!this.headerParsed) {
      const lineEnd = this.buffer.indexOf(0x0a);
      if (lineEnd < 0) return;
      const header = this.buffer.subarray(0, lineEnd).toString('utf8');
      this.buffer = this.buffer.subarray(lineEnd + 1);
      const matched = /^C\d{4} (\d+) .+$/.exec(header);
      if (!matched) {
        this.stderr.emit('data', Buffer.from('invalid scp header'));
        this.finish(1);
        return;
      }
      this.size = Number(matched[1]);
      this.headerParsed = true;
      this.emit('data', Buffer.from([0]));
    }
    if (this.content.byteLength < this.size) {
      const need = this.size - this.content.byteLength;
      const take = this.buffer.subarray(0, Math.min(need, this.buffer.byteLength));
      this.content = Buffer.concat([this.content, take]);
      this.buffer = this.buffer.subarray(take.byteLength);
      if (this.content.byteLength < this.size) return;
    }
    if (this.buffer.byteLength < 1) return;
    const end = this.buffer[0];
    this.buffer = this.buffer.subarray(1);
    if (end !== 0) {
      this.stderr.emit('data', Buffer.from('invalid scp payload terminator'));
      this.finish(1);
      return;
    }
    const current = this.state.files.get(this.remotePath);
    this.state.files.set(this.remotePath, {
      content: Buffer.from(this.content),
      mode: current?.mode,
      owner: current?.owner,
      group: current?.group,
      mtime: current?.mtime ?? 1_783_036_800,
    });
    this.done = true;
    this.emit('data', Buffer.from([0]));
  }
}

class FakeScpDownloadChannel extends FakeExecChannel {
  private stage: 'start' | 'header_ack' | 'final_ack' = 'start';

  constructor(private readonly state: FakeScpState, private readonly remotePath: string) {
    super();
  }

  override write(chunk: Buffer | string): boolean {
    const data = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk);
    if (data[0] !== 0) {
      this.stderr.emit('data', Buffer.from('invalid client ack'));
      this.finish(1);
      return true;
    }
    const file = this.state.files.get(this.remotePath);
    if (!file) {
      this.stderr.emit('data', Buffer.from('missing remote file'));
      this.finish(1);
      return true;
    }
    if (this.stage === 'start') {
      this.stage = 'header_ack';
      this.emit('data', Buffer.from(`C0644 ${file.content.byteLength} ${this.remotePath.split('/').pop()}\n`, 'utf8'));
      return true;
    }
    if (this.stage === 'header_ack') {
      this.stage = 'final_ack';
      this.emit('data', Buffer.concat([Buffer.from(file.content), Buffer.from([0])]));
      return true;
    }
    this.finish(0);
    return true;
  }
}

function executeFakeShell(state: FakeScpState, command: string): { stdout: string; stderr: string; exitCode: number } {
  const args = parseQuoted(command);
  if (command.startsWith('test -e ')) {
    return { stdout: '', stderr: '', exitCode: state.files.has(args[0] ?? '') ? 0 : 1 };
  }
  if (command.startsWith('LC_ALL=C stat -c ')) {
    const file = state.files.get(args.at(-1) ?? '');
    if (!file) return { stdout: '', stderr: 'missing', exitCode: 1 };
    return {
      stdout: `${file.content.byteLength}\t${file.mode ?? '0644'}\t${file.owner ?? 'root'}\t${file.group ?? 'root'}\t${file.mtime ?? 1_783_036_800}\n`,
      stderr: '',
      exitCode: 0,
    };
  }
  if (command.startsWith('mv -f -- ')) {
    const [source, target] = args;
    const file = state.files.get(source ?? '');
    if (!file || !target) return { stdout: '', stderr: 'missing source', exitCode: 1 };
    state.files.set(target, { ...file, content: Buffer.from(file.content) });
    state.files.delete(source ?? '');
    return { stdout: '', stderr: '', exitCode: 0 };
  }
  if (command.startsWith('rm -f -- ')) {
    state.files.delete(args[0] ?? '');
    return { stdout: '', stderr: '', exitCode: 0 };
  }
  if (command.startsWith('chmod ')) {
    const matched = /^chmod ([0-7]{3,4}) -- /.exec(command);
    const file = state.files.get(args[0] ?? '');
    if (!matched || !file) return { stdout: '', stderr: 'missing chmod target', exitCode: 1 };
    file.mode = matched[1];
    return { stdout: '', stderr: '', exitCode: 0 };
  }
  if (command.startsWith('chown ')) {
    const file = state.files.get(args[1] ?? '');
    if (!file) return { stdout: '', stderr: 'missing chown target', exitCode: 1 };
    const [owner, group] = (args[0] ?? '').split(':');
    file.owner = owner || file.owner;
    file.group = group || file.group;
    return { stdout: '', stderr: '', exitCode: 0 };
  }
  if (command.startsWith('chgrp ')) {
    const file = state.files.get(args[1] ?? '');
    if (!file) return { stdout: '', stderr: 'missing chgrp target', exitCode: 1 };
    file.group = args[0] ?? file.group;
    return { stdout: '', stderr: '', exitCode: 0 };
  }
  return { stdout: '', stderr: `unsupported command: ${command}`, exitCode: 1 };
}

function parseQuoted(command: string): string[] {
  return [...command.matchAll(/'([^']*)'/g)].map((match) => match[1] ?? '');
}
