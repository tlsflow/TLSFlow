import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../../common/errors/app-error.js';
import type { DeploymentInputContractV1 } from './dto/deployment-input-contract.dto.js';
import { validateDeploymentInputContractV1 } from './schema/deployment-input-contract.schema.js';
import { validateAgentDeploymentPluginManifest } from '../plugins/schema/agent-deployment-plugins.schema.js';
import { workflowTemplatesSchemaRegistry } from '../workflow-templates/schema/workflow-templates.schema.js';

describe('DeploymentInputContractV1 Schema', () => {
  it('接受统一变量、HTTP/SSH 连接、凭据和 Artifact 契约', () => {
    const contract = contractFixture();
    const validated = validateDeploymentInputContractV1(contract);

    assert.equal(validated.apiVersion, contract.apiVersion);
    assert.deepEqual(Object.keys(validated.variables), Object.keys(contract.variables));
    assert.equal(validated.connections.managementApi.transport, 'http');
    assert.equal(validated.connections.fileTransfer.transport, 'ssh');
    assert.equal(validated.credentials.managementCredential.allowedKinds[0], 'USERNAME_PASSWORD');
    assert.equal(validated.artifacts.certificate.artifactContract.outputs.privateKey.sensitive, true);
  });

  it('Agent Plugin 与 Workflow DSL 调用同一个 Contract Schema', () => {
    const inputContract = contractFixture();
    const agent = validateAgentDeploymentPluginManifest({
      apiVersion: 'gcac.agent-plugin/v1',
      kind: 'AgentDeploymentPlugin',
      pluginId: 'example.shared-contract',
      name: 'shared-contract',
      publisher: 'gcac',
      version: '1.0.0',
      compatibility: { platforms: ['LINUX'] },
      inputContract,
      permissions: [],
      operations: [{
        id: 'preflight',
        name: '预检',
        stage: 'prepare',
        operationType: 'preflight.assert',
        schemaVersion: '1.0',
        input: {},
      }],
    });
    const workflow = workflowTemplatesSchemaRegistry.validate({
      apiVersion: 'gcac.workflow/v1',
      kind: 'CurlSshWorkflow',
      metadata: { name: 'shared-contract', version: '1.0.0' },
      inputContract,
      variables: {},
      steps: [{ name: 'confirm', type: 'manual', instruction: '确认执行结果' }],
    });

    assert.equal(agent.inputContract?.apiVersion, 'gcac.deployment-input/v1');
    assert.equal(workflow.inputContract?.apiVersion, 'gcac.deployment-input/v1');
    assert.deepEqual(agent.inputContract?.connections.managementApi, workflow.inputContract?.connections.managementApi);
  });

  it('拒绝旧 Source 和普通 Credential/Certificate 变量类型', () => {
    for (const sourceKind of ['asset_ssl', 'execution_context', 'dsl']) {
      const contract = contractFixture() as unknown as Record<string, unknown>;
      const variables = contract.variables as Record<string, Record<string, unknown>>;
      variables.applicationAddress.source = { kind: sourceKind, path: 'application.address' };
      assertContractInvalid(() => validateDeploymentInputContractV1(contract));
    }

    for (const variableType of ['credential', 'certificate']) {
      const contract = contractFixture() as unknown as Record<string, unknown>;
      const variables = contract.variables as Record<string, Record<string, unknown>>;
      variables.applicationAddress.type = variableType;
      assertContractInvalid(() => validateDeploymentInputContractV1(contract));
    }
  });

  it('拒绝 Source、Binding Policy 和 Lifecycle 的矛盾组合', () => {
    const invalidPolicy = contractFixture() as unknown as Record<string, unknown>;
    const policyVariables = invalidPolicy.variables as Record<string, Record<string, unknown>>;
    policyVariables.applicationAddress.bindingPolicy = 'required_binding';
    assertContractInvalid(() => validateDeploymentInputContractV1(invalidPolicy));

    const invalidLifecycle = contractFixture() as unknown as Record<string, unknown>;
    const lifecycleVariables = invalidLifecycle.variables as Record<string, Record<string, unknown>>;
    lifecycleVariables.stepResult.lifecycle = 'pre_execution';
    assertContractInvalid(() => validateDeploymentInputContractV1(invalidLifecycle));
  });

  it('拒绝未声明 Credential Slot 和错误的连接专属配置', () => {
    const missingCredential = contractFixture() as unknown as Record<string, unknown>;
    const connections = missingCredential.connections as Record<string, Record<string, unknown>>;
    connections.managementApi.credentialSlot = 'missingCredential';
    assertContractInvalid(() => validateDeploymentInputContractV1(missingCredential));

    const invalidHttpHostKey = contractFixture() as unknown as Record<string, unknown>;
    const httpConnections = invalidHttpHostKey.connections as Record<string, Record<string, unknown>>;
    httpConnections.managementApi.hostKey = { policy: 'strict' };
    assertContractInvalid(() => validateDeploymentInputContractV1(invalidHttpHostKey));
  });
});

