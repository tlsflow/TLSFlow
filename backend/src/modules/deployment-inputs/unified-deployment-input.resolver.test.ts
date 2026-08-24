import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DeploymentInputContractV1 } from './dto/deployment-input-contract.dto.js';
import type { DeploymentAssetContextV1 } from './dto/deployment-asset-context.dto.js';
import { emptyInputBindingsV1, type InputBindingsV1 } from './dto/input-bindings.dto.js';
import type { ResolveDeploymentInputRequest } from './dto/resolved-deployment-input.dto.js';
import type { EffectiveInputBindingV1 } from './domain/deployment-input-provenance.js';
import { UnifiedDeploymentInputResolver } from './domain/unified-deployment-input.resolver.js';

describe('UnifiedDeploymentInputResolver', () => {
  const resolver = new UnifiedDeploymentInputResolver();

  it('按 Execution、Application、Target、Device、Source 顺序解析并记录 Provenance', () => {
    const request = requestFixture();
    request.effectiveBinding.inputBindings.variables = {
      requiredPath: '/device/path',
      serviceName: 'asset-service',
      sensitiveLabel: 'asset-sensitive',
    };
    request.effectiveBinding.provenance = {
      'variables.requiredPath': 'DEVICE',
      'variables.serviceName': 'APPLICATION_ASSET',
      'variables.sensitiveLabel': 'APPLICATION_ASSET',
      'credentials.managementCredential': 'DEVICE',
      'artifacts.certificate': 'APPLICATION_ASSET',
    };
    request.executionOverrides = bindings({ variables: { serviceName: 'execution-service' } });

    const resolved = resolver.resolve(request);

    assert.equal(resolved.variables.fixedServerName, 'app.example.com');
    assert.equal(resolved.variables.requiredPath, '/device/path');
    assert.equal(resolved.variables.serviceName, 'execution-service');
    assert.equal(resolved.variables.certificateResourceName, 'certificate-app-example-com-fixture');
    assert.equal(resolved.connections.management.host, '10.0.0.20');
    assert.equal(resolved.connections.management.port, 443);
    assert.equal(resolved.provenance['variables.requiredPath']?.bindingLayer, 'DEVICE');
    assert.equal(resolved.provenance['variables.serviceName']?.bindingLayer, 'EXECUTION');
    assert.equal(resolved.provenance['variables.fixedServerName']?.source, 'asset');
    assert.equal(resolved.executable, true);
  });

  it('从标准部署目标上下文自动派生单目标名称', () => {
    const request = requestFixture();
    request.contract.variables.deploymentTarget = variable(
      'string',
      'runtime',
      { kind: 'derived', resolver: 'deployment_target_name' },
      'fixed',
    );

    const resolved = resolver.resolve(request);

    assert.equal(resolved.variables.deploymentTarget, 'APP');
    assert.equal(resolved.provenance['variables.deploymentTarget']?.source, 'derived');
    assert.equal(resolved.executable, true);
  });

  it('兼容历史 DSM 的 deployment.target 路径并从 targets 首项自动填充', () => {
    const request = requestFixture();
    request.contract.variables.target = variable(
      'string',
      'runtime',
      { kind: 'asset', path: 'deployment.target' },
      'fixed',
    );

    const resolved = resolver.resolve(request);

    assert.equal(resolved.variables.target, 'APP');
    assert.equal(resolved.issues.some((item) => item.path === 'deployment.target'), false);
    assert.equal(resolved.executable, true);
  });

  it('fixed Source 被任何 Binding 覆盖时保留标准值并返回全部问题', () => {
    const request = requestFixture();
    request.effectiveBinding.inputBindings.variables = {
      fixedServerName: 'forbidden-binding-value',
      requiredPath: '/required',
      sensitiveLabel: 'secret-label',
    };
    request.effectiveBinding.provenance = {
      'variables.fixedServerName': 'APPLICATION_ASSET',
      'variables.requiredPath': 'MANAGED_TARGET',
      'variables.sensitiveLabel': 'MANAGED_TARGET',
      'credentials.managementCredential': 'DEVICE',
      'artifacts.certificate': 'APPLICATION_ASSET',
    };
    request.executionOverrides = bindings({ variables: { fixedServerName: 'forbidden-execution-value' } });

    const resolved = resolver.resolve(request);
    const fixedIssues = resolved.issues.filter((item) => item.code === 'DEPLOYMENT_INPUT_FIXED_OVERRIDE_FORBIDDEN');

    assert.equal(resolved.variables.fixedServerName, 'app.example.com');
    assert.deepEqual(fixedIssues.map((item) => item.bindingLayer), ['EXECUTION', 'APPLICATION_ASSET']);
    assert.equal(resolved.executable, false);
  });

  it('资产来源优先使用发现值，缺失时回退声明的默认值', () => {
    const request = requestFixture();
    request.contract.variables.certificatePath = {
      ...variable('file', 'advanced', { kind: 'asset', path: 'target.certificateLocation.certificatePath' }, 'default_overridable'),
      default: '/etc/nginx/tls/server.crt',
    };
    request.assetContext.target!.certificateLocation = {
      apiVersion: 'gcac.certificate-location/v1',
      storageKind: 'PEM_FILES',
      certificatePath: '/etc/gcac-test/certs/test.crt',
      confidence: 'EXACT',
      observedAt: '2026-08-01T00:00:00.000Z',
    };

    const discovered = resolver.resolve(request);
    assert.equal(discovered.variables.certificatePath, '/etc/gcac-test/certs/test.crt');
    assert.equal(discovered.provenance['variables.certificatePath']?.source, 'asset');

    delete request.assetContext.target!.certificateLocation;
    const fallback = resolver.resolve(request);
    assert.equal(fallback.variables.certificatePath, '/etc/nginx/tls/server.crt');
    assert.equal(fallback.provenance['variables.certificatePath']?.source, 'default');
  });

  it('聚合变量、连接、凭据和 Artifact 的全部缺失问题', () => {
    const request = requestFixture();
    request.contract.connections.management.host = {
      type: 'string',
      required: true,
      configurationMode: 'required',
      source: { kind: 'binding' },
      lifecycle: 'pre_execution',
      bindingPolicy: 'required_binding',
    };
    request.effectiveBinding = { inputBindings: emptyInputBindingsV1(), provenance: {} };
    request.credentialSnapshots = {};
    request.artifactSnapshots = {};

    const resolved = resolver.resolve(request);
    const codes = new Set(resolved.issues.map((item) => item.code));

    assert.equal(codes.has('DEPLOYMENT_INPUT_REQUIRED'), true);
    assert.equal(codes.has('DEPLOYMENT_CONNECTION_REQUIRED'), true);
    assert.equal(codes.has('DEPLOYMENT_CREDENTIAL_REQUIRED'), true);
    assert.equal(codes.has('DEPLOYMENT_ARTIFACT_REQUIRED'), true);
    assert.equal(resolved.issues.length >= 5, true);
    assert.equal(resolved.executable, false);
  });

  it('拒绝纯数字管理地址，避免历史表单值“1”进入执行快照', () => {
    const request = requestFixture();
    request.contract.connections.management.host = {
      ...request.contract.connections.management.host,
      source: { kind: 'binding' },
      bindingPolicy: 'required_binding',
    };
    request.effectiveBinding.inputBindings.connections.management = { host: '1' };
    request.effectiveBinding.provenance['connections.management.host'] = 'DEVICE';

    const resolved = resolver.resolve(request);

    assert.equal(resolved.executable, false);
    assert.equal(resolved.connections.management?.host, '1');
    assert.equal(resolved.issues.some((item) => item.code === 'DEPLOYMENT_INPUT_TYPE_INVALID' && item.path === 'connections.management.host'), true);
  });

  it('configure/preflight 延迟运行时值，execute 注入 system 和 step_output', () => {
    const configure = resolver.resolve({ ...requestFixture(), phase: 'configure' });
    const preflight = resolver.resolve({ ...requestFixture(), phase: 'preflight' });
    const execute = resolver.resolve({
      ...requestFixture(),
      phase: 'execute',
      systemValues: { execution: { token: 'system-token' } },
      stepOutputs: { upload: { result: { success: true } } },
    });

    assert.equal(configure.provenance['variables.systemToken']?.deferred, true);
    assert.equal(preflight.provenance['variables.stepResult']?.deferred, true);
    assert.equal(execute.variables.systemToken, 'system-token');
    assert.deepEqual(execute.variables.stepResult, { success: true });
    assert.equal(execute.executable, true);
  });

  it('敏感路径完整且 resolvedSha256 对对象键顺序稳定', () => {
    const firstRequest = requestFixture();
    firstRequest.effectiveBinding.inputBindings.variables = { requiredPath: '/required', sensitiveLabel: 'sensitive' };
    firstRequest.effectiveBinding.provenance = {
      'variables.requiredPath': 'DEVICE',
      'variables.sensitiveLabel': 'APPLICATION_ASSET',
      'credentials.managementCredential': 'DEVICE',
      'artifacts.certificate': 'APPLICATION_ASSET',
    };
    const secondRequest = requestFixture();
    secondRequest.effectiveBinding.inputBindings.variables = { sensitiveLabel: 'sensitive', requiredPath: '/required' };
    secondRequest.effectiveBinding.provenance = { ...firstRequest.effectiveBinding.provenance };

    const first = resolver.resolve(firstRequest);
    const second = resolver.resolve(secondRequest);

    assert.equal(first.resolvedSha256, second.resolvedSha256);
    assert.deepEqual(first.sensitivePaths, [
      'artifacts.certificate.outputs.privateKey',
      'credentials.managementCredential',
      'variables.sensitiveLabel',
    ]);
  });

  it('PEM 与 PFX 只按 Artifact Contract 校验必需输出，不判断厂商或 Framework', () => {
    const pemRequest = requestFixture();
    pemRequest.contract.artifacts.certificate.artifactContract.outputs = {
      leafPem: { role: 'public_certificate', required: true },
      chainPem: { role: 'certificate_chain', required: false },
      privateKeyPem: { role: 'private_key', required: true, sensitive: true },
    };
    pemRequest.artifactSnapshots = {
      certificate: { artifactId: 'pem-artifact', outputs: { leafPem: 'CERT', privateKeyPem: 'KEY' } },
    };
    const pem = resolver.resolve(pemRequest);
    assert.equal(pem.executable, true);
    assert.equal(pem.sensitivePaths.includes('artifacts.certificate.outputs.privateKeyPem'), true);

    const requiredChainRequest = structuredClone(pemRequest);
    requiredChainRequest.contract.artifacts.certificate.artifactContract.outputs.chainPem!.required = true;
    const missingChain = resolver.resolve(requiredChainRequest);
    assert.equal(missingChain.executable, false);
    assert.equal(missingChain.issues.some((item) => item.code === 'DEPLOYMENT_ARTIFACT_OUTPUT_REQUIRED' && item.path === 'artifacts.certificate.outputs.chainPem'), true);

    const pfxRequest = requestFixture();
    pfxRequest.contract.artifacts.certificate.artifactContract.outputs = {
      bundle: { role: 'pkcs12_bundle', required: true, sensitive: true },
      password: { role: 'password', required: true, sensitive: true },
    };
    pfxRequest.artifactSnapshots = {
      certificate: { artifactId: 'pfx-artifact', outputs: { bundle: 'PFX_BASE64', password: 'PFX_PASSWORD' } },
    };
    const pfx = resolver.resolve(pfxRequest);
    assert.equal(pfx.executable, true);
    assert.deepEqual(pfx.sensitivePaths.filter((path) => path.startsWith('artifacts.certificate.outputs.')), [
      'artifacts.certificate.outputs.bundle',
      'artifacts.certificate.outputs.password',
    ]);
  });

  it('Credential Snapshot 保留精确版本和 SecretRef，Issue 不包含敏感正文', () => {
    const request = requestFixture();
    request.credentialSnapshots = {
      managementCredential: {
        credentialId: 'credential-1',
        credentialVersionId: '7',
        kind: 'USERNAME_PASSWORD',
        username: 'admin',
        secretRefs: { password: 'secret://password/sec-1#v9' },
      },
    };
    const resolved = resolver.resolve(request);
    assert.equal(resolved.credentials.managementCredential?.credentialVersionId, '7');
    assert.equal(resolved.credentials.managementCredential?.secretRefs?.password, 'secret://password/sec-1#v9');
    assert.equal(JSON.stringify(resolved.issues).includes('secret://'), false);
  });
});

