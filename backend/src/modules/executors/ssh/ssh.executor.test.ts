import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import { AppError } from '../../../common/errors/app-error.js';
import { HostKeyVerifier, InMemoryKnownHostRepository } from './ssh.known-hosts.js';
import { StaticSshSecretResolver } from './ssh.secret-resolver.js';
import { SSHExecutor, type SSHExecutionRequest } from './ssh.executor.js';
import type { SshCommandBatchResult, SshCommandRequest, SshCommandResult } from './ssh.types.js';
import type { SshConnectionManager, SshSession } from './ssh.connection-manager.js';
import { SshCommandRunner } from './ssh.command-runner.js';

describe('spec015 SSH 后端真实连接与命令执行', () => {
  it('校验 SecretRef、路径和 dry-run 计划，返回 010 可消费结果', async () => {
    const executor = new SSHExecutor();
    const result = await executor.execute({
      idempotencyKey: 'idem_ssh_1',
      dryRun: true,
      connection: { host: 'web-01', username: 'deploy', credentialSecretRef: 'secret://ssh/web-01#current', expectedHostKeyFingerprint: 'aabbccddeeff0011' },
      program: 'systemctl',
      args: ['service-main'],
      argumentTemplate: 'systemctl.reload',
      sftp: [{ direction: 'upload', localPath: '/artifact/cert.pem', remotePath: '/etc/nginx/cert.pem' }],
      backup: [{ remotePath: '/etc/nginx/cert.pem', backupRef: 'backup://cert.pem' }],
    });
    assert.equal(result.success, true);
    assert.equal(result.dryRun, true);
    assert.equal(result.mode, 'dry_run');
    assert.deepEqual(result.plannedActions, ['hostkey:verified', 'exec:systemctl:systemctl.reload:service-main', 'sftp:upload:/etc/nginx/cert.pem', 'backup:/etc/nginx/cert.pem:backup://cert.pem']);
    assert.equal(result.hostKeyDecision, 'verified');
    assert.deepEqual(result.backupManifest, [{ remotePath: '/etc/nginx/cert.pem', backupRef: 'backup://cert.pem' }]);
    assert.deepEqual(executor.getRequiredCapabilities(), ['ssh.connect', 'ssh.hostkey.verify', 'ssh.exec', 'ssh.sftp', 'ssh.scp', 'ssh.sudo', 'file.write', 'file.backup', 'file.rollback']);
  });

  it('拒绝明文凭据、危险命令、非法路径和重复幂等键', async () => {
    const executor = new SSHExecutor();
    await assert.rejects(() => executor.execute({ idempotencyKey: 'bad_cred', connection: { host: 'h', username: 'u', credentialSecretRef: 'password=123' }, program: 'systemctl', args: ['service-main'], argumentTemplate: 'systemctl.reload' }), /SecretRef/);
    await assert.rejects(() => executor.execute({ idempotencyKey: 'bad_hostkey', connection: { host: 'h', username: 'u', credentialSecretRef: 'secret://ssh/current' }, program: 'systemctl', args: ['service-main'], argumentTemplate: 'systemctl.reload' }), /Host Key/);
    await assert.rejects(() => executor.execute({ idempotencyKey: 'bad_shell', connection: { host: 'h', username: 'u', credentialSecretRef: 'secret://ssh/current', expectedHostKeyFingerprint: 'aabbccddeeff0011' }, program: 'systemctl', args: ['reload; sh -c id'], argumentTemplate: 'systemctl.reload' }), /元字符/);
    await assert.rejects(() => executor.execute({ idempotencyKey: 'bad_interpreter', connection: { host: 'h', username: 'u', credentialSecretRef: 'secret://ssh/current', expectedHostKeyFingerprint: 'aabbccddeeff0011' }, program: 'systemctl', args: ['powershell'], argumentTemplate: 'systemctl.reload' }), /解释器|服务名/);
    await assert.rejects(() => executor.execute({ idempotencyKey: 'bad_template', connection: { host: 'h', username: 'u', credentialSecretRef: 'secret://ssh/current', expectedHostKeyFingerprint: 'aabbccddeeff0011' }, program: 'systemctl', args: ['nginx'], argumentTemplate: 'systemctl.stop' as never }), /模板/);
    await assert.rejects(() => executor.execute({ idempotencyKey: 'bad_path', connection: { host: 'h', username: 'u', credentialSecretRef: 'secret://ssh/current', expectedHostKeyFingerprint: 'aabbccddeeff0011' }, sftp: [{ direction: 'upload', localPath: '../x', remotePath: '/tmp/x' }] }), /路径/);
    await assert.rejects(() => executor.execute({ idempotencyKey: 'bad_relative_remote_path', connection: { host: 'h', username: 'u', credentialSecretRef: 'secret://ssh/current', expectedHostKeyFingerprint: 'aabbccddeeff0011' }, dryRun: true, sftp: [{ direction: 'upload', localPath: '/tmp/x', remotePath: 'tmp/x' }] }), /远程路径/);
    const privateKeyTransfer = await executor.execute({
      idempotencyKey: 'private_key_file_transfer_ok',
      dryRun: true,
      connection: { host: 'h', username: 'u', credentialSecretRef: 'secret://ssh/current', expectedHostKeyFingerprint: 'aabbccddeeff0011' },
      sftp: [{
        direction: 'upload',
        localPath: 'virtual://workflow/key',
        remotePath: '/tmp/key.pem',
        content: '-----BEGIN PRIVATE KEY-----ok-----END PRIVATE KEY-----',
      }],
    });
    assert.equal(privateKeyTransfer.success, true);
    assert.deepEqual(privateKeyTransfer.plannedActions, ['hostkey:verified', 'sftp:upload:/tmp/key.pem']);
    await executor.execute({ idempotencyKey: 'idem_ssh_once', connection: { host: 'h', username: 'u', credentialSecretRef: 'secret://ssh/current', expectedHostKeyFingerprint: 'aabbccddeeff0011' }, program: 'systemctl', args: ['service-main'], argumentTemplate: 'systemctl.reload', allowMockExecution: true });
    await assert.rejects(() => executor.execute({ idempotencyKey: 'idem_ssh_once', connection: { host: 'h', username: 'u', credentialSecretRef: 'secret://ssh/current', expectedHostKeyFingerprint: 'aabbccddeeff0011' }, program: 'systemctl', args: ['service-main'], argumentTemplate: 'systemctl.reload', allowMockExecution: true }), /幂等键/);
  });

  it('支持 HostKey 策略、sudo SecretRef、Windows OpenSSH 限制和能力探测', async () => {
    const executor = new SSHExecutor();
    const tof = await executor.execute({
      idempotencyKey: 'idem_ssh_tofu',
      dryRun: true,
      connection: { host: 'web-02', username: 'deploy', credentialSecretRef: 'secret://ssh/web-02#current', hostKeyPolicy: 'trust_on_first_use' },
      program: 'systemctl', args: ['service-main'], argumentTemplate: 'systemctl.reload',
      sudo: { enabled: true, passwordSecretRef: 'secret://password/sudo-web-02#current' },
      rollback: [{ backupRef: 'backup://old-cert', remotePath: '/etc/nginx/cert.pem' }],
    });
    assert.equal(tof.hostKeyDecision, 'trust_on_first_use');
    assert.ok(tof.plannedActions.includes('rollback:backup://old-cert:/etc/nginx/cert.pem'));
    await assert.rejects(() => executor.execute({
      idempotencyKey: 'idem_win_bad',
      connection: { host: 'win', username: 'deploy', credentialSecretRef: 'secret://ssh/win#current', expectedHostKeyFingerprint: 'aabbccddeeff0011', platform: 'WINDOWS_OPENSSH' },
      program: 'systemctl', args: ['nginx'], argumentTemplate: 'systemctl.reload',
    }), /Windows OpenSSH/);

    const probe = executor.probeCapabilities({ host: 'win', username: 'deploy', credentialSecretRef: 'secret://ssh/win#current', expectedHostKeyFingerprint: 'aabbccddeeff0011', platform: 'WINDOWS_OPENSSH' });
    assert.equal(probe.declarations.some((item) => item.capabilityKey === 'os.windows_openssh' && item.value === true), true);
    assert.equal(probe.compatibilityWarnings.length, 1);
  });

  it('missing sshRequest 不允许伪成功，mock 路径必须显式标记', async () => {
    const executor = new SSHExecutor();
    const missing = await executor.executeStep({
      dryRun: false,
      runType: 'workflow',
      step: fakeStep({}),
    });
    assert.equal(missing.success, false);
    assert.equal(missing.errorCode, 'SSH_REQUEST_REQUIRED');

    await assert.rejects(() => executor.execute(baseRequest({ mockExitCode: 0 })), /allowMockExecution/);
    const explicitMock = await executor.execute(baseRequest({ mockExitCode: 7, allowMockExecution: true }));
    assert.equal(explicitMock.mode, 'explicit_mock');
    assert.equal(explicitMock.success, false);
    assert.equal(explicitMock.exitCode, 7);
  });

  it('真实执行路径返回命令成功、失败和认证失败结构化错误', async () => {
    const okExecutor = new SSHExecutor({
      secretResolver: new StaticSshSecretResolver({ 'secret://ssh/web#current': 'correct-password' }),
      connectionManager: new FakeConnectionManager('ok') as unknown as SshConnectionManager,
      commandRunner: new FakeCommandRunner({ exitCode: 0, stdout: 'ok\n' }) as unknown as SshCommandRunner,
    });
    const ok = await okExecutor.execute(baseRequest({ idempotencyKey: 'real_ok' }));
    assert.equal(ok.mode, 'real_ssh');
    assert.equal(ok.success, true);
    assert.equal(ok.commandResult?.stdout, 'ok\n');

    const failExecutor = new SSHExecutor({
      connectionManager: new FakeConnectionManager('ok') as unknown as SshConnectionManager,
      commandRunner: new FakeCommandRunner({ exitCode: 2, stderr: 'bad\n' }) as unknown as SshCommandRunner,
    });
    const failed = await failExecutor.execute(baseRequest({ idempotencyKey: 'real_fail' }));
    assert.equal(failed.success, false);
    assert.equal(failed.commandResult?.errorCode, 'SSH_COMMAND_FAILED');
    assert.equal(failed.commandResult?.exitCode, 2);

    const authExecutor = new SSHExecutor({ connectionManager: new FakeConnectionManager('auth_failed') as unknown as SshConnectionManager });
    await assert.rejects(() => authExecutor.execute(baseRequest({ idempotencyKey: 'auth_failed' })), (error: unknown) => {
      assert.equal(error instanceof AppError, true);
      assert.equal((error as AppError).errorCode, 'AUTH_FORBIDDEN');
      assert.equal(((error as AppError).details as { sshErrorCode: string }).sshErrorCode, 'SSH_AUTH_FAILED');
      return true;
    });
  });

  it('Host Key mismatch 阻断执行并记录 mismatch 状态', async () => {
    const repository = new InMemoryKnownHostRepository([{
      id: 'kh-1',
      address: 'web-01',
      port: 22,
      algorithm: 'ssh-ed25519',
      fingerprint: 'aabbccddeeff0011',
      status: 'trusted',
      firstSeenAt: '2026-07-02T00:00:00.000Z',
      lastSeenAt: '2026-07-02T00:00:00.000Z',
    }]);
    const verifier = new HostKeyVerifier(repository);
    await assert.rejects(
      () => verifier.verify({ host: 'web-01', username: 'deploy', credentialSecretRef: 'secret://ssh/web#current' }, { algorithm: 'ssh-ed25519', fingerprint: 'ffeeddccbbaa0011' }),
      /Known Hosts/,
    );
    const record = await repository.find('web-01', 22);
    assert.equal(record?.status, 'mismatch');
  });

  it('命令 runner 覆盖成功、失败、超时和 Secret 脱敏', async () => {
    const runner = new SshCommandRunner();
    const success = await runner.run(fakeSession(new FakeSshClient({ exitCode: 0, stdout: 'token=super-secret\n' })), {
       program: 'systemctl',
       args: ['service-main'],
       argumentTemplate: 'systemctl.reload',
      timeoutMs: 100,
      sensitiveValues: ['super-secret'],
    });
    assert.equal(success.success, true);
    assert.equal(success.exitCode, 0);
    assert.equal(success.stdout.includes('super-secret'), false);
    assert.equal(success.sanitizedCommand.includes('super-secret'), false);
    assert.equal(success.audit?.program, 'systemctl');
    assert.deepEqual(success.audit?.remotePaths, []);

    const failure = await runner.run(fakeSession(new FakeSshClient({ exitCode: 9, stderr: 'no\n' })), { program: 'systemctl', args: ['service-main'], argumentTemplate: 'systemctl.reload', timeoutMs: 100 });
    assert.equal(failure.success, false);
    assert.equal(failure.errorCode, 'SSH_COMMAND_FAILED');

    const timeout = await runner.run(fakeSession(new FakeSshClient({ neverClose: true })), { program: 'systemctl', args: ['service-main'], argumentTemplate: 'systemctl.reload', timeoutMs: 5 });
    assert.equal(timeout.success, false);
    assert.equal(timeout.timedOut, true);
    assert.equal(timeout.errorCode, 'COMMAND_TIMEOUT');
  });

  it('SSH runner 只执行一个结构化白名单程序请求', async () => {
    const runner = new SshCommandRunner();
    const result = await runner.run(fakeSession(new FakeSshClient({ exitCode: 0, stdout: 'ok\n' })), {
      program: 'systemctl',
      args: ['service-main'],
      argumentTemplate: 'systemctl.reload',
      timeoutMs: 100,
    });

    assert.equal(result.success, true);
    assert.equal(result.commandResults, undefined);
    assert.match(result.sanitizedCommand, /^systemctl 'reload' 'service-main'$/);

    const executor = new SSHExecutor();
    const dryRun = await executor.execute({
      idempotencyKey: 'idem_ssh_commands',
      dryRun: true,
      connection: { host: 'web-03', username: 'deploy', credentialSecretRef: 'secret://ssh/web-03#current', expectedHostKeyFingerprint: 'aabbccddeeff0011' },
      program: 'systemctl',
      args: ['service-main'],
      argumentTemplate: 'systemctl.reload',
    });
    assert.deepEqual(dryRun.plannedActions, ['hostkey:verified', 'exec:systemctl:systemctl.reload:service-main']);
  });
});

