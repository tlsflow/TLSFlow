import { AppError } from '../../../common/errors/app-error.js';
import type { Executor, StepExecutionInput, StepExecutionResult } from '../../executions/application/executors.js';
import { HostKeyVerifier, normalizeFingerprint } from './ssh.known-hosts.js';
import { assertNoInlineSshSecret } from './ssh.redaction.js';
import { SshCommandRunner } from './ssh.command-runner.js';
import { SshConnectionManager } from './ssh.connection-manager.js';
import type { SSHConnectionProfile, SshCommandBatchResult, SshSecretResolver, SshSecretResolverContext } from './ssh.types.js';
import { FileTransferService, type FileTransferCapabilities, type FileTransferPlan, type FileTransferResult } from './ssh.file-transfer.js';
import { RemoteBackupService, type BackupManifest } from './ssh.remote-backup.js';
import { RemoteRollbackService, type RollbackResult } from './ssh.rollback.js';
import { SshRemoteFileClient } from './ssh.remote-file-client.js';

export type { SSHConnectionProfile } from './ssh.types.js';

export interface SftpTransferPlan {
  direction: 'upload' | 'download';
  localPath: string;
  remotePath: string;
  content?: string | Buffer;
  temporaryPath?: string;
  expectedHash?: string;
  expectedSize?: number;
  verifyHash?: boolean;
  mode?: string;
  owner?: string;
  group?: string;
  allowScpFallback?: boolean;
}

export interface ScpTransferPlan extends SftpTransferPlan {}

export interface SSHExecutionRequest {
  idempotencyKey: string;
  connection: SSHConnectionProfile;
  command?: string;
  commands?: string[];
  script?: string;
  workingDirectory?: string;
  environment?: Record<string, string>;
  sudo?: { enabled: boolean; passwordSecretRef?: string; requirePty?: boolean };
  sftp?: SftpTransferPlan[];
  scp?: ScpTransferPlan[];
  fileTransferCapabilities?: FileTransferCapabilities;
  backup?: Array<{ remotePath: string; backupRef: string }>;
  rollback?: Array<{ backupRef: string; remotePath: string; deleteIfOriginalMissing?: boolean }>;
  backupManifest?: BackupManifest;
  timeoutMs?: number;
  connectTimeoutMs?: number;
  dryRun?: boolean;
  mockExitCode?: number;
  allowMockExecution?: boolean;
  successExitCodes?: number[];
}

export interface SSHExecutionResult {
  success: boolean;
  exitCode: number | null;
  plannedActions: string[];
  hostKeyDecision: 'verified' | 'trust_on_first_use' | 'manual_approval_required';
  backupManifest: Array<{ remotePath: string; backupRef: string }>;
  transferResults?: FileTransferResult[];
  generatedBackupManifest?: BackupManifest;
  rollbackResult?: RollbackResult;
  dryRun: boolean;
  mode: 'dry_run' | 'real_ssh' | 'explicit_mock';
  commandResult?: SshCommandBatchResult;
}

export interface SSHCapabilityProbeResult {
  declarations: Array<{ capabilityKey: string; value: unknown; confidence: number; evidence: Record<string, unknown> }>;
  compatibilityWarnings: string[];
}

export interface SSHExecutorOptions {
  secretResolver?: SshSecretResolver;
  connectionManager?: SshConnectionManager;
  commandRunner?: SshCommandRunner;
  hostKeyVerifier?: HostKeyVerifier;
  fileTransfer?: FileTransferService;
  remoteBackup?: RemoteBackupService;
  rollback?: RemoteRollbackService;
}

export class SSHExecutor implements Executor {
  readonly type = 'SSH';
  private readonly executed = new Set<string>();
  private readonly connectionManager: SshConnectionManager;
  private readonly commandRunner: SshCommandRunner;
  private readonly fileTransfer?: FileTransferService;
  private readonly remoteBackup?: RemoteBackupService;
  private readonly rollback?: RemoteRollbackService;

  constructor(private readonly options: SSHExecutorOptions = {}) {
    this.connectionManager = options.connectionManager ?? new SshConnectionManager({
      secretResolver: options.secretResolver,
      hostKeyVerifier: options.hostKeyVerifier,
    });
    this.commandRunner = options.commandRunner ?? new SshCommandRunner();
    this.fileTransfer = options.fileTransfer;
    this.remoteBackup = options.remoteBackup;
    this.rollback = options.rollback;
  }

