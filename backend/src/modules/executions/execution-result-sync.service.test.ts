import assert from 'node:assert/strict';
import test from 'node:test';
import type { AssetsApplicationService } from '../assets/application/assets.application-service.js';
import type { BindingsApplicationService } from '../bindings/application/bindings.application-service.js';
import { DeploymentPlansRepository } from '../deployment-plans/repository/deployment-plans.repository.js';
import { ExecutionResultSyncService } from './application/execution-result-sync.service.js';
import { ExecutionsRepository } from './repository/executions.repository.js';
import type { ExecutionRunEntity, ExecutionStepEntity } from './schema/executions.schema.js';

const tenantId = 'tenant_cert_verify';
const actorId = 'tester';
const expectedFingerprint = 'a'.repeat(64);
const mismatchedFingerprint = 'b'.repeat(64);

test('Agent 写操作结果 UNKNOWN 保持步骤和运行不明，不进入 FAILED 或自动回滚', async () => {
  const { repository, service, run, step } = await createVerifyScenario('unknown_agent_write');

  await service.applyAgentTaskResult({
    tenantId,
    executionRunId: run.id,
    executionStepId: step.id,
    success: false,
    status: 'UNKNOWN',
    errorCode: 'AGENT_CONNECTION_LOST',
    errorMessage: 'Agent 连接在写操作后断开',
    actorId,
  });

  const updatedRun = await repository.getRunOrThrow(run.id, tenantId);
  const updatedStep = await repository.getStepOrThrow(step.id, tenantId);
  const resultDetail = updatedStep.inputSnapshot.resultDetail as Record<string, unknown> | undefined;
  assert.equal(updatedStep.status, 'RUNNING');
  assert.equal(resultDetail?.executionStatus, 'UNKNOWN');
  assert.equal(updatedStep.lastErrorCode, 'AGENT_CONNECTION_LOST');
  assert.equal(updatedRun.status, 'RUNNING');
  assert.equal(updatedRun.summary.executionStatus, 'UNKNOWN');
});

test('UNKNOWN 后的迟到成功不会覆盖 receipt、checkpoint 或恢复状态', async () => {
  const { repository, service, run, step } = await createVerifyScenario('late_success_after_unknown');
  const receipt = { receiptId: 'receipt-1', status: 'UNKNOWN', operationId: 'operation-1' };
  const checkpoint = { checkpointRef: 'checkpoint-1', digest: 'a'.repeat(64) };

  await service.applyAgentTaskResult({
    tenantId,
    executionRunId: run.id,
    executionStepId: step.id,
    success: false,
    status: 'UNKNOWN',
    errorCode: 'PLUGIN_OPERATION_UNKNOWN_STATE',
    errorMessage: '写操作响应超时',
    actorId,
    detail: { receipt, checkpoint },
  });
  await service.applyAgentTaskResult({
    tenantId,
    executionRunId: run.id,
    executionStepId: step.id,
    success: true,
    status: 'SUCCESS',
    actorId,
    detail: { receipt: { ...receipt, status: 'SUCCESS' }, checkpoint },
  });

  const updatedStep = await repository.getStepOrThrow(step.id, tenantId);
  const resultDetail = updatedStep.inputSnapshot.resultDetail as Record<string, unknown>;
  assert.equal(updatedStep.status, 'RUNNING');
  assert.equal(resultDetail.executionStatus, 'UNKNOWN');
  assert.deepEqual(resultDetail.receipt, receipt);
  assert.deepEqual(resultDetail.checkpoint, checkpoint);
});

test('取消结果无法确认外部写入时统一落为 UNKNOWN', async () => {
  const { repository, service, run, step } = await createVerifyScenario('cancelled_write');

  await service.applyAgentTaskResult({
    tenantId,
    executionRunId: run.id,
    executionStepId: step.id,
    success: false,
    status: 'CANCELLED',
    errorCode: 'PLUGIN_RUNNER_CANCELLED',
    errorMessage: '取消与远端写入竞态',
    actorId,
  });

  const updatedStep = await repository.getStepOrThrow(step.id, tenantId);
  const updatedRun = await repository.getRunOrThrow(run.id, tenantId);
  assert.equal(updatedStep.status, 'RUNNING');
  assert.equal((updatedStep.inputSnapshot.resultDetail as Record<string, unknown>).executionStatus, 'UNKNOWN');
  assert.equal(updatedRun.summary.executionStatus, 'UNKNOWN');
});

test('显式 FAILED 状态不能被不一致的 success=true 伪装成成功', async () => {
  const { repository, service, run, step } = await createVerifyScenario('inconsistent_failed_status');

  await service.applyAgentTaskResult({
    tenantId,
    executionRunId: run.id,
    executionStepId: step.id,
    success: true,
    status: 'FAILED',
    errorCode: 'AGENT_RESULT_FAILED',
    errorMessage: 'Agent 明确返回失败',
    actorId,
  });

  assert.equal((await repository.getStepOrThrow(step.id, tenantId)).status, 'FAILED');
  assert.equal((await repository.getRunOrThrow(run.id, tenantId)).status, 'FAILED');
});

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