function baseRequest(overrides: Partial<SSHExecutionRequest> = {}): SSHExecutionRequest {
  return {
    idempotencyKey: 'idem_base',
    connection: { host: 'web', username: 'deploy', credentialSecretRef: 'secret://ssh/web#current', expectedHostKeyFingerprint: 'aabbccddeeff0011' },
      program: 'systemctl', args: ['service-main'], argumentTemplate: 'systemctl.reload',
    timeoutMs: 1000,
    ...overrides,
  };
}

function fakeStep(inputSnapshot: Record<string, unknown>) {
  return {
    id: 'step-1',
    executionRunId: 'run-1',
    tenantId: 'tenant-1',
    inputSnapshot,
    stepType: 'SSH',
    attemptCount: 0,
  } as any;
}

class FakeConnectionManager {
  constructor(private readonly mode: 'ok' | 'auth_failed') {}

  async connect(): Promise<SshSession> {
    if (this.mode === 'auth_failed') {
      throw new AppError('AUTH_FORBIDDEN', 'SSH 认证失败', { sshErrorCode: 'SSH_AUTH_FAILED', stage: 'auth' });
    }
    return fakeSession(new FakeSshClient({ exitCode: 0 }));
  }
}

class FakeCommandRunner {
  constructor(private readonly result: { exitCode: number; stdout?: string; stderr?: string }) {}