  async executeStep(input: StepExecutionInput): Promise<StepExecutionResult> {
    const request = input.step.inputSnapshot.sshRequest as SSHExecutionRequest | undefined;
    if (!request) {
      return { success: false, errorCode: 'SSH_REQUEST_REQUIRED', errorMessage: 'SSH 执行器缺少 sshRequest，拒绝伪成功' };
    }
    try {
      const result = await this.execute(request, input.dryRun, {
        runId: input.step.executionRunId,
        stepId: input.step.id,
        tenantId: input.step.tenantId,
        actorId: 'ssh-executor',
      });
      return result.success
        ? { success: true, detail: result as unknown as Record<string, unknown> }
        : { success: false, errorCode: result.commandResult?.errorCode ?? 'SSH_COMMAND_FAILED', errorMessage: result.commandResult?.errorMessage ?? 'SSH 执行失败', detail: result as unknown as Record<string, unknown> };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, errorCode: readSshErrorCode(error) ?? error.errorCode, errorMessage: error.message, detail: error.details as Record<string, unknown> | undefined };
      }
      return { success: false, errorCode: 'SSH_COMMAND_FAILED', errorMessage: error instanceof Error ? error.message : String(error) };
    }
  }

  async execute(request: SSHExecutionRequest, forceDryRun = false, context: SshSecretResolverContext = {}): Promise<SSHExecutionResult> {
    validateRequest(request);
    if (this.executed.has(request.idempotencyKey)) throw new AppError('IDEMPOTENCY_CONFLICT', 'SSH 请求幂等键已执行', { idempotencyKey: request.idempotencyKey });
    const dryRun = forceDryRun || request.dryRun === true;
    const plannedActions = buildPlannedActions(request);
    const backupManifest = (request.backup ?? []).map((item) => ({ remotePath: normalizePath(item.remotePath), backupRef: item.backupRef }));
    const hostKeyDecision = dryRun ? dryRunHostKeyDecision(request.connection) : 'verified';

    if (dryRun) {
      return { success: true, exitCode: 0, plannedActions, hostKeyDecision, backupManifest, dryRun: true, mode: 'dry_run' };
    }

    if (request.allowMockExecution === true) {
      this.executed.add(request.idempotencyKey);
      const exitCode = request.mockExitCode ?? 0;
      return { success: exitCode === 0, exitCode, plannedActions, hostKeyDecision: dryRunHostKeyDecision(request.connection), backupManifest, dryRun: false, mode: 'explicit_mock' };
    }

    if (request.mockExitCode !== undefined) {
      throw new AppError('VALIDATION_FAILED', 'mockExitCode 只能在 allowMockExecution=true 时使用，真实执行禁止静默 mock');
    }

    const fileWork = await this.executeFileWork(request, context);
    if (!request.command && !request.script) {
      this.executed.add(request.idempotencyKey);
      return {
        success: fileWork.rollbackResult?.success ?? true,
        exitCode: 0,
        plannedActions,
        hostKeyDecision,
        backupManifest,
        dryRun: false,
        mode: 'real_ssh',
        transferResults: fileWork.transferResults,
        generatedBackupManifest: fileWork.generatedBackupManifest,
        rollbackResult: fileWork.rollbackResult,
      };
    }

    const session = await this.connectionManager.connect({ ...request.connection, connectTimeoutMs: request.connectTimeoutMs ?? request.connection.connectTimeoutMs }, context);
    try {
      const commandResult = await this.commandRunner.run(session, {
        command: request.command,
        commands: request.commands,
        script: request.script,
        workingDirectory: request.workingDirectory,
        environment: request.environment,
        timeoutMs: request.timeoutMs ?? 30_000,
        successExitCodes: request.successExitCodes,
      });
      this.executed.add(request.idempotencyKey);
      return {
        success: commandResult.success,
        exitCode: commandResult.exitCode,
        plannedActions,
        hostKeyDecision: session.hostKeyDecision,
        backupManifest,
        dryRun: false,
        mode: 'real_ssh',
        commandResult,
        transferResults: fileWork.transferResults,
        generatedBackupManifest: fileWork.generatedBackupManifest,
        rollbackResult: fileWork.rollbackResult,
      };
    } finally {
      session.close();
    }
  }

  private async executeFileWork(request: SSHExecutionRequest, context: SshSecretResolverContext = {}): Promise<Pick<SSHExecutionResult, 'transferResults' | 'generatedBackupManifest' | 'rollbackResult'>> {
    if (!hasFileWork(request)) return {};
    if (!this.fileTransfer && !this.remoteBackup && !this.rollback) {
      const session = await this.connectionManager.connect({ ...request.connection, connectTimeoutMs: request.connectTimeoutMs ?? request.connection.connectTimeoutMs }, context);
      try {
        const capabilities = request.fileTransferCapabilities ?? { sftp: true, scp: false };
        const remoteClient = new SshRemoteFileClient(session, capabilities);
        const fileTransfer = new FileTransferService(remoteClient);
        const remoteBackup = new RemoteBackupService(remoteClient);
        const rollback = new RemoteRollbackService(remoteClient);
        const safeContext = context ?? {};
        const generatedBackupManifest = (request.backup?.length ?? 0) > 0
          ? await remoteBackup.createManifest({
            targetHostId: request.connection.hostId ?? request.connection.host,
            taskId: `${safeContext.runId ?? 'run'}:${safeContext.stepId ?? request.idempotencyKey}`,
            items: request.backup ?? [],
          })
          : undefined;

        const transferResults: FileTransferResult[] = [];
        for (const item of request.sftp ?? []) transferResults.push(await fileTransfer.transfer(toFileTransferPlan(item), capabilities));
        for (const item of request.scp ?? []) transferResults.push(await fileTransfer.transfer(toFileTransferPlan({ ...item, allowScpFallback: true }), { sftp: false, scp: true }));

        const manifest = request.backupManifest ?? generatedBackupManifest;
        if ((request.rollback?.length ?? 0) > 0 && !manifest) throw new AppError('VALIDATION_FAILED', 'SSH 回滚步骤缺少 BackupManifest');
        const rollbackResult = manifest && (request.rollback?.length ?? 0) > 0
          ? await rollback.restore(manifest)
          : undefined;

        return { transferResults, generatedBackupManifest, rollbackResult };
      } finally {
        session.close();
      }
    }
    const safeContext = context ?? {};
    const generatedBackupManifest = this.remoteBackup && (request.backup?.length ?? 0) > 0
      ? await this.remoteBackup.createManifest({
        targetHostId: request.connection.hostId ?? request.connection.host,
        taskId: `${safeContext.runId ?? 'run'}:${safeContext.stepId ?? request.idempotencyKey}`,
        items: request.backup ?? [],
      })
      : undefined;

    if ((request.backup?.length ?? 0) > 0 && !this.remoteBackup) throw new AppError('VALIDATION_FAILED', 'SSH 文件备份步骤缺少 RemoteBackupService');

    const transferResults: FileTransferResult[] = [];
    if ((request.sftp?.length ?? 0) > 0 || (request.scp?.length ?? 0) > 0) {
      if (!this.fileTransfer) throw new AppError('VALIDATION_FAILED', 'SSH 文件传输步骤缺少 FileTransferService');
      const capabilities = request.fileTransferCapabilities ?? { sftp: true, scp: false };
      for (const item of request.sftp ?? []) transferResults.push(await this.fileTransfer.transfer(toFileTransferPlan(item), capabilities));
      for (const item of request.scp ?? []) transferResults.push(await this.fileTransfer.transfer(toFileTransferPlan({ ...item, allowScpFallback: true }), { sftp: false, scp: true }));
    }

    if ((request.rollback?.length ?? 0) > 0 && !this.rollback) throw new AppError('VALIDATION_FAILED', 'SSH 回滚步骤缺少 RemoteRollbackService');
    const manifest = request.backupManifest ?? generatedBackupManifest;
    if ((request.rollback?.length ?? 0) > 0 && !manifest) throw new AppError('VALIDATION_FAILED', 'SSH 回滚步骤缺少 BackupManifest');
    const rollbackResult = manifest && this.rollback && (request.rollback?.length ?? 0) > 0
      ? await this.rollback.restore(manifest)
      : undefined;

    return { transferResults, generatedBackupManifest, rollbackResult };
  }

  getRequiredCapabilities(): string[] {
    return ['ssh.connect', 'ssh.hostkey.verify', 'ssh.exec', 'ssh.sftp', 'ssh.scp', 'ssh.sudo', 'file.write', 'file.backup', 'file.rollback'];
  }

  probeCapabilities(connection: SSHConnectionProfile): SSHCapabilityProbeResult {
    const platform = connection.platform ?? 'UNKNOWN';
    return {
      declarations: [
        declaration('ssh.connect', true, connection, 0.9),
        declaration('ssh.hostkey.verify', Boolean(connection.expectedHostKeyFingerprint), connection, connection.expectedHostKeyFingerprint ? 0.95 : 0.6),
        declaration('ssh.exec', true, connection, 0.85),
        declaration('ssh.sftp', true, connection, 0.8),
        declaration('ssh.scp', platform !== 'WINDOWS_OPENSSH', connection, platform === 'WINDOWS_OPENSSH' ? 0.45 : 0.75),
        declaration('os.windows_openssh', platform === 'WINDOWS_OPENSSH', connection, 0.8),
      ],
      compatibilityWarnings: platform === 'WINDOWS_OPENSSH' ? ['Windows OpenSSH 目标不得执行 POSIX 文件权限和 systemctl 步骤'] : [],
    };
  }
}

