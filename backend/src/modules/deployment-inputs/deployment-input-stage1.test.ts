import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DeploymentInputContractV1 } from './dto/deployment-input-contract.dto.js';
import type { DeploymentAssetContextV1 } from './dto/deployment-asset-context.dto.js';
import { emptyInputBindingsV1, type InputBindingsV1 } from './dto/input-bindings.dto.js';
import type { EffectiveInputBindingV1 } from './domain/deployment-input-provenance.js';
import { UnifiedDeploymentInputResolver } from './domain/unified-deployment-input.resolver.js';
import { validateDeploymentInputContractV1 } from './schema/deployment-input-contract.schema.js';

describe('Spec 033.6 阶段 1 Fixture 检查', () => {
  const resolver = new UnifiedDeploymentInputResolver();

  for (const fixture of stageFixtures()) {
    it(`${fixture.name} 使用统一 Contract、Context 和 Resolver`, () => {
      const contract = validateDeploymentInputContractV1(fixture.contract);
      const resolved = resolver.resolve({
        phase: 'preflight',
        contract,
        assetContext: assetContextFixture(),
        effectiveBinding: fixture.effectiveBinding,
        credentialSnapshots: fixture.credentialSnapshots,
        artifactSnapshots: fixture.artifactSnapshots,
      });

      assert.equal(resolved.contractVersion, 'gcac.deployment-input/v1');
      assert.equal(resolved.assetContext.apiVersion, 'gcac.deployment-asset-context/v1');
      assert.equal(resolved.executable, true, JSON.stringify(resolved.issues));
      assert.equal(resolved.issues.length, 0);
      assert.match(resolved.resolvedSha256, /^[a-f0-9]{64}$/);
    });
  }

  it('Citrix 形状同时缺少连接、凭据和 Artifact 时一次返回全部问题', () => {
    const fixture = stageFixtures().find((item) => item.name === 'Citrix ADC Workflow')!;
    const resolved = resolver.resolve({
      phase: 'preflight',
      contract: validateDeploymentInputContractV1(fixture.contract),
      assetContext: assetContextFixture(),
      effectiveBinding: { inputBindings: emptyInputBindingsV1(), provenance: {} },
      credentialSnapshots: {},
      artifactSnapshots: {},
    });
    const categories = new Set(resolved.issues.map((item) => item.category));

    assert.equal(categories.has('CONNECTION'), true);
    assert.equal(categories.has('CREDENTIAL'), true);
    assert.equal(categories.has('ARTIFACT'), true);
    assert.equal(resolved.issues.some((item) => item.path === 'connections.management.host'), true);
    assert.equal(resolved.issues.some((item) => item.slot === 'managementCredential'), true);
    assert.equal(resolved.issues.some((item) => item.slot === 'certificate'), true);
    assert.equal(resolved.executable, false);
  });
});

interface StageFixture {
  name: string;
  contract: DeploymentInputContractV1;
  effectiveBinding: EffectiveInputBindingV1;
  credentialSnapshots?: Record<string, { credentialId: string; kind: string }>;
  artifactSnapshots: Record<string, { artifactId: string; outputs: Record<string, unknown> }>;
}

function stageFixtures(): StageFixture[] {
  return [
    agentFixture('Windows IIS Agent', 'siteName', 'Default Web Site', ['pfx']),
    agentFixture('Linux NGINX Agent', 'serviceName', 'nginx', ['certificatePem', 'privateKeyPem']),
    httpWorkflowFixture('Citrix ADC Workflow', true),
    sshWorkflowFixture(),
    httpWorkflowFixture('通用 HTTP Workflow', false),
  ];
}

function agentFixture(name: string, variableName: string, variableValue: string, outputs: string[]): StageFixture {
  const contract = baseContract();
  contract.variables[variableName] = requiredBindingVariable();
  contract.artifacts.certificate = artifactSlot(outputs);
  return {
    name,
    contract,
    effectiveBinding: effectiveBinding(bindings({
      variables: { [variableName]: variableValue },
      artifacts: { certificate: { outputBindings: Object.fromEntries(outputs.map((output) => [output, output])) } },
    }), {
      [`variables.${variableName}`]: 'APPLICATION_ASSET',
      'artifacts.certificate': 'APPLICATION_ASSET',
    }),
    artifactSnapshots: { certificate: artifactSnapshot(outputs) },
  };
}

function httpWorkflowFixture(name: string, includeAssetTargets: boolean): StageFixture {
  const contract = baseContract();
  if (includeAssetTargets) {
    contract.variables.deploymentTargets = {
      type: 'array', required: true, configurationMode: 'runtime', source: { kind: 'asset', path: 'deployment.targets' }, lifecycle: 'pre_execution', bindingPolicy: 'fixed',
    };
    contract.variables.certificateResourceName = {
      type: 'string', required: true, configurationMode: 'runtime', source: { kind: 'derived', resolver: 'certificate_resource_name' }, lifecycle: 'pre_execution', bindingPolicy: 'fixed',
    };
  }
  contract.credentials.managementCredential = credentialSlot(includeAssetTargets ? ['USERNAME_PASSWORD'] : ['BEARER_TOKEN']);
  contract.connections.management = {
    transport: 'http',
    host: requiredConnectionField('string'),
    port: defaultConnectionField('number', 443),
    credentialSlot: 'managementCredential',
    tls: { verifyPeer: defaultConnectionField('boolean', true) },
  };
  contract.artifacts.certificate = artifactSlot(['certificatePem', 'privateKeyPem']);
  const inputBindings = bindings({
    connections: { management: { host: '10.0.0.30' } },
    credentials: { managementCredential: { credentialId: 'credential-http' } },
    artifacts: { certificate: { outputBindings: { certificatePem: 'certificatePem', privateKeyPem: 'privateKeyPem' } } },
  });
  return {
    name,
    contract,
    effectiveBinding: effectiveBinding(inputBindings, {
      'connections.management.host': 'DEVICE',
      'credentials.managementCredential': 'DEVICE',
      'artifacts.certificate': 'APPLICATION_ASSET',
    }),
    credentialSnapshots: { managementCredential: { credentialId: 'credential-http', kind: includeAssetTargets ? 'USERNAME_PASSWORD' : 'BEARER_TOKEN' } },
    artifactSnapshots: { certificate: artifactSnapshot(['certificatePem', 'privateKeyPem']) },
  };
}

