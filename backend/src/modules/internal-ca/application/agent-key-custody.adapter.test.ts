import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AgentKeyCustodyAdapter,
  type AgentKeyCsrTaskInput,
} from './agent-key-custody.adapter.js';
import type { AgentTaskEnvelope } from '../../agents/schema/agents.schema.js';
import type { UnifiedAgentPlanAuthorizationDependenciesV1 } from '../../plugins/application/unified-agent-plan-authorization.port.js';
import {
  agentSecurityContractVersion,
  type AgentCapabilityTokenV1,
  type PolicyAuthorityDecisionV1,
} from '../../agents/security/agent-security.contract.js';
import type { PolicyAuthorityAuthorizationResultV1 } from '../../agents/security/policy-authority.service.js';

test('本机持钥适配器生成受限 CSR Plan，并按幂等键只入队一次', async () => {
  const queue = createQueue();
  const adapter = new AgentKeyCustodyAdapter({
    agents: queue,
    authorization: createAuthorization(),
    resolvePluginAnchor: async () => ({ pluginId: 'web.nginx.linux', pluginVersionId: 'plugin-version-1' }),
  });
  const input: AgentKeyCsrTaskInput = {
    certificateRequestId: 'request-1',
    agentId: 'agent-1',
    targetId: 'target-1',
    commonName: 'app.example.test',
    sans: ['app.example.test'],
    keyPath: '/etc/gcac/private/app.key.pem',
    certificatePath: '/etc/gcac/certs/app.crt.pem',
    format: 'pem',
    algorithm: 'rsa',
    idempotencyKey: 'csr-request-1',
  };
  const first = await adapter.generateCsr('tenant-1', input);
  const second = await adapter.generateCsr('tenant-1', input);
  assert.equal(first.id, second.id);
  assert.equal(queue.enqueued.length, 1);
  assert.equal(first.payload.actionType, 'agent.plan.execute');
  assert.equal(first.payload.operation, 'key.generate_csr');
  const plan = first.payload.plan as { operations: Array<{ operationType: string; input: Record<string, unknown> }>; pluginId: string };
  assert.equal(plan.pluginId, 'web.nginx.linux');
  assert.equal(plan.operations[0]?.operationType, 'key.generate_csr');
  assert.equal(plan.operations[0]?.input.path, '/etc/gcac/private/app.key.pem');
  assert.equal(JSON.stringify(first.payload).includes('PRIVATE KEY'), false);
});

test('本机持钥适配器拒绝 Policy Authority 拒绝的计划', async () => {
  const denied: UnifiedAgentPlanAuthorizationDependenciesV1 = {
    grants: { validate: async () => ({}) as never },
    policyAuthority: {
      assertReady: () => undefined,
      issueAuthorization: (request) => ({
        decision: {
          ...decisionBase(request.planDigest),
          allowed: false,
          reason: '本机策略拒绝',
        } satisfies PolicyAuthorityDecisionV1,
      }),
    },
  };
  const adapter = new AgentKeyCustodyAdapter({
    agents: createQueue(),
    authorization: denied,
    resolvePluginAnchor: async () => ({ pluginId: 'web.nginx.linux', pluginVersionId: 'plugin-version-1' }),
  });
  await assert.rejects(
    () => adapter.generateCsr('tenant-1', baseInput()),
    (error: unknown) => error instanceof Error && 'errorCode' in error && error.errorCode === 'AGENT_AUTHORIZATION_UNAVAILABLE',
  );
});

