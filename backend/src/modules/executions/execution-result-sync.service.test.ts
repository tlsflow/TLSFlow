import assert from 'node:assert/strict';
import { createHash, X509Certificate } from 'node:crypto';
import test from 'node:test';
import { createServer } from 'node:tls';
import type { AssetsApplicationService } from '../assets/application/assets.application-service.js';
import type { BindingsApplicationService } from '../bindings/application/bindings.application-service.js';
import { ExecutionResultSyncService } from './application/execution-result-sync.service.js';
import { ExecutionsRepository } from './repository/executions.repository.js';
import type { ExecutionRunEntity, ExecutionStepEntity } from './schema/executions.schema.js';

const tenantId = 'tenant_cert_verify';
const actorId = 'tester';
const expectedFingerprint = 'a'.repeat(64);
const mismatchedFingerprint = 'b'.repeat(64);

test('正式 VERIFY 必须拒绝远端 TLS 证书 SHA256 不匹配的假成功', async () => {
  const { repository, service, run, step } = await createVerifyScenario('mismatch');

  await service.applyAgentTaskResult({
    tenantId,
    executionRunId: run.id,
    executionStepId: step.id,
    success: true,
    actorId,
    detail: {
      verify: {
        remoteCertificateSha256: mismatchedFingerprint,
        remoteThumbprint: '1'.repeat(40),
      },
      newThumbprint: '1'.repeat(40),
    },
  });

  const updatedRun = await repository.getRunOrThrow(run.id, tenantId);
  const updatedStep = await repository.getStepOrThrow(step.id, tenantId);
  assert.equal(updatedStep.status, 'FAILED');
  assert.equal(updatedStep.lastErrorCode, 'CERT_VERIFY_FINGERPRINT_MISMATCH');
  assert.equal(updatedRun.status, 'FAILED');
  assert.equal(updatedRun.errorCode, 'CERT_VERIFY_FINGERPRINT_MISMATCH');
});

test('正式 VERIFY 只有远端 TLS 证书 SHA256 匹配目标证书时才成功', async () => {
  const { repository, service, run, step } = await createVerifyScenario('match');

  await service.applyAgentTaskResult({
    tenantId,
    executionRunId: run.id,
    executionStepId: step.id,
    success: true,
    actorId,
    detail: {
      verify: {
        remoteCertificateSha256: expectedFingerprint,
        remoteThumbprint: '2'.repeat(40),
      },
      newThumbprint: '2'.repeat(40),
    },
  });

  const updatedRun = await repository.getRunOrThrow(run.id, tenantId);
  const updatedStep = await repository.getStepOrThrow(step.id, tenantId);
  assert.equal(updatedStep.status, 'SUCCESS');
  assert.equal(updatedRun.status, 'SUCCESS');
});

test('NGINX 正式 VERIFY 必须同时匹配 Agent 安装后落盘证书指纹与控制面远端证书指纹', async () => {
  const { repository, service, run, step } = await createVerifyScenario('nginx_installed_and_remote_match', {
    providerType: 'NGINX',
    installResult: { installedCertificateSha256: expectedFingerprint },
  });

  await service.applyAgentTaskResult({
    tenantId,
    executionRunId: run.id,
    executionStepId: step.id,
    success: true,
    actorId,
    detail: {
      verify: {
        remoteCertificateSha256: expectedFingerprint,
        remoteThumbprint: '3'.repeat(40),
      },
      newThumbprint: '3'.repeat(40),
    },
  });

  const updatedRun = await repository.getRunOrThrow(run.id, tenantId);
  const updatedStep = await repository.getStepOrThrow(step.id, tenantId);
  assert.equal(updatedStep.status, 'SUCCESS');
  assert.equal(updatedRun.status, 'SUCCESS');
});

