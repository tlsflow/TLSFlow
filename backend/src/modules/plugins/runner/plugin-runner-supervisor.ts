import { AppError } from '../../../common/errors/app-error.js';
import { PluginRunnerClient, type PluginRunnerExecutionInput, type PluginRunnerLaunchSpec } from './plugin-runner-client.js';
import type { PluginRunnerExecuteResult } from './protocol/protocol.types.js';

export interface PluginRunnerSupervisorOptions {
  maxRestarts?: number;
}

interface RunnerRecord {
  key: string;
  spec: PluginRunnerLaunchSpec;
  client: PluginRunnerClient;
  restartCount: number;
  startPromise?: Promise<PluginRunnerClient>;
  restartPromise?: Promise<PluginRunnerClient>;
}

/**
 * Runner 监督器只管理进程生命周期和固定版本映射。
 * 它不负责重放执行，也不在 Runner 之间复制 Secret、租户对象或业务状态。
 */
export class PluginRunnerSupervisor {
  private readonly records = new Map<string, RunnerRecord>();
  private readonly retiredRunnerKeys = new Set<string>();
  private readonly maxRestarts: number;

  constructor(options: PluginRunnerSupervisorOptions = {}) {
    this.maxRestarts = options.maxRestarts ?? 3;
    if (!Number.isInteger(this.maxRestarts) || this.maxRestarts < 0 || this.maxRestarts > 100) {
      throw new AppError('VALIDATION_FAILED', 'Runner 最大重启次数必须是 0 到 100 之间的整数');
    }
  }

  async start(spec: PluginRunnerLaunchSpec): Promise<PluginRunnerClient> {
    const key = runnerKey(spec.pluginVersionId, spec.tenantId);
    if (this.retiredRunnerKeys.has(key)) throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', '已退休的 PluginVersion 不能重新启动', { pluginVersionId: spec.pluginVersionId, tenantId: spec.tenantId });
    const existing = this.records.get(key);
    if (existing) {
      assertImmutableSpec(existing.spec, spec);
      if (existing.client.state === 'READY') return existing.client;
      if (existing.restartPromise) return existing.restartPromise;
      if (existing.startPromise) return existing.startPromise;
      if (existing.client.state === 'DRAINING') throw new AppError('PLUGIN_RUNNER_DRAINING', '旧 Runner 正在排空');
      // 只在新的 start 调用中重建固定 Runner；绝不重放导致崩溃的原执行。
      if (existing.client.state === 'CRASHED') return this.restart(spec.pluginVersionId, spec.tenantId);
    }
    const client = new PluginRunnerClient(spec);
    const record: RunnerRecord = existing ?? { key, spec: immutableCopy(spec), client, restartCount: 0 };
    record.spec = immutableCopy(spec);
    record.client = client;
    this.records.set(key, record);
    record.startPromise = client.start().then(() => client).finally(() => {
      if (record.startPromise) record.startPromise = undefined;
    });
    return record.startPromise;
  }

  async restart(pluginVersionId: string, tenantId: string): Promise<PluginRunnerClient> {
    const key = runnerKey(pluginVersionId, tenantId);
    if (this.retiredRunnerKeys.has(key)) throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', '已退休的 PluginVersion 不能重启', { pluginVersionId, tenantId });
    const record = this.records.get(key);
    if (!record) throw new AppError('RESOURCE_NOT_FOUND', '没有可重启的 Runner', { pluginVersionId, tenantId });
    if (record.restartPromise) return record.restartPromise;
    const restartPromise = (async () => {
      if (record.startPromise) await record.startPromise;
      if (record.restartCount >= this.maxRestarts) throw new AppError('PLUGIN_RUNNER_START_FAILED', 'Runner 重启次数达到熔断上限', { pluginVersionId, maxRestarts: this.maxRestarts });
      record.restartCount += 1;
      await record.client.stop(true);
      const client = new PluginRunnerClient(record.spec);
      record.client = client;
      await client.start();
      return client;
    })();
    const trackedRestart = restartPromise.finally(() => {
      if (record.restartPromise === trackedRestart) record.restartPromise = undefined;
    });
    record.restartPromise = trackedRestart;
    return trackedRestart;
  }

