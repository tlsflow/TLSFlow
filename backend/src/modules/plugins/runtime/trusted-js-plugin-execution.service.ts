import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { AuditService, type WriteAuditInput } from '../../audits/audit.service.js';
import type { CredentialsRepository } from '../../credentials/repository/credentials.repository.js';
import { PluginResourceLockService } from '../../executions/application/plugin-resource-lock.service.js';
import type { CloudAccountAssetsApplicationService } from '../../providers/application/cloud-account-assets.application-service.js';
import type { SecretService } from '../../secrets/secret.service.js';
import type { UnifiedPluginVersionRecord } from '../dto/unified-plugins.dto.js';
import { UnifiedPluginsApplicationService } from '../application/unified-plugins.application-service.js';
import { PluginRunnerSupervisor } from '../runner/plugin-runner-supervisor.js';
import type { ProductionPluginRunnerConfig } from '../runner/production-runner-config.js';
import type { PluginRunnerHostCallContext, PluginRunnerLaunchSpec } from '../runner/plugin-runner-client.js';
import type { PluginRunnerExecuteResult } from '../runner/protocol/protocol.types.js';
import { validateTrustedJsRunnerRequest, type TrustedJsRunnerRequest } from './trusted-js-runtime.contract.js';

/**
 * Trusted JS 执行绑定。所有身份和制品摘要都必须由调用方显式提交。
 * 这里不接受 providerKey、产品类型、操作别名或“当前最新版本”等路由字段。
 */
export interface TrustedJsExecutionInput extends TrustedJsRunnerRequest {
  writeEffect: boolean;
  deadlineAt?: string;
}

export interface TrustedJsPluginExecutionDependencies {
  db: DatabasePort;
  unifiedPlugins: UnifiedPluginsApplicationService;
  cloudAccounts: Pick<CloudAccountAssetsApplicationService, 'get'>;
  credentials: CredentialsRepository;
  secrets: SecretService;
  audit: AuditService;
  runner?: ProductionPluginRunnerConfig & { supervisor?: PluginRunnerSupervisor };
}

/**
 * 已废止的 Trusted JS 宿主入口只保留 Runner 边界。
 *
 * 宿主不加载插件代码、不维护 Provider 目录、不按厂商或产品选择版本。
 * 调用方必须先完成真实 PluginVersion 绑定，再由本服务交给 Supervisor/Client。
 */
export class TrustedJsPluginExecutionService {
  private readonly resourceLocks: PluginResourceLockService;
  private readonly runnerSupervisor: PluginRunnerSupervisor;
  private readonly runnerConfig: TrustedJsPluginExecutionDependencies['runner'];
  private readonly activeExecutions = new Map<string, TrustedJsRunnerRequest>();
  private readonly runnerHostApiHandler: (context: PluginRunnerHostCallContext) => Promise<Record<string, unknown>>;

  constructor(private readonly dependencies: TrustedJsPluginExecutionDependencies) {
    this.resourceLocks = new PluginResourceLockService(dependencies.db);
    this.runnerConfig = dependencies.runner;
    this.runnerSupervisor = dependencies.runner?.supervisor ?? new PluginRunnerSupervisor({ maxRestarts: 0 });
    this.runnerHostApiHandler = this.handleRunnerHostCall.bind(this);
  }

  /** 宿主 Provider 目录已经清退，禁止恢复按 Provider 选择执行的入口。 */
  async listProviders(_tenantId: string): Promise<never[]> {
    throw providerCatalogDisabled();
  }

  /** 宿主 Provider 目录已经清退，禁止按 ProviderKey 解析版本。 */
  async requireProvider(_tenantId: string, _providerKey: string): Promise<never> {
    throw providerCatalogDisabled();
  }

  /** 宿主能力目录已经清退，禁止从产品字段生成执行能力。 */
  async listCapabilities(_tenantId: string, _filter?: unknown): Promise<never[]> {
    throw providerCatalogDisabled();
  }

  /**
   * 执行一个已经完成身份、制品、能力和租户绑定的 Trusted JS 请求。
   * PluginVersionId 只来自调用方和真实版本记录，服务绝不生成或推导它。
   */
  async execute(input: TrustedJsExecutionInput): Promise<PluginRunnerExecuteResult> {
    const request = validateTrustedJsRunnerRequest(input);
    const versionRecord = await this.requireBoundVersion(request);
    const runnerConfig = requireRunnerConfiguration(this.runnerConfig, request.pluginVersionId);
    const grantRefs = validateGrantRefs(request.grantRefs);
    assertPermissionBinding(versionRecord);

    const executionId = request.executionId;
    const executionStepId = request.executionStepId;
    const activeRequest: TrustedJsRunnerRequest = { ...request, grantRefs };
    this.activeExecutions.set(executionId, activeRequest);
    const spec = buildLaunchSpec(runnerConfig, versionRecord, request, this.runnerHostApiHandler);
    try {
      const client = await this.runnerSupervisor.start(spec);
      return await client.execute({
        tenantId: request.tenantId,
        executionId,
        executionStepId,
        capability: request.capability,
        input: request.input,
        grantRefs,
        idempotencyKey: executionId,
        deadlineAt: input.deadlineAt ?? new Date(Date.now() + 120_000).toISOString(),
        writeEffect: input.writeEffect,
      });
    } finally {
      this.activeExecutions.delete(executionId);
    }
  }

