import assert from 'node:assert/strict';
import test from 'node:test';
import { DeploymentPlansApplicationService } from './application/deployment-plans.application-service.js';
import type { ServiceAssetDto } from '../assets/dto/assets.dto.js';

test('Standalone Workflow Plugin 计划保留统一插件执行身份', async () => {
  const service = new DeploymentPlansApplicationService({
    pluginBindings: {
      getBinding: async () => ({
        id: 'plgb_standalone_identity',
        tenantId: 'tenant_standalone_identity',
        pluginVersionId: 'uplgv_standalone_identity',
        mode: 'STANDALONE',
        variableBindings: {},
        secretBindings: {},
        certificateArtifactBindings: {},
        connectionBindings: {},
        status: 'ACTIVE',
        version: 1,
        createdAt: '2026-07-26T00:00:00.000Z',
        updatedAt: '2026-07-26T00:00:00.000Z',
      }),
    } as never,
  });
  const asset = {
    id: 'asset_standalone_identity',
    deploymentStrategy: {
      type: 'WORKFLOW',
      workflow: {
        pluginBindingId: 'plgb_standalone_identity',
        runner: 'CONTROL_PLANE',
      },
    },
  } as ServiceAssetDto;
  const resolved = {
    strategyType: 'WORKFLOW',
    executorType: 'WORKFLOW',
    executionTargetId: asset.id,
    requiredCapabilities: ['workflow.run'],
    payload: { workflowRequest: { workflowVersionId: 'wftplv_standalone_identity' } },
  } as const;

  const result = await (service as unknown as {
    attachPluginExecutionIdentity: (targetAsset: ServiceAssetDto, snapshot: typeof resolved) => Promise<typeof resolved & { payload: Record<string, unknown> }>;
  }).attachPluginExecutionIdentity(asset, resolved);
  const workflowRequest = result.payload.workflowRequest as Record<string, unknown>;

  assert.equal(workflowRequest.pluginBindingId, 'plgb_standalone_identity');
  assert.equal(workflowRequest.pluginVersionId, 'uplgv_standalone_identity');
  assert.equal(workflowRequest.capabilityKey, 'certificate.deploy');
  assert.equal(workflowRequest.workflowVersionId, 'wftplv_standalone_identity');
});
