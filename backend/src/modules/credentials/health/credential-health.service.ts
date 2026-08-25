import { AppError } from '../../../common/errors/app-error.js';
import { newId } from '../../../shared/id.js';
import type { CredentialProfileEntity } from '../../../persistence/entities/credential-profile.entity.js';
import { CredentialsRepository } from '../repository/credentials.repository.js';
import type { TasksApplicationService } from '../../tasks/task.application-service.js';
import type { TaskRun } from '../../tasks/task.types.js';
import { CredentialHealthRepository } from './credential-health.repository.js';
import { DeviceWorkflowCredentialHealthAdapter, CredentialHealthAdapterRegistry } from './credential-health.adapter.js';
import { aggregateCredentialHealth, type CredentialHealthAdapter, type CredentialHealthAdapterResult, type CredentialHealthCheckRecord, type CredentialHealthDeviceEligibility, type CredentialHealthEligibility, type CredentialHealthState } from './credential-health.types.js';
import type { CredentialHealthDevice } from './credential-health.types.js';
import type { CredentialHealthCapabilityExecutor } from './credential-health.adapter.js';
import { DEFAULT_CREDENTIAL_HEALTH_SETTINGS, type CredentialHealthSettings } from '../../../shared/credential-health-settings.js';

interface CredentialHealthSettingsReader {
  getCredentialHealthSettings(tenantId: string): Promise<CredentialHealthSettings>;
}

export class CredentialHealthService {
  readonly adapters: CredentialHealthAdapterRegistry;
  private readonly schedulerOwnerId = newId('credential-health-scheduler');
  constructor(
    private readonly repository: CredentialHealthRepository,
    private readonly credentials: Pick<CredentialsRepository, 'get'>,
    private readonly tasks?: Pick<TasksApplicationService, 'enqueue' | 'findActiveByIdempotency'>,
    capabilityExecutor?: CredentialHealthCapabilityExecutor,
    adapterRegistry?: CredentialHealthAdapterRegistry,
    private readonly settings?: CredentialHealthSettingsReader,
  ) {
    this.adapters = adapterRegistry ?? new CredentialHealthAdapterRegistry();
    if (capabilityExecutor) this.adapters.register(new DeviceWorkflowCredentialHealthAdapter(capabilityExecutor));
  }

  async eligibility(tenantId: string, credentialId: string): Promise<CredentialHealthEligibility> {
    const profile = await this.credentials.get(tenantId, credentialId);
    if (!profile) throw new AppError('RESOURCE_NOT_FOUND', 'CredentialProfile 不存在', { credentialId });
    const state = await this.repository.getState(tenantId, credentialId);
    const devices = profile.status === 'active' ? await this.repository.listEligibleDevices(tenantId, credentialId) : [];
    const enabled = state?.enabled === true;
    const selectedDeviceAssetId = state?.selectedDeviceAssetId;
    const selectedDevice = selectedDeviceAssetId ? devices.find((device) => device.id === selectedDeviceAssetId) : undefined;
    let status: CredentialHealthEligibility['status'] = 'DISABLED';
    let eligible = false;
    if (profile.status === 'active') {
      if (devices.length === 0) status = 'UNUSED';
      else if (!enabled) status = 'DISABLED';
      else if (!selectedDevice || selectedDevice.credentialTestSupported !== true) status = 'ERROR';
      else { status = 'UNREACHABLE'; eligible = true; }
    }
    return { eligible, profileVersion: profile.version, status, devices, enabled, ...(selectedDeviceAssetId ? { selectedDeviceAssetId } : {}), configVersion: Number(state?.configVersion ?? 0), ...(selectedDevice ? { selectedDevice } : {}) };
  }

  async getHealth(tenantId: string, credentialId: string): Promise<CredentialHealthState> {
    const eligibility = await this.eligibility(tenantId, credentialId);
    const state = await this.repository.ensureState(tenantId, credentialId, eligibility.profileVersion, eligibility.status, eligibility.devices.length);
    const status = statusFromEligibility(state.status, eligibility);
    return {
      ...state,
      status,
      enabled: eligibility.enabled,
      deviceEligibility: summarizeDeviceEligibility(eligibility.devices),
      ...(eligibility.selectedDeviceAssetId ? { selectedDeviceAssetId: eligibility.selectedDeviceAssetId } : {}),
      ...(eligibility.selectedDevice ? { selectedDevice: eligibility.selectedDevice } : {}),
      configVersion: eligibility.configVersion,
      availableDevices: eligibility.devices.filter((device) => device.online === true && device.credentialTestSupported === true),
    };
  }

