import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PluginCaActionDispatcher } from './plugin-ca-action-dispatcher.js';

describe('Microsoft AD CS Agent 调度', () => {
  it('issue 使用 Authority 配置的 Agent ID，而不是 Provider ID', async () => {
    const { dispatcher, captured } = createDispatcher({ agentPlan: true });
    await dispatcher.execute({
      provider: provider(),
      binding: binding(),
      action: 'issue',
      authority: { configuration: { agentId: 'agent-authority-1' } } as never,
      payload: { csrPem: '-----BEGIN CERTIFICATE REQUEST-----' },
      actorId: 'actor-1',
      idempotencyKey: 'idempotency-1',
    });
    assert.equal(captured.input.agentId, 'agent-authority-1');
    assert.equal(captured.input.agentRole, 'adcs_agent');
    assert.equal(captured.input.agentPlatform, 'windows_adcs');
    assert.equal(captured.input.operation, 'ca.certificate.issue');
    assert.notEqual(captured.input.agentId, 'provider-1');
  });

  it('Microsoft AD CS Plan 只入队到 Authority 关联的 AD CS Agent', async () => {
    const { dispatcher, captured } = createDispatcher({ agentPlan: true });
    const result = await dispatcher.execute({
      provider: provider(),
      binding: binding(),
      action: 'issue',
      authority: { configuration: { agentId: 'agent-authority-1' } } as never,
      payload: { csrPem: '-----BEGIN CERTIFICATE REQUEST-----' },
      actorId: 'actor-1',
      idempotencyKey: 'idempotency-agent-queue',
    });
    assert.equal(captured.agentLookup, 'agent-authority-1');
    assert.equal(captured.enqueued?.agentId, 'agent-authority-1');
    assert.equal(captured.enqueued?.payload.actionType, 'agent.plan.execute');
    assert.equal(captured.enqueued?.payload.agentRole, 'adcs_agent');
    assert.equal(captured.enqueued?.payload.agentPlatform, 'windows_adcs');
    assert.equal(result.status, 'pending');
    assert.match(String(result.detail), /task-adcs-1/);
  });

  it('拒绝把 Full Agent 关联为 Microsoft AD CS Agent', async () => {
    const { dispatcher } = createDispatcher({ agentPlatform: { osType: 'windows', role: 'full_agent' } });
    await assert.rejects(
      dispatcher.execute({
        provider: provider(),
        binding: binding(),
        action: 'issue',
        authority: { configuration: { agentId: 'agent-full-1' } } as never,
        payload: { csrPem: 'csr' },
        actorId: 'actor-1',
        idempotencyKey: 'idempotency-full-agent',
      }),
      (error: unknown) => error instanceof Error && error.message.includes('不是 Windows AD CS Agent'),
    );
  });

  it('Authority 未关联 AD CS Agent 时返回明确错误', async () => {
    const { dispatcher } = createDispatcher();
    await assert.rejects(
      dispatcher.execute({
        provider: provider(),
        binding: binding(),
        action: 'issue',
        authority: { configuration: {} } as never,
        payload: { csrPem: 'csr' },
        actorId: 'actor-1',
        idempotencyKey: 'idempotency-2',
      }),
      (error: unknown) => error instanceof Error && error.message.includes('Microsoft AD CS Agent 尚未安装或关联'),
    );
  });
});

function createDispatcher(options: {
  agentPlan?: boolean;
  agentPlatform?: { osType: string; role: string };
} = {}) {
  const contract = {
    actionId: 'ca.issue',
    capability: 'ca.certificate.issue',
    actionContractVersion: 'v1',
    inputSchema: { type: 'object', additionalProperties: true },
    outputSchema: { type: 'object', additionalProperties: true },
    writeEffect: true,
    hostPermissions: [],
  };
  const plugin = {
    id: 'plugin-version-1',
    pluginId: 'ca.microsoft-adcs',
    version: '1.0.0',
    status: 'ENABLED',
    packageSha256: 'package-sha',
    manifestSha256: 'manifest-sha',
    resourceSha256: { 'contracts/issue.json': 'resource-sha' },
    resources: { 'contracts/issue.json': JSON.stringify(contract) },
    manifest: {
      capabilities: [{ key: contract.capability }],
      resources: { actionContracts: { 'ca.issue': 'contracts/issue.json' } },
    },
  } as never;
  const captured: {
    input: Record<string, unknown>;
    agentLookup?: string;
    enqueued?: { agentId: string; payload: Record<string, unknown> };
  } = { input: {} };
  const agents = {
    getAgentExecutionPlatform: async (_tenantId: string, agentId: string) => {
      captured.agentLookup = agentId;
      return options.agentPlatform ?? { osType: 'windows_adcs', role: 'adcs_agent' };
    },
    findTaskByIdempotencyKey: async () => undefined,
    enqueueTask: async (_tenantId: string, input: { agentId: string; payload: Record<string, unknown> }) => {
      captured.enqueued = input;
      return { id: 'task-adcs-1', status: 'queued' };
    },
  };
  const dispatcher = new PluginCaActionDispatcher(
    { getVersionForTenant: async () => plugin },
    { create: async () => ({ id: 'grant-1' }), validate: async () => undefined } as never,
    {},
    agents as never,
  );
  (dispatcher as unknown as { executor: { executeAction: (input: { input: Record<string, unknown> }) => Promise<unknown> } }).executor.executeAction = async (input) => {
    captured.input = input.input;
    return {
      success: true,
      status: 'SUCCESS',
      output: options.agentPlan
        ? { normalizedObjects: [{ status: 'pending-agent-execution', stableKey: 'request-1', agentPlan: { planDigest: 'a'.repeat(64), agentId: input.input.agentId, tenantId: 'tenant-1', actions: [{ kind: 'certificate.authority.operation', operation: 'ca.certificate.issue' }] } }] }
        : { providerRequestId: 'request-1', status: 'pending' },
      detail: {},
    };
  };
  return { dispatcher, captured };
}

function provider() {
  return { id: 'provider-1', tenantId: 'tenant-1', type: 'plugin', configuration: { providerKind: 'microsoft_adcs' } } as never;
}

function binding() {
  return {
    id: 'binding-1',
    tenantId: 'tenant-1',
    providerId: 'provider-1',
    pluginVersionId: 'plugin-version-1',
    executionLocation: 'control_plane',
    issueAction: { actionId: 'ca.issue', actionVersion: 'v1' },
  } as never;
}
