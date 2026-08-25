import { AppError } from '../../../common/errors/app-error.js';
import { newId } from '../../../shared/id.js';
import type { CredentialProfileEntity } from '../../../persistence/entities/credential-profile.entity.js';
import { CredentialsRepository } from '../repository/credentials.repository.js';
import type { TasksApplicationService } from '../../tasks/task.application-service.js';
import type { TaskRun } from '../../tasks/task.types.js';
import { CredentialHealthRepository } from './credential-health.repository.js';
import { DeviceWorkflowCredentialHealthAdapter, CredentialHealthAdapterRegistry } from './credential-health.adapter.js';
import { aggregateCredentialHealth, type CredentialHealthAdapter, type CredentialHealthAdapterResult, type CredentialHealthCheckRecord, type CredentialHealthEligibility, type CredentialHealthState } from './credential-health.types.js';
import type { CredentialHealthDevice } from './credential-health.types.js';
import type { CredentialHealthCapabilityExecutor } from './credential-health.adapter.js';

export class CredentialHealthService {
  readonly adapters: CredentialHealthAdapterRegistry;
  constructor(
    private readonly repository: CredentialHealthRepository,
    private readonly credentials: Pick<CredentialsRepository, 'get'>,
    private readonly tasks?: Pick<TasksApplicationService, 'enqueue' | 'findActiveByIdempotency'>,
    capabilityExecutor?: CredentialHealthCapabilityExecutor,
    adapterRegistry?: CredentialHealthAdapterRegistry,
  ) {
    this.adapters = adapterRegistry ?? new CredentialHealthAdapterRegistry();
    if (capabilityExecutor) this.adapters.register(new DeviceWorkflowCredentialHealthAdapter(capabilityExecutor));
  }

  async eligibility(tenantId: string, credentialId: string): Promise<CredentialHealthEligibility> {
    const profile = await this.credentials.get(tenantId, credentialId);
    if (!profile) throw new AppError('RESOURCE_NOT_FOUND', 'CredentialProfile 不存在', { credentialId });
    const devices = profile.status === 'active' ? await this.repository.listEligibleDevices(tenantId, credentialId) : [];
    const status = profile.status === 'active' ? (devices.length > 0 ? 'UNREACHABLE' : 'UNUSED') : 'DISABLED';
    return { eligible: profile.status === 'active' && devices.length > 0, profileVersion: profile.version, status, devices };
  }

  async getHealth(tenantId: string, credentialId: string): Promise<CredentialHealthState> {
    const eligibility = await this.eligibility(tenantId, credentialId);
    return this.repository.ensureState(tenantId, credentialId, eligibility.profileVersion, eligibility.status, eligibility.devices.length);
  }

  listChecks(tenantId: string, credentialId: string, deviceAssetId?: string): Promise<CredentialHealthCheckRecord[]> { return this.repository.listRecords(tenantId, credentialId, deviceAssetId); }

  async enqueueManual(tenantId: string, credentialId: string, actorId: string, deviceAssetId?: string, triggerSource = 'credential.manual-health-check'): Promise<{ task: TaskRun; health: CredentialHealthState }> {
    const eligibility = await this.eligibility(tenantId, credentialId);
    if (!eligibility.eligible) throw new AppError('VALIDATION_FAILED', eligibility.status === 'DISABLED' ? '凭据已禁用，不能检测' : '凭据未关联有效设备，不能检测', { code: eligibility.status });
    const devices = deviceAssetId ? eligibility.devices.filter((item) => item.id === deviceAssetId) : eligibility.devices;
    if (devices.length === 0) throw new AppError('RESOURCE_NOT_FOUND', '设备资产不存在或未关联当前凭据', { deviceAssetId });
    const state = await this.repository.ensureState(tenantId, credentialId, eligibility.profileVersion, 'UNREACHABLE', eligibility.devices.length);
    let generation = state.generation;
    let idempotencyKey = `credential-health:${credentialId}:${generation}`;
    let existing = state.checkingTaskId
      ? await this.tasks?.findActiveByIdempotency(tenantId, 'CREDENTIAL_HEALTH_CHECK', idempotencyKey)
      : undefined;
    if (!existing && !state.checkingTaskId) {
      generation = await this.repository.startGeneration(tenantId, credentialId, eligibility.profileVersion);
      idempotencyKey = `credential-health:${credentialId}:${generation}`;
      existing = await this.tasks?.findActiveByIdempotency(tenantId, 'CREDENTIAL_HEALTH_CHECK', idempotencyKey);
    }
    if (!existing && state.checkingTaskId && !state.checkingTaskId.startsWith('pending:')) {
      await this.repository.clearCheckingTask(tenantId, credentialId, state.generation);
      generation = await this.repository.startGeneration(tenantId, credentialId, eligibility.profileVersion);
      idempotencyKey = `credential-health:${credentialId}:${generation}`;
    }
    const task = existing ?? await this.tasks?.enqueue({ tenantId, taskType: 'CREDENTIAL_HEALTH_CHECK', requestedBy: actorId, triggerSource, idempotencyKey, idempotencyScope: { actionType: 'credential.health-check', resourceType: 'credential', resourceId: credentialId }, resourceSummary: { credentialId, deviceCount: devices.length }, resourceRefs: [{ resourceType: 'credential', resourceId: credentialId }, ...devices.map((device) => ({ resourceType: 'deviceAsset', resourceId: device.id }))], payload: { credentialId, profileVersion: eligibility.profileVersion, generation, deviceAssetIds: devices.map((device) => device.id) } });
    if (!task) throw new AppError('CAPABILITY_MISSING', '统一任务服务未注册');
    await this.repository.markTask(tenantId, credentialId, task.id, generation);
    return { task, health: { ...state, status: 'UNREACHABLE', generation, profileVersion: eligibility.profileVersion, checkingTaskId: task.id, deviceCount: eligibility.devices.length } };
  }