function contractFixture(): DeploymentInputContractV1 {
  return {
    apiVersion: 'gcac.deployment-input/v1',
    variables: {
      applicationAddress: {
        type: 'string',
        required: true,
        configurationMode: 'runtime',
        source: { kind: 'asset', path: 'application.address' },
        lifecycle: 'pre_execution',
        bindingPolicy: 'fixed',
      },
      serviceName: {
        type: 'string',
        required: true,
        configurationMode: 'advanced',
        source: { kind: 'default' },
        lifecycle: 'pre_execution',
        bindingPolicy: 'default_overridable',
        default: 'gcac-service',
      },
      executionToken: {
        type: 'string',
        required: true,
        configurationMode: 'runtime',
        source: { kind: 'system', key: 'execution.token' },
        lifecycle: 'runtime_injected',
        bindingPolicy: 'fixed',
        sensitive: true,
      },
      stepResult: {
        type: 'object',
        required: true,
        configurationMode: 'runtime',
        source: { kind: 'step_output', step: 'upload', output: 'result' },
        lifecycle: 'step_output',
        bindingPolicy: 'fixed',
      },
    },
    connections: {
      managementApi: {
        transport: 'http',
        host: fixedAssetField('string', 'host.primaryIp'),
        port: defaultField('number', 443),
        credentialSlot: 'managementCredential',
        tls: { verifyPeer: defaultField('boolean', true) },
      },
      fileTransfer: {
        transport: 'ssh',
        host: requiredBindingField('string'),
        port: defaultField('number', 22),
        username: requiredBindingField('string'),
        credentialSlot: 'sshCredential',
        hostKey: {
          policy: 'strict',
          expectedFingerprint: requiredBindingField('string'),
        },
      },
    },
    credentials: {
      managementCredential: {
        allowedKinds: ['USERNAME_PASSWORD', 'BEARER_TOKEN'],
        required: true,
        configurationMode: 'required',
        lifecycle: 'pre_execution',
      },
      sshCredential: {
        allowedKinds: ['USERNAME_PASSWORD', 'SSH_KEY'],
        required: true,
        configurationMode: 'required',
        lifecycle: 'pre_execution',
      },
    },
    artifacts: {
      certificate: {
        kind: 'certificate',
        required: true,
        configurationMode: 'required',
        lifecycle: 'pre_execution',
        artifactContract: {
          outputs: {
            publicCertificate: { role: 'public_certificate', required: true },
            privateKey: { role: 'private_key', required: true, sensitive: true },
          },
        },
      },
    },
  };
}

function fixedAssetField(type: 'string' | 'number' | 'boolean', path: string) {
  return {
    type,
    required: true,
    configurationMode: 'runtime' as const,
    source: { kind: 'asset' as const, path },
    lifecycle: 'pre_execution' as const,
    bindingPolicy: 'fixed' as const,
  };
}

function defaultField(type: 'string' | 'number' | 'boolean', defaultValue: string | number | boolean) {
  return {
    type,
    required: true,
    configurationMode: 'advanced' as const,
    source: { kind: 'default' as const },
    lifecycle: 'pre_execution' as const,
    bindingPolicy: 'default_overridable' as const,
    default: defaultValue,
  };
}

function requiredBindingField(type: 'string' | 'number' | 'boolean') {
  return {
    type,
    required: true,
    configurationMode: 'required' as const,
    source: { kind: 'binding' as const },
    lifecycle: 'pre_execution' as const,
    bindingPolicy: 'required_binding' as const,
  };
}

function assertContractInvalid(action: () => unknown): void {
  assert.throws(action, (error: unknown) => error instanceof AppError && error.errorCode === 'DEPLOYMENT_INPUT_CONTRACT_INVALID');
}