  get(pluginVersionId: string, tenantId: string): PluginRunnerClient {
    const key = runnerKey(pluginVersionId, tenantId);
    if (this.retiredRunnerKeys.has(key)) throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', '已退休的 PluginVersion 不能使用', { pluginVersionId, tenantId });
    const record = this.records.get(key);
    if (!record) throw new AppError('RESOURCE_NOT_FOUND', 'Plugin Runner 未注册', { pluginVersionId, tenantId });
    return record.client;
  }

  async execute(pluginVersionId: string, tenantId: string, input: PluginRunnerExecutionInput): Promise<PluginRunnerExecuteResult> {
    return this.get(pluginVersionId, tenantId).execute(input);
  }

  async drain(pluginVersionId: string, tenantId: string): Promise<void> {
    const key = runnerKey(pluginVersionId, tenantId);
    const record = this.records.get(key);
    if (!record) return;
    await record.client.drain();
    this.records.delete(key);
  }

  async switchVersion(oldPluginVersionId: string, tenantId: string, next: PluginRunnerLaunchSpec): Promise<PluginRunnerClient> {
    if (next.tenantId !== tenantId) throw new AppError('TENANT_SCOPE_DENIED', '版本切换不能改变租户');
    if (next.pluginVersionId === oldPluginVersionId) throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', '版本切换必须使用不同的 PluginVersionId');
    const oldRecord = this.records.get(runnerKey(oldPluginVersionId, tenantId));
    const client = await this.start(next);
    const oldKey = runnerKey(oldPluginVersionId, tenantId);
    this.retiredRunnerKeys.add(oldKey);
    if (oldRecord) {
      try {
        await oldRecord.client.retire();
      } catch (error) {
        await client.stop(true);
        throw error;
      }
      if (this.records.get(oldKey) === oldRecord) this.records.delete(oldKey);
    }
    return client;
  }

  async shutdownAll(): Promise<void> {
    const records = [...this.records.values()];
    this.records.clear();
    await Promise.all(records.map(async (record) => {
      try {
        if (record.restartPromise) await record.restartPromise;
        if (record.startPromise) await record.startPromise;
        await record.client.drain();
      } catch { await record.client.stop(true); }
    }));
  }

  list(): Array<{ pluginVersionId: string; tenantId: string; state: string; pid?: number; restartCount: number }> {
    return [...this.records.values()].map(({ spec, client, restartCount }) => ({ pluginVersionId: spec.pluginVersionId, tenantId: spec.tenantId, state: client.state, pid: client.pid, restartCount }));
  }
}

function runnerKey(pluginVersionId: string, tenantId: string): string {
  return `${pluginVersionId}\u0000${tenantId}`;
}

function immutableCopy(spec: PluginRunnerLaunchSpec): PluginRunnerLaunchSpec {
  return { ...spec, args: [...spec.args], environment: { ...(spec.environment ?? {}) }, capabilities: [...spec.capabilities], hostPermissions: [...(spec.hostPermissions ?? [])] };
}

function assertImmutableSpec(left: PluginRunnerLaunchSpec, right: PluginRunnerLaunchSpec): void {
  const same = left.pluginVersionId === right.pluginVersionId && left.pluginId === right.pluginId && left.pluginVersion === right.pluginVersion && left.tenantId === right.tenantId
    && left.executablePath === right.executablePath && left.workingDirectory === right.workingDirectory && JSON.stringify(left.args) === JSON.stringify(right.args)
    && JSON.stringify(left.environment ?? {}) === JSON.stringify(right.environment ?? {})
    && left.runnerVersion === right.runnerVersion && left.sdkVersion === right.sdkVersion
    && JSON.stringify(left.capabilities ?? []) === JSON.stringify(right.capabilities ?? [])
    && left.packageHash === right.packageHash && left.resourceHash === right.resourceHash && left.manifestHash === right.manifestHash
    && left.startupTimeoutMs === right.startupTimeoutMs && left.helloTimeoutMs === right.helloTimeoutMs
    && left.executeTimeoutMs === right.executeTimeoutMs && left.hostCallTimeoutMs === right.hostCallTimeoutMs
    && left.shutdownGraceMs === right.shutdownGraceMs && left.maxStdoutBytes === right.maxStdoutBytes
    && left.maxStderrBytes === right.maxStderrBytes && JSON.stringify(left.hostPermissions ?? []) === JSON.stringify(right.hostPermissions ?? [])
    && left.hostApiHandler === right.hostApiHandler;
  if (!same) throw new AppError('PLUGIN_RUNNER_VERSION_MISMATCH', '同一 Runner 不能替换已固定的 PluginVersion 启动规格');
}
