import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { createCertificateServices } from '../certificates/index.js';
import { createSecurityServices } from '../security/security.controller.js';
import { InternalCaApplicationService } from './application/internal-ca.application-service.js';
import { CertificateLifecycleService } from './application/certificate-lifecycle.service.js';
import { ManagedKeyCustodyAdapter } from './application/managed-key-custody.adapter.js';
import { OpenSslCa } from './providers/openssl-ca.js';
import type { AgentTaskEnvelope } from '../agents/schema/agents.schema.js';
import type { AgentKeyCsrTaskInput, AgentIssuedCertificateTaskInput, AgentKeyCustodyAdapter } from './application/agent-key-custody.adapter.js';

const previousSecretKek = process.env.GCAC_SECRET_KEK;
const previousCaConfirmationSecret = process.env.GCAC_CA_CONFIRMATION_SECRET;
process.env.GCAC_SECRET_KEK = 'test-secret-kek-for-certificate-lifecycle';
process.env.GCAC_CA_CONFIRMATION_SECRET = 'test-ca-confirmation-secret';

async function fixture() {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations');
  const security = createSecurityServices();
  const certificates = createCertificateServices(security, { db });
  const internalCa = new InternalCaApplicationService({
    db,
    secrets: security.secrets,
    certificates: certificates.certificates,
    audit: security.audit,
    approvals: security.approvals,
  });
  return {
    db,
    internalCa,
    certificates: certificates.certificates,
    lifecycle: new CertificateLifecycleService({
      internalCa,
      certificates: certificates.certificates,
      repository: internalCa.getRepository(),
    }),
  };
}

process.on('exit', () => {
  if (previousSecretKek === undefined) delete process.env.GCAC_SECRET_KEK;
  else process.env.GCAC_SECRET_KEK = previousSecretKek;
  if (previousCaConfirmationSecret === undefined) delete process.env.GCAC_CA_CONFIRMATION_SECRET;
  else process.env.GCAC_CA_CONFIRMATION_SECRET = previousCaConfirmationSecret;
});