test('NGINX 正式 VERIFY 拒绝 Agent 安装后落盘证书指纹缺失或不匹配', async () => {
  const missing = await createVerifyScenario('nginx_installed_missing', { providerType: 'NGINX' });
  await missing.service.applyAgentTaskResult({
    tenantId,
    executionRunId: missing.run.id,
    executionStepId: missing.step.id,
    success: true,
    actorId,
    detail: { verify: { remoteCertificateSha256: expectedFingerprint, remoteThumbprint: '4'.repeat(40) }, newThumbprint: '4'.repeat(40) },
  });
  const missingStep = await missing.repository.getStepOrThrow(missing.step.id, tenantId);
  assert.equal(missingStep.status, 'FAILED');
  assert.equal(missingStep.lastErrorCode, 'CERT_VERIFY_INSTALLED_FINGERPRINT_MISSING');

  const mismatch = await createVerifyScenario('nginx_installed_mismatch', {
    providerType: 'NGINX',
    installResult: { installedCertificateSha256: mismatchedFingerprint },
  });
  await mismatch.service.applyAgentTaskResult({
    tenantId,
    executionRunId: mismatch.run.id,
    executionStepId: mismatch.step.id,
    success: true,
    actorId,
    detail: { verify: { remoteCertificateSha256: expectedFingerprint, remoteThumbprint: '5'.repeat(40) }, newThumbprint: '5'.repeat(40) },
  });
  const mismatchStep = await mismatch.repository.getStepOrThrow(mismatch.step.id, tenantId);
  assert.equal(mismatchStep.status, 'FAILED');
  assert.equal(mismatchStep.lastErrorCode, 'CERT_VERIFY_INSTALLED_FINGERPRINT_MISMATCH');
});

