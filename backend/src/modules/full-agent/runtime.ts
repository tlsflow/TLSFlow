import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import type { AgentTaskEnvelope } from '../agents/schema/agents.schema.js';
import type { BackupManifest, BackupResult, ProviderRuntimeLog, RollbackResult, StepExecutionResultLike, VerifyReport } from './full-agent.types.js';
import { RecoveryLedger } from './recovery-ledger.js';

export interface SafeRuntimeOptions {
  dataDir: string;
  allowedRoots: string[];
  dryRunDefault?: boolean;
  ledger?: RecoveryLedger;
  commandAllowlist?: string[];
}

export interface AtomicWriteInput {
  targetPath: string;
  content: string | Buffer;
  mode?: number;
  dryRun?: boolean;
}

export interface SafeCommandInput {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  dryRun?: boolean;
}

export interface SafeCommandResult {
  success: boolean;
  dryRun: boolean;
  command: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface FileBackupRecord {
  kind: 'file';
  target: string;
  backupPath: string;
  digest: string;
  existed: boolean;
}

export interface RuntimeProviderTaskPayload {
  action?: 'write-file' | 'verify-file' | 'run-command' | 'rollback';
  targetPath?: string;
  content?: string;
  expectedSha256?: string;
  backupTargets?: string[];
  command?: string;
  args?: string[];
  cwd?: string;
  dryRun?: boolean;
}

function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

async function fileSha256(filePath: string): Promise<string> {
  return sha256(await readFile(filePath));
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

export class SafeFileSystem {
  private readonly allowedRoots: string[];

  constructor(private readonly dataDir: string, allowedRoots: string[]) {
    this.allowedRoots = [...new Set([dataDir, ...allowedRoots].map((root) => resolve(root)))];
  }

  resolveAllowed(inputPath: string): string {
    const resolved = resolve(inputPath);
    const allowed = this.allowedRoots.some((root) => resolved === root || !relative(root, resolved).startsWith('..') && relative(root, resolved) !== '..');
    if (!allowed) throw new Error(`路径越界，拒绝访问：${inputPath}`);
    return resolved;
  }

  async readFile(targetPath: string): Promise<Buffer> {
    return readFile(this.resolveAllowed(targetPath));
  }

  async atomicWrite(input: AtomicWriteInput): Promise<{ dryRun: boolean; targetPath: string; sha256: string }> {
    const targetPath = this.resolveAllowed(input.targetPath);
    const content = Buffer.isBuffer(input.content) ? input.content : Buffer.from(input.content);
    const digest = sha256(content);
    if (input.dryRun) return { dryRun: true, targetPath, sha256: digest };

    await mkdir(dirname(targetPath), { recursive: true });
    const tmpPath = `${targetPath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await writeFile(tmpPath, content, { mode: input.mode ?? 0o600 });
    await rename(tmpPath, targetPath);
    return { dryRun: false, targetPath, sha256: digest };
  }

  async backupFiles(taskId: string, targets: string[], backupRoot: string, dryRun: boolean): Promise<BackupResult> {
    const backupId = `bkp_${taskId}_${Date.now()}`;
    const safeBackupRoot = this.resolveAllowed(backupRoot);
    const records: FileBackupRecord[] = [];

    for (const target of targets) {
      const resolvedTarget = this.resolveAllowed(target);
      const existed = await pathExists(resolvedTarget);
      const digest = existed ? await fileSha256(resolvedTarget) : sha256(`missing:${resolvedTarget}`);
      const backupPath = join(safeBackupRoot, backupId, `${records.length}-${basename(resolvedTarget) || 'artifact'}`);
      records.push({ kind: 'file', target: resolvedTarget, backupPath, digest, existed });
      if (!dryRun && existed) {
        await mkdir(dirname(backupPath), { recursive: true });
        await copyFile(resolvedTarget, backupPath);
      }
    }

    const createdAt = new Date().toISOString();
    const unsigned = {
      backupId,
      taskId,
      createdAt,
      items: records.map((record) => ({ kind: record.kind, target: record.target, digest: record.digest })),
      rollbackActions: records.map((record) => ({ type: 'restore_file_artifact' as const, target: record.target, digest: record.digest, backupPath: record.backupPath, existed: record.existed })),
    };
    const checksum = sha256(JSON.stringify(unsigned));
    const manifest = { ...unsigned, checksum } as BackupManifest;
    return { success: true, manifest };
  }

  verifyManifest(manifest: BackupManifest): boolean {
    const unsigned = {
      backupId: manifest.backupId,
      taskId: manifest.taskId,
      createdAt: manifest.createdAt,
      items: manifest.items,
      rollbackActions: manifest.rollbackActions,
    };
    return manifest.checksum === sha256(JSON.stringify(unsigned));
  }

  async rollbackFiles(manifest: BackupManifest | undefined, dryRun: boolean): Promise<RollbackResult> {
    if (!manifest) {
      return {
        status: 'manual_intervention_required',
        success: false,
        rolledBackAt: new Date().toISOString(),
        restoredTargets: [],
        errorCode: 'ROLLBACK_POINT_MISSING',
        errorMessage: '没有备份点，拒绝伪造回滚成功',
      };
    }
    if (!this.verifyManifest(manifest)) {
      return {
        status: 'manual_intervention_required',
        success: false,
        rolledBackAt: new Date().toISOString(),
        restoredTargets: [],
        errorCode: 'BACKUP_MANIFEST_TAMPERED',
        errorMessage: '备份 manifest 完整性校验失败',
      };
    }

    const restoredTargets: string[] = [];
    for (const action of manifest.rollbackActions) {
      const extended = action as typeof action & { backupPath?: string; existed?: boolean };
      const target = this.resolveAllowed(action.target);
      restoredTargets.push(target);
      if (dryRun) continue;
      if (extended.existed === false) {
        await rm(target, { force: true });
        continue;
      }
      if (!extended.backupPath) {
        return {
          status: 'manual_intervention_required',
          success: false,
          rolledBackAt: new Date().toISOString(),
          restoredTargets,
          errorCode: 'ROLLBACK_ARTIFACT_MISSING',
          errorMessage: '回滚动作缺少备份 artifact 路径',
        };
      }
      const backupPath = this.resolveAllowed(extended.backupPath);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(backupPath, target);
    }

    return {
      status: 'rolled_back',
      success: true,
      rolledBackAt: new Date().toISOString(),
      restoredTargets,
    };
  }
}

export class SafeCommandExecutor {
  private readonly allowlist: Set<string>;

  constructor(commandAllowlist: string[] = ['node']) {
    this.allowlist = new Set(commandAllowlist);
  }

  async execute(input: SafeCommandInput): Promise<SafeCommandResult> {
    const args = input.args ?? [];
    if (input.dryRun) {
      return { success: true, dryRun: true, command: input.command, args, exitCode: 0, stdout: '[dry-run] command not executed', stderr: '' };
    }
    if (!this.allowlist.has(input.command)) {
      return { success: false, dryRun: false, command: input.command, args, exitCode: 126, stdout: '', stderr: 'command denied', errorCode: 'COMMAND_NOT_ALLOWED', errorMessage: '命令不在安全 allowlist 内' };
    }

    return new Promise((resolveResult) => {
      const child = spawn(input.command, args, { cwd: input.cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
      }, input.timeoutMs ?? 30_000);
      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('error', (error) => {
        clearTimeout(timer);
        resolveResult({ success: false, dryRun: false, command: input.command, args, exitCode: 1, stdout, stderr: error.message, errorCode: 'COMMAND_SPAWN_FAILED', errorMessage: error.message });
      });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        const timedOut = signal === 'SIGTERM';
        resolveResult({
          success: !timedOut && code === 0,
          dryRun: false,
          command: input.command,
          args,
          exitCode: timedOut ? 124 : code ?? 1,
          stdout,
          stderr,
          errorCode: timedOut ? 'COMMAND_TIMEOUT' : code === 0 ? undefined : 'COMMAND_FAILED',
          errorMessage: timedOut ? '命令超时，已终止' : code === 0 ? undefined : '命令执行失败',
        });
      });
    });
  }
}

export class RuntimeBackupManager {
  constructor(private readonly fs: SafeFileSystem, private readonly backupRoot: string, private readonly dryRunDefault = true) {}

  createManifest(task: AgentTaskEnvelope, targets: string[], dryRun = this.dryRunDefault): Promise<BackupResult> {
    return this.fs.backupFiles(task.id, targets, this.backupRoot, dryRun);
  }

  verifyManifest(manifest: BackupManifest): boolean {
    return this.fs.verifyManifest(manifest);
  }
}

export class RuntimeVerifyManager {
  constructor(private readonly fs: SafeFileSystem) {}

  async verify(input: { taskId: string; targetPath?: string; expectedSha256?: string }): Promise<VerifyReport> {
    const checkedAt = new Date().toISOString();
    if (!input.targetPath || !input.expectedSha256) {
      return { success: true, checkedAt, checks: [{ name: 'runtime-noop', success: true, detail: { taskId: input.taskId } }] };
    }
    try {
      const actualSha256 = sha256(await this.fs.readFile(input.targetPath));
      const success = actualSha256 === input.expectedSha256;
      return {
        success,
        checkedAt,
        checks: [{ name: 'file-sha256', success, detail: { targetPath: input.targetPath, expectedSha256: input.expectedSha256, actualSha256 } }],
        errorCode: success ? undefined : 'VERIFY_FAILED',
        errorMessage: success ? undefined : '文件 sha256 校验失败',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '验证失败';
      return { success: false, checkedAt, checks: [{ name: 'file-readable', success: false, detail: { targetPath: input.targetPath } }], errorCode: 'VERIFY_FAILED', errorMessage: message };
    }
  }
}

export class RuntimeRollbackManager {
  constructor(private readonly fs: SafeFileSystem, private readonly dryRunDefault = true) {}

  rollback(manifest: BackupManifest | undefined, dryRun = this.dryRunDefault): Promise<RollbackResult> {
    return this.fs.rollbackFiles(manifest, dryRun);
  }
}

function adaptRuntimeResult(task: AgentTaskEnvelope, startedAt: Date, success: boolean, status: StepExecutionResultLike['status'], detail: Record<string, unknown>, stdout = '', stderr = '', errorCode?: string, errorMessage?: string): StepExecutionResultLike {
  const finishedAt = new Date();
  return {
    executionRunId: task.executionRunId,
    executionStepId: task.executionStepId,
    taskId: task.id,
    success,
    status,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    exitCode: success ? 0 : 1,
    stdout,
    stderr,
    detail,
    errorCode,
    errorMessage,
  };
}

export class LocalProviderRuntime {
  readonly fs: SafeFileSystem;
  readonly backup: RuntimeBackupManager;
  readonly verify: RuntimeVerifyManager;
  readonly rollback: RuntimeRollbackManager;
  readonly executor: SafeCommandExecutor;
  readonly ledger: RecoveryLedger;
  private readonly dryRunDefault: boolean;

  constructor(options: SafeRuntimeOptions) {
    this.dryRunDefault = options.dryRunDefault ?? true;
    this.ledger = options.ledger ?? new RecoveryLedger(join(options.dataDir, 'recovery-ledger.json'));
    this.fs = new SafeFileSystem(options.dataDir, options.allowedRoots);
    this.backup = new RuntimeBackupManager(this.fs, join(options.dataDir, 'backups'), this.dryRunDefault);
    this.verify = new RuntimeVerifyManager(this.fs);
    this.rollback = new RuntimeRollbackManager(this.fs, this.dryRunDefault);
    this.executor = new SafeCommandExecutor(options.commandAllowlist);
  }

  async execute(task: AgentTaskEnvelope): Promise<{ result: StepExecutionResultLike; logs: ProviderRuntimeLog[] }> {
    const startedAt = new Date();
    const payload = task.payload as RuntimeProviderTaskPayload;
    const dryRun = payload.dryRun ?? this.dryRunDefault;
    const logs: ProviderRuntimeLog[] = [{ level: 'info', message: '开始执行真实本地 Provider Runtime 骨架', detail: { taskId: task.id, dryRun } }];
    await this.ledger.start(task.id, 'runtime', 'accepted', { dryRun, action: payload.action ?? 'write-file' });

    try {
      if (payload.action === 'run-command') {
        const commandResult = await this.executor.execute({ command: payload.command ?? '', args: payload.args, cwd: payload.cwd, dryRun, timeoutMs: 10_000 });
        await this.ledger.record(task.id, commandResult.success ? 'succeeded' : 'failed', 'command', { commandResult });
        return { result: adaptRuntimeResult(task, startedAt, commandResult.success, dryRun ? 'dry_run' : commandResult.success ? 'succeeded' : 'failed', { commandResult }, commandResult.stdout, commandResult.stderr, commandResult.errorCode, commandResult.errorMessage), logs };
      }

      if (payload.action === 'rollback') {
        const rollback = await this.rollback.rollback(undefined, dryRun);
        await this.ledger.record(task.id, rollback.success ? 'rolled_back' : 'failed', 'rollback', { rollback });
        return { result: adaptRuntimeResult(task, startedAt, rollback.success, rollback.success ? 'succeeded' : 'failed', { rollback }, '', rollback.errorMessage ?? '', rollback.errorCode, rollback.errorMessage), logs };
      }

      const targets = payload.backupTargets ?? (payload.targetPath ? [payload.targetPath] : []);
      const backup = targets.length > 0 ? await this.backup.createManifest(task, targets, dryRun) : undefined;
      if (backup && !backup.success) {
        await this.ledger.record(task.id, 'failed', 'backup', { backup });
        return { result: adaptRuntimeResult(task, startedAt, false, 'failed', { backup }, '', backup.errorMessage ?? '', backup.errorCode, backup.errorMessage), logs };
      }
      await this.ledger.record(task.id, 'staged', 'backup', { backup });

      if (payload.action === 'verify-file') {
        const verify = await this.verify.verify({ taskId: task.id, targetPath: payload.targetPath, expectedSha256: payload.expectedSha256 });
        await this.ledger.record(task.id, verify.success ? 'verified' : 'failed', 'verify', { verify });
        return { result: adaptRuntimeResult(task, startedAt, verify.success, verify.success ? 'succeeded' : 'failed', { verify }, '', verify.errorMessage ?? '', verify.errorCode, verify.errorMessage), logs };
      }

      if (!payload.targetPath || typeof payload.content !== 'string') {
        await this.ledger.record(task.id, 'failed', 'validate', { errorCode: 'RUNTIME_PAYLOAD_INVALID' });
        return { result: adaptRuntimeResult(task, startedAt, false, 'rejected', {}, '', '缺少 targetPath 或 content', 'RUNTIME_PAYLOAD_INVALID', '缺少 targetPath 或 content'), logs };
      }

      const write = await this.fs.atomicWrite({ targetPath: payload.targetPath, content: payload.content, dryRun });
      await this.ledger.record(task.id, 'activated', 'atomic-write', { write });
      const expectedSha256 = payload.expectedSha256 ?? sha256(payload.content);
      const verify = dryRun
        ? {
            success: write.sha256 === expectedSha256,
            checkedAt: new Date().toISOString(),
            checks: [{ name: 'dry-run-content-sha256', success: write.sha256 === expectedSha256, detail: { targetPath: payload.targetPath, expectedSha256, actualSha256: write.sha256 } }],
            errorCode: write.sha256 === expectedSha256 ? undefined : 'VERIFY_FAILED',
            errorMessage: write.sha256 === expectedSha256 ? undefined : 'dry-run 内容 sha256 校验失败',
          }
        : await this.verify.verify({ taskId: task.id, targetPath: payload.targetPath, expectedSha256 });
      if (!verify.success) {
        const rollback = await this.rollback.rollback(backup?.manifest, dryRun);
        await this.ledger.record(task.id, rollback.success ? 'rolled_back' : 'failed', 'verify-rollback', { verify, rollback });
        return { result: adaptRuntimeResult(task, startedAt, false, 'failed', { write, verify, rollback, backup }, '', verify.errorMessage ?? '', rollback.success ? 'VERIFY_FAILED_ROLLED_BACK' : 'VERIFY_FAILED_MANUAL_REQUIRED', verify.errorMessage), logs };
      }

      await this.ledger.record(task.id, 'succeeded', 'done', { write, verify, backup });
      return { result: adaptRuntimeResult(task, startedAt, true, dryRun ? 'dry_run' : 'succeeded', { write, verify, backup }, JSON.stringify({ dryRun, sha256: write.sha256 }), ''), logs };
    } catch (error) {
      const message = error instanceof Error ? error.message : '本地 Runtime 执行失败';
      await this.ledger.record(task.id, 'failed', 'exception', { errorMessage: message });
      return { result: adaptRuntimeResult(task, startedAt, false, 'failed', {}, '', message, 'LOCAL_RUNTIME_ERROR', message), logs };
    }
  }

  async resume(): Promise<Array<{ entryId: string; action: 'rollback_required' | 'verify_required'; entry: unknown }>> {
    const recoverable = this.ledger.recoverable();
    return recoverable.map((entry) => ({ entryId: entry.id, action: entry.status === 'activated' ? 'rollback_required' : 'verify_required', entry }));
  }
}