test('证书安装 Plan 只携带公开证书并绑定本机密钥句柄', async () => {
  const queue = createQueue();
  const adapter = new AgentKeyCustodyAdapter({
    agents: queue,
    authorization: createAuthorization(),
    resolvePluginAnchor: async () => ({ pluginId: 'app.tomcat.linux', pluginVersionId: 'plugin-version-2' }),
  });
  const task = await adapter.installIssuedCertificate('tenant-1', {
    certificateRequestId: 'request-2',
    agentId: 'agent-1',
    targetId: 'target-1',
    keyPath: '/var/lib/tomcat/private.key.pem',
    certificatePath: '/var/lib/tomcat/server.p12',
    localKeyRef: `local-key:${'a'.repeat(64)}`,
    expectedPublicKeyFingerprintSha256: 'b'.repeat(64),
    certificatePem: '-----BEGIN CERTIFICATE-----\npublic\n-----END CERTIFICATE-----',
    certificateChainPem: '-----BEGIN CERTIFICATE-----\nchain\n-----END CERTIFICATE-----',
    format: 'pkcs12',
    configPath: '/var/lib/tomcat/conf/server.xml',
    alias: 'server',
    idempotencyKey: 'install-request-2',
  });
  const plan = task.payload.plan as { operations: Array<{ operationType: string; input: Record<string, unknown> }> };
  const operation = plan.operations[0]!;
  assert.equal(operation.operationType, 'certificate.install_issued');
  assert.equal(operation.input.localKeyRef, `local-key:${'a'.repeat(64)}`);
  assert.equal(operation.input.expectedPublicKeyFingerprintSha256, 'b'.repeat(64));
  assert.equal(operation.input.configPath, '/var/lib/tomcat/conf/server.xml');
  assert.equal(task.payload.privateKey, undefined);
  assert.equal(JSON.stringify(task.payload).includes('PRIVATE KEY'), false);
});

test('证书安装拒绝携带私钥的材料', async () => {
  const adapter = new AgentKeyCustodyAdapter({
    agents: createQueue(),
    authorization: createAuthorization(),
    resolvePluginAnchor: async () => ({ pluginId: 'web.nginx.linux', pluginVersionId: 'plugin-version-1' }),
  });
  await assert.rejects(
    () => adapter.installIssuedCertificate('tenant-1', {
      certificateRequestId: 'request-3', agentId: 'agent-1', targetId: 'target-1',
      keyPath: '/etc/gcac/private.key.pem', certificatePath: '/etc/gcac/cert.pem',
      localKeyRef: `local-key:${'a'.repeat(64)}`, expectedPublicKeyFingerprintSha256: 'b'.repeat(64),
      certificatePem: '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----',
      certificateChainPem: '-----BEGIN CERTIFICATE-----\nchain\n-----END CERTIFICATE-----',
      format: 'pem', idempotencyKey: 'install-private-material',
    }),
    (error: unknown) => error instanceof Error && 'errorCode' in error && error.errorCode === 'VALIDATION_FAILED',
  );
});

test('显式 PluginVersion 与目标生效锚点不一致时拒绝排队', async () => {
  const adapter = new AgentKeyCustodyAdapter({
    agents: createQueue(),
    authorization: createAuthorization(),
    resolvePluginAnchor: async () => ({ pluginId: 'web.nginx.linux', pluginVersionId: 'plugin-version-effective' }),
  });
  await assert.rejects(
    () => adapter.generateCsr('tenant-1', {
      ...baseInput(),
      pluginId: 'web.nginx.linux',
      pluginVersionId: 'plugin-version-stale',
      idempotencyKey: 'csr-stale-plugin',
    }),
    (error: unknown) => error instanceof Error && 'errorCode' in error && error.errorCode === 'RESOURCE_VERSION_CONFLICT',
  );
});

function baseInput(): AgentKeyCsrTaskInput {
  return {
    certificateRequestId: 'request-denied', agentId: 'agent-1', targetId: 'target-1',
    commonName: 'app.example.test', sans: ['app.example.test'],
    keyPath: '/etc/gcac/private/app.key.pem', certificatePath: '/etc/gcac/cert.pem',
    format: 'pem', algorithm: 'rsa', idempotencyKey: 'csr-denied',
  };
}

