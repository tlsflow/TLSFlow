import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { AppError } from '../../../common/errors/app-error.js';
import type { AgentManagementClient } from './agent-management-client.js';
import { AgentsApplicationService } from './agents.application-service.js';
import type { AgentRegistration, AgentUpgradePlan, AgentVersionRelease } from '../schema/agents.schema.js';

test('Windows Go 宿主升级链路把接受与传输失败分开记录', async () => {
  const previousKeyId = process.env.GCAC_AGENT_UPGRADE_AUTHORITY_KEY_ID;
  const previousPrivateKey = process.env.GCAC_AGENT_UPGRADE_SIGNING_KEY_PEM;
  const { privateKey } = generateKeyPairSync('ed25519');
  process.env.GCAC_AGENT_UPGRADE_AUTHORITY_KEY_ID = 'upgrade-host-test';
  process.env.GCAC_AGENT_UPGRADE_SIGNING_KEY_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  try {
    const acceptedState = createUpgradeStore();
    let acceptedEnvelope: Record<string, unknown> | undefined;
    const acceptedClient = {
      dispatchUpgrade: async (_agent: AgentRegistration, envelope: Record<string, unknown>) => {
        acceptedEnvelope = envelope;
        return { success: true, accepted: true, transactionId: envelope.transactionId, status: 'accepted' };
      },
    };
    let enqueuedTaskInput: Record<string, unknown> | undefined;
    const acceptedService = createService(acceptedState, acceptedClient as never, {
      enqueue: async (input: Record<string, unknown>) => {
        enqueuedTaskInput = input;
        return { id: 'task-agent-upgrade-1' } as never;
      },
    });
    const plan = await acceptedService.checkUpgrade('tenant-host-flow', { agentId: 'agent-host-flow', releaseId: 'release-host-flow' });
    assert.equal('id' in plan, true);
    const accepted = await acceptedService.dispatchUpgrade(
      'tenant-host-flow',
      { agentId: 'agent-host-flow', planId: (plan as AgentUpgradePlan).id },
      'operator-1',
      'request-1',
      'https://control-plane.invalid',
    );
    assert.equal(accepted.status, 'accepted');
    assert.equal((accepted.result as { accepted?: boolean }).accepted, true);
    assert.equal(enqueuedTaskInput?.taskType, 'AGENT_UPDATE');
    assert.equal(enqueuedTaskInput?.triggerSource, 'agent-upgrade-confirmed');
    assert.equal((accepted.result as { taskId?: string }).taskId, 'task-agent-upgrade-1');
    assert.equal((acceptedEnvelope?.release as { productLine?: string }).productLine, 'windows-go-full');
    assert.match(String(acceptedEnvelope?.upgradeBootstrapUrl), /^https:\/\/control-plane\.invalid\/agent-install\.ps1\?token=/u);
    assert.equal(acceptedState.installSessions[0]?.agentKey, acceptedState.agent.agentKey);
    assert.equal(acceptedState.installSessions[0]?.platform, 'windows_go_service');
    const manualRequired = await acceptedService.markUpgradeManualRequired(
      'tenant-host-flow',
      'agent-host-flow',
      accepted.id,
      'operator-1',
      '全局任务已强制结束',
    );
    assert.equal(manualRequired.status, 'manual_required');
    assert.equal((manualRequired.result as { taskCancelled?: boolean }).taskCancelled, true);

    const failedState = createUpgradeStore();
    const failedClient = {
      dispatchUpgrade: async () => { throw new Error('连接被拒绝'); },
    };
    const failedService = createService(failedState, failedClient as never);
    const failedPlan = await failedService.checkUpgrade('tenant-host-flow', { agentId: 'agent-host-flow', releaseId: 'release-host-flow' });
    await assert.rejects(() => failedService.dispatchUpgrade('tenant-host-flow', { agentId: 'agent-host-flow', planId: (failedPlan as AgentUpgradePlan).id }, 'operator-1', 'request-2'));
    assert.equal(failedState.plan.status, 'transport_failed');
  } finally {
    if (previousKeyId === undefined) delete process.env.GCAC_AGENT_UPGRADE_AUTHORITY_KEY_ID;
    else process.env.GCAC_AGENT_UPGRADE_AUTHORITY_KEY_ID = previousKeyId;
    if (previousPrivateKey === undefined) delete process.env.GCAC_AGENT_UPGRADE_SIGNING_KEY_PEM;
    else process.env.GCAC_AGENT_UPGRADE_SIGNING_KEY_PEM = previousPrivateKey;
  }
});

