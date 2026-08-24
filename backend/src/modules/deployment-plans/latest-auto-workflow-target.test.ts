// @ts-nocheck
import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../common/errors/app-error.js';
import { DeploymentPlansApplicationService } from './application/deployment-plans.application-service.js';

test('独立 WORKFLOW 的 LATEST_AUTO 运行快照重建不能把 applicationAssetId 当作 managedTargetId', async () => {
  const now = '2026-08-02T00:00:00.000Z';
  const certificateVersion = {
    id: 'certver_workflow_latest',
    certificateAssetId: 'certasset_workflow_latest',
    versionNo: 1,
    commonName: 'workflow-only.example.com',
    sans: ['workflow-only.example.com'],
    issuer: { raw: 'CN=issuer' },
    subject: { raw: 'CN=workflow-only.example.com' },
    serialNumber: '001',
    notBefore: now,
    notAfter: '2027-08-02T00:00:00.000Z',
    fingerprintSha256: 'f'.repeat(64),
    publicKeyAlgorithm: 'RSA',
    signatureAlgorithm: 'SHA256RSA',
    leafStorageRef: 'vault://leaf/workflow-latest',
    privateKeySecretRef: 'secret://key/workflow-latest',
    chainCertificateRefs: [],
    chainOrder: [],
    chainDiagnostics: [],
    chainStatus: 'valid',
    deployable: true,
    sourceType: 'manual',
    status: 'active',
    createdBy: 'tester',
    createdAt: now,
  };
  const certificateFormat = {
    id: 'fmt_workflow_latest',
    certificateVersionId: certificateVersion.id,
    format: 'pfx',
    artifactRef: 'artifact://certificate-format/workflow-latest/pfx',
    parameterHash: 'hash_workflow_latest',
    parameters: { runtimePlatform: 'workflow' },
    containsPrivateKey: true,
    passwordSecretRef: 'secret://pfx-password/workflow-latest',
    createdBy: 'tester',
    createdAt: now,
  };
  const workflowInputBindings = {
    apiVersion: 'gcac.input-bindings/v1',
    variables: {},
    connections: {},
    credentials: {},
    artifacts: {},
  };
  const service = new DeploymentPlansApplicationService({
    assets: {
      getServiceAsset: async (_tenantId, id) => id === 'asset_workflow_only'
        ? {
          id,
          tenantId: 'tenant_workflow_latest',
          address: 'workflow-only.example.com',
          addressType: 'DNS',
          port: 443,
          protocol: 'HTTPS',
          displayName: 'Workflow Only',
          status: 'ACTIVE',
          metadata: {},
          createdAt: now,
          updatedAt: now,
          version: 1,
          deploymentStrategy: {
            type: 'WORKFLOW',
            workflow: {
              workflowId: 'workflow_latest',
              pluginVersionId: 'plugin_workflow_latest_v1',
              capabilityKey: 'certificate.deploy',
              workflowVersionSelection: 'FIXED',
              workflowVersionId: 'workflow_latest_v1',
              runner: 'CONTROL_PLANE',
              inputBindings: workflowInputBindings,
            },
          },
        }
        : undefined,
    } as never,
    certificates: {
      getVersion: async (id) => id === certificateVersion.id ? certificateVersion : undefined,
      getAsset: async (id) => id === certificateVersion.certificateAssetId
        ? {
          id,
          name: 'workflow-only.example.com',
          primaryDomain: 'workflow-only.example.com',
          sans: ['workflow-only.example.com'],
          sourceType: 'manual',
          status: 'active',
          tags: [],
          createdBy: 'tester',
          createdAt: now,
          updatedAt: now,
        }
        : undefined,
      listVersions: async () => ({ items: [certificateVersion], total: 1, page: 1, pageSize: 5000 }),
      getFormat: async (id) => id === certificateFormat.id ? certificateFormat : undefined,
      listFormatsByVersion: async (id) => id === certificateVersion.id ? [certificateFormat] : [],
    } as never,
    certificatesApp: {
      generateDeploymentArtifactFromFormat: async ({ certificateVersionId, certificateFormatId }) => ({
        certificateVersionId,
        certificateFormatId,
        format: 'pfx',
        containsPrivateKey: true,
        pfxBase64: 'dGVzdA==',
        pfxPassword: 'test-password',
        files: [],
        warnings: [],
      }),
    } as never,
    managedTargetContextResolver: {
      resolve: async (_tenantId, managedTargetId) => {
        throw new AppError('VALIDATION_FAILED', '测试不允许解析受管目标', { managedTargetId });
      },
    } as never,
    workflows: {
      getVersion: async (id) => ({
        id,
        templateId: 'workflow_latest',
        version: 1,
        dslVersion: 'v1',
        status: 'published',
        contentHash: 'hash_workflow_latest',
        content: {
          inputContract: {
            apiVersion: 'gcac.deployment-input/v1',
            variables: {},
            connections: {},
            credentials: {},
            artifacts: {},
          },
        },
        createdAt: now,
        createdBy: 'tester',
      }),
    } as never,
  });
  (service as any).workflowExecutionBindings = {
    get: async (_tenantId, id) => ({
      id,
      tenantId: 'tenant_workflow_latest',
      pluginVersionId: 'plugin_workflow_latest_v1',
      capabilityKey: 'certificate.deploy',
      workflowTemplateId: 'workflow_latest',
      workflowVersionSelection: 'FIXED',
      workflowVersionId: 'workflow_latest_v1',
      runner: 'CONTROL_PLANE',
      inputBindings: workflowInputBindings,
      status: 'ACTIVE',
      version: 1,
      createdAt: now,
      updatedAt: now,
    }),
  };

  const runtimeSnapshot = await (service as any).buildLatestAutoRuntimeSnapshot({
    id: 'plan_workflow_latest',
    tenantId: 'tenant_workflow_latest',
    name: '独立工作流最新证书部署',
    planType: 'UPDATE',
    selectionMode: 'LATEST_AUTO',
    certificateVersionId: certificateVersion.id,
    certificateFormatId: certificateFormat.id,
    status: 'READY',
    approvalStatus: 'NOT_REQUIRED',
    snapshotHash: 'snapshot',
    idempotencyKey: 'idem_workflow_latest',
    requestHash: 'request',
    policy: { failurePolicy: 'stop', batchSize: 1 },
    createdReason: 'MANUAL',
    createdAt: now,
    updatedAt: now,
    createdBy: 'tester',
    version: 1,
  }, {
    id: 'target_workflow_latest',
    tenantId: 'tenant_workflow_latest',
    deploymentPlanId: 'plan_workflow_latest',
    applicationAssetId: 'asset_workflow_only',
    serviceAssetId: 'asset_workflow_only',
    executionTargetId: 'asset_workflow_only',
    executorType: 'WORKFLOW',
    requiredCapabilities: ['workflow.run'],
    strategyPayload: {
      executionSource: {
        type: 'WORKFLOW',
        workflowExecutionBindingId: 'wfeb_workflow_latest',
        pluginVersionId: 'plugin_workflow_latest_v1',
        capabilityKey: 'certificate.deploy',
        workflowTemplateId: 'workflow_latest',
        workflowVersionSelection: 'FIXED',
        workflowVersionId: 'workflow_latest_v1',
      },
      certificateVerification: {
        capabilityKey: 'certificate.verify',
        schemaVersion: '1.0',
        connectHost: 'workflow-only.example.com',
        serverName: 'workflow-only.example.com',
        port: 443,
      },
      workflowRequest: {
        workflowId: 'workflow_latest',
        pluginVersionId: 'plugin_workflow_latest_v1',
        capabilityKey: 'certificate.deploy',
        workflowVersionSelection: 'FIXED',
        workflowVersionId: 'workflow_latest_v1',
        runner: 'CONTROL_PLANE',
        applicationAssetId: 'asset_workflow_only',
        inputBindings: workflowInputBindings,
      },
    },
    status: 'READY',
    createdAt: now,
    updatedAt: now,
    createdBy: 'tester',
    version: 1,
  });

  assert.equal(runtimeSnapshot.deploymentArtifact.certificateVersionId, certificateVersion.id);
  assert.equal(runtimeSnapshot.resolvedDeploymentInput.assetContext.application.id, 'asset_workflow_only');
  assert.equal(runtimeSnapshot.resolvedDeploymentInput.assetContext.target, undefined);
});

test('已声明的 certificatesApp.getTrustRoots 异常必须透传', () => {
  const expected = new Error('trust roots unavailable');

  assert.throws(
    () => new DeploymentPlansApplicationService({
      certificatesApp: {
        generateDeploymentArtifactFromFormat: async () => ({
          certificateVersionId: 'certificate-version',
          certificateFormatId: 'certificate-format',
          format: 'pfx',
          containsPrivateKey: true,
          files: [],
          warnings: [],
        }),
        getTrustRoots: () => {
          throw expected;
        },
      } as never,
    }),
    (error: unknown) => error === expected,
  );
});
