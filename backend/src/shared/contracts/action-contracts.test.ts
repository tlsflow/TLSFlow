import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ACTION_CONTRACT_SCHEMA_VERSION,
  ActionContractError,
  parseActionProgress,
  parseActionRequest,
  parseActionResult,
} from './action-contracts.js';

describe('Action Contract', () => {
  it('接受包含产品线、能力快照、幂等和审计信息的请求', () => {
    const request = parseActionRequest(createRequest());
    assert.equal(request.schemaVersion, ACTION_CONTRACT_SCHEMA_VERSION);
    assert.equal(request.agentProduct.productLine, 'windows-modern');
    assert.equal(request.capabilitySnapshotRef.snapshotId, 'snapshot_1');
    assert.equal(request.audit.executionRunId, 'run_1');
  });

  it('拒绝未知合同版本并返回稳定错误码', () => {
    assert.throws(
      () => parseActionRequest({ ...createRequest(), schemaVersion: 'gcac.action/v2' }),
      (error: unknown) => error instanceof ActionContractError && error.errorCode === 'ACTION_SCHEMA_UNSUPPORTED',
    );
  });

  it('拒绝缺少幂等标识的请求', () => {
    const request = createRequest() as Record<string, unknown>;
    delete request.idempotencyKey;
    assert.throws(
      () => parseActionRequest(request),
      (error: unknown) => error instanceof ActionContractError && error.errorCode === 'ACTION_CONTRACT_INVALID',
    );
  });

  it('校验进度序列和百分比边界', () => {
    const progress = parseActionProgress({
      ...createEnvelope(),
      sequence: 2,
      status: 'verifying',
      progressPercent: 85,
      messageCode: 'certificate.verify.running',
      evidence: [],
    });
    assert.equal(progress.sequence, 2);
    assert.throws(() => parseActionProgress({ ...progress, progressPercent: 101 }), ActionContractError);
  });

  it('要求恢复状态携带恢复账本引用', () => {
    assert.throws(
      () => parseActionResult({
        ...createEnvelope(),
        success: false,
        status: 'recovery_required',
        evidence: [],
        error: { code: 'OPERATION_RESULT_UNKNOWN', message: '执行结果未知', retryable: false },
      }),
      (error: unknown) => error instanceof ActionContractError && error.errorCode === 'ACTION_CONTRACT_INVALID',
    );

    const result = parseActionResult({
      ...createEnvelope(),
      success: false,
      status: 'recovery_required',
      evidence: [],
      error: { code: 'OPERATION_RESULT_UNKNOWN', message: '执行结果未知', retryable: false },
      recovery: { ledgerId: 'ledger_1', state: 'manual_required', rollbackAvailable: true },
    });
    assert.equal(result.recovery?.ledgerId, 'ledger_1');
  });
});

function createEnvelope(): Record<string, unknown> {
  return {
    schemaVersion: ACTION_CONTRACT_SCHEMA_VERSION,
    actionType: 'certificate.deploy',
    actionSchemaVersion: '1.0',
    requestId: 'action_1',
    agentProduct: {
      productLine: 'windows-modern',
      productVersion: '1.0.0',
      runtimeName: 'go',
      runtimeVersion: '1.23.0',
    },
    capabilitySnapshotRef: {
      snapshotId: 'snapshot_1',
      snapshotVersion: '1',
      capturedAt: '2026-07-21T00:00:00.000Z',
    },
    audit: {
      tenantId: 'default',
      requestId: 'req_1',
      correlationId: 'corr_1',
      executionRunId: 'run_1',
      executionStepId: 'step_1',
    },
  };
}

function createRequest(): Record<string, unknown> {
  return {
    ...createEnvelope(),
    idempotencyKey: 'certificate.deploy:target_1:version_1',
    target: { targetType: 'service_instance', targetId: 'iis_site_1' },
    input: { certificateVersionId: 'version_1' },
    requiredCapabilities: [],
    dryRun: false,
  };
}