  async updateConfiguration(tenantId: string, credentialId: string, actorId: string, input: { enabled: boolean; selectedDeviceAssetId?: string }): Promise<CredentialHealthState> {
    const profile = await this.credentials.get(tenantId, credentialId);
    if (!profile) throw new AppError('RESOURCE_NOT_FOUND', 'CredentialProfile 不存在', { credentialId });
    const devices = profile.status === 'active' ? await this.repository.listEligibleDevices(tenantId, credentialId) : [];
    if (input.enabled) {
      if (profile.status !== 'active') throw new AppError('VALIDATION_FAILED', '凭据未启用，不能开启有效性检测', { code: 'DISABLED' });
      const selected = devices.find((device) => device.id === input.selectedDeviceAssetId);
      if (!selected) throw new AppError('RESOURCE_NOT_FOUND', '设备资产不存在或未关联当前凭据', { deviceAssetId: input.selectedDeviceAssetId });
      if (selected.online !== true) throw new AppError('VALIDATION_FAILED', '只能选择在线设备作为检测设备', { code: 'DEVICE_OFFLINE', deviceAssetId: selected.id });
      if (selected.credentialTestSupported !== true) throw new AppError('VALIDATION_FAILED', '该设备插件未提供凭据测试能力', { code: 'CHECK_CAPABILITY_MISSING', deviceAssetId: selected.id });
    }
    await this.repository.saveConfiguration({
      tenantId,
      credentialId,
      profileVersion: profile.version,
      enabled: input.enabled,
      ...(input.enabled && input.selectedDeviceAssetId ? { selectedDeviceAssetId: input.selectedDeviceAssetId } : {}),
      updatedBy: actorId,
    });
    return this.getHealth(tenantId, credentialId);
  }

  listChecks(tenantId: string, credentialId: string, deviceAssetId?: string): Promise<CredentialHealthCheckRecord[]> { return this.repository.listRecords(tenantId, credentialId, deviceAssetId); }

  async enqueueManual(tenantId: string, credentialId: string, actorId: string, deviceAssetId?: string, triggerSource = 'credential.manual-health-check'): Promise<{ task: TaskRun; health: CredentialHealthState }> {
    const eligibility = await this.eligibility(tenantId, credentialId);
    if (!eligibility.eligible) throw new AppError('VALIDATION_FAILED', eligibility.status === 'DISABLED' ? '凭据有效性检测未开启' : eligibility.status === 'UNUSED' ? '凭据未关联有效设备，不能检测' : '凭据检测设备或插件能力无效', { code: eligibility.status });
    const selectedDevice = eligibility.selectedDevice;
    if (!selectedDevice) throw new AppError('VALIDATION_FAILED', '凭据尚未选择有效性检测设备', { code: 'DEVICE_NOT_SELECTED' });
    if (deviceAssetId && deviceAssetId !== selectedDevice.id) throw new AppError('VALIDATION_FAILED', '只能检测凭据配置中选定的设备', { code: 'DEVICE_SELECTION_CONFLICT', deviceAssetId });
    const state = await this.repository.ensureState(tenantId, credentialId, eligibility.profileVersion, 'UNREACHABLE', 1);
    let generation = state.generation;
    const configVersion = eligibility.configVersion;
    let idempotencyKey = `credential-health:${credentialId}:${selectedDevice.id}:${configVersion}:${generation}`;
    let existing = state.checkingTaskId
      ? await this.tasks?.findActiveByIdempotency(tenantId, 'CREDENTIAL_HEALTH_CHECK', idempotencyKey)
      : undefined;
    if (!existing && !state.checkingTaskId) {
      generation = await this.repository.startGeneration(tenantId, credentialId, eligibility.profileVersion);
      idempotencyKey = `credential-health:${credentialId}:${selectedDevice.id}:${configVersion}:${generation}`;
      existing = await this.tasks?.findActiveByIdempotency(tenantId, 'CREDENTIAL_HEALTH_CHECK', idempotencyKey);
    }
    if (!existing && state.checkingTaskId && !state.checkingTaskId.startsWith('pending:')) {
      await this.repository.clearCheckingTask(tenantId, credentialId, state.generation);
      generation = await this.repository.startGeneration(tenantId, credentialId, eligibility.profileVersion);
      idempotencyKey = `credential-health:${credentialId}:${selectedDevice.id}:${configVersion}:${generation}`;
    }
    const task = existing ?? await this.tasks?.enqueue({ tenantId, taskType: 'CREDENTIAL_HEALTH_CHECK', requestedBy: actorId, triggerSource, idempotencyKey, idempotencyScope: { actionType: 'credential.health-check', resourceType: 'credential', resourceId: credentialId }, resourceSummary: { credentialId, deviceCount: 1, selectedDeviceAssetId: selectedDevice.id }, resourceRefs: [{ resourceType: 'credential', resourceId: credentialId }, { resourceType: 'deviceAsset', resourceId: selectedDevice.id }], payload: { credentialId, profileVersion: eligibility.profileVersion, generation, configVersion, deviceAssetId: selectedDevice.id } });
    if (!task) throw new AppError('CAPABILITY_MISSING', '统一任务服务未注册');
    await this.repository.markTask(tenantId, credentialId, task.id, generation);
    return { task, health: { ...state, status: 'UNREACHABLE', generation, profileVersion: eligibility.profileVersion, checkingTaskId: task.id, deviceCount: 1, enabled: true, selectedDeviceAssetId: selectedDevice.id, configVersion } };
  }

