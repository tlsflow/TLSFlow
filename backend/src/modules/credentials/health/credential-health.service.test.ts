import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../../common/errors/app-error.js';
import type { CredentialProfileEntity } from '../../../persistence/entities/credential-profile.entity.js';
import type { TaskEnqueueInput, TaskRun } from '../../tasks/task.types.js';
import { CredentialHealthAdapterRegistry } from './credential-health.adapter.js';
import { CredentialHealthService } from './credential-health.service.js';
import type { CredentialHealthCheckRecord, CredentialHealthDevice, CredentialHealthState } from './credential-health.types.js';
import { sanitizeCredentialHealthDetail } from './credential-health.repository.js';

const tenantId = 'tenant-health-test';
const credentialId = 'credential-health-test';

test('禁用凭据和未使用凭据不会创建检测任务', async () => {
  const tasks = new FakeTasks();
  const disabled = service({ profile: profile('disabled'), tasks });
  await assert.rejects(() => disabled.enqueueManual(tenantId, credentialId, 'user-1'), (error: unknown) => error instanceof AppError && error.errorCode === 'VALIDATION_FAILED');
  const unused = service({ profile: profile('active'), devices: [], tasks });
  await assert.rejects(() => unused.enqueueManual(tenantId, credentialId, 'user-1'), (error: unknown) => error instanceof AppError && error.errorCode === 'VALIDATION_FAILED');
  assert.equal(tasks.enqueued.length, 0);
});

test('重复手动检测复用同一代次任务', async () => {
  const tasks = new FakeTasks();
  const health = service({ tasks });
  const first = await health.enqueueManual(tenantId, credentialId, 'user-1');
  const second = await health.enqueueManual(tenantId, credentialId, 'user-1');
  assert.equal(first.task.id, second.task.id);
  assert.equal(first.health.generation, 1);
  assert.equal(tasks.enqueued.length, 1);
});

test('Profile 代次迟到任务不会覆盖新版本', async () => {
  const repository = new FakeRepository([device('device-1')]);
  const health = service({ repository, profile: profile('active', 2) });
  const result = await health.executeTask(task({ credentialId, profileVersion: 1, generation: 1, deviceAssetIds: ['device-1'] }));
  assert.deepEqual(result, { success: true, detail: { stale: true, credentialId } });
  assert.equal(repository.records.length, 0);
  assert.equal(repository.finalized.length, 0);
});

test('多设备结果按错误优先级聚合并保存设备证据', async () => {
  const devices = [device('device-valid'), device('device-unreachable'), device('device-error')];
  const repository = new FakeRepository(devices);
  const adapters = new CredentialHealthAdapterRegistry();
  adapters.register({
    capabilityKey: 'credential.health-check',
    async check(input) {
      if (input.device.id === 'device-error') return { status: 'ERROR', reasonCode: 'PASSWORD_INVALID', summary: '密码错误', detail: { responseBody: 'must-not-persist', nested: { token: 'secret' } } };
      if (input.device.id === 'device-unreachable') return { status: 'UNREACHABLE', reasonCode: 'NETWORK_UNREACHABLE', summary: '设备不可达' };
      return { status: 'VALID', summary: '认证成功' };
    },
  });
  const health = service({ repository, adapters });
  const result = await health.executeTask(task({ credentialId, profileVersion: 1, generation: 1, deviceAssetIds: devices.map((item) => item.id) }));
  assert.equal(result.success, true);
  assert.equal(repository.finalized[0]?.status, 'ERROR');
  assert.equal(repository.records.length, 3);
  assert.equal(repository.records.find((item) => item.deviceAssetId === 'device-error')?.reasonCode, 'PASSWORD_INVALID');
  assert.deepEqual(repository.records.find((item) => item.deviceAssetId === 'device-error')?.detail, { nested: {} });
});

test('健康检测详情递归脱敏', () => {
  assert.deepEqual(sanitizeCredentialHealthDetail({ httpStatus: 401, password: 'x', nested: { token: 'y', safe: 'ok' }, responseBody: { safe: true }, attempts: [{ cookie: 'z', safe: 'ok' }] }), { httpStatus: 401, nested: { safe: 'ok' }, attempts: [{ safe: 'ok' }] });
});