function validateRequest(request: SSHExecutionRequest): void {
  if (!request.idempotencyKey) throw new AppError('VALIDATION_FAILED', 'idempotencyKey 必填');
  if (!request.connection.host.trim()) throw new AppError('VALIDATION_FAILED', 'host 必填');
  if (!request.connection.username.trim()) throw new AppError('VALIDATION_FAILED', 'username 必填');
  if (!isSecretRef(request.connection.credentialSecretRef)) throw new AppError('VALIDATION_FAILED', 'SSH 凭据必须使用 SecretRef', { field: 'credentialSecretRef' });
  if (request.connection.privateKeyPassphraseSecretRef && !isSecretRef(request.connection.privateKeyPassphraseSecretRef)) throw new AppError('VALIDATION_FAILED', '私钥口令必须使用 SecretRef');
  if (request.timeoutMs !== undefined && (request.timeoutMs < 1 || request.timeoutMs > 300_000)) throw new AppError('VALIDATION_FAILED', 'timeoutMs 必须在 1-300000 之间');
  if (request.connectTimeoutMs !== undefined && (request.connectTimeoutMs < 1 || request.connectTimeoutMs > 120_000)) throw new AppError('VALIDATION_FAILED', 'connectTimeoutMs 必须在 1-120000 之间');
  if (request.sudo?.enabled && request.sudo.passwordSecretRef && !isSecretRef(request.sudo.passwordSecretRef)) throw new AppError('VALIDATION_FAILED', 'sudo 密码必须使用 SecretRef');
  if (request.command) validateCommand(request.command);
  for (const command of request.commands ?? []) validateCommand(command);
  if (request.script) validateCommand(request.script);
  if (request.connection.platform === 'WINDOWS_OPENSSH' && (request.command || request.commands?.length || request.script) && /(systemctl|chmod|chown|\/etc\/|sudo\b)/.test(`${request.command ?? ''}\n${(request.commands ?? []).join('\n')}\n${request.script ?? ''}`)) {
    throw new AppError('VALIDATION_FAILED', 'Windows OpenSSH 目标不允许执行 POSIX 专用步骤', { command: request.command });
  }
  for (const item of [...(request.sftp ?? []), ...(request.scp ?? [])]) {
    normalizePath(item.remotePath);
    normalizePath(item.localPath);
    assertNoInlineSshSecret(item);
  }
  for (const item of request.backup ?? []) {
    normalizePath(item.remotePath);
    if (!item.backupRef.trim()) throw new AppError('VALIDATION_FAILED', 'backupRef 必填');
  }
  for (const item of request.rollback ?? []) {
    normalizePath(item.remotePath);
    if (!item.backupRef.trim()) throw new AppError('VALIDATION_FAILED', 'rollback backupRef 必填');
  }
  if (!request.command && !request.commands?.length && !request.script && !hasFileWork(request) && !request.dryRun && request.allowMockExecution !== true) throw new AppError('VALIDATION_FAILED', '真实 SSH 执行必须提供 command、commands、script 或文件步骤');
}

