import assert from 'node:assert/strict';
import test from 'node:test';
import { isAgentPlanDeploymentPayload, shouldBuildCertificateTrustPlan } from './deployment-plans.application-service.js';

test('只有明确使用 Windows 证书库的目标进入根信任，普通无事实工作流保留兜底', () => {
  assert.equal(shouldBuildCertificateTrustPlan({
    resolvedDeploymentInput: {
      assetContext: {
        target: { certificateLocation: { storageKind: 'WINDOWS_CERTIFICATE_STORE' } },
      },
    },
  }), true);

  assert.equal(shouldBuildCertificateTrustPlan({
    resolvedDeploymentInput: {
      assetContext: {
        target: { certificateLocation: { storageKind: 'PEM_FILES' } },
      },
    },
  }), false);

  assert.equal(shouldBuildCertificateTrustPlan({
    resolvedDeploymentInput: {
      assetContext: {
        deployment: { targets: [{ certificateLocation: { storageKind: 'WINDOWS_CERTIFICATE_STORE' } }] },
      },
    },
  }), true);

  assert.equal(shouldBuildCertificateTrustPlan({}), true);

  assert.equal(shouldBuildCertificateTrustPlan({
    certificateUpdateSnapshot: { artifactKind: 'PEM_FILES' },
  }), false);
  assert.equal(shouldBuildCertificateTrustPlan({
    certificateUpdateSnapshot: { artifactKind: 'KEYSTORE' },
  }), false);
  assert.equal(shouldBuildCertificateTrustPlan({
    certificateUpdateSnapshot: { artifactKind: 'KEYSTORE' },
    resolvedDeploymentInput: {
      assetContext: {
        target: { certificateLocation: { storageKind: 'WINDOWS_CERTIFICATE_STORE' } },
      },
    },
  }), true);
});

test('证书更新快照缺少受支持的 Artifact 类型时拒绝继续部署', () => {
  assert.throws(
    () => shouldBuildCertificateTrustPlan({ certificateUpdateSnapshot: {} }),
    (error: unknown) => error instanceof Error
      && error.message.includes('证书更新快照缺少受支持的 Artifact 类型'),
  );
});

test('WORKFLOW_DSL 的 Agent Plan 资源也必须识别为 Agent Plan', () => {
  assert.equal(isAgentPlanDeploymentPayload({
    pluginRuntimeCapability: { runtime: 'WORKFLOW_DSL' },
    actionType: 'agent.plan.execute',
    plan: { operations: [{ operationType: 'filesystem.atomic_replace' }] },
  }), true);
  assert.equal(isAgentPlanDeploymentPayload({
    pluginRuntimeCapability: { runtime: 'WORKFLOW_DSL' },
    workflowRequest: { workflowId: 'workflow-1' },
  }), false);
});