function service(options: { repository?: FakeRepository; profile?: CredentialProfileEntity; devices?: CredentialHealthDevice[]; tasks?: FakeTasks; adapters?: CredentialHealthAdapterRegistry } = {}): CredentialHealthService {
  const repository = options.repository ?? new FakeRepository(options.devices ?? [device('device-1')]);
  const credentials = { get: async () => options.profile ?? profile('active') } as never;
  return new CredentialHealthService(repository as never, credentials, options.tasks as never, undefined, options.adapters);
}

function profile(status: string, version = 1): CredentialProfileEntity {
  return { id: credentialId, tenantId, name: '测试凭据', kind: 'USERNAME_PASSWORD', scopeType: 'global', delivery: {}, secretSlots: {}, metadata: {}, status, version, createdBy: 'test', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as CredentialProfileEntity;
}

function device(id: string): CredentialHealthDevice { return { id, displayName: id, address: '192.0.2.10', port: 443, deviceFamily: 'fixture', credentialId, version: 1 }; }

function task(payload: Record<string, unknown>): TaskRun {
  return { id: 'task-health-test', tenantId, taskType: 'CREDENTIAL_HEALTH_CHECK', definitionVersion: 1, category: 'MONITORING', status: 'QUEUED', triggerSource: 'test', payload, availableAt: new Date().toISOString(), createdAt: new Date().toISOString() };
}

class FakeTasks {
  readonly enqueued: TaskEnqueueInput[] = [];
  private readonly active = new Map<string, TaskRun>();
  async findActiveByIdempotency(_tenant: string, _type: string, key: string): Promise<TaskRun | undefined> { return this.active.get(key); }
  async enqueue(input: TaskEnqueueInput): Promise<TaskRun> {
    this.enqueued.push(input);
    const taskRun = task({ ...(input.payload ?? {}) });
    taskRun.idempotencyKey = input.idempotencyKey;
    const existing = input.idempotencyKey ? this.active.get(input.idempotencyKey) : undefined;
    if (existing) return existing;
    if (input.idempotencyKey) this.active.set(input.idempotencyKey, taskRun);
    return taskRun;
  }
}

class FakeRepository {
  state?: CredentialHealthState;
  readonly records: CredentialHealthCheckRecord[] = [];
  readonly finalized: Array<{ status: string }> = [];
  constructor(private readonly devices: CredentialHealthDevice[]) {}
  async listEligibleDevices(): Promise<CredentialHealthDevice[]> { return this.devices; }
  async getState(): Promise<CredentialHealthState | undefined> { return this.state; }
  async ensureState(_tenant: string, _credential: string, profileVersion: number, status: CredentialHealthState['status'], deviceCount: number): Promise<CredentialHealthState> {
    if (!this.state) this.state = { tenantId, credentialId, status, profileVersion, generation: 0, failureCount: 0, deviceCount, updatedAt: new Date().toISOString() };
    this.state = { ...this.state, profileVersion, deviceCount, status: this.state.status === 'DISABLED' || this.state.status === 'UNUSED' ? status : this.state.status };
    return this.state;
  }
  async startGeneration(): Promise<number> { const generation = (this.state?.generation ?? 0) + 1; this.state = { ...this.state!, generation, checkingTaskId: 'pending:credential-health' }; return generation; }
  async markTask(_tenant: string, _credential: string, taskId: string | undefined, generation: number): Promise<void> { this.state = { ...this.state!, checkingTaskId: taskId, generation }; }
  async clearCheckingTask(): Promise<void> { this.state = { ...this.state!, checkingTaskId: undefined }; }
  async saveRecord(record: Omit<CredentialHealthCheckRecord, 'id' | 'createdAt'>): Promise<CredentialHealthCheckRecord> { const saved = { ...record, id: `record-${this.records.length}`, createdAt: new Date().toISOString(), detail: sanitizeCredentialHealthDetail(record.detail) }; this.records.push(saved); return saved; }
  async listRecords(): Promise<CredentialHealthCheckRecord[]> { return this.records; }
  async finalizeState(_tenant: string, _credential: string, _generation: number, _profileVersion: number, status: string): Promise<boolean> { this.finalized.push({ status }); return true; }
}