test('活动旧事务冲突会拒绝新计划并保留 Agent 返回的旧事务证据', async () => {
  const state = createUpgradeStore();
  const client = {
    dispatchUpgrade: async () => ({
      errorCode: 'AGENT_UPGRADE_CONFLICT',
      errorMessage: '已有升级事务正在执行',
      transactionId: 'txn-old',
      status: 'running',
    }),
  };
  const service = createService(state, client as never);
  const plan = await service.checkUpgrade('tenant-host-flow', { agentId: 'agent-host-flow', releaseId: 'release-host-flow' });
  const rejected = await service.dispatchUpgrade('tenant-host-flow', { agentId: 'agent-host-flow', planId: (plan as AgentUpgradePlan).id }, 'operator-1', 'request-conflict');
  assert.equal(rejected.status, 'rejected');
  assert.equal((rejected.result as { errorCode?: string }).errorCode, 'AGENT_UPGRADE_CONFLICT');
  assert.equal((rejected.result as { actualTransactionId?: string }).actualTransactionId, 'txn-old');
});

test('Agent 返回不匹配事务时升级计划收敛为 unknown，不再循环等待', async () => {
  const state = createUpgradeStore();
  state.plan.status = 'running';
  state.plan.transactionId = 'txn-expected';
  const client = {
    getUpgradeStatus: async () => {
      throw new AppError('EXECUTION_TARGET_UNAVAILABLE', 'Agent 返回了不匹配的升级事务状态', {
        reason: 'AGENT_UPGRADE_RESPONSE_IDENTITY_MISMATCH',
        actualTransactionId: 'txn-old',
      });
    },
  };
  const service = createService(state, client as never);
  const result = await service.getUpgradeStatus('tenant-host-flow', 'agent-host-flow', state.plan.id);
  assert.equal(result.status, 'unknown');
  assert.equal((result.result?.receipt as { errorCode?: string }).errorCode, 'AGENT_UPGRADE_RESULT_UNKNOWN');
  assert.equal((result.result?.receipt as { actualTransactionId?: string }).actualTransactionId, 'txn-old');
});

test('旧版 Agent 的过期 helper_started 在控制面收敛为 unknown，不依赖 Agent 自身超时逻辑', async () => {
  const state = createUpgradeStore();
  state.plan.status = 'running';
  state.plan.transactionId = 'txn-timeout';
  const client = {
    getUpgradeStatus: async () => ({
      status: 'running',
      phase: 'helper_started',
      transactionId: 'txn-timeout',
      updatedAt: new Date(Date.now() - 5 * 60 * 1000 - 1000).toISOString(),
    }),
  };
  const service = createService(state, client as never);
  const result = await service.getUpgradeStatus('tenant-host-flow', 'agent-host-flow', state.plan.id);
  assert.equal(result.status, 'unknown');
  assert.equal((result.result?.receipt as { errorCode?: string }).errorCode, 'AGENT_UPGRADE_HELPER_TIMEOUT');
});

test('Linux Go 宿主升级改用现有 agent-install bootstrap，并复用原 agentKey', async () => {
  const state = createLinuxUpgradeStore();
  let capturedEnvelope: Record<string, unknown> | undefined;
  const client = {
    dispatchUpgrade: async (_agent: AgentRegistration, envelope: Record<string, unknown>) => {
      capturedEnvelope = envelope;
      return { success: true, accepted: true, transactionId: envelope.transactionId, status: 'accepted' };
    },
  };
  const service = createService(state as never, client as never);
  const plan = await service.checkUpgrade(state.agent.tenantId, { agentId: state.agent.id, releaseId: state.release.id });
  const accepted = await service.dispatchUpgrade(state.agent.tenantId, { agentId: state.agent.id, planId: (plan as AgentUpgradePlan).id }, 'operator-linux', 'request-linux');
  assert.equal(accepted.status, 'accepted');
  assert.match(String(capturedEnvelope?.upgradeBootstrapUrl), /\/agent-install\?token=/u);
  assert.equal(state.installSessions[0]?.agentKey, state.agent.agentKey);
  assert.equal(state.installSessions[0]?.platform, 'linux_go_systemd');
});

function createService(state: ReturnType<typeof createUpgradeStore>, client: Partial<AgentManagementClient>, tasks?: { enqueue(input: Record<string, unknown>): Promise<unknown> }): AgentsApplicationService {
  const dependencies: unknown[] = [state.repository, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, tasks, undefined, undefined, undefined, undefined, client];
  return new AgentsApplicationService(...dependencies as ConstructorParameters<typeof AgentsApplicationService>);
}

