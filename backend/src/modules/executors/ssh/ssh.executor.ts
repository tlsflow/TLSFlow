import { AppError } from '../../../common/errors/app-error.js';
import type { Executor, StepExecutionInput, StepExecutionResult } from '../../executions/application/executors.js';

export interface SSHConnectionProfile {
  host: string;
  port?: number;
  username: string;
  credentialSecretRef: string;
  expectedHostKeyFingerprint?: string;
  observedHostKeyFingerprint?: string;
  hostKeyPolicy?: 'strict' | 'trust_on_first_use' | 'manual_approval_required';
  platform?: 'LINUX' | 'WINDOWS_OPENSSH' | 'UNKNOWN';
}

export interface SftpTransferPlan {
  direction: 'upload' | 'download';
  localPath: string;
  remotePath: string;
  mode?: string;
}

export interface ScpTransferPlan extends SftpTransferPlan {}

export interface SSHExecutionRequest {
  idempotencyKey: string;
  connection: SSHConnectionProfile;
  command?: string;
  sudo?: { enabled: boolean; passwordSecretRef?: string; requirePty?: boolean };
  sftp?: SftpTransferPlan[];
  scp?: ScpTransferPlan[];
  backup?: Array<{ remotePath: string; backupRef: string }>;
  rollback?: Array<{ backupRef: string; remotePath: string; deleteIfOriginalMissing?: boolean }>;
  timeoutMs?: number;
  dryRun?: boolean;
  mockExitCode?: number;
}

export interface SSHExecutionResult {
  success: boolean;
  exitCode: number;
  plannedActions: string[];
  hostKeyDecision: 'verified' | 'trust_on_first_use' | 'manual_approval_required';
  backupManifest: Array<{ remotePath: string; backupRef: string }>;
  dryRun: boolean;
}

export interface SSHCapabilityProbeResult {
  declarations: Array<{ capabilityKey: string; value: unknown; confidence: number; evidence: Record<string, unknown> }>;
  compatibilityWarnings: string[];
}

export class SSHExecutor implements Executor {
  readonly type = 'SSH';
  private readonly executed = new Set<string>();

  async executeStep(input: StepExecutionInput): Promise<StepExecutionResult> {
    const request = input.step.inputSnapshot.sshRequest as SSHExecutionRequest | undefined;
    if (!request) return { success: true, detail: { skipped: true, reason: 'missing sshRequest' } };
    const result = this.execute(request, input.dryRun);
    return result.success ? { success: true, detail: result as unknown as Record<string, unknown> } : { success: false, errorCode: 'SSH_COMMAND_FAILED', errorMessage: 'SSH mock 执行失败', detail: result as unknown as Record<string, unknown> };
  }

  execute(request: SSHExecutionRequest, forceDryRun = false): SSHExecutionResult {
    validateRequest(request);
    if (this.executed.has(request.idempotencyKey)) throw new AppError('IDEMPOTENCY_CONFLICT', 'SSH 请求幂等键已执行', { idempotencyKey: request.idempotencyKey });
    const dryRun = forceDryRun || request.dryRun === true;
    const plannedActions = [
      `hostkey:${hostKeyDecision(request.connection)}`,
      ...(request.command ? [`exec:${request.command}`] : []),
      ...(request.sftp ?? []).map((item) => `sftp:${item.direction}:${normalizePath(item.remotePath)}`),
      ...(request.scp ?? []).map((item) => `scp:${item.direction}:${normalizePath(item.remotePath)}`),
      ...(request.backup ?? []).map((item) => `backup:${normalizePath(item.remotePath)}:${item.backupRef}`),
      ...(request.rollback ?? []).map((item) => `rollback:${item.backupRef}:${normalizePath(item.remotePath)}`),
    ];
    const backupManifest = (request.backup ?? []).map((item) => ({ remotePath: normalizePath(item.remotePath), backupRef: item.backupRef }));
    if (dryRun) return { success: true, exitCode: 0, plannedActions, hostKeyDecision: hostKeyDecision(request.connection), backupManifest, dryRun };
    this.executed.add(request.idempotencyKey);
    const exitCode = request.mockExitCode ?? 0;
    return { success: exitCode === 0, exitCode, plannedActions, hostKeyDecision: hostKeyDecision(request.connection), backupManifest, dryRun };
  }

  getRequiredCapabilities(): string[] {
    return ['ssh.connect', 'ssh.hostkey.verify', 'ssh.exec', 'ssh.sftp', 'ssh.scp', 'ssh.sudo', 'file.write', 'file.backup', 'file.rollback'];
  }

