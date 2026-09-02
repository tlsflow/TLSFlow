import assert from 'node:assert/strict';
import test from 'node:test';
import { LivenessDomainService } from './domain/liveness.domain-service.js';
import type { DeviceLivenessSignal, LivenessSignalType } from './schema/liveness.schema.js';

const domain = new LivenessDomainService();

test('Agent 缺少任一必需信号时存活状态未知', () => {
  const projection = domain.project([signal('HEARTBEAT', 'HEALTHY', 0)], ['HEARTBEAT', 'MANAGEMENT_TCP']);
  assert.equal(projection.livenessStatus, 'UNKNOWN');
});

test('任一必需信号连续两次失败时设备离线', () => {
  const projection = domain.project([
    signal('HEARTBEAT', 'HEALTHY', 0),
    signal('MANAGEMENT_TCP', 'FAILED', 2, 'TCP_CONNECT_TIMEOUT'),
  ], ['HEARTBEAT', 'MANAGEMENT_TCP']);
  assert.equal(projection.livenessStatus, 'OFFLINE');
  assert.equal(projection.livenessReasonCode, 'TCP_CONNECT_TIMEOUT');
});

test('第一次失败只进入可疑状态并保留最近在线结论', () => {
  const projection = domain.project([
    signal('HEARTBEAT', 'HEALTHY', 0),
    signal('MANAGEMENT_TCP', 'SUSPECT', 1, 'TCP_CONNECTION_REFUSED'),
  ], ['HEARTBEAT', 'MANAGEMENT_TCP']);
  assert.equal(projection.livenessStatus, 'ONLINE');
  assert.equal(projection.livenessReasonCode, 'TCP_CONNECTION_REFUSED');
});

test('非 Agent 设备只要求管理端口成功', () => {
  const projection = domain.project([signal('MANAGEMENT_TCP', 'HEALTHY', 0)], ['MANAGEMENT_TCP']);
  assert.equal(projection.livenessStatus, 'ONLINE');
});

test('管理端口健康信号过期后不再判定在线', () => {
  const projection = domain.project(
    [signal('MANAGEMENT_TCP', 'HEALTHY', 0, undefined, '2026-07-27T00:00:00.000Z')],
    ['MANAGEMENT_TCP'],
    { now: new Date('2026-07-27T00:10:00.000Z') },
  );
  assert.equal(projection.livenessStatus, 'UNKNOWN');
  assert.equal(projection.livenessReasonCode, 'LIVENESS_SIGNAL_STALE');
  assert.equal(projection.signals.find((item) => item.signalType === 'MANAGEMENT_TCP')?.status, 'UNKNOWN');
});

test('管理端口健康信号缺少探测时间时不再判定在线', () => {
  const staleSignal = signal('MANAGEMENT_TCP', 'HEALTHY', 0);
  delete staleSignal.lastObservedAt;
  const projection = domain.project([staleSignal], ['MANAGEMENT_TCP']);
  assert.equal(projection.livenessStatus, 'UNKNOWN');
});

function signal(
  signalType: LivenessSignalType,
  status: DeviceLivenessSignal['status'],
  failures: number,
  reasonCode?: string,
  lastObservedAt = new Date().toISOString(),
): DeviceLivenessSignal {
  return {
    id: `signal_${signalType}`,
    tenantId: 'tenant_liveness',
    resourceType: 'AGENT',
    resourceId: 'agent_liveness',
    signalType,
    required: true,
    status,
    consecutiveFailures: failures,
    lastObservedAt,
    source: signalType === 'HEARTBEAT' ? 'AGENT' : 'CONTROL_PLANE',
    reasonCode,
    createdAt: lastObservedAt,
    updatedAt: lastObservedAt,
  };
}