test('正式 VERIFY 在 Agent 仅回传本机 binding 状态时由后端自行完成真实 TLS 验证', async () => {
  const certificate = new X509Certificate(CERT_PEM);
  const expected = createHash('sha256').update(certificate.raw).digest('hex');
  const thumbprint = createHash('sha1').update(certificate.raw).digest('hex').toUpperCase();
  const server = createServer({ cert: CERT_PEM, key: PRIVATE_KEY_PEM });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const { repository, service, run, step } = await createVerifyScenario('remote_probe', {
      expectedCertificateFingerprintSha256: expected,
      verifyUrl: `https://127.0.0.1:${address.port}`,
      expectedDomains: ['example.com'],
    });

    await service.applyAgentTaskResult({
      tenantId,
      executionRunId: run.id,
      executionStepId: step.id,
      success: true,
      actorId,
      detail: {
        verify: {
          mode: 'iis_local_binding_state',
          bindingThumbprint: thumbprint,
        },
        newThumbprint: thumbprint,
      },
    });

    const updatedRun = await repository.getRunOrThrow(run.id, tenantId);
    const updatedStep = await repository.getStepOrThrow(step.id, tenantId);
    const verifyDetail = ((updatedStep.inputSnapshot.resultDetail as Record<string, unknown>).verify ?? {}) as Record<string, unknown>;
    assert.equal(updatedStep.status, 'SUCCESS');
    assert.equal(updatedRun.status, 'SUCCESS');
    assert.equal(verifyDetail.remoteCertificateSha256, expected);
    assert.equal(verifyDetail.remoteThumbprint, thumbprint);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('正式 VERIFY 遇到旧 Agent 的远程 TLS 失败时以后端真实 TLS 验证结果为准', async () => {
  const certificate = new X509Certificate(CERT_PEM);
  const expected = createHash('sha256').update(certificate.raw).digest('hex');
  const thumbprint = createHash('sha1').update(certificate.raw).digest('hex').toUpperCase();
  const server = createServer({ cert: CERT_PEM, key: PRIVATE_KEY_PEM });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const { repository, service, run, step } = await createVerifyScenario('legacy_agent_verify_failure', {
      expectedCertificateFingerprintSha256: expected,
      verifyUrl: `https://127.0.0.1:${address.port}`,
      expectedDomains: ['example.com'],
    });

    await service.applyAgentTaskResult({
      tenantId,
      executionRunId: run.id,
      executionStepId: step.id,
      success: false,
      errorCode: 'TLS_VERIFY_FAILED',
      errorMessage: 'TLS 连接失败: dial tcp 10.255.0.74:4433: connectex: No connection could be made because the target machine actively refused it.',
      actorId,
      detail: {
        mode: 'iis_tls_verify',
        executor: 'windows-iis-provider',
        binding: {
          currentThumbprint: thumbprint,
          port: 4433,
          bindingInformation: '*:4433:',
        },
        verify: null,
        newThumbprint: thumbprint,
      },
    });

    const updatedRun = await repository.getRunOrThrow(run.id, tenantId);
    const updatedStep = await repository.getStepOrThrow(step.id, tenantId);
    const resultDetail = updatedStep.inputSnapshot.resultDetail as Record<string, unknown>;
    const verifyDetail = (resultDetail.verify ?? {}) as Record<string, unknown>;
    const recovery = (resultDetail.verificationRecovery ?? {}) as Record<string, unknown>;

    assert.equal(updatedStep.status, 'SUCCESS');
    assert.equal(updatedRun.status, 'SUCCESS');
    assert.equal(updatedStep.lastErrorCode, undefined);
    assert.equal(updatedRun.errorCode, undefined);
    assert.equal(verifyDetail.remoteCertificateSha256, expected);
    assert.equal(verifyDetail.remoteThumbprint, thumbprint);
    assert.equal(recovery.source, 'control_plane_tls_probe');
    assert.equal(recovery.originalErrorCode, 'TLS_VERIFY_FAILED');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('dry-run Agent 回传失败后会跳过后续 PENDING 步骤并结束 run', async () => {
  const repository = new ExecutionsRepository();
  const service = new ExecutionResultSyncService(
    repository,
    {} as unknown as AssetsApplicationService,
    {} as unknown as BindingsApplicationService,
  );
  const now = new Date().toISOString();
  const run = await repository.createRun({
    id: 'run_dry_run_skip_pending',
    tenantId,
    deploymentPlanId: 'dplan_dry_run_skip_pending',
    runNo: 1,
    type: 'dry_run',
    idempotencyKey: 'dry-run-skip-pending',
    requestHash: 'hash-dry-run-skip-pending',
    status: 'RUNNING',
    concurrencyLimit: 1,
    summary: {},
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
    version: 1,
  });
  const discover = await repository.createStep({
    id: 'stp_dry_run_skip_pending_discover',
    tenantId,
    executionRunId: run.id,
    deploymentPlanTargetId: 'dpt_dry_run_skip_pending',
    stepNo: 1,
    stepType: 'DISCOVER',
    name: 'DISCOVER target',
    dependsOn: [],
    idempotent: true,
    attemptCount: 1,
    maxAttempts: 1,
    inputSnapshot: { dryRun: true },
    status: 'RUNNING',
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
    version: 1,
  });
  const verify = await repository.createStep({
    id: 'stp_dry_run_skip_pending_verify',
    tenantId,
    executionRunId: run.id,
    deploymentPlanTargetId: 'dpt_dry_run_skip_pending',
    stepNo: 2,
    stepType: 'VERIFY',
    name: 'VERIFY target',
    dependsOn: [1],
    idempotent: true,
    attemptCount: 0,
    maxAttempts: 1,
    inputSnapshot: { dryRun: true },
    status: 'PENDING',
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
    version: 1,
  });

  await service.applyAgentTaskResult({
    tenantId,
    executionRunId: run.id,
    executionStepId: discover.id,
    success: false,
    errorCode: 'NGINX_DRY_RUN_FAILED',
    errorMessage: 'Linux NGINX dry-run 预检未通过',
    actorId,
    detail: {
      executionMode: 'direct',
      mode: 'nginx_dry_run_preflight',
      dryRunChecks: [{ key: 'test_command_execution', status: 'failed' }],
    },
  });

  const updatedRun = await repository.getRunOrThrow(run.id, tenantId);
  const updatedDiscover = await repository.getStepOrThrow(discover.id, tenantId);
  const updatedVerify = await repository.getStepOrThrow(verify.id, tenantId);
  assert.equal(updatedDiscover.status, 'FAILED');
  assert.equal(updatedVerify.status, 'SKIPPED');
  assert.equal(updatedRun.status, 'FAILED');
  assert.equal(updatedRun.errorCode, 'NGINX_DRY_RUN_FAILED');
});

test('异步 Agent apply 失败且 failurePolicy=rollback 时会触发自动回滚', async () => {
  const repository = new ExecutionsRepository();
  const service = new ExecutionResultSyncService(
    repository,
    {} as unknown as AssetsApplicationService,
    {} as unknown as BindingsApplicationService,
  );
  const rollbackCalls: Array<{ runId: string; tenantId: string; actorId: string }> = [];
  service.setRollbackRunner(async (input) => {
    rollbackCalls.push(input);
  });

  const now = new Date().toISOString();
  const run = await repository.createRun({
    id: 'run_apply_async_rollback',
    tenantId,
    deploymentPlanId: 'dplan_apply_async_rollback',
    runNo: 1,
    type: 'apply',
    idempotencyKey: 'apply-async-rollback',
    requestHash: 'hash-apply-async-rollback',
    status: 'RUNNING',
    concurrencyLimit: 1,
    summary: { failurePolicy: 'rollback' },
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
    version: 1,
  });
  const step = await repository.createStep({
    id: 'stp_apply_async_rollback_install',
    tenantId,
    executionRunId: run.id,
    deploymentPlanTargetId: 'dpt_apply_async_rollback',
    stepNo: 1,
    stepType: 'INSTALL',
    name: 'INSTALL async rollback target',
    dependsOn: [],
    idempotent: true,
    attemptCount: 1,
    maxAttempts: 1,
    inputSnapshot: {
      dryRun: false,
    },
    status: 'RUNNING',
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
    version: 1,
  });

  await service.applyAgentTaskResult({
    tenantId,
    executionRunId: run.id,
    executionStepId: step.id,
    success: false,
    errorCode: 'NGINX_INSTALL_FAILED',
    errorMessage: '安装失败',
    actorId,
    detail: {
      executionMode: 'queued',
      mode: 'nginx_install_failed',
    },
  });

  const updatedRun = await repository.getRunOrThrow(run.id, tenantId);
  assert.equal(updatedRun.status, 'FAILED');
  assert.deepEqual(rollbackCalls, [{ runId: run.id, tenantId, actorId }]);
});

test('BACKUP 成功不会提前污染绑定与资产状态', async () => {
  const repository = new ExecutionsRepository();
  const assetsWrites = createAssetWriteRecorder();
  const service = new ExecutionResultSyncService(
    repository,
    assetsWrites.assets as unknown as AssetsApplicationService,
    assetsWrites.bindings as unknown as BindingsApplicationService,
  );

  const now = new Date().toISOString();
  const run = await repository.createRun({
    id: 'run_backup_intermediate_success',
    tenantId,
    deploymentPlanId: 'dplan_backup_intermediate_success',
    runNo: 1,
    type: 'apply',
    idempotencyKey: 'backup-intermediate-success',
    requestHash: 'hash-backup-intermediate-success',
    status: 'RUNNING',
    concurrencyLimit: 1,
    summary: {},
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
    version: 1,
  });
  const step = await repository.createStep({
    id: 'stp_backup_intermediate_success',
    tenantId,
    executionRunId: run.id,
    deploymentPlanTargetId: 'dpt_backup_intermediate_success',
    stepNo: 1,
    stepType: 'BACKUP',
    name: 'BACKUP target',
    dependsOn: [],
    idempotent: true,
    attemptCount: 1,
    maxAttempts: 1,
    inputSnapshot: {
      dryRun: false,
      certificateBindingId: String(assetsWrites.binding.id),
    },
    status: 'RUNNING',
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
    version: 1,
  });

  await service.applyAgentTaskResult({
    tenantId,
    executionRunId: run.id,
    executionStepId: step.id,
    success: true,
    actorId,
    detail: {
      executionMode: 'queued',
      mode: 'nginx_backup_completed',
    },
  });

  assert.equal(assetsWrites.bindingUpdates.length, 0);
  assert.equal(assetsWrites.snapshots.length, 0);
});

test('rollback VERIFY 成功后应写回回滚状态而不是目标证书状态', async () => {
  const repository = new ExecutionsRepository();
  const assetsWrites = createAssetWriteRecorder({
    certificateVersionId: 'cert_old',
    targetCertificateVersionId: 'cert_new',
    targetFingerprintSha256: expectedFingerprint,
    observedFingerprintSha256: mismatchedFingerprint,
    storeThumbprint: '0'.repeat(40),
  });
  const service = new ExecutionResultSyncService(
    repository,
    assetsWrites.assets as unknown as AssetsApplicationService,
    assetsWrites.bindings as unknown as BindingsApplicationService,
  );

  const now = new Date().toISOString();
  const run = await repository.createRun({
    id: 'run_rollback_verify_success',
    tenantId,
    deploymentPlanId: 'dplan_rollback_verify_success',
    runNo: 1,
    type: 'rollback',
    idempotencyKey: 'rollback-verify-success',
    requestHash: 'hash-rollback-verify-success',
    status: 'RUNNING',
    concurrencyLimit: 1,
    summary: {},
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
    version: 1,
  });
  const step = await repository.createStep({
    id: 'stp_rollback_verify_success',
    tenantId,
    executionRunId: run.id,
    deploymentPlanTargetId: 'dpt_rollback_verify_success',
    stepNo: 1,
    stepType: 'VERIFY',
    name: 'VERIFY rollback target',
    dependsOn: [],
    idempotent: true,
    attemptCount: 1,
    maxAttempts: 1,
    inputSnapshot: {
      dryRun: false,
      certificateBindingId: String(assetsWrites.binding.id),
      expectedCertificateFingerprintSha256: expectedFingerprint,
    },
    status: 'RUNNING',
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
    version: 1,
  });

  await service.applyAgentTaskResult({
    tenantId,
    executionRunId: run.id,
    executionStepId: step.id,
    success: true,
    actorId,
    detail: {
      executionMode: 'queued',
      verify: {
        remoteCertificateSha256: expectedFingerprint,
        remoteThumbprint: '9'.repeat(40),
      },
      newThumbprint: '9'.repeat(40),
    },
  });

  assert.equal(assetsWrites.bindingUpdates.length, 1);
  assert.equal(assetsWrites.bindingUpdates[0]?.certificateVersionId, 'cert_old');
  assert.equal(assetsWrites.bindingUpdates[0]?.status, 'DRIFTED');
  const bindingMetadata = assetsWrites.bindingUpdates[0]?.metadata as Record<string, unknown> | undefined;
  assert.equal(bindingMetadata?.deploymentResultState, 'DEPLOY_FAILED_ROLLED_BACK');
  const latestSnapshot = assetsWrites.snapshots[assetsWrites.snapshots.length - 1];
  assert.equal(latestSnapshot?.snapshotType, 'POST_ROLLBACK');
  assert.equal(latestSnapshot?.status, 'ROLLED_BACK');
});

async function createVerifyScenario(
  suffix: string,
  options: {
    expectedCertificateFingerprintSha256?: string;
    verifyUrl?: string;
    expectedDomains?: string[];
    providerType?: string;
    installResult?: Record<string, unknown>;
  } = {},
): Promise<{
  repository: ExecutionsRepository;
  service: ExecutionResultSyncService;
  run: ExecutionRunEntity;
  step: ExecutionStepEntity;
}> {
  const repository = new ExecutionsRepository();
  const service = new ExecutionResultSyncService(
    repository,
    {} as unknown as AssetsApplicationService,
    {} as unknown as BindingsApplicationService,
  );
  const now = new Date().toISOString();
  const run = await repository.createRun({
    id: `run_cert_verify_${suffix}`,
    tenantId,
    deploymentPlanId: `dplan_cert_verify_${suffix}`,
    runNo: 1,
    type: 'apply',
    idempotencyKey: `cert-verify-${suffix}`,
    requestHash: `hash-${suffix}`,
    status: 'RUNNING',
    concurrencyLimit: 1,
    summary: {},
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
    version: 1,
  });
  const step = await repository.createStep({
    id: `stp_cert_verify_${suffix}`,
    tenantId,
    executionRunId: run.id,
    deploymentPlanTargetId: `dpt_cert_verify_${suffix}`,
    stepNo: 1,
    stepType: 'VERIFY',
    name: 'VERIFY certificate',
    dependsOn: [],
    idempotent: true,
    attemptCount: 1,
    maxAttempts: 1,
    inputSnapshot: {
      expectedCertificateFingerprintSha256: options.expectedCertificateFingerprintSha256 ?? expectedFingerprint,
      expectedDomains: options.expectedDomains,
      providerType: options.providerType,
      verifyUrl: options.verifyUrl,
      dryRun: false,
    },
    status: 'RUNNING',
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
    version: 1,
  });
  if (options.installResult) {
    await repository.createStep({
      id: `stp_cert_verify_${suffix}_install`,
      tenantId,
      executionRunId: run.id,
      deploymentPlanTargetId: `dpt_cert_verify_${suffix}`,
      stepNo: 0,
      stepType: 'INSTALL',
      name: 'INSTALL certificate',
      dependsOn: [],
      idempotent: true,
      attemptCount: 1,
      maxAttempts: 1,
      inputSnapshot: {
        resultDetail: options.installResult,
      },
      status: 'SUCCESS',
      createdAt: now,
      updatedAt: now,
      createdBy: actorId,
      version: 1,
    });
  }
  return { repository, service, run, step };
}

function createAssetWriteRecorder(bindingPatch: Record<string, unknown> = {}) {
  const binding = {
    id: 'binding_asset_sync',
    tenantId,
    protocol: 'HTTPS',
    port: 443,
    certificateVersionId: 'cert_current',
    targetCertificateVersionId: 'cert_target',
    targetFingerprintSha256: expectedFingerprint,
    observedFingerprintSha256: mismatchedFingerprint,
    storeThumbprint: '1'.repeat(40),
    metadata: {},
    ...bindingPatch,
  } as Record<string, unknown>;
  const bindingUpdates: Array<Record<string, unknown>> = [];
  const snapshots: Array<Record<string, unknown>> = [];

  const assets = {
    getRepository() {
      return {
        listApplicationAssetTargets: async () => ({ items: [] }),
        getSiteAsset: async () => undefined,
        getManagedTarget: async () => undefined,
        findServiceAssetByIdentity: async () => undefined,
        updateApplicationAssetTarget: async () => undefined,
      };
    },
    createManagedTargetSnapshot: async (_tenantId: string, payload: Record<string, unknown>) => {
      snapshots.push(payload);
      return payload;
    },
    updateSiteAsset: async () => undefined,
    updateManagedTarget: async () => undefined,
  };

  const bindings = {
    getRepository() {
      return {
        getCertificateBinding: async () => binding,
      };
    },
    updateCertificateBinding: async (_tenantId: string, _bindingId: string, patch: Record<string, unknown>) => {
      bindingUpdates.push(patch);
      Object.assign(binding, patch);
      return binding;
    },
  };

  return { assets, bindings, binding, bindingUpdates, snapshots };
}

const CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDVDCCAjygAwIBAgIUG5ildtPXNPyfiDQ1eus6hH5dRFowDQYJKoZIhvcNAQEL
BQAwJTEUMBIGA1UEAwwLZXhhbXBsZS5jb20xDTALBgNVBAoMBEdDQUMwHhcNMjYw
NjA4MDkwOTU0WhcNMjcwNjA4MDkwOTU0WjAlMRQwEgYDVQQDDAtleGFtcGxlLmNv
bTENMAsGA1UECgwER0NBQzCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEB
ANnmaaLnxtwDFZBfUmKgdJL5NPCkxIWunc+vrTi1dEXkGLlzppat6C8YGWc+fFvY
Ym+IBrukthZ7KEsjnum2rkKMEMl+a+lUPi2NDVAvy6ZyswouyxtuJnh5rC5GcReu
esZTQ0bR/SMgI8umYUu2A7fDfna9LnXjkXxqyb7ZY5gvVUyjaC3/gINJQ945JBxC
BO8PerlOXuRKbHXPAbeOuo0nsaiD7nMcmZ6BE5c4HvTLDfDKBzZNLaKwxwWrIr5l
tEhg0Zm7mhtLTYZkg/UzKpbuNOr4Zd48tMtVUzlyQeRxgGTJHcnZdSX3oaizfv88
FFhExjQwqpWaTHoiTXfk5SMCAwEAAaN8MHowHQYDVR0OBBYEFM3GnbaMzOx3k1qa
8XB2S4Zq+lw1MB8GA1UdIwQYMBaAFM3GnbaMzOx3k1qa8XB2S4Zq+lw1MA8GA1Ud
EwEB/wQFMAMBAf8wJwYDVR0RBCAwHoILZXhhbXBsZS5jb22CD3d3dy5leGFtcGxl
LmNvbTANBgkqhkiG9w0BAQsFAAOCAQEAsW/aieACElxUDvOF4jcto6lQAv30DZg3
q82o2sGsTcInQC987HN2AYK5v3uj9CyWT5OJmeFkJrRekeaFnnutGYyQoRsfJ16u
YrVXYshRygqzFzQ6WoWEnD9mN+eILLl9kkrPlNX8mV7ly+NuMEk+Y43WTo19lrg3
li+tUg7XYIzac937W72xTG2rrZ2MUqM+rNNSWjKh8hw32x6b0s1t6j7kKJxuPDJ7
ypU+DoduyO53xf/mnvIGcDUESJvwRZ7Iffi1pp99oPh73SWPRyLTaYBcsPbbsi/f
aAQqw3mzHJgVJXhAdmNXmxWG/TCNanalPXMpyLNYSW32L2rZKdE+UQ==
-----END CERTIFICATE-----`;

const PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQDZ5mmi58bcAxWQ
X1JioHSS+TTwpMSFrp3Pr604tXRF5Bi5c6aWregvGBlnPnxb2GJviAa7pLYWeyhL
I57ptq5CjBDJfmvpVD4tjQ1QL8umcrMKLssbbiZ4eawuRnEXrnrGU0NG0f0jICPL
pmFLtgO3w352vS5145F8asm+2WOYL1VMo2gt/4CDSUPeOSQcQgTvD3q5Tl7kSmx1
zwG3jrqNJ7Gog+5zHJmegROXOB70yw3wygc2TS2isMcFqyK+ZbRIYNGZu5obS02G
ZIP1MyqW7jTq+GXePLTLVVM5ckHkcYBkyR3J2XUl96Gos37/PBRYRMY0MKqVmkx6
Ik135OUjAgMBAAECggEAGW5futsZOvlYgsfqmhyHA9ZLsaBRWBbX+p19dpEQTSNA
0s18I7mP+oXHWo+Q57lFTSYPlHE2ApaveQw4Z6eMsV3z4Z28eM1+ZPDsR6+5sXym
h77hW/C1qGRETlxQplu/SYv93fNJJi3XRP/vUBeiBHMFEf+kv1k8KXdfLMPmG08y
Tu4TGdu6prKXluOjKJKCmxyjcMMiMKs3KGEHFeZpehhCBZw/BAcUeJj4P0IOax5G
MLMyouiH8qz1ZZ43tOBGgF9gc2x7WK5yvEmAyfVE9bkehD7dzEyeYTzoym5tEebX
MK785Iu3z8fma7qmxDHG5tIrooaN/TNq2b6582pc0QKBgQD+XWrIQYCFM21tk1E9
GcgttA2xmYHne6gq+ZaFWE2Bemzf/oKFFtVyuauyASYnKLqv7uEc0LnTSF2hIkAP
qA/jSGUJ9wqbvcakz6TvDUfgYDamTnqp0EdlQj3Z+uMd/uoT+SOblJnyJTOi+NdR
EMUCxzY1OoaQ5gBun1JezQ4GMQKBgQDbTP0r2XUvodx2oJFzMC7/bEEV0Qg6KrJc
OsEdGsQL/W9+JW5IUqQlYb97F97Cg5MPPRkjlLM8tBHkUdiNbjyrHnpdt8d50P/O
ViMiFIPKDhUzimka32fKoPN7bkdmJ5EPP0Qa8YC4UcPZQi9Ptm5DVP0OzqDANAOE
EA2y2mwHkwKBgQCzM2cWXCdKMDgIuX/DVxWTNUVseKRvS8vnMt1bZiF8dZ6ck/aq
ArMv1yTiDDMv5V7YsaeAoIA6HMJx0epl3VYMHqWoRpX/sMxwsiUVkTqxFbeKpMGA
P079RJTErB8zs7J/jccLRb7LPHBLgZpX70OMuII1L9072f418SKbzUTzEQKBgQCj
rTigS7NtE6/KUll80Y+iUBfbwqITV967e5a6tElycXuPeTxwek3NIMGbi9tU7oMK
Mp3aspd8TSG1eWjZVletmBfYbtxRDS5/wEaEny8l1ZD5YOrFhcyfrbVMgKiFlC5u
ZNfeDDX4W/6C3yUUp6JwWrRtIsdT7P5ayOiQfvl2RQKBgQCajPXye+yJqWQboUyF
C38mSIcEm7mdLCLa7psXWxsMvH15ynl34RzjI/Ne3iWIVWHbnJ9yitudvM1UcdiX
PyyRtpZNjzHF1i72Y3Ox3WRenxBqp+KjnkkOMTrK8YqxeMXgQ1XBPXXSjhrn8yD8
HVlUi9P3lKu3lUEi2bOiP2KYvg==
-----END PRIVATE KEY-----`;

test('dry-run failure adds fallback failed check when agent returns no failed preflight check', async () => {
  const repository = new ExecutionsRepository();
  const service = new ExecutionResultSyncService(
    repository,
    {} as unknown as AssetsApplicationService,
    {} as unknown as BindingsApplicationService,
  );
  const now = new Date().toISOString();
  const run = await repository.createRun({
    id: 'run_dry_run_failure_check',
    tenantId,
    deploymentPlanId: 'dplan_dry_run_failure_check',
    runNo: 1,
    type: 'dry_run',
    idempotencyKey: 'dry-run-failure-check',
    requestHash: 'hash-dry-run-failure-check',
    status: 'RUNNING',
    concurrencyLimit: 1,
    summary: {},
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
    version: 1,
  });
  const step = await repository.createStep({
    id: 'stp_dry_run_failure_check',
    tenantId,
    executionRunId: run.id,
    deploymentPlanTargetId: 'dpt_dry_run_failure_check',
    stepNo: 1,
    stepType: 'DISCOVER',
    name: 'DISCOVER certificate target',
    dependsOn: [],
    idempotent: true,
    attemptCount: 1,
    maxAttempts: 1,
    inputSnapshot: {
      dryRun: true,
      resultDetail: {
        dryRunChecks: [
          { key: 'site_exists', label: 'IIS 站点存在', status: 'passed', detail: '已命中 IIS 站点 TEST' },
          { key: 'https_binding_matched', label: 'HTTPS 绑定匹配', status: 'passed', detail: '已定位目标 HTTPS Binding' },
        ],
      },
    },
    status: 'RUNNING',
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
    version: 1,
  });

  await service.applyAgentTaskResult({
    tenantId,
    executionRunId: run.id,
    executionStepId: step.id,
    success: false,
    errorCode: 'IIS_DRY_RUN_FAILED',
    errorMessage: 'Agent 返回失败，但未附带 failed 检查项',
    actorId,
    detail: {
      mode: 'dry_run_preflight',
      executor: 'windows-iis-provider',
      taskId: 'task_dry_run_failure_check',
      dryRunChecks: [
        { key: 'site_exists', label: 'IIS 站点存在', status: 'passed', detail: '已命中 IIS 站点 TEST' },
        { key: 'https_binding_matched', label: 'HTTPS 绑定匹配', status: 'passed', detail: '已定位目标 HTTPS Binding' },
      ],
    },
  });

  const updatedRun = await repository.getRunOrThrow(run.id, tenantId);
  const updatedStep = await repository.getStepOrThrow(step.id, tenantId);
  const resultDetail = updatedStep.inputSnapshot.resultDetail as Record<string, unknown>;
  const checks = resultDetail.dryRunChecks as Array<Record<string, unknown>>;
  const summary = resultDetail.dryRunSummary as Record<string, number>;

  assert.equal(updatedStep.status, 'FAILED');
  assert.equal(updatedRun.status, 'FAILED');
  assert.equal(summary.failed, 1);
  assert.ok(checks.some((check) => check.key === 'agent_execution' && check.status === 'failed'));
});