function requestFixture(): ResolveDeploymentInputRequest {
  const effectiveBinding: EffectiveInputBindingV1 = {
    inputBindings: bindings({
      variables: { requiredPath: '/required', sensitiveLabel: 'sensitive' },
      credentials: { managementCredential: { credentialId: 'credential-1' } },
      artifacts: { certificate: { certificateFormatId: 'format-1', outputBindings: { certificate: 'certificate', privateKey: 'privateKey' } } },
    }),
    provenance: {
      'variables.requiredPath': 'DEVICE',
      'variables.sensitiveLabel': 'APPLICATION_ASSET',
      'credentials.managementCredential': 'DEVICE',
      'artifacts.certificate': 'APPLICATION_ASSET',
    },
  };
  return {
    phase: 'preflight',
    contract: contractFixture(),
    assetContext: assetContextFixture(),
    effectiveBinding,
    credentialSnapshots: {
      managementCredential: { credentialId: 'credential-1', credentialVersionId: 'credential-version-1', kind: 'USERNAME_PASSWORD' },
    },
    artifactSnapshots: {
      certificate: { artifactId: 'artifact-1', outputs: { certificate: { ref: 'memory://certificate' }, privateKey: { ref: 'memory://private-key' } } },
    },
  };
}

function contractFixture(): DeploymentInputContractV1 {
  return {
    apiVersion: 'gcac.deployment-input/v1',
    variables: {
      fixedServerName: variable('string', 'runtime', { kind: 'asset', path: 'application.serverName' }, 'fixed'),
      serviceName: { ...variable('string', 'advanced', { kind: 'default' }, 'default_overridable'), default: 'default-service' },
      requiredPath: variable('string', 'required', { kind: 'binding' }, 'required_binding'),
      sensitiveLabel: { ...variable('string', 'required', { kind: 'binding' }, 'required_binding'), sensitive: true },
      certificateResourceName: variable('string', 'runtime', { kind: 'derived', resolver: 'certificate_resource_name' }, 'fixed'),
      systemToken: { ...variable('string', 'runtime', { kind: 'system', key: 'execution.token' }, 'fixed'), lifecycle: 'runtime_injected' },
      stepResult: { ...variable('object', 'runtime', { kind: 'step_output', step: 'upload', output: 'result' }, 'fixed'), lifecycle: 'step_output' },
    },
    connections: {
      management: {
        transport: 'http',
        host: connectionField('string', 'runtime', { kind: 'asset', path: 'host.primaryIp' }, 'fixed'),
        port: { ...connectionField('number', 'advanced', { kind: 'default' }, 'default_overridable'), default: 443 },
        credentialSlot: 'managementCredential',
        tls: { verifyPeer: { ...connectionField('boolean', 'advanced', { kind: 'default' }, 'default_overridable'), default: true } },
      },
    },
    credentials: {
      managementCredential: {
        allowedKinds: ['USERNAME_PASSWORD', 'BEARER_TOKEN'],
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
            certificate: { role: 'public_certificate', required: true },
            privateKey: { role: 'private_key', required: true, sensitive: true },
          },
        },
      },
    },
  };
}