function createLifecycleAgentStub(): {
  adapter: AgentKeyCustodyAdapter;
  tasks: AgentTaskEnvelope[];
} {
  const tasks: AgentTaskEnvelope[] = [];
  const enqueue = async (tenantId: string, agentId: string, idempotencyKey: string, payload: Record<string, unknown>): Promise<AgentTaskEnvelope> => {
    const task: AgentTaskEnvelope = {
      id: `task-${tasks.length + 1}`,
      tenantId,
      agentId,
      executionRunId: idempotencyKey,
      executionStepId: idempotencyKey,
      idempotencyKey,
      payload,
      status: 'queued',
      requestId: idempotencyKey,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    tasks.push(task);
    return task;
  };
  const adapter = {
    async generateCsr(tenantId: string, input: AgentKeyCsrTaskInput): Promise<AgentTaskEnvelope> {
      return enqueue(tenantId, input.agentId, input.idempotencyKey, {
        actionType: 'agent.plan.execute', operation: 'key.generate_csr', certificateRequestId: input.certificateRequestId,
        targetId: input.targetId, keyPath: input.keyPath, certificatePath: input.certificatePath, format: input.format,
      });
    },
    async installIssuedCertificate(tenantId: string, input: AgentIssuedCertificateTaskInput): Promise<AgentTaskEnvelope> {
      return enqueue(tenantId, input.agentId, input.idempotencyKey, {
        actionType: 'agent.plan.execute', operation: 'certificate.install_issued', certificateRequestId: input.certificateRequestId,
        targetId: input.targetId, localKeyRef: input.localKeyRef, certificatePem: input.certificatePem,
        certificateChainPem: input.certificateChainPem, privateKeyTransported: false,
      });
    },
  } as AgentKeyCustodyAdapter;
  return { adapter, tasks };
}

test('证书轮换使用新密钥，TLS 验证前不吊销旧证书，重复请求保持幂等', async () => {
  const { db, internalCa, lifecycle } = await fixture();
  try {
    const tenantId = 'tenant-certificate-rotation';
    const provider = await internalCa.createProvider(tenantId, {
      name: '轮换内置 CA', type: 'gcac_builtin', deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single',
    }, 'admin');
    const preview = internalCa.previewAuthority({
      topologyMode: 'root_only', deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single', keyBackend: 'secret',
    });
    const [authority] = await internalCa.createAuthority(tenantId, {
      providerId: provider.id, name: 'Rotation Root', commonName: 'Rotation Root', securityDomain: 'production',
      topologyMode: 'root_only', deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single', keyBackend: 'secret',
      crlDistributionPoint: 'http://gcac.test/api/v1/public/ca-crl/tenant-certificate-rotation/',
      confirmationToken: preview.confirmationToken, actorId: 'admin',
    });
    const profile = await internalCa.createProfile(tenantId, { name: 'Rotation Profile', securityDomain: 'production', actorId: 'admin' });
    const issued = await internalCa.createCertificateRequest(tenantId, {
      applicationAssetId: 'rotation-app', caId: authority!.id, profileVersionId: profile.version.id,
      commonName: 'rotation.example.com', sans: ['rotation.example.com'], custodyMode: 'managed_secret', actorId: 'admin',
    });
    assert.equal(issued.status, 'issued');
    assert.ok(issued.certificateVersionId);

    const first = await lifecycle.createRotation({
      tenantId, applicationAssetId: 'rotation-app', sourceCertificateVersionId: issued.certificateVersionId!,
      custodyMode: 'managed_secret', idempotencyKey: 'rotate-once', actorId: 'admin',
    });
    const repeated = await lifecycle.createRotation({
      tenantId, applicationAssetId: 'rotation-app', sourceCertificateVersionId: issued.certificateVersionId!,
      custodyMode: 'managed_secret', idempotencyKey: 'rotate-once', actorId: 'admin',
    });
    assert.equal(repeated.id, first.id);
    assert.equal(first.status, 'install_pending');
    assert.notEqual(first.sourceKeyReferenceId, first.targetKeyReferenceId);
    assert.ok(first.targetCertificateVersionId);
    assert.deepEqual(await internalCa.listRevocations(tenantId), []);

    const install = await lifecycle.getInstallAction(tenantId, first.id);
    assert.equal(install.operation, 'certificate.install_issued');
    assert.equal(install.privateKeyTransported, false);
    assert.equal(install.certificateVersionId, first.targetCertificateVersionId);

    const completed = await lifecycle.markTlsVerified({
      tenantId, rotationId: first.id, certificateVersionId: first.targetCertificateVersionId!,
      tlsEvidence: { verified: true, protocol: 'TLS', observedAt: new Date().toISOString() }, actorId: 'admin',
    });
    assert.equal(completed.status, 'completed');
    assert.equal((await internalCa.listRevocations(tenantId)).length, 1);
  } finally {
    await db.close();
  }
});

test('本机 Agent 轮换在 CSR 尚未回传时保持可恢复状态', async () => {
  const { db, internalCa, lifecycle } = await fixture();
  try {
    const tenantId = 'tenant-agent-rotation-pending';
    const provider = await internalCa.createProvider(tenantId, {
      name: 'Agent 轮换内置 CA', type: 'gcac_builtin', deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single',
    }, 'admin');
    const preview = internalCa.previewAuthority({ topologyMode: 'root_only', deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single', keyBackend: 'secret' });
    const [authority] = await internalCa.createAuthority(tenantId, {
      providerId: provider.id, name: 'Agent Rotation Root', securityDomain: 'production', topologyMode: 'root_only',
      deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single', keyBackend: 'secret', confirmationToken: preview.confirmationToken, actorId: 'admin',
    });
    const profile = await internalCa.createProfile(tenantId, { name: 'Agent Rotation Profile', securityDomain: 'production', actorId: 'admin' });
    const issued = await internalCa.createCertificateRequest(tenantId, {
      applicationAssetId: 'agent-rotation-app', caId: authority!.id, profileVersionId: profile.version.id,
      commonName: 'agent-rotation.example.com', sans: ['agent-rotation.example.com'], custodyMode: 'managed_secret', actorId: 'admin',
    });
    const pending = await lifecycle.createRotation({
      tenantId, applicationAssetId: 'agent-rotation-app', sourceCertificateVersionId: issued.certificateVersionId!,
      custodyMode: 'local_agent', idempotencyKey: 'agent-rotate-once', actorId: 'admin',
    });
    assert.equal(pending.status, 'key_csr_pending');
    assert.equal((await internalCa.listRevocations(tenantId)).length, 0);
  } finally {
    await db.close();
  }
});

test('本机持钥控制面贯通 pending_key、CSR 回执、签发和证书安装任务', async () => {
    const { db, internalCa, certificates, lifecycle } = await fixture();
  try {
    const tenantId = 'tenant-local-agent-e2e';
    const provider = await internalCa.createProvider(tenantId, {
      name: '本机持钥闭环 CA', type: 'gcac_builtin', deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single',
    }, 'admin');
    const preview = internalCa.previewAuthority({ topologyMode: 'root_only', deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single', keyBackend: 'secret' });
    const [authority] = await internalCa.createAuthority(tenantId, {
      providerId: provider.id, name: '本机持钥闭环 Root', commonName: '本机持钥闭环 Root', securityDomain: 'production',
      topologyMode: 'root_only', deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single', keyBackend: 'secret',
      crlDistributionPoint: `http://gcac.test/api/v1/public/ca-crl/${tenantId}/`, confirmationToken: preview.confirmationToken, actorId: 'admin',
    });
    const profile = await internalCa.createProfile(tenantId, { name: '本机持钥闭环 Profile', securityDomain: 'production', actorId: 'admin' });
    const agent = createLifecycleAgentStub();
    lifecycle.setAgentKeyCustody(agent.adapter);
    const policyUpdates: Array<Record<string, unknown>> = [];
    lifecycle.setApplicationPolicyStatusUpdater(async (tenantId, applicationAssetId, status, certificateVersionId) => {
      policyUpdates.push({ tenantId, applicationAssetId, status, certificateVersionId });
    });
    internalCa.setLocalAgentIssuedHandler((input) => lifecycle.enqueueIssuedCertificateInstall(input).then(() => undefined));

    const request = await internalCa.createCertificateRequest(tenantId, {
      applicationAssetId: 'local-agent-app', caId: authority!.id, profileVersionId: profile.version.id,
      commonName: 'local-agent.example.test', sans: ['local-agent.example.test'], custodyMode: 'local_agent', actorId: 'admin',
    });
    assert.equal(request.status, 'pending_key');

    const keyPath = '/etc/gcac/local-agent/private.key.pem';
    const certificatePath = '/etc/gcac/local-agent/certificate.pem';
    const csr = await new OpenSslCa().generateManagedKeyAndCsr({ commonName: request.subjectCommonName, sans: request.sans, algorithm: 'rsa' });
    const csrTask = await lifecycle.generateLocalCsr({
      tenantId, certificateRequestId: request.id, agentId: 'agent-local-1', targetId: 'target-local-1',
      commonName: request.subjectCommonName, sans: request.sans, keyPath, certificatePath, format: 'pem', algorithm: 'rsa',
      idempotencyKey: `csr:${request.id}`,
    });
    assert.equal(csrTask.taskId, 'task-1');
    const bound = (await internalCa.listRequests(tenantId)).find((item) => item.id === request.id);
    assert.deepEqual(bound?.agentContext, {
      agentId: 'agent-local-1', targetId: 'target-local-1', keyPath, certificatePath, format: 'pem',
    });

    const completed = await internalCa.completeLocalAgentCsr(tenantId, request.id, {
      localKeyRef: `local-key:${'c'.repeat(64)}`,
      csrPem: csr.csr.csrPem,
      csrSha256: csr.csr.csrSha256,
      publicKeyFingerprintSha256: csr.csr.publicKeyFingerprintSha256,
      keyBackend: 'file', exportability: 'exportable', protectionLevel: 'software_controlled',
      evidence: { privateKeyTransported: false },
      agentContext: { agentId: 'agent-local-1', targetId: 'target-local-1', keyPath, certificatePath, format: 'pem' },
    }, 'agent-local-1');
    assert.equal(completed.status, 'issued');
    assert.ok(completed.certificateVersionId);
    assert.equal(agent.tasks.length, 2);
    assert.equal(agent.tasks[1]?.payload.operation, 'certificate.install_issued');
    assert.equal(agent.tasks[1]?.payload.privateKey, undefined);
    assert.equal(JSON.stringify(agent.tasks[1]?.payload).includes('PRIVATE KEY'), false);
    const key = await internalCa.getRepository().getKeyReference(tenantId, completed.keyReferenceId);
    assert.equal(key?.status, 'active');
    assert.equal(key?.opaqueReference, `local-key:${'c'.repeat(64)}`);

    const issuedVersion = await certificates.getRepository().getVersion(completed.certificateVersionId!, tenantId);
    const active = await internalCa.markLocalAgentCertificateInstall(tenantId, request.id, 'SUCCESS', {
      detail: {
        operationResults: [{
          operationType: 'certificate.install_issued',
          localKeyRef: key?.opaqueReference,
          publicKeyFingerprintSha256: issuedVersion?.publicKeyFingerprintSha256,
          certificateFingerprintSha256: issuedVersion?.fingerprintSha256,
          privateKeyTransported: false,
        }],
      },
    });
    assert.equal(active.status, 'active');
    await lifecycle.reconcileCertificateInstallResult({ tenantId, requestId: request.id, status: 'SUCCESS' });
    assert.deepEqual(policyUpdates.at(-1), {
      tenantId, applicationAssetId: 'local-agent-app', status: 'deployed', certificateVersionId: completed.certificateVersionId,
    });
  } finally {
    await db.close();
  }
});

test('应用专属本机持钥签发只回写已签发事实，不生成第二条直装任务', async () => {
  const { db, lifecycle } = await fixture();
  try {
    const tenantId = 'tenant-dedicated-agent-single-deploy';
    const agent = createLifecycleAgentStub();
    lifecycle.setAgentKeyCustody(agent.adapter);
    const policyUpdates: Array<Record<string, unknown>> = [];
    lifecycle.setApplicationPolicyStatusUpdater(async (updatedTenantId, applicationAssetId, status, certificateVersionId) => {
      policyUpdates.push({ tenantId: updatedTenantId, applicationAssetId, status, certificateVersionId });
    });
    await lifecycle.enqueueIssuedCertificateInstall({
      tenantId,
      actorId: 'admin',
      request: {
        id: 'dedicated-request',
        applicationAssetId: 'dedicated-agent-app',
        certificateAssetId: 'dedicated-certificate-asset',
        applicationCertificatePolicyVersionId: 'dedicated-policy-version',
        certificateVersionId: 'dedicated-certificate-version',
      } as never,
    });

    assert.deepEqual(policyUpdates, [{
      tenantId,
      applicationAssetId: 'dedicated-agent-app',
      status: 'issued',
      certificateVersionId: 'dedicated-certificate-version',
    }]);
    assert.deepEqual(agent.tasks, []);
  } finally {
    await db.close();
  }
});

test('轮换计划固定使用新证书版本，执行未知或失败会回写轮换状态', async () => {
  const { db, internalCa, lifecycle } = await fixture();
  try {
    const tenantId = 'tenant-rotation-plan-reconcile';
    const provider = await internalCa.createProvider(tenantId, {
      name: '轮换计划 CA', type: 'gcac_builtin', deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single',
    }, 'admin');
    const preview = internalCa.previewAuthority({ topologyMode: 'root_only', deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single', keyBackend: 'secret' });
    const [authority] = await internalCa.createAuthority(tenantId, {
      providerId: provider.id, name: 'Rotation Plan Root', securityDomain: 'production', topologyMode: 'root_only',
      deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single', keyBackend: 'secret', confirmationToken: preview.confirmationToken, actorId: 'admin',
    });
    const profile = await internalCa.createProfile(tenantId, { name: 'Rotation Plan Profile', securityDomain: 'production', actorId: 'admin' });
    const issued = await internalCa.createCertificateRequest(tenantId, {
      applicationAssetId: 'rotation-plan-app', caId: authority!.id, profileVersionId: profile.version.id,
      commonName: 'rotation-plan.example.com', sans: ['rotation-plan.example.com'], custodyMode: 'managed_secret', actorId: 'admin',
    });
    let capturedPlanInput: Record<string, unknown> | undefined;
    lifecycle.setDeploymentPlans({
      createFromApplicationAsset: async (input) => {
        capturedPlanInput = input as unknown as Record<string, unknown>;
        return {
          id: 'plan-rotation-reconcile', status: 'READY', selectionMode: input.selectionMode,
          certificateVersionId: input.targetCertificateVersionId, targets: [],
        } as never;
      },
    });
    const policyUpdates: Array<Record<string, unknown>> = [];
    lifecycle.setApplicationPolicyStatusUpdater(async (tenantId, applicationAssetId, status, certificateVersionId) => {
      policyUpdates.push({ tenantId, applicationAssetId, status, certificateVersionId });
    });
    const rotation = await lifecycle.createRotation({
      tenantId, applicationAssetId: 'rotation-plan-app', sourceCertificateVersionId: issued.certificateVersionId!,
      custodyMode: 'managed_secret', idempotencyKey: 'rotation-plan-reconcile-once', actorId: 'admin',
    });
    assert.equal(capturedPlanInput?.selectionMode, 'EXPLICIT');
    assert.equal(capturedPlanInput?.targetCertificateVersionId, rotation.targetCertificateVersionId);
    assert.equal(capturedPlanInput?.reuseDraft, false);
    assert.equal(rotation.evidence.deploymentPlanId, 'plan-rotation-reconcile');

    const deployed = await lifecycle.reconcileDeploymentPlanResult({
      tenantId, deploymentPlanId: 'plan-rotation-reconcile', status: 'SUCCESS', executionStatus: 'SUCCESS', actorId: 'admin',
    });
    assert.equal(deployed?.status, 'deploying');
    assert.deepEqual(policyUpdates.at(-1), {
      tenantId, applicationAssetId: 'rotation-plan-app', status: 'deployed', certificateVersionId: rotation.targetCertificateVersionId,
    });

    const unknown = await lifecycle.reconcileDeploymentPlanResult({
      tenantId, deploymentPlanId: 'plan-rotation-reconcile', status: 'UNKNOWN', executionStatus: 'UNKNOWN', actorId: 'admin',
    });
    assert.equal(unknown?.status, 'unknown');
    assert.deepEqual(policyUpdates.at(-1), {
      tenantId, applicationAssetId: 'rotation-plan-app', status: 'needs_attention', certificateVersionId: rotation.targetCertificateVersionId,
    });
    const failed = await lifecycle.reconcileDeploymentPlanResult({
      tenantId, deploymentPlanId: 'plan-rotation-reconcile', status: 'FAILED', executionStatus: 'FAILED', actorId: 'admin',
    });
    assert.equal(failed?.status, 'failed');
    assert.equal(failed?.evidence.rollbackRequired, true);
    assert.deepEqual(policyUpdates.at(-1), {
      tenantId, applicationAssetId: 'rotation-plan-app', status: 'needs_attention', certificateVersionId: rotation.targetCertificateVersionId,
    });
  } finally {
    await db.close();
  }
});

test('轮换 TLS 回执必须明确 verified=true，且重复回执不重复撤销', async () => {
  const { db, internalCa, lifecycle } = await fixture();
  try {
    const tenantId = 'tenant-rotation-tls-guard';
    const provider = await internalCa.createProvider(tenantId, {
      name: 'TLS 守卫 CA', type: 'gcac_builtin', deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single',
    }, 'admin');
    const preview = internalCa.previewAuthority({ topologyMode: 'root_only', deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single', keyBackend: 'secret' });
    const [authority] = await internalCa.createAuthority(tenantId, {
      providerId: provider.id, name: 'TLS Guard Root', securityDomain: 'production', topologyMode: 'root_only',
      deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single', keyBackend: 'secret',
      crlDistributionPoint: `http://gcac.test/api/v1/public/ca-crl/${tenantId}/`, confirmationToken: preview.confirmationToken, actorId: 'admin',
    });
    const profile = await internalCa.createProfile(tenantId, { name: 'TLS Guard Profile', securityDomain: 'production', actorId: 'admin' });
    const issued = await internalCa.createCertificateRequest(tenantId, {
      applicationAssetId: 'tls-guard-app', caId: authority!.id, profileVersionId: profile.version.id,
      commonName: 'tls-guard.example.com', sans: ['tls-guard.example.com'], custodyMode: 'managed_secret', actorId: 'admin',
    });
    const rotation = await lifecycle.createRotation({
      tenantId, applicationAssetId: 'tls-guard-app', sourceCertificateVersionId: issued.certificateVersionId!,
      custodyMode: 'managed_secret', idempotencyKey: 'tls-guard-once', actorId: 'admin',
    });
    await assert.rejects(
      lifecycle.markTlsVerified({ tenantId, rotationId: rotation.id, certificateVersionId: rotation.targetCertificateVersionId!, tlsEvidence: { verified: false }, actorId: 'admin' }),
      (error: unknown) => (error as { errorCode?: string }).errorCode === 'VALIDATION_FAILED',
    );
    const evidence = { verified: true, protocol: 'TLS', observedAt: new Date().toISOString() };
    const completed = await lifecycle.markTlsVerified({ tenantId, rotationId: rotation.id, certificateVersionId: rotation.targetCertificateVersionId!, tlsEvidence: evidence, actorId: 'admin' });
    const repeated = await lifecycle.markTlsVerified({ tenantId, rotationId: rotation.id, certificateVersionId: rotation.targetCertificateVersionId!, tlsEvidence: evidence, actorId: 'admin' });
    assert.equal(completed.status, 'completed');
    assert.equal(repeated.id, completed.id);
    assert.equal((await internalCa.listRevocations(tenantId)).length, 1);
  } finally {
    await db.close();
  }
});

test('ManagedKeyCustodyAdapter 强制托管模式且不改写私钥字段', async () => {
  let received: Record<string, unknown> | undefined;
  const adapter = new ManagedKeyCustodyAdapter({
    createCertificateRequest: async (_tenantId, input) => {
      received = input as unknown as Record<string, unknown>;
      return { id: 'request-managed', keyReferenceId: 'keyref-managed', status: 'issued' } as never;
    },
  });
  const result = await adapter.createRequest('tenant-managed-adapter', {
    applicationAssetId: 'app-managed-adapter', caId: 'ca-managed-adapter', profileVersionId: 'profile-managed-adapter',
    commonName: 'managed-adapter.example.com', sans: ['managed-adapter.example.com'], actorId: 'admin',
  });
  assert.equal(result.id, 'request-managed');
  assert.equal(received?.custodyMode, 'managed_secret');
  assert.equal(Object.keys(received ?? {}).some((key) => /privateKeyPem|privateKeySecret/i.test(key)), false);
});

test('托管密钥签发后自动创建精确版本部署计划，缺目标时保留申请并可重试', async () => {
  const { db, internalCa, lifecycle } = await fixture();
  try {
    const tenantId = 'tenant-managed-lifecycle';
    const provider = await internalCa.createProvider(tenantId, {
      name: '托管密钥生命周期 CA', type: 'gcac_builtin', deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single',
    }, 'admin');
    const preview = internalCa.previewAuthority({ topologyMode: 'root_only', deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single', keyBackend: 'secret' });
    const [authority] = await internalCa.createAuthority(tenantId, {
      providerId: provider.id, name: '托管密钥生命周期 Root', commonName: '托管密钥生命周期 Root', securityDomain: 'production',
      topologyMode: 'root_only', deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single', keyBackend: 'secret',
      confirmationToken: preview.confirmationToken, actorId: 'admin',
    });
    const profile = await internalCa.createProfile(tenantId, { name: '托管密钥生命周期 Profile', securityDomain: 'production', actorId: 'admin' });
    let calls = 0;
    let captured: Record<string, unknown> | undefined;
    lifecycle.setDeploymentPlans({
      createFromApplicationAsset: async (input) => {
        calls += 1;
        captured = input as unknown as Record<string, unknown>;
        return { id: 'managed-plan-1', status: 'READY', selectionMode: input.selectionMode, certificateVersionId: input.targetCertificateVersionId, targets: [] } as never;
      },
    });
    internalCa.setManagedSecretIssuedHandler((input) => lifecycle.enqueueManagedCertificateDeployment(input));
    const request = await internalCa.createCertificateRequest(tenantId, {
      applicationAssetId: 'managed-lifecycle-app', caId: authority!.id, profileVersionId: profile.version.id,
      commonName: 'managed-lifecycle.example.test', sans: ['managed-lifecycle.example.test'], custodyMode: 'managed_secret', actorId: 'admin',
    });
    assert.equal(request.status, 'issued');
    assert.equal(request.deploymentPlanId, 'managed-plan-1');
    assert.equal(request.deploymentPlanCertificateVersionId, request.certificateVersionId);
    assert.equal(calls, 1);
    assert.equal(captured?.selectionMode, 'EXPLICIT');
    assert.equal(captured?.targetCertificateVersionId, request.certificateVersionId);
    assert.equal(captured?.reuseDraft, false);

    // 重试已签发请求不会再次创建计划。
    const repeated = await internalCa.issueRequest(tenantId, request.id, 'admin');
    assert.equal(repeated.deploymentPlanId, 'managed-plan-1');
    assert.equal(calls, 1);

    // 没有部署计划服务时申请仍保持 issued，后续接入后显式重试可恢复。
    lifecycle.setDeploymentPlans(undefined);
    const second = await internalCa.createCertificateRequest(tenantId, {
      applicationAssetId: 'managed-lifecycle-no-target', caId: authority!.id, profileVersionId: profile.version.id,
      commonName: 'managed-lifecycle-no-target.example.test', sans: ['managed-lifecycle-no-target.example.test'], custodyMode: 'managed_secret', actorId: 'admin',
    });
    assert.equal(second.status, 'issued');
    assert.equal(second.deploymentPlanStatus, 'blocked');
    lifecycle.setDeploymentPlans({
      createFromApplicationAsset: async (input) => ({ id: 'managed-plan-2', status: 'READY', selectionMode: input.selectionMode, certificateVersionId: input.targetCertificateVersionId, targets: [] } as never),
    });
    const resumed = await internalCa.issueRequest(tenantId, second.id, 'admin');
    assert.equal(resumed.deploymentPlanId, 'managed-plan-2');
  } finally {
    await db.close();
  }
});