function hasFileWork(request: SSHExecutionRequest): boolean {
  return (request.sftp?.length ?? 0) > 0
    || (request.scp?.length ?? 0) > 0
    || (request.backup?.length ?? 0) > 0
    || (request.rollback?.length ?? 0) > 0;
}

function toFileTransferPlan(plan: SftpTransferPlan): FileTransferPlan {
  return {
    direction: plan.direction,
    localPath: plan.localPath,
    remotePath: plan.remotePath,
    content: plan.content,
    temporaryPath: plan.temporaryPath,
    expectedHash: plan.expectedHash,
    expectedSize: plan.expectedSize,
    verifyHash: plan.verifyHash,
    mode: plan.mode,
    owner: plan.owner,
    group: plan.group,
    allowScpFallback: plan.allowScpFallback,
  };
}

function buildPlannedActions(request: SSHExecutionRequest): string[] {
  return [
    `hostkey:${dryRunHostKeyDecision(request.connection)}`,
    ...(request.commands ?? []).map((command) => `exec:${command}`),
    ...(request.command ? [`exec:${request.command}`] : []),
    ...(request.script ? ['exec:script'] : []),
    ...(request.sftp ?? []).map((item) => `sftp:${item.direction}:${normalizePath(item.remotePath)}`),
    ...(request.scp ?? []).map((item) => `scp:${item.direction}:${normalizePath(item.remotePath)}`),
    ...(request.backup ?? []).map((item) => `backup:${normalizePath(item.remotePath)}:${item.backupRef}`),
    ...(request.rollback ?? []).map((item) => `rollback:${item.backupRef}:${normalizePath(item.remotePath)}`),
  ];
}

