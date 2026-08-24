import { redactSensitive } from '../../common/logging/redact.js';
import type {
  BackupManager,
  DetectedCapabilities,
  MockLocalExecutorContract,
  MockProvider,
  ProviderContext,
  ProviderDescriptor,
  ProviderPermission,
  ProviderResultLike,
  ProviderRuntimeExecution,
  ProviderRuntimeInput,
  ProviderRuntimeLog,
  RollbackManager,
  SecretSession,
  StepExecutionResultLike,
  VerifyManager,
} from './full-agent.types.js';
import { MockLocalExecutor } from './mock-local-executor.js';
import { MockBackupManager, MockRollbackManager, MockVerifyManager } from './backup-verify-rollback.manager.mock.js';
import { MockSecretSession } from './security-session.mock.js';

const allowedPermissions = new Set<ProviderPermission>(['file.read', 'file.write', 'process.exec', 'service.control', 'secret.read', 'backup.write']);

function stringPayload(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' ? value : undefined;
}

function stringArrayPayload(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function hasCapability(capabilities: DetectedCapabilities, key: string): boolean {
  return capabilities.capabilities.some((capability) => capability.capabilityKey === key && capability.value === true);
}

function adaptResult(input: ProviderRuntimeInput, providerResult: ProviderResultLike, logs: ProviderRuntimeLog[], cleanupReport: unknown): StepExecutionResultLike {
  const startedAt = new Date();
  const durationMs = 1;
  const status = providerResult.status ?? (providerResult.success ? 'succeeded' : 'failed');
  const success = providerResult.success && status !== 'failed' && status !== 'timeout' && status !== 'rejected';
  const detail = redactSensitive({
    ...(providerResult.detail ?? {}),
    providerLogs: logs,
    cleanupReport,
  }) as Record<string, unknown>;

  return {
    executionRunId: input.task.executionRunId,
    executionStepId: input.task.executionStepId,
    taskId: input.task.id,
    success,
    status,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date(startedAt.getTime() + durationMs).toISOString(),
    durationMs,
    exitCode: success ? 0 : 1,
    stdout: providerResult.stdout ?? JSON.stringify({ status, detail }),
    stderr: providerResult.stderr ?? '',
    detail,
    errorCode: providerResult.errorCode,
    errorMessage: providerResult.errorMessage,
  };
}

function rejected(input: ProviderRuntimeInput, errorCode: string, errorMessage: string, detail: Record<string, unknown> = {}): ProviderRuntimeExecution {
  const now = new Date();
  return {
    result: {
      executionRunId: input.task.executionRunId,
      executionStepId: input.task.executionStepId,
      taskId: input.task.id,
      success: false,
      status: 'rejected',
      startedAt: now.toISOString(),
      finishedAt: now.toISOString(),
      durationMs: 0,
      exitCode: 1,
      stdout: '',
      stderr: errorMessage,
      detail: redactSensitive(detail) as Record<string, unknown>,
      errorCode,
      errorMessage,
    },
    logs: [{ level: 'warn', message: errorMessage, detail }],
  };
}

export class MockProviderRuntime {
  private readonly providers = new Map<string, MockProvider>();

  constructor(
    private readonly executor: MockLocalExecutorContract = new MockLocalExecutor(),
    private readonly backup: BackupManager = new MockBackupManager(),
    private readonly verifier: VerifyManager = new MockVerifyManager(),
    private readonly rollback: RollbackManager = new MockRollbackManager(),
    private readonly secretFactory: () => SecretSession = () => new MockSecretSession(),
  ) {
    this.registerProvider(new MockCertificateDeployProvider());
  }

  registerProvider(provider: MockProvider): void {
    this.validateDescriptor(provider.descriptor);
    if (this.providers.has(provider.descriptor.name)) {
      throw new Error(`Provider 已注册：${provider.descriptor.name}`);
    }
    this.providers.set(provider.descriptor.name, provider);
  }

  execute(input: ProviderRuntimeInput): ProviderRuntimeExecution {
    const providerName = stringPayload(input.task.payload, 'providerName') ?? 'mock.certificate';
    const action = stringPayload(input.task.payload, 'action') ?? 'deploy';
    const provider = this.providers.get(providerName);
    if (!provider) {
      return rejected(input, 'PROVIDER_UNSUPPORTED', `Provider 不存在或未加载：${providerName}`, { providerName });
    }

    if (!provider.descriptor.actions.includes(action)) {
      return rejected(input, 'PROVIDER_ACTION_UNSUPPORTED', `Provider 不支持动作：${action}`, { providerName, action });
    }

    const requiredCapabilities = [
      ...provider.descriptor.requiredCapabilities,
      ...stringArrayPayload(input.task.payload, 'requiredCapabilities'),
    ];
    const missingCapabilities = requiredCapabilities.filter((capability) => !hasCapability(input.capabilities, capability));
    if (missingCapabilities.length > 0) {
      return rejected(input, 'CAPABILITY_MISSING', '能力不足，拒绝执行本地任务', { missingCapabilities });
    }

    const requestedPermissions = stringArrayPayload(input.task.payload, 'requestedPermissions') as ProviderPermission[];
    const deniedPermissions = requestedPermissions.filter((permission) => !provider.descriptor.permissions.includes(permission));
    if (deniedPermissions.length > 0) {
      return rejected(input, 'PLUGIN_PERMISSION_DENIED', 'Provider 请求了未声明权限', { deniedPermissions });
    }

    const logs: ProviderRuntimeLog[] = [];
    const secrets = this.secretFactory();
    for (const [key, value] of Object.entries(input.task.payload)) {
      if (key.endsWith('SecretRef') && typeof value === 'string') {
        secrets.put(value, `mock-secret-value-for-${key}`);
      }
    }

    const context: ProviderContext = {
      task: input.task,
      action,
      dryRun: input.dryRun ?? Boolean(input.task.payload.dryRun),
      tempDir: `/mock/tmp/${input.task.id}`,
      capabilities: input.capabilities,
      secrets,
      backup: this.backup,
      verify: this.verifier,
      rollback: this.rollback,
      executor: this.executor,
      log: (level, message, detail) => logs.push({ level, message, detail: redactSensitive(detail) as Record<string, unknown> | undefined }),
    };

    try {
      const providerResult = provider.execute(context);
      const cleanupReport = secrets.cleanup();
      return {
        result: adaptResult(input, providerResult, logs, cleanupReport),
        logs,
      };
    } catch (error) {
      const cleanupReport = secrets.cleanup();
      const message = error instanceof Error ? error.message : 'Provider 抛出未知错误';
      return {
        result: adaptResult(input, {
          success: false,
          status: 'failed',
          errorCode: 'PROVIDER_RUNTIME_ERROR',
          errorMessage: message,
          stderr: message,
          detail: { cleanupReport },
        }, logs, cleanupReport),
        logs,
      };
    }
  }

  listProviders(): ProviderDescriptor[] {
    return [...this.providers.values()].map((provider) => ({ ...provider.descriptor, actions: [...provider.descriptor.actions], requiredCapabilities: [...provider.descriptor.requiredCapabilities], permissions: [...provider.descriptor.permissions] }));
  }

  private validateDescriptor(descriptor: ProviderDescriptor): void {
    if (!descriptor.name || !descriptor.version || descriptor.actions.length === 0) {
      throw new Error('Provider 元数据不完整');
    }
    const badPermission = descriptor.permissions.find((permission) => !allowedPermissions.has(permission));
    if (badPermission) throw new Error(`Provider 声明了未知权限：${badPermission}`);
  }
}

export class MockCertificateDeployProvider implements MockProvider {
  readonly descriptor: ProviderDescriptor = {
    name: 'mock.certificate',
    version: '0.1.0',
    actions: ['deploy', 'verify', 'rollback', 'dry-run'],
    requiredCapabilities: ['file.write'],
    permissions: ['file.read', 'file.write', 'service.control', 'secret.read', 'backup.write'],
  };

  execute(context: ProviderContext): ProviderResultLike {
    const payload = context.task.payload;
    const targets = stringArrayPayload(payload, 'backupTargets');
    const destructive = payload.destructive !== false && context.action === 'deploy';
    context.log('info', `mock provider 执行动作：${context.action}`, { action: context.action, tempDir: context.tempDir, secrets: context.secrets.snapshot() });

    if (context.dryRun || context.action === 'dry-run') {
      return {
        success: true,
        status: 'dry_run',
        stdout: JSON.stringify({ dryRun: true, provider: this.descriptor.name }),
        detail: { provider: this.descriptor.name, dryRun: true },
      };
    }

    if (context.action === 'verify') {
      const verify = context.verify.verify({ taskId: context.task.id, simulate: payload.simulateVerify });
      return {
        success: verify.success,
        status: verify.success ? 'succeeded' : 'failed',
        detail: { verify },
        errorCode: verify.errorCode,
        errorMessage: verify.errorMessage,
      };
    }

    if (context.action === 'rollback') {
      const rollback = context.rollback.rollback(undefined);
      return {
        success: rollback.success,
        status: rollback.success ? 'succeeded' : 'failed',
        detail: { rollback },
        errorCode: rollback.errorCode,
        errorMessage: rollback.errorMessage,
      };
    }

    let manifest;
    if (destructive) {
      const backup = context.backup.createManifest(context.task, targets.length > 0 ? targets : ['/mock/etc/service.conf']);
      if (!backup.success || !backup.manifest) {
        return {
          success: false,
          status: 'failed',
          detail: { backup },
          errorCode: backup.errorCode ?? 'BACKUP_FAILED',
          errorMessage: backup.errorMessage ?? '备份失败',
        };
      }
      manifest = backup.manifest;
      context.log('info', 'mock 备份 manifest 已创建', { backupId: manifest.backupId, checksum: manifest.checksum });
    }

    const install = context.executor.execute({ task: context.task });
    if (!install.success) {
      return {
        success: false,
        status: install.status,
        stdout: install.stdout,
        stderr: install.stderr,
        detail: { install, backupManifest: manifest },
        errorCode: install.errorCode,
        errorMessage: install.errorMessage,
      };
    }

    const verify = context.verify.verify({ taskId: context.task.id, simulate: payload.simulateVerify, expectedFingerprint: stringPayload(payload, 'expectedFingerprint') });
    if (!verify.success) {
      const rollback = context.rollback.rollback(manifest);
      return {
        success: false,
        status: 'failed',
        detail: { install, verify, rollback, backupManifest: manifest },
        errorCode: rollback.success ? 'VERIFY_FAILED_ROLLED_BACK' : 'VERIFY_FAILED_MANUAL_REQUIRED',
        errorMessage: rollback.success ? '验证失败，已按 mock 备份回滚' : '验证失败，自动回滚失败，需要人工介入',
      };
    }

    return {
      success: true,
      status: 'succeeded',
      stdout: install.stdout,
      detail: { install, verify, backupManifest: manifest },
    };
  }
}