function createQueue(): {
  enqueued: AgentTaskEnvelope[];
  enqueueTask: (_tenantId: string, input: { agentId: string; executionRunId: string; executionStepId: string; idempotencyKey: string; payload?: Record<string, unknown> }, requestId: string) => Promise<AgentTaskEnvelope>;
  findTaskByIdempotencyKey: (_tenantId: string, _agentId: string, idempotencyKey: string) => Promise<AgentTaskEnvelope | undefined>;
} {
  const enqueued: AgentTaskEnvelope[] = [];
  return {
    enqueued,
    async findTaskByIdempotencyKey(_tenantId, _agentId, idempotencyKey) {
      return enqueued.find((item) => item.idempotencyKey === idempotencyKey);
    },
    async enqueueTask(tenantId, input, requestId) {
      const task: AgentTaskEnvelope = {
        id: `task-${enqueued.length + 1}`, tenantId, agentId: input.agentId,
        executionRunId: input.executionRunId, executionStepId: input.executionStepId,
        idempotencyKey: input.idempotencyKey, payload: input.payload ?? {}, status: 'queued',
        requestId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      enqueued.push(task);
      return task;
    },
  };
}

function createAuthorization(): UnifiedAgentPlanAuthorizationDependenciesV1 {
  return {
    grants: { validate: async () => ({}) as never },
    policyAuthority: {
      assertReady: () => undefined,
      issueAuthorization: (request) => {
        const tokenId = `token-${request.agentId}`;
        const nonce = `nonce-${request.agentId}`;
        return {
          token: {
            ...tokenBase(request.planDigest, request, tokenId, nonce),
            signature: 'signed-token',
          },
          decision: {
            ...decisionBase(request.planDigest, request),
            tokenId, nonce, signature: 'signed-decision',
          },
        } satisfies PolicyAuthorityAuthorizationResultV1;
      },
    },
  };
}

function tokenBase(planDigest: string, request: { agentId: string; tenantId: string; pluginId: string; pluginVersionId: string; capability: string; actions: string[]; allowedPaths: string[]; allowedServices: string[]; artifactDigests: string[]; policyRef: string; policyVersion: string }, tokenId: string, nonce: string): Omit<AgentCapabilityTokenV1, 'signature'> {
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  return { tokenVersion: agentSecurityContractVersion, tokenId, agentId: request.agentId, tenantId: request.tenantId, pluginId: request.pluginId, pluginVersionId: request.pluginVersionId, capability: request.capability, actions: request.actions, allowedPaths: request.allowedPaths, allowedServices: request.allowedServices, artifactDigests: request.artifactDigests, policyRef: request.policyRef, policyVersion: request.policyVersion, issuedAt, expiresAt, nonce, planDigest, authorityKeyId: 'authority-key', };
}

function decisionBase(planDigest: string, request?: { agentId: string; tenantId: string; pluginId: string; pluginVersionId: string; capability: string; actions?: string[]; allowedPaths?: string[]; allowedServices?: string[]; artifactDigests?: string[]; policyRef?: string; policyVersion?: string }): PolicyAuthorityDecisionV1 {
  const now = new Date().toISOString();
  return { decisionVersion: agentSecurityContractVersion, decisionId: `decision-${request?.agentId ?? 'denied'}`, allowed: true, agentId: request?.agentId ?? 'agent-1', tenantId: request?.tenantId ?? 'tenant-1', pluginId: request?.pluginId ?? 'web.nginx.linux', pluginVersionId: request?.pluginVersionId ?? 'plugin-version-1', capability: request?.capability ?? 'certificate.key.custody', actions: request?.actions ?? ['key.generate_csr'], allowedPaths: request?.allowedPaths ?? ['/etc/gcac/private/app.key.pem'], allowedServices: request?.allowedServices ?? [], artifactDigests: request?.artifactDigests ?? [], policyRef: request?.policyRef ?? 'certificate-key-custody', policyVersion: request?.policyVersion ?? 'v1', planDigest, tokenId: 'token-agent-1', nonce: 'nonce-agent-1', issuedAt: now, validUntil: new Date(Date.now() + 60_000).toISOString(), authorityKeyId: 'authority-key', revocationRef: 'revocation-ref', signature: 'signed-decision', reason: 'allowed', };
}