  async executeTask(task: TaskRun): Promise<{ success: boolean; detail?: Record<string, unknown>; errorCode?: string; errorMessage?: string }> {
    const credentialId = requiredPayloadString(task, 'credentialId');
    const profile = await this.credentials.get(task.tenantId, credentialId);
    if (!profile) return { success: false, errorCode: 'RESOURCE_NOT_FOUND', errorMessage: '凭据不存在' };
    const expectedVersion = Number(task.payload.profileVersion);
    const generation = Number(task.payload.generation);
    if (profile.status !== 'active' || profile.version !== expectedVersion) return { success: true, detail: { stale: true, credentialId } };
    const eligibility = await this.eligibility(task.tenantId, credentialId);
    const wanted = Array.isArray(task.payload.deviceAssetIds) ? new Set(task.payload.deviceAssetIds.filter((id): id is string => typeof id === 'string')) : undefined;
    const devices = wanted ? eligibility.devices.filter((device) => wanted.has(device.id)) : eligibility.devices;
    const results: CredentialHealthCheckRecord[] = [];
    for (const device of devices) {
      const started = Date.now();
      let result: CredentialHealthAdapterResult;
      try { result = await this.adapters.resolve().check({ tenantId: task.tenantId, credentialId, profileVersion: profile.version, device, generation }); } catch (error) { result = { status: 'ERROR', reasonCode: 'CHECK_RESULT_INVALID', summary: error instanceof Error ? error.message : '凭据检测失败' }; }
      results.push(await this.repository.saveRecord({ tenantId: task.tenantId, credentialId, deviceAssetId: device.id, taskId: task.id, generation, profileVersion: profile.version, resultStatus: result.status, reasonCode: result.reasonCode, reasonSummary: result.summary, checkedAt: new Date().toISOString(), durationMs: Date.now() - started, pluginVersionId: result.pluginVersionId ?? device.pluginVersionId, workflowVersionId: result.workflowVersionId, secretVersionSummary: result.secretVersionSummary, detail: result.detail ?? {} }));
    }
    const aggregateRecords = (await this.repository.listRecords(task.tenantId, credentialId))
      .filter((item) => item.generation === generation && item.profileVersion === profile.version)
      .reduce((map, item) => map.set(item.deviceAssetId, item), new Map<string, CredentialHealthCheckRecord>());
    const stateStatus = aggregateCredentialHealth({ profileStatus: profile.status, deviceCount: eligibility.devices.length, results: [...aggregateRecords.values()] });
    const firstFailure = [...aggregateRecords.values()].find((item) => item.resultStatus !== 'VALID');
    await this.repository.finalizeState(task.tenantId, credentialId, generation, profile.version, stateStatus, firstFailure?.reasonCode, firstFailure?.reasonSummary, [...aggregateRecords.values()].filter((item) => item.resultStatus === 'ERROR').length, new Date(Date.now() + 15 * 60_000).toISOString());
    return { success: true, detail: { credentialId, generation, status: stateStatus, deviceCount: aggregateRecords.size } };
  }

  async scheduleDue(tenantId?: string): Promise<TaskRun[]> {
    if (!this.tasks) return [];
    for (const item of await this.repository.listActiveCredentialRefs(tenantId)) {
      const devices = await this.repository.listEligibleDevices(item.tenantId, item.credentialId);
      await this.repository.ensureState(item.tenantId, item.credentialId, item.profileVersion, devices.length > 0 ? 'UNREACHABLE' : 'UNUSED', devices.length);
    }
    const due = await this.repository.listDue(tenantId);
    const tasks: TaskRun[] = [];
    for (const item of due) {
      const existing = await this.tasks.findActiveByIdempotency(item.tenantId, 'CREDENTIAL_HEALTH_CHECK', `credential-health:${item.credentialId}:${item.generation + 1}`);
      if (existing) { tasks.push(existing); continue; }
      try {
        const result = await this.enqueueManual(item.tenantId, item.credentialId, 'credential-health-scheduler', undefined, 'credential.scheduler');
        tasks.push(result.task);
      } catch { /* 资格在扫描和入队之间变化时跳过本轮，下一轮重新判断。 */ }
    }
    return tasks;
  }
}

function requiredPayloadString(task: TaskRun, key: string): string { const value = task.payload[key]; if (typeof value !== 'string' || !value.trim()) throw new AppError('VALIDATION_FAILED', `任务载荷缺少 ${key}`); return value.trim(); }