  async executeTask(task: TaskRun): Promise<{ success: boolean; detail?: Record<string, unknown>; errorCode?: string; errorMessage?: string }> {
    const credentialId = requiredPayloadString(task, 'credentialId');
    const profile = await this.credentials.get(task.tenantId, credentialId);
    if (!profile) return { success: false, errorCode: 'RESOURCE_NOT_FOUND', errorMessage: '凭据不存在' };
    const expectedVersion = Number(task.payload.profileVersion);
    const generation = Number(task.payload.generation);
    if (profile.status !== 'active' || profile.version !== expectedVersion) return { success: true, detail: { stale: true, credentialId } };
    const eligibility = await this.eligibility(task.tenantId, credentialId);
    const taskDeviceAssetId = payloadString(task, 'deviceAssetId');
    const taskConfigVersion = Number(task.payload.configVersion);
    if (!taskDeviceAssetId || !Number.isFinite(taskConfigVersion) || !eligibility.eligible || eligibility.selectedDeviceAssetId !== taskDeviceAssetId || eligibility.configVersion !== taskConfigVersion) {
      return { success: true, detail: { stale: true, credentialId, ...(taskDeviceAssetId ? { deviceAssetId: taskDeviceAssetId } : {}), ...(!taskDeviceAssetId || !Number.isFinite(taskConfigVersion) ? { reason: 'LEGACY_TASK_PAYLOAD' } : {}) } };
    }
    const currentState = await this.repository.getState(task.tenantId, credentialId);
    if (!currentState || currentState.generation !== generation || currentState.configVersion !== taskConfigVersion) {
      return { success: true, detail: { stale: true, credentialId, deviceAssetId: taskDeviceAssetId, reason: 'GENERATION_CHANGED' } };
    }
    const devices = eligibility.selectedDevice ? [eligibility.selectedDevice] : [];
    if (devices[0]?.online !== true) {
      const checkedAt = new Date().toISOString();
      const record = await this.repository.saveRecord({ tenantId: task.tenantId, credentialId, deviceAssetId: taskDeviceAssetId, taskId: task.id, generation, profileVersion: profile.version, resultStatus: 'UNREACHABLE', reasonCode: 'NETWORK_UNREACHABLE', reasonSummary: '设备网络不可达', checkedAt, durationMs: 0, pluginVersionId: devices[0]?.pluginVersionId, detail: { livenessStatus: devices[0]?.livenessStatus ?? 'UNKNOWN' } });
      await this.repository.finalizeState(task.tenantId, credentialId, generation, profile.version, 'UNREACHABLE', record.reasonCode, record.reasonSummary, 0, await this.nextCheckAt(task.tenantId));
      return { success: true, detail: { credentialId, generation, status: 'UNREACHABLE', deviceCount: 1, deviceAssetId: taskDeviceAssetId, reasonCode: 'NETWORK_UNREACHABLE' } };
    }
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
    const stateStatus = aggregateCredentialHealth({ profileStatus: profile.status, deviceCount: 1, results: [...aggregateRecords.values()] });
    const firstFailure = [...aggregateRecords.values()].find((item) => item.resultStatus !== 'VALID');
    await this.repository.finalizeState(task.tenantId, credentialId, generation, profile.version, stateStatus, firstFailure?.reasonCode, firstFailure?.reasonSummary, [...aggregateRecords.values()].filter((item) => item.resultStatus === 'ERROR').length, await this.nextCheckAt(task.tenantId));
    return { success: true, detail: { credentialId, generation, status: stateStatus, deviceCount: aggregateRecords.size, deviceAssetId: taskDeviceAssetId } };
  }