function createUpgradeStore() {
  const now = new Date().toISOString();
  const agent: AgentRegistration = {
    id: 'agent-host-flow', tenantId: 'tenant-host-flow', agentKey: 'agent-host-flow', role: 'full_agent',
    descriptor: { agentKey: 'agent-host-flow', hostname: 'agent-host-flow', version: '0.1.0', osType: 'WINDOWS', arch: 'amd64', labels: [], managementEndpoint: 'https://agent.invalid:18930' },
    status: 'ONLINE', registeredAt: now, updatedAt: now, version: 1,
  };
  const release: AgentVersionRelease = {
    id: 'release-host-flow', tenantId: 'tenant-host-flow', version: '0.2.0', platform: 'WINDOWS', arch: 'amd64', productLine: 'windows-go-full',
    downloadUrl: 'https://release.invalid/windows-agent.exe', checksumSha256: 'a'.repeat(64), signature: 'artifact-signature', signatureKeyId: 'release-host-key', artifactSize: 100,
    rolloutPercent: 100, status: 'active', createdAt: now, createdBy: 'test',
  };
  const plan: AgentUpgradePlan = { id: 'plan-host-flow', tenantId: agent.tenantId, agentId: agent.id, releaseId: release.id, targetVersion: release.version, status: 'planned', reason: 'fixture', createdAt: now, updatedAt: now };
  const installSessions: Array<{ agentKey?: string; platform?: string }> = [];
  const repository = {
    getRegistration: async () => agent,
    listActiveVersions: async () => [release],
    findUpgradePlanForAgent: async () => undefined,
    findUpgradePlanByIdempotencyKey: async () => undefined,
    createUpgradePlan: async (value: AgentUpgradePlan) => Object.assign(plan, value),
    getUpgradePlan: async () => plan,
    updateUpgradePlan: async (_id: string, patch: Partial<AgentUpgradePlan>) => Object.assign(plan, patch),
    createEnrollmentToken: async (value: unknown) => value,
    createInstallSession: async (value: { agentKey?: string; platform?: string }) => {
      installSessions.push(value);
      return value;
    },
  };
  return { repository, plan, agent, release, installSessions };
}

function createLinuxUpgradeStore() {
  const now = new Date().toISOString();
  const agent: AgentRegistration = {
    id: 'agent-linux-host-flow', tenantId: 'tenant-linux-host-flow', agentKey: 'agent-linux-host-flow', role: 'full_agent', zone: 'prod',
    descriptor: { agentKey: 'agent-linux-host-flow', hostname: 'agent-linux-host-flow', version: '0.1.24', osType: 'LINUX', arch: 'amd64', labels: [], managementEndpoint: 'http://agent.invalid:18931' },
    status: 'ONLINE', registeredAt: now, updatedAt: now, version: 1,
  };
  const release: AgentVersionRelease = {
    id: 'release-linux-host-flow', tenantId: agent.tenantId, version: '0.1.25', platform: 'LINUX', arch: 'amd64', productLine: 'linux-go-full',
    downloadUrl: 'http://127.0.0.1:3003/agent-releases/release-linux-host-flow', checksumSha256: 'b'.repeat(64), signature: 'unsigned', artifactSize: 100,
    rolloutPercent: 100, status: 'active', createdAt: now, createdBy: 'test',
  };
  const plan: AgentUpgradePlan = { id: 'plan-linux-host-flow', tenantId: agent.tenantId, agentId: agent.id, releaseId: release.id, targetVersion: release.version, status: 'planned', reason: 'fixture', createdAt: now, updatedAt: now };
  const installSessions: Array<{ agentKey?: string; platform?: string }> = [];
  const repository = {
    getRegistration: async () => agent,
    listActiveVersions: async () => [release],
    findUpgradePlanForAgent: async () => undefined,
    findUpgradePlanByIdempotencyKey: async () => undefined,
    createUpgradePlan: async (value: AgentUpgradePlan) => Object.assign(plan, value),
    getUpgradePlan: async () => plan,
    updateUpgradePlan: async (_id: string, patch: Partial<AgentUpgradePlan>) => Object.assign(plan, patch),
    createEnrollmentToken: async (value: unknown) => value,
    createInstallSession: async (value: { agentKey?: string; platform?: string }) => {
      installSessions.push(value);
      return value;
    },
  };
  return { repository, plan, agent, release, installSessions };
}