  private async requireBoundVersion(request: TrustedJsRunnerRequest): Promise<UnifiedPluginVersionRecord> {
    let record: UnifiedPluginVersionRecord;
    try {
      record = await this.dependencies.unifiedPlugins.getVersionForTenant(request.tenantId, request.pluginVersionId);
    } catch (error) {
      throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', '真实 PluginVersion 绑定不存在或当前租户不可见', {
        pluginVersionId: request.pluginVersionId,
        tenantId: request.tenantId,
        cause: error instanceof AppError ? error.errorCode : 'PLUGIN_VERSION_LOOKUP_FAILED',
      });
    }
    assertVersionBinding(record, request);
    return record;
  }

  private async handleRunnerHostCall(context: PluginRunnerHostCallContext): Promise<Record<string, unknown>> {
    const active = this.activeExecutions.get(context.executionId);
    if (!active || active.pluginVersionId !== context.pluginVersionId || active.pluginId !== context.pluginId
      || active.pluginVersion !== context.pluginVersion || active.tenantId !== context.tenantId
      || active.capability !== context.capability || active.executionStepId !== context.executionStepId) {
      throw new AppError('TENANT_SCOPE_DENIED', 'Runner Host API 请求没有匹配的固定执行绑定');
    }
    assertGrantRefsSubset(context.grantRefs, active.grantRefs);
    if (context.method === 'audit.append') {
      const input = context.input;
      await this.dependencies.audit.write({
        eventType: String(input.eventType),
        actorType: 'system',
        actorId: active.pluginId,
        action: String(input.action),
        resourceType: String(input.resourceType),
        resourceId: String(input.resourceId),
        result: input.result as WriteAuditInput['result'],
        riskLevel: 'medium',
        context: { tenantId: context.tenantId },
        detail: (input.detail ?? {}) as Record<string, unknown>,
      });
      return { ok: true };
    }
    if (context.method === 'resourceLock.acquire') {
      const input = context.input;
      const record = await this.resourceLocks.acquire({
        tenantId: context.tenantId,
        resourceKey: normalizePluginLockKey(context.tenantId, String(input.resourceKey)),
        mode: 'WRITE',
        ownerRunId: String(input.ownerRunId),
        ownerStepId: String(input.ownerStepId),
        ttlSeconds: Number(input.ttlSeconds),
      });
      return { ok: true, data: { lockId: record.id } };
    }
    if (context.method === 'resourceLock.release') {
      const input = context.input;
      await this.resourceLocks.release({
        tenantId: context.tenantId,
        lockId: String(input.lockId),
        ownerRunId: String(input.ownerRunId),
        ownerStepId: String(input.ownerStepId),
      });
      return { ok: true };
    }
    throw new AppError('PLUGIN_HOST_CALL_DENIED', '该 Runner Host API 未完成通用装配，已失败关闭', {
      method: context.method,
      pluginVersionId: context.pluginVersionId,
    });
  }
}

function providerCatalogDisabled(): AppError {
  return new AppError('PLUGIN_CAPABILITY_EXECUTION_FAILED', '宿主 Provider 目录已清退，必须提交固定 PluginVersion 并经 Runner 执行');
}

function assertVersionBinding(record: UnifiedPluginVersionRecord, request: TrustedJsRunnerRequest): void {
  if (record.id !== request.pluginVersionId || record.pluginId !== request.pluginId || record.version !== request.pluginVersion
    || record.manifest.pluginId !== request.pluginId || record.manifest.version !== request.pluginVersion
    || record.runtime !== 'TRUSTED_JS' || record.status !== 'ENABLED'
    || (record.source !== 'BUILTIN' && record.tenantId !== request.tenantId)) {
    throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', 'Trusted JS PluginVersion 身份绑定无效', {
      pluginVersionId: request.pluginVersionId,
      pluginId: request.pluginId,
      pluginVersion: request.pluginVersion,
      tenantId: request.tenantId,
    });
  }
  if (record.packageSha256 !== request.packageHash || record.manifestSha256 !== request.manifestHash
    || resourceAggregateHash(record.resourceSha256, record.id) !== request.resourceHash) {
    throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', 'Trusted JS PluginVersion 制品摘要绑定无效', {
      pluginVersionId: request.pluginVersionId,
    });
  }
  if (!record.manifest.capabilities.some((capability) => capability.key === request.capability
    && capability.executionLocations.includes('CONTROL_PLANE'))) {
    throw new AppError('PLUGIN_CAPABILITY_EXECUTION_FAILED', 'Capability 未绑定到当前 PluginVersion 的控制面执行位置', {
      pluginVersionId: request.pluginVersionId,
      capability: request.capability,
    });
  }
}