function assetContextFixture(): DeploymentAssetContextV1 {
  return {
    apiVersion: 'gcac.deployment-asset-context/v1',
    application: { id: 'asset-1', address: '10.0.0.10', serverName: 'app.example.com', port: 443, protocol: 'HTTPS' },
    host: { id: 'host-1', primaryIp: '10.0.0.20', osType: 'LINUX' },
    target: { id: 'target-1', type: 'tls.binding', key: 'target-1', metadata: {} },
    deployment: {
      targets: [{ id: 'target-1', name: 'APP', serverName: 'app.example.com', port: 443, sni: true, metadata: {} }],
      certificateResourceName: 'certificate-app-example-com-fixture',
    },
  };
}

function variable(
  type: DeploymentInputContractV1['variables'][string]['type'],
  configurationMode: DeploymentInputContractV1['variables'][string]['configurationMode'],
  source: DeploymentInputContractV1['variables'][string]['source'],
  bindingPolicy: DeploymentInputContractV1['variables'][string]['bindingPolicy'],
): DeploymentInputContractV1['variables'][string] {
  return { type, required: true, configurationMode, source, lifecycle: 'pre_execution', bindingPolicy };
}

function connectionField(
  type: 'string' | 'number' | 'boolean',
  configurationMode: 'required' | 'advanced' | 'runtime',
  source: Exclude<DeploymentInputContractV1['variables'][string]['source'], { kind: 'step_output' }>,
  bindingPolicy: 'fixed' | 'default_overridable' | 'required_binding',
) {
  return { type, required: true, configurationMode, source, lifecycle: 'pre_execution' as const, bindingPolicy };
}

function bindings(input: Partial<Omit<InputBindingsV1, 'apiVersion'>>): InputBindingsV1 {
  return {
    apiVersion: 'gcac.input-bindings/v1',
    variables: input.variables ?? {},
    connections: input.connections ?? {},
    credentials: input.credentials ?? {},
    artifacts: input.artifacts ?? {},
  };
}