test('NGINX 正式 VERIFY 接受宿主远端证书指纹，不依赖安装结果字段', async () => {
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

test('NGINX 正式 VERIFY 只消费宿主远端证书验证结果，不依赖插件本地文件指纹', async () => {
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
  assert.equal(missingStep.status, 'SUCCESS');

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
  assert.equal(mismatchStep.status, 'SUCCESS');
});

test('正式 VERIFY 缺少宿主节点远端指纹时失败，结果同步阶段不补发网络请求', async () => {
  const { repository, service, run, step } = await createVerifyScenario('remote_fingerprint_missing');
  await service.applyAgentTaskResult({
    tenantId,
    executionRunId: run.id,
    executionStepId: step.id,
    success: true,
    actorId,
    detail: { verify: {} },
  });

  const updatedRun = await repository.getRunOrThrow(run.id, tenantId);
  const updatedStep = await repository.getStepOrThrow(step.id, tenantId);
  assert.equal(updatedStep.status, 'FAILED');
  assert.equal(updatedRun.status, 'FAILED');
  assert.equal(updatedStep.lastErrorCode, 'CERT_VERIFY_REMOTE_FINGERPRINT_MISSING');
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

test('部署计划成功后按 target 应用资产触发控制面证书探测并回写资产状态', async () => {
  const repository = new ExecutionsRepository();
  const deploymentPlans = new DeploymentPlansRepository();
  const assetsWrites = createAssetWriteRecorder();
  const service = new ExecutionResultSyncService(
    repository,
    assetsWrites.assets as unknown as AssetsApplicationService,
    assetsWrites.bindings as unknown as BindingsApplicationService,
    deploymentPlans,
  );
  const probeCalls: Array<Record<string, unknown>> = [];
  service.setMonitorsService({
    probeServiceAsset: async (input: Record<string, unknown>) => {
      probeCalls.push(input);
      return {
        serviceAssetId: input.serviceAssetId as string,
        source: 'control_plane',
        url: 'https://test.example.com/',
        status: 'READY',
        success: true,
        latencyMs: 5,
        checkedAt: '2026-07-07T10:00:00.000Z',
        message: '平台探测成功',
        certificate: {
          fingerprintSha256: expectedFingerprint.toUpperCase(),
          notAfter: '2026-09-30T21:03:02.000Z',
          verified: true,
        },
      };
    },
  } as any);
  const serviceAssetId = String(assetsWrites.serviceAsset.id);

  await deploymentPlans.createTarget({
    id: 'dpt_success_probe',
    tenantId,
    deploymentPlanId: 'dplan_success_probe',
    executionTargetId: serviceAssetId,
    executorType: 'WORKFLOW',
    requiredCapabilities: [],
    strategyPayload: {
      workflowRequest: {
        applicationAssetId: serviceAssetId,
        target: {
          verifyUrl: 'https://test.example.com/health',
          sniName: 'test.example.com',
        },
      },
    },
    status: 'COMPLETED',
    createdAt: '2026-07-07T09:59:00.000Z',
    updatedAt: '2026-07-07T09:59:00.000Z',
    version: 1,
  });

  await service.probeSuccessfulDeploymentPlanTargets({ tenantId, deploymentPlanId: 'dplan_success_probe' });

  assert.deepEqual(probeCalls, [{ tenantId, serviceAssetId }]);
  assert.equal(assetsWrites.serviceAssetUpdates.length, 2);
  const metadata = assetsWrites.serviceAssetUpdates.at(-1)?.metadata as Record<string, unknown>;
  const workflowTarget = metadata.workflowTarget as Record<string, unknown>;
  assert.equal(workflowTarget.verifyUrl, 'https://test.example.com/health');
  assert.equal(metadata.currentCertificateNotAfter, '2026-09-30T21:03:02.000Z');
  assert.equal(metadata.currentCertificateObservedAt, '2026-07-07T10:00:00.000Z');
  assert.equal(metadata.currentCertificateVerified, true);
  assert.equal(metadata.currentFingerprintSha256, expectedFingerprint);
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
      certificateVerification: {
        capabilityKey: 'certificate.verify', schemaVersion: '1.0', connectHost: '127.0.0.1', serverName: 'example.com', port: 443,
        expectedDomains: ['example.com'], expectedFingerprintSha256: expectedFingerprint,
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
      certificateVerification: {
        capabilityKey: 'certificate.verify',
        schemaVersion: '1.0',
        connectHost: '127.0.0.1',
        serverName: options.expectedDomains?.[0] ?? 'example.com',
        port: 443,
        expectedDomains: options.expectedDomains ?? ['example.com'],
        expectedFingerprintSha256: options.expectedCertificateFingerprintSha256 ?? expectedFingerprint,
      },
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
  const serviceAsset = {
    id: 'app_asset_sync',
    tenantId,
    address: 'test.example.com',
    port: 443,
    protocol: 'HTTPS',
    metadata: {},
  } as Record<string, unknown>;
  const binding = {
    id: 'binding_asset_sync',
    tenantId,
    serviceAssetId: serviceAsset.id,
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
  const serviceAssetUpdates: Array<Record<string, unknown>> = [];
  const snapshots: Array<Record<string, unknown>> = [];

  const assets = {
    getRepository() {
      return {
        listApplicationAssetTargets: async () => ({ items: [] }),
        getSiteAsset: async () => undefined,
        getManagedTarget: async () => undefined,
        getServiceAsset: async (_tenantId: string, serviceAssetId: string) => serviceAssetId === serviceAsset.id ? serviceAsset : undefined,
        getApplicationAssetTargetByApplicationAssetId: async () => undefined,
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
    updateServiceAsset: async (_tenantId: string, _serviceAssetId: string, patch: Record<string, unknown>) => {
      serviceAssetUpdates.push(patch);
      Object.assign(serviceAsset, patch);
      return serviceAsset;
    },
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

  return { assets, bindings, binding, bindingUpdates, serviceAsset, serviceAssetUpdates, snapshots };
}

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
  assert.ok(checks.some((check) => check.key === 'agent.plan.validate' && check.status === 'failed'));
});