  probeCapabilities(connection: SSHConnectionProfile): SSHCapabilityProbeResult {
    const platform = connection.platform ?? 'UNKNOWN';
    return {
      declarations: [
        declaration('ssh.connect', true, connection, 0.9),
        declaration('ssh.hostkey.verify', hostKeyDecision(connection) === 'verified', connection, connection.expectedHostKeyFingerprint ? 0.95 : 0.6),
        declaration('ssh.exec', true, connection, 0.85),
        declaration('ssh.sftp', true, connection, 0.8),
        declaration('ssh.scp', true, connection, 0.75),
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
  if (!/^secret:\/\/.+/.test(request.connection.credentialSecretRef)) {
    throw new AppError('VALIDATION_FAILED', 'SSH 凭据必须使用 SecretRef', { field: 'credentialSecretRef' });
  }
  hostKeyDecision(request.connection);
  if (request.timeoutMs !== undefined && (request.timeoutMs < 1 || request.timeoutMs > 300_000)) throw new AppError('VALIDATION_FAILED', 'timeoutMs 必须在 1-300000 之间');
  if (request.sudo?.enabled && request.sudo.passwordSecretRef && !/^secret:\/\/.+/.test(request.sudo.passwordSecretRef)) {
    throw new AppError('VALIDATION_FAILED', 'sudo 密码必须使用 SecretRef');
  }
  if (request.command) validateCommand(request.command);
  if (request.connection.platform === 'WINDOWS_OPENSSH' && request.command && /(systemctl|chmod|chown|\/etc\/|sudo\b)/.test(request.command)) {
    throw new AppError('VALIDATION_FAILED', 'Windows OpenSSH 目标不允许执行 POSIX 专用步骤', { command: request.command });
  }
  for (const item of [...(request.sftp ?? []), ...(request.scp ?? [])]) {
    normalizePath(item.remotePath);
    normalizePath(item.localPath);
    scanSecretLike(item);
  }
  for (const item of request.backup ?? []) {
    normalizePath(item.remotePath);
    if (!item.backupRef.trim()) throw new AppError('VALIDATION_FAILED', 'backupRef 必填');
  }
  for (const item of request.rollback ?? []) {
    normalizePath(item.remotePath);
    if (!item.backupRef.trim()) throw new AppError('VALIDATION_FAILED', 'rollback backupRef 必填');
  }
}

function hostKeyDecision(connection: SSHConnectionProfile): SSHExecutionResult['hostKeyDecision'] {
  const policy = connection.hostKeyPolicy ?? 'strict';
  if (connection.expectedHostKeyFingerprint) {
    const expected = normalizeFingerprint(connection.expectedHostKeyFingerprint);
    const observed = normalizeFingerprint(connection.observedHostKeyFingerprint ?? connection.expectedHostKeyFingerprint);
    if (expected !== observed) throw new AppError('VALIDATION_FAILED', 'SSH Host Key 指纹不匹配', { host: connection.host });
    return 'verified';
  }
  if (policy === 'trust_on_first_use') return 'trust_on_first_use';
  if (policy === 'manual_approval_required') return 'manual_approval_required';
  throw new AppError('VALIDATION_FAILED', 'strict Host Key 策略要求 expectedHostKeyFingerprint', { host: connection.host });
}

function validateCommand(command: string): void {
  scanSecretLike(command);
  if (/(^|\s)(rm\s+-rf\s+\/|mkfs|dd\s+if=|shutdown|reboot)(\s|$)/i.test(command)) {
    throw new AppError('VALIDATION_FAILED', '危险 SSH 命令被拒绝', { command });
  }
}

function normalizePath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/');
  if (!normalized || normalized.includes('..') || /[\0\r\n]/.test(normalized)) throw new AppError('VALIDATION_FAILED', '路径不合法', { path });
  return normalized;
}

function scanSecretLike(value: unknown): void {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|password\s*=|token\s*=|api[_-]?key\s*=|bearer\s+[a-z0-9._-]{10,}/i.test(text)) {
    throw new AppError('VALIDATION_FAILED', 'SSH 请求包含疑似明文敏感信息');
  }
}

function normalizeFingerprint(value: string): string {
  const normalized = value.trim().replace(/:/g, '').toLowerCase();
  if (!/^[a-f0-9]{16,128}$/.test(normalized)) throw new AppError('VALIDATION_FAILED', 'Host Key 指纹格式不合法');
  return normalized;
}

function declaration(capabilityKey: string, value: unknown, connection: SSHConnectionProfile, confidence: number) {
  return { capabilityKey, value, confidence, evidence: { host: connection.host, platform: connection.platform ?? 'UNKNOWN' } };
}
