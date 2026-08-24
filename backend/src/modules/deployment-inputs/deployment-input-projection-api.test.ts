import assert from 'node:assert/strict';
import test from 'node:test';
import { App } from '../../common/http/app.js';
import { configureTestAuth, testAuthHeaders } from '../../common/http/test-auth.js';
import { DeploymentInputProjectionController } from './controller/deployment-input-projection.controller.js';

test('统一 Deployment Input Projection API 不接受厂商分派字段且返回标准分组', async () => {
  const app = configureTestAuth(new App());
  let received: unknown;
  new DeploymentInputProjectionController({
    async resolveProjectionSource(input: { applicationAssetId: string; tenantId?: string }) {
      received = input;
      return {
        contract: { apiVersion: 'gcac.deployment-input/v1', variables: {}, connections: {}, credentials: {}, artifacts: {} },
        resolvedInput: { apiVersion: 'gcac.resolved-deployment-input/v1', contractVersion: 'gcac.deployment-input/v1', assetContext: {}, variables: {}, connections: {}, credentials: {}, artifacts: {}, provenance: {}, sensitivePaths: [], issues: [], executable: true, resolvedSha256: 'hash' },
      };
    },
  } as never).register(app.router);
  const response = await app.inject({
    method: 'POST',
    path: '/api/v1/deployment-inputs/projection',
    headers: testAuthHeaders('user_projection', 'tenant-projection'),
    body: {
      applicationAssetId: 'asset-1',
      vendor: 'forbidden-input',
      contract: { apiVersion: 'gcac.deployment-input/v1', variables: {}, connections: {}, credentials: {}, artifacts: {} },
      resolvedInput: { apiVersion: 'gcac.resolved-deployment-input/v1', contractVersion: 'gcac.deployment-input/v1', assetContext: {}, variables: {}, connections: {}, credentials: {}, artifacts: {}, provenance: {}, sensitivePaths: [], issues: [], executable: true, resolvedSha256: 'hash' },
    },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(received, { applicationAssetId: 'asset-1', tenantId: 'tenant-projection' });
  assert.deepEqual(response.body, { contractVersion: 'gcac.deployment-input/v1', requiredVariables: [], advancedVariables: [], connections: [], credentials: [], artifacts: [], fixedValues: [], runtimeValues: [], issues: [], saveable: true });
});

test('统一 Deployment Input Projection API 可以接收未保存的工作流版本草稿', async () => {
  const app = configureTestAuth(new App());
  let received: unknown;
  new DeploymentInputProjectionController({
    async resolveProjectionSource(input: { applicationAssetId: string; tenantId?: string; workflow?: unknown }) {
      received = input;
      return {
        contract: { apiVersion: 'gcac.deployment-input/v1', variables: {}, connections: {}, credentials: {}, artifacts: {} },
        resolvedInput: { apiVersion: 'gcac.resolved-deployment-input/v1', contractVersion: 'gcac.deployment-input/v1', assetContext: {}, variables: {}, connections: {}, credentials: {}, artifacts: {}, provenance: {}, sensitivePaths: [], issues: [], executable: true, resolvedSha256: 'hash' },
      };
    },
  } as never).register(app.router);
  const response = await app.inject({
    method: 'POST',
    path: '/api/v1/deployment-inputs/projection',
    headers: testAuthHeaders('user_projection_draft', 'tenant-projection-draft'),
    body: {
      applicationAssetId: 'asset-1',
      workflow: {
        workflowTemplateId: 'workflow-dsm',
        workflowVersionId: 'workflow-dsm-v1',
        pluginVersionId: 'plugin-dsm-v1',
        inputBindings: { apiVersion: 'gcac.input-bindings/v1', variables: {}, connections: {}, credentials: {}, artifacts: {} },
      },
    },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(received, {
    applicationAssetId: 'asset-1',
    tenantId: 'tenant-projection-draft',
    workflow: {
      workflowTemplateId: 'workflow-dsm',
      workflowVersionId: 'workflow-dsm-v1',
      pluginVersionId: 'plugin-dsm-v1',
      inputBindings: { apiVersion: 'gcac.input-bindings/v1', variables: {}, connections: {}, credentials: {}, artifacts: {} },
    },
  });
});
