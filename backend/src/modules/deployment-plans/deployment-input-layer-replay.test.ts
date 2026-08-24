import assert from 'node:assert/strict';
import test from 'node:test';
import { DeploymentPlansApplicationService } from './application/deployment-plans.application-service.js';
import type { InputBindingsV1 } from '../deployment-inputs/dto/input-bindings.dto.js';

const pluginVersionId = 'plugin_version_layered';
const deviceBindingId = 'binding_device_layered';
const assetBindingId = 'binding_asset_layered';

test('计划预检按固定资产 Binding 身份重放时保留设备默认层', async () => {
  const bindings = new Map([
    [deviceBindingId, binding(deviceBindingId, {
      variables: {},
      connections: { management: { host: '10.255.0.49' } },
      credentials: {},
      artifacts: {},
    }, 3)],
    [assetBindingId, binding(assetBindingId, {
      variables: { resourceName: 'lb-test01' },
      connections: {},
      credentials: {},
      artifacts: {},
    }, 9)],
  ]);
  const service = new DeploymentPlansApplicationService({
    assets: {
      getServiceAsset: async () => ({
        id: 'application_asset_layered',
        tenantId: 'tenant_1',
        address: 'lb-test01.example.com',
        port: 443,
        protocol: 'HTTPS',
        displayName: 'LB Test',
        status: 'ACTIVE',
      }),
    } as never,
    managedTargetContextResolver: {
      resolve: async () => ({
        host: { id: 'host_layered', tenantId: 'tenant_1', hostname: 'lb-host', primaryIp: '10.255.0.49' },
        managedTarget: { id: 'target_layered', tenantId: 'tenant_1', targetType: 'tls.binding', targetKey: 'lb-test01' },
        availableExecutionLocations: ['CONTROL_PLANE'],
        frameworkType: 'lb.test',
      }),
    } as never,
    pluginBindings: {
      listAssignmentCandidates: async () => [
        assignment('APPLICATION_ASSET', 'application_asset_layered', assetBindingId, 'ASSET_OVERRIDE'),
        assignment('DEVICE', 'host_layered', deviceBindingId, 'DEVICE_DEFAULT'),
      ],
      getTenantBinding: async (_tenantId: string, bindingId: string) => bindings.get(bindingId),
    } as never,
    unifiedPlugins: {
      getVersion: async () => ({
        id: pluginVersionId,
        runtime: 'WORKFLOW_DSL',
        manifest: { resources: { workflows: { 'certificate.deploy': 'workflows/deploy.json' } } },
        resources: { 'workflows/deploy.json': JSON.stringify({ inputContract: inputContract() }) },
      }),
    } as never,
  });

  const replay = service as unknown as {
    resolveTargetDeploymentInput(
      phase: 'preflight',
      tenantId: string,
      target: Record<string, unknown>,
      artifact: Record<string, unknown>,
    ): Promise<{ resolvedInput: { variables: Record<string, unknown>; connections: Record<string, unknown>; executable: boolean } }>;
  };
  const result = await replay.resolveTargetDeploymentInput('preflight', 'tenant_1', {
    applicationAssetId: 'application_asset_layered',
    managedTargetId: 'target_layered',
    strategyPayload: {
      pluginRuntimeCapability: {
        pluginVersionId,
        pluginBindingId: assetBindingId,
        pluginBindingVersion: 9,
        capabilityKey: 'certificate.deploy',
        assignmentOwnerType: 'APPLICATION_ASSET',
      },
    },
  }, {
    certificateVersionId: 'certificate_version_layered',
    certificateFormatId: 'certificate_format_layered',
    format: 'PEM',
    containsPrivateKey: false,
    files: [],
    warnings: [],
    workflowCertificateMaterials: {},
  });

  assert.equal(result.resolvedInput.executable, true);
  assert.equal((result.resolvedInput.connections.management as { host?: string }).host, '10.255.0.49');
  assert.equal(result.resolvedInput.variables.resourceName, 'lb-test01');
});

function binding(id: string, input: Omit<InputBindingsV1, 'apiVersion'>, version: number) {
  return {
    id,
    tenantId: 'tenant_1',
    pluginVersionId,
    mode: 'MANAGED',
    inputBindings: { apiVersion: 'gcac.input-bindings/v1', ...input },
    managedContext: { hostId: 'host_layered' },
    status: 'ACTIVE',
    version,
  };
}

function assignment(
  ownerType: 'DEVICE' | 'APPLICATION_ASSET',
  ownerId: string,
  pluginBindingId: string,
  precedence: 'DEVICE_DEFAULT' | 'ASSET_OVERRIDE',
) {
  return {
    id: `assignment_${ownerType.toLowerCase()}`,
    tenantId: 'tenant_1',
    ownerType,
    ownerId,
    capabilityKey: 'certificate.deploy',
    pluginVersionId,
    pluginBindingId,
    precedence,
    status: 'ACTIVE',
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
  };
}

function inputContract() {
  return {
    apiVersion: 'gcac.deployment-input/v1',
    variables: {
      resourceName: {
        type: 'string', required: true, configurationMode: 'required',
        source: { kind: 'binding' }, lifecycle: 'pre_execution', bindingPolicy: 'required_binding',
      },
    },
    connections: {
      management: {
        transport: 'http',
        host: {
          type: 'string', required: true, configurationMode: 'required',
          source: { kind: 'binding' }, lifecycle: 'pre_execution', bindingPolicy: 'required_binding',
        },
        port: {
          type: 'number', required: true, configurationMode: 'advanced', default: 443,
          source: { kind: 'default' }, lifecycle: 'pre_execution', bindingPolicy: 'default_overridable',
        },
      },
    },
    credentials: {},
    artifacts: {},
  };
}