  async run(_session: SshSession, request: SshCommandRequest): Promise<SshCommandBatchResult> {
    const now = new Date().toISOString();
    return {
      success: this.result.exitCode === 0,
      exitCode: this.result.exitCode,
      stdout: this.result.stdout ?? '',
      stderr: this.result.stderr ?? '',
      timedOut: false,
      durationMs: 1,
      startedAt: now,
      endedAt: now,
      sanitizedCommand: `${request.program} ${request.argumentTemplate} ${(request.args ?? []).join(' ')}`,
      errorCode: this.result.exitCode === 0 ? undefined : 'SSH_COMMAND_FAILED',
      errorMessage: this.result.exitCode === 0 ? undefined : `SSH 命令退出码非零：${this.result.exitCode}`,
    };
  }
}

function fakeSession(client: FakeSshClient): SshSession {
  return {
    client: client as any,
    config: { host: 'web', username: 'deploy', credentialSecretRef: 'secret://ssh/web#current', credential: { kind: 'password', username: 'deploy', password: 'super-secret', secretRefs: [] } },
    hostKeyDecision: 'verified',
    sensitiveValues: ['super-secret'],
    close: () => undefined,
  };
}

class FakeSshClient {
  constructor(private readonly behavior: { exitCode?: number; stdout?: string; stderr?: string; neverClose?: boolean }) {}

  exec(_command: string, callback: (error: Error | undefined, stream: FakeChannel) => void): void {
    const stream = new FakeChannel();
    callback(undefined, stream);
    setTimeout(() => {
      if (this.behavior.stdout) stream.emit('data', Buffer.from(this.behavior.stdout));
      if (this.behavior.stderr) stream.stderr.emit('data', Buffer.from(this.behavior.stderr));
      if (!this.behavior.neverClose) stream.emit('close', this.behavior.exitCode ?? 0);
    }, 0);
  }
}

class FakeChannel extends EventEmitter {
  readonly stderr = new EventEmitter();
  close(): void {
    this.emit('close', null);
  }
}
