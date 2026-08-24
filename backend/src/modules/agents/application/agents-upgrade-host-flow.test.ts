import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
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
    const accepted = await acceptedService.dispatchUpgrade('tenant-host-flow', { agentId: 'agent-host-flow', planId: (plan as AgentUpgradePlan).id }, 'operator-1', 'request-1');
    assert.equal(accepted.status, 'accepted');
    assert.equal((accepted.result as { accepted?: boolean }).accepted, true);
    assert.equal(enqueuedTaskInput?.taskType, 'AGENT_UPDATE');
    assert.equal(enqueuedTaskInput?.triggerSource, 'agent-upgrade-confirmed');
    assert.equal((accepted.result as { taskId?: string }).taskId, 'task-agent-upgrade-1');
    assert.equal((acceptedEnvelope?.release as { productLine?: string }).productLine, 'windows-go-full');

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
  const repository = {
    getRegistration: async () => agent,
    listActiveVersions: async () => [release],
    findUpgradePlanForAgent: async () => undefined,
    findUpgradePlanByIdempotencyKey: async () => undefined,
    createUpgradePlan: async (value: AgentUpgradePlan) => Object.assign(plan, value),
    getUpgradePlan: async () => plan,
    updateUpgradePlan: async (_id: string, patch: Partial<AgentUpgradePlan>) => Object.assign(plan, patch),
  };
  return { repository, plan };
}