function dryRunHostKeyDecision(connection: SSHConnectionProfile): SSHExecutionResult['hostKeyDecision'] {
  const policy = connection.hostKeyPolicy ?? 'strict';
  if (connection.expectedHostKeyFingerprint) {
    const expected = normalizeFingerprint(connection.expectedHostKeyFingerprint);
    const observed = normalizeFingerprint(connection.observedHostKeyFingerprint ?? connection.expectedHostKeyFingerprint);
    if (expected !== observed) throw new AppError('VALIDATION_FAILED', 'SSH Host Key 指纹不匹配', { host: connection.host, sshErrorCode: 'HOST_KEY_MISMATCH' });
    return 'verified';
  }
  if (policy === 'trust_on_first_use') return 'trust_on_first_use';
  if (policy === 'manual_approval' || policy === 'manual_approval_required') return 'manual_approval_required';
  throw new AppError('VALIDATION_FAILED', 'strict Host Key 策略要求 expectedHostKeyFingerprint 或 Known Hosts 记录', { host: connection.host });
}

function validateCommand(command: string): void {
  assertNoInlineSshSecret(command);
  if (/(^|\s)(rm\s+-rf\s+\/|mkfs|dd\s+if=|shutdown|reboot)(\s|$)/i.test(command)) throw new AppError('VALIDATION_FAILED', '危险 SSH 命令被拒绝', { command });
}

function normalizePath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/');
  if (!normalized || normalized.includes('..') || /[\0\r\n]/.test(normalized)) throw new AppError('VALIDATION_FAILED', '路径不合法', { path });
  return normalized;
}

function isSecretRef(value: string): boolean {
  return /^secret:\/\/.+/.test(value);
}

function readSshErrorCode(error: AppError): string | undefined {
  const details = error.details as { sshErrorCode?: unknown } | undefined;
  return typeof details?.sshErrorCode === 'string' ? details.sshErrorCode : undefined;
}

function declaration(capabilityKey: string, value: unknown, connection: SSHConnectionProfile, confidence: number) {
  return { capabilityKey, value, confidence, evidence: { host: connection.host, platform: connection.platform ?? 'UNKNOWN' } };
}