function assertPermissionBinding(record: UnifiedPluginVersionRecord): void {
  if (record.permissionApprovalStatus !== 'APPROVED' && record.permissionApprovalStatus !== 'NOT_REQUIRED') {
    throw new AppError('PLUGIN_PERMISSION_DENIED', 'Trusted JS PluginVersion 尚未完成权限审批', { pluginVersionId: record.id });
  }
  const approved = new Set(record.approvedPermissions);
  if (record.approvedPermissions.some((permission) => !record.manifest.permissions.includes(permission))
    || approved.size !== record.approvedPermissions.length) {
    throw new AppError('PLUGIN_PERMISSION_DENIED', 'Trusted JS PluginVersion 权限绑定无效', { pluginVersionId: record.id });
  }
}

function buildLaunchSpec(
  runner: ProductionPluginRunnerConfig & { supervisor?: PluginRunnerSupervisor },
  record: UnifiedPluginVersionRecord,
  request: TrustedJsRunnerRequest,
  hostApiHandler: (context: PluginRunnerHostCallContext) => Promise<Record<string, unknown>>,
): PluginRunnerLaunchSpec {
  return {
    pluginVersionId: request.pluginVersionId,
    pluginId: request.pluginId,
    pluginVersion: request.pluginVersion,
    tenantId: request.tenantId,
    executablePath: runner.executablePath,
    args: runner.args,
    workingDirectory: runner.workingDirectory,
    runnerVersion: runner.runnerVersion,
    sdkVersion: runner.sdkVersion,
    capabilities: record.manifest.capabilities.map((capability) => capability.key),
    packageHash: request.packageHash,
    manifestHash: request.manifestHash,
    resourceHash: request.resourceHash,
    hostPermissions: [...new Set(record.approvedPermissions)].sort(),
    hostApiHandler,
  };
}

function requireRunnerConfiguration(
  value: TrustedJsPluginExecutionDependencies['runner'],
  pluginVersionId: string,
): ProductionPluginRunnerConfig & { supervisor?: PluginRunnerSupervisor } {
  if (!value) {
    throw new AppError('PLUGIN_RUNNER_START_FAILED', 'Trusted JS Runner 缺少生产装配，已失败关闭', { pluginVersionId });
  }
  const fields = [
    ['executablePath', value.executablePath],
    ['workingDirectory', value.workingDirectory],
    ['executorModulePath', value.executorModulePath],
    ['runnerVersion', value.runnerVersion],
    ['sdkVersion', value.sdkVersion],
  ] as const;
  const missing = fields.filter(([, field]) => typeof field !== 'string' || field.trim() === '').map(([name]) => name);
  if (missing.length > 0 || !isAbsolute(value.executablePath) || !isAbsolute(value.workingDirectory) || !isAbsolute(value.executorModulePath)) {
    throw new AppError('PLUGIN_RUNNER_START_FAILED', 'Trusted JS Runner 生产装配不完整，已失败关闭', { pluginVersionId, missing });
  }
  if (!Array.isArray(value.args) || value.args.length === 0 || value.args.some((argument) => typeof argument !== 'string' || argument.length === 0)) {
    throw new AppError('PLUGIN_RUNNER_START_FAILED', 'Trusted JS Runner 参数必须是非空固定字符串数组', { pluginVersionId });
  }
  const executorIndexes = value.args.reduce<number[]>((indexes, argument, index) => argument === '--executor-module' ? [...indexes, index] : indexes, []);
  if (executorIndexes.length !== 1 || value.args[executorIndexes[0] + 1] !== value.executorModulePath) {
    throw new AppError('PLUGIN_RUNNER_START_FAILED', 'Trusted JS Runner 未绑定唯一固定执行器模块', { pluginVersionId });
  }
  return value;
}

function validateGrantRefs(value: readonly string[]): string[] {
  if (!Array.isArray(value) || value.length > 100 || value.some((ref) => !/^[A-Za-z0-9._:-]{1,256}$/.test(ref))) {
    throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Trusted JS Grant 引用格式无效');
  }
  if (new Set(value).size !== value.length) throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Trusted JS Grant 引用不允许重复');
  return [...value];
}

function assertGrantRefsSubset(requested: readonly string[], allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  if (requested.some((ref) => !allowedSet.has(ref))) throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Runner Host API 使用了未绑定的 Grant 引用');
}

function resourceAggregateHash(resourceHashes: Record<string, string>, pluginVersionId: string): string {
  const entries = Object.entries(resourceHashes).sort(([left], [right]) => left.localeCompare(right));
  for (const [path, value] of entries) {
    if (!/^sha256:[a-f0-9]{64}$/.test(value)) {
      throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', 'PluginVersion 资源摘要无效', { pluginVersionId, path });
    }
  }
  return `sha256:${createHash('sha256').update(JSON.stringify(entries), 'utf8').digest('hex')}`;
}

function normalizePluginLockKey(tenantId: string, resourceKey: string): string {
  const normalized = resourceKey.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 160);
  return `tenant:${tenantId}:standalone:${normalized || 'plugin_resource'}`;
}