function sshWorkflowFixture(): StageFixture {
  const contract = baseContract();
  contract.credentials.sshCredential = credentialSlot(['USERNAME_PASSWORD', 'SSH_KEY']);
  contract.connections.remote = {
    transport: 'ssh',
    host: requiredConnectionField('string'),
    port: defaultConnectionField('number', 22),
    username: requiredConnectionField('string'),
    credentialSlot: 'sshCredential',
    hostKey: { policy: 'strict', expectedFingerprint: requiredConnectionField('string') },
  };
  contract.artifacts.certificate = artifactSlot(['certificatePem']);
  return {
    name: '通用 SSH Workflow',
    contract,
    effectiveBinding: effectiveBinding(bindings({
      connections: { remote: { host: '10.0.0.40', username: 'deploy', hostKey: { expectedFingerprint: 'SHA256:fixture' } } },
      credentials: { sshCredential: { credentialId: 'credential-ssh' } },
      artifacts: { certificate: { outputBindings: { certificatePem: 'certificatePem' } } },
    }), {
      'connections.remote.host': 'DEVICE',
      'connections.remote.username': 'DEVICE',
      'connections.remote.hostKey.expectedFingerprint': 'DEVICE',
      'credentials.sshCredential': 'DEVICE',
      'artifacts.certificate': 'APPLICATION_ASSET',
    }),
    credentialSnapshots: { sshCredential: { credentialId: 'credential-ssh', kind: 'SSH_KEY' } },
    artifactSnapshots: { certificate: artifactSnapshot(['certificatePem']) },
  };
}

function baseContract(): DeploymentInputContractV1 {
  return {
    apiVersion: 'gcac.deployment-input/v1',
    variables: {
      serverName: { type: 'string', required: true, configurationMode: 'runtime', source: { kind: 'asset', path: 'application.serverName' }, lifecycle: 'pre_execution', bindingPolicy: 'fixed' },
    },
    connections: {},
    credentials: {},
    artifacts: {},
  };
}

function requiredBindingVariable(): DeploymentInputContractV1['variables'][string] {
  return { type: 'string', required: true, configurationMode: 'required', source: { kind: 'binding' }, lifecycle: 'pre_execution', bindingPolicy: 'required_binding' };
}

function requiredConnectionField(type: 'string' | 'number' | 'boolean') {
  return { type, required: true, configurationMode: 'required' as const, source: { kind: 'binding' as const }, lifecycle: 'pre_execution' as const, bindingPolicy: 'required_binding' as const };
}

function defaultConnectionField(type: 'string' | 'number' | 'boolean', defaultValue: string | number | boolean) {
  return { type, required: true, configurationMode: 'advanced' as const, source: { kind: 'default' as const }, lifecycle: 'pre_execution' as const, bindingPolicy: 'default_overridable' as const, default: defaultValue };
}

function credentialSlot(allowedKinds: Array<'USERNAME_PASSWORD' | 'SSH_KEY' | 'BEARER_TOKEN'>) {
  return { allowedKinds, required: true, configurationMode: 'required' as const, lifecycle: 'pre_execution' as const };
}

function artifactSlot(outputs: string[]): DeploymentInputContractV1['artifacts'][string] {
  return {
    kind: 'certificate', required: true, configurationMode: 'required', lifecycle: 'pre_execution',
    artifactContract: { outputs: Object.fromEntries(outputs.map((output) => [output, { role: output, required: true, sensitive: output.toLowerCase().includes('private') }])) },
  };
}

function artifactSnapshot(outputs: string[]) {
  return { artifactId: 'artifact-certificate', outputs: Object.fromEntries(outputs.map((output) => [output, { ref: `memory://${output}` }])) };
}

function bindings(input: Partial<Omit<InputBindingsV1, 'apiVersion'>>): InputBindingsV1 {
  return { apiVersion: 'gcac.input-bindings/v1', variables: input.variables ?? {}, connections: input.connections ?? {}, credentials: input.credentials ?? {}, artifacts: input.artifacts ?? {} };
}

function effectiveBinding(inputBindings: InputBindingsV1, provenance: EffectiveInputBindingV1['provenance']): EffectiveInputBindingV1 {
  return { inputBindings, provenance };
}

function assetContextFixture(): DeploymentAssetContextV1 {
  return {
    apiVersion: 'gcac.deployment-asset-context/v1',
    application: { id: 'asset-1', address: '10.0.0.10', serverName: 'app.example.com', port: 443, protocol: 'HTTPS' },
    host: { id: 'host-1', primaryIp: '10.0.0.20', osType: 'LINUX' },
    site: { id: 'site-1', name: 'APP', bindingInformation: '*:443:app.example.com', hostHeader: 'app.example.com', port: 443, protocol: 'HTTPS', metadata: {} },
    target: { id: 'target-1', type: 'tls.binding', key: 'target-1', bindingKey: '*:443:app.example.com', metadata: {} },
    deployment: {
      targets: [{ id: 'target-1', name: 'APP', serverName: 'app.example.com', port: 443, sni: true, metadata: {} }],
      certificateResourceName: 'certificate-app-example-com-fixture',
    },
  };
}