  private async nextCheckAt(tenantId: string): Promise<string> {
    let intervalMinutes = DEFAULT_CREDENTIAL_HEALTH_SETTINGS.intervalMinutes;
    if (this.settings) {
      try {
        intervalMinutes = (await this.settings.getCredentialHealthSettings(tenantId)).intervalMinutes;
      } catch {
        // 中文说明：设置读取失败时继续使用默认间隔，避免一次配置故障停止全部检测调度。
      }
    }
    return new Date(Date.now() + intervalMinutes * 60_000).toISOString();
  }

  async scheduleDue(tenantId?: string): Promise<TaskRun[]> {
    if (!this.tasks) return [];
    if (!(await this.repository.acquireSchedulerLease(this.schedulerOwnerId))) return [];
    for (const item of await this.repository.listActiveCredentialRefs(tenantId)) {
      const devices = await this.repository.listEligibleDevices(item.tenantId, item.credentialId);
      await this.repository.ensureState(item.tenantId, item.credentialId, item.profileVersion, devices.length > 0 ? 'UNREACHABLE' : 'UNUSED', devices.length);
    }
    const due = await this.repository.listDue(tenantId);
    const tasks: TaskRun[] = [];
    for (const item of due) {
      try {
        const result = await this.enqueueManual(item.tenantId, item.credentialId, 'credential-health-scheduler', undefined, 'credential.scheduler');
        tasks.push(result.task);
      } catch { /* 资格在扫描和入队之间变化时跳过本轮，下一轮重新判断。 */ }
    }
    return tasks;
  }
}

function summarizeDeviceEligibility(devices: readonly CredentialHealthDevice[]): CredentialHealthDeviceEligibility {
  const online = devices.filter((device) => device.online === true).length;
  const offline = devices.filter((device) => device.livenessStatus === 'OFFLINE').length;
  const onlineWithCredentialTest = devices.filter((device) => device.online === true && device.credentialTestSupported === true).length;
  return {
    total: devices.length,
    online,
    offline,
    unknown: Math.max(devices.length - online - offline, 0),
    onlineWithCredentialTest,
    onlineWithoutCredentialTest: Math.max(online - onlineWithCredentialTest, 0),
  };
}

function requiredPayloadString(task: TaskRun, key: string): string { const value = task.payload[key]; if (typeof value !== 'string' || !value.trim()) throw new AppError('VALIDATION_FAILED', `任务载荷缺少 ${key}`); return value.trim(); }
function payloadString(task: TaskRun, key: string): string | undefined { const value = task.payload[key]; return typeof value === 'string' && value.trim() ? value.trim() : undefined; }

function statusFromEligibility(current: CredentialHealthState['status'], eligibility: CredentialHealthEligibility): CredentialHealthState['status'] {
  if (eligibility.status === 'DISABLED' || eligibility.status === 'UNUSED' || eligibility.status === 'ERROR') return eligibility.status;
  if (eligibility.selectedDevice && eligibility.selectedDevice.online !== true) return 'UNREACHABLE';
  return current;
}
