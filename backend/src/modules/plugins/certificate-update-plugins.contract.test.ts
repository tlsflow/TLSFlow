import assert from 'node:assert/strict';
import test from 'node:test';
import { BuiltinPluginRegistry } from './builtin-plugins/builtin-plugin-registry.js';
import { BuiltinUnifiedPluginLoader, type BuiltinPluginPackage } from './builtin-plugins/builtin-unified-plugin-loader.js';
import { validateBuiltinPluginPolicy } from './builtin-plugins/builtin-plugin-policy.js';
import type { UnifiedPluginManifestV1 } from './dto/unified-plugins.dto.js';
import { allowedAgentOperationTypes } from '../agents/security/agent-security.contract.js';
import { validateCertificateUpdateInputContract, type CertificateUpdateInputContractV1 } from '../deployment-inputs/certificate-update/certificate-update.contract.js';

const certificatePluginProfiles = {
  'web.nginx.linux': { frameworkType: 'web.nginx', platform: 'linux', productFamily: 'LINUX_SERVER', artifactKind: 'PEM_FILES' },
  'web.nginx.windows': { frameworkType: 'web.nginx', platform: 'windows', productFamily: 'WINDOWS_SERVER', artifactKind: 'PEM_FILES' },
  'web.apache.linux': { frameworkType: 'web.apache', platform: 'linux', productFamily: 'LINUX_SERVER', artifactKind: 'PEM_FILES' },
  'web.apache.windows': { frameworkType: 'web.apache', platform: 'windows', productFamily: 'WINDOWS_SERVER', artifactKind: 'PEM_FILES' },
  'app.tomcat.linux': { frameworkType: 'app.tomcat', platform: 'linux', productFamily: 'LINUX_SERVER', artifactKind: 'KEYSTORE' },
  'app.tomcat.windows': { frameworkType: 'app.tomcat', platform: 'windows', productFamily: 'WINDOWS_SERVER', artifactKind: 'KEYSTORE' },
} as const;

const capabilities = ['certificate.deploy', 'certificate.verify', 'certificate.rollback'] as const;
const requiredResourceKinds = ['inputContracts', 'workflows', 'agentPlans'] as const;
const workflowStages = ['prepare', 'backup', 'install', 'refresh', 'verify'] as const;
type CertificatePluginProfile = Pick<CertificateUpdateInputContractV1, 'frameworkType' | 'platform' | 'artifactKind'> & { productFamily: 'LINUX_SERVER' | 'WINDOWS_SERVER' };

test('六个证书更新包的 Manifest、Registry 和双资源合同彼此独立', async () => {
  const loader = new BuiltinUnifiedPluginLoader();
  const packages = await loader.loadPackages();
  const certificatePackages = packages.filter((item) => item.manifest && typeof item.manifest === 'object'
    && Object.hasOwn(certificatePluginProfiles, (item.manifest as { pluginId?: string }).pluginId ?? ''));
  assert.equal(certificatePackages.length, Object.keys(certificatePluginProfiles).length);

  for (const [pluginId, profile] of Object.entries(certificatePluginProfiles)) {
    const pluginPackage = certificatePackages.find((item) => (item.manifest as { pluginId?: string }).pluginId === pluginId);
    assert.ok(pluginPackage, `${pluginId} 缺少独立包`);
    assertCertificatePackage(pluginPackage, pluginId, profile);
  }

  const entries = await new BuiltinPluginRegistry(loader).refresh();
  for (const pluginId of Object.keys(certificatePluginProfiles)) {
    const entry = entries.find((item) => item.pluginId === pluginId);
    assert.ok(entry, `${pluginId} 未进入 Registry`);
    assert.equal(entry.executionMode, 'AGENT_PLAN');
    assert.equal(entry.runtimeEntrypoint, undefined);
    assert.equal(entry.resourceHash.startsWith('sha256:'), true);
    assert.ok(Object.keys(entry.resourceSha256).length >= 10);
  }
  assert.equal(entries.some((item) => item.pluginId === 'web.nginx'), false, '独立 web.nginx 包必须移除');
  assert.equal(entries.some((item) => ['web.apache', 'app.tomcat'].includes(item.pluginId)), false);
});

test('证书更新包拒绝 Runner、发现能力和跨包资源引用', async () => {
  const packages = await new BuiltinUnifiedPluginLoader().loadPackages();
  const pluginPackage = packages.find((item) => (item.manifest as { pluginId?: string }).pluginId === 'web.apache.linux');
  assert.ok(pluginPackage);
  const manifest = structuredClone(pluginPackage.manifest) as UnifiedPluginManifestV1;
  manifest.resources.runtimeEntrypoint = 'runtime/index.js';
  assert.throws(() => validateBuiltinPluginPolicy(manifest), /不得声明 Runner 入口/);

  const discoveryManifest = structuredClone(pluginPackage.manifest) as UnifiedPluginManifestV1;
  discoveryManifest.capabilities.push({
    key: 'application.discover',
    contractVersion: 'v1',
    actionContractId: 'application.discover.v1',
    riskLevel: 'LOW',
    executionLocations: ['AGENT'],
  });
  assert.throws(() => validateBuiltinPluginPolicy(discoveryManifest), /不得声明发现或 plugin.action 能力/);

  const certificateDiscoveryManifest = structuredClone(pluginPackage.manifest) as UnifiedPluginManifestV1;
  certificateDiscoveryManifest.capabilities.push({
    key: 'certificate.discover',
    contractVersion: 'v1',
    actionContractId: 'certificate.discover.v1',
    riskLevel: 'LOW',
    executionLocations: ['AGENT'],
  });
  assert.throws(() => validateBuiltinPluginPolicy(certificateDiscoveryManifest), /不得声明发现或 plugin.action 能力/);

  const currentPluginId = (pluginPackage.manifest as { pluginId?: string }).pluginId;
  for (const [resourcePath, content] of Object.entries(pluginPackage.resources)) {
    for (const otherPluginId of Object.keys(certificatePluginProfiles).filter((id) => id !== currentPluginId)) {
      assert.equal(content.includes(otherPluginId), false, `${resourcePath} 引用了 ${otherPluginId}`);
    }
  }
});

function assertCertificatePackage(
  pluginPackage: BuiltinPluginPackage,
  pluginId: string,
  profile: CertificatePluginProfile,
): void {
  const manifest = pluginPackage.manifest as Record<string, unknown>;
  assert.equal(manifest.pluginId, pluginId);
  assert.equal(manifest.version, pluginId === 'web.nginx.linux' ? '1.0.4' : pluginId === 'web.nginx.windows' ? '1.0.5' : pluginId.endsWith('.windows') ? '1.0.3' : '1.0.2');
  assert.deepEqual((manifest.compatibility as { productFamilies?: string[] }).productFamilies, [profile.productFamily]);
  assert.equal(manifest.runtime, 'WORKFLOW_DSL');
  assert.equal(manifest.source, 'BUILTIN');
  assert.equal(manifest.trust, 'OFFICIAL_SIGNED');
  assert.equal(manifest.support, 'OFFICIAL');
  assert.equal(manifest.resources && typeof manifest.resources === 'object'
    ? Object.hasOwn(manifest.resources, 'runtimeEntrypoint') : false, false);
  const normalizedResources = manifest.resources as Record<string, unknown>;
  assert.deepEqual(normalizedResources.discoveryMappings ?? {}, {});
  assert.deepEqual(normalizedResources.agentDiscoveryMappings ?? {}, {});

  const manifestCapabilities = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];
  assert.deepEqual(manifestCapabilities.map((item) => (item as { key?: string }).key).sort(), [...capabilities].sort());
  for (const capability of manifestCapabilities) {
    assert.deepEqual((capability as { executionLocations?: string[] }).executionLocations, ['AGENT']);
  }
  const resources = manifest.resources as Record<string, Record<string, string>>;
  for (const resourceKind of requiredResourceKinds) assert.deepEqual(Object.keys(resources[resourceKind] ?? {}).sort(), [...capabilities].sort());
  assert.ok(Object.keys(resources.locales ?? {}).length >= 1);
  assert.ok(Object.keys(resources.presentations ?? {}).length >= 2);
  for (const capability of capabilities) {
    const contractPath = resources.inputContracts[capability];
    const contract = parseResource(pluginPackage.resources, contractPath);
    const validated = validateCertificateUpdateInputContract(contract);
    assert.equal(validated.pluginId, pluginId);
    assert.equal(validated.frameworkType, profile.frameworkType);
    assert.equal(validated.platform, profile.platform);
    assert.equal(validated.artifactKind, profile.artifactKind);
    assert.deepEqual(validated.requiredFacts, ['frameworkType', 'site', 'tls.binding', 'certificateLocation', 'configFingerprint', 'serviceName', 'programPath']);

    const plan = parseResource(pluginPackage.resources, resources.agentPlans[capability]) as Record<string, unknown>;
    assert.equal(plan.apiVersion, 'gcac.certificate-update-plan/v1');
    assert.equal(plan.pluginId, pluginId);
    assert.equal(plan.capability, capability);
    assert.equal(plan.writeEffect, capability !== 'certificate.verify');
    assert.ok(Array.isArray(plan.operations) && plan.operations.length > 0);
    for (const operation of plan.operations as Array<Record<string, unknown>>) {
      assert.equal(allowedAgentOperationTypes.includes(operation.operationType as never), true);
      assert.ok(['prepare', 'execute', 'verify', 'compensate'].includes(String(operation.stage)));
      assert.doesNotMatch(JSON.stringify(operation), /(?:shell|powershell|cmd|script|download|invoke-expression)/i);
    }

    const workflow = parseResource(pluginPackage.resources, resources.workflows[capability]) as Record<string, unknown>;
    assert.equal(workflow.apiVersion, 'gcac.workflow/v1');
    const steps = Array.isArray(workflow.steps) ? workflow.steps as Array<Record<string, unknown>> : [];
    if (capability === 'certificate.deploy') {
      assert.deepEqual(steps.map((step) => step.stage), workflowStages);
      const rollback = Array.isArray(workflow.rollback) ? workflow.rollback as Array<Record<string, unknown>> : [];
      assert.equal(rollback.some((step) => step.name === 'backupLedger' || step.type === 'checkpoint'), false);
      if (profile.artifactKind === 'KEYSTORE') {
        const workflowContract = workflow.inputContract as Record<string, unknown>;
        const artifacts = workflowContract.artifacts as Record<string, Record<string, unknown>>;
        const certificateArtifact = artifacts.certificateArtifact;
        const artifactContract = certificateArtifact.artifactContract as Record<string, unknown>;
        const outputs = artifactContract.outputs as Record<string, Record<string, unknown>>;
        assert.ok(outputs.pfxBase64 && outputs.jksBase64, `${pluginId} Workflow 必须同时声明 PKCS12/JKS 输出`);
        assert.equal(outputs.pfxBase64.required, false);
        assert.equal(outputs.jksBase64.required, false);
        assert.equal(Object.keys(outputs).some((name) => /password/i.test(name)), false, `${pluginId} 不得从 Artifact 输出 KeyStore 密码`);
        assert.equal(Object.values(outputs).some((output) => output.role === 'keystore_password'), false, `${pluginId} 不得声明 keystore_password 输出`);
      }
    } else {
      assert.ok(steps.length > 0);
    }
  }

  const deployPlan = parseResource(pluginPackage.resources, resources.agentPlans['certificate.deploy']) as Record<string, unknown>;
  const operationTypes = (deployPlan.operations as Array<Record<string, unknown>>).map((operation) => operation.operationType);
  const supportsLinuxReload = profile.platform === 'linux' && profile.frameworkType !== 'app.tomcat';
  const supportsWindowsNginxReload = profile.platform === 'windows' && profile.frameworkType === 'web.nginx';
  const supportsRestart = profile.platform === 'windows';
  if (supportsLinuxReload) {
    assert.equal(operationTypes.includes('service.reload'), true);
    assert.equal(operationTypes.includes('service.stop'), false);
    assert.equal(operationTypes.includes('service.start'), false);
  } else if (supportsWindowsNginxReload) {
    assert.equal(operationTypes.includes('service.reload'), false);
    assert.equal(operationTypes.includes('service.stop'), false);
    assert.equal(operationTypes.includes('service.start'), false);
    assert.equal(operationTypes.includes('service.restart'), false);
    assert.equal((deployPlan.operations as Array<Record<string, unknown>>).some((operation) => operation.operationId === 'reload-service' && operation.operationType === 'command.execute_allowlisted'), true);
  } else if (supportsRestart) {
    assert.equal(operationTypes.includes('service.restart'), true);
    assert.equal(operationTypes.includes('service.stop'), false);
    assert.equal(operationTypes.includes('service.start'), false);
    assert.equal(operationTypes.includes('service.reload'), false);
  } else {
    assert.equal(operationTypes.includes('service.restart'), false);
    assert.equal(operationTypes.includes('service.stop'), true);
    assert.equal(operationTypes.includes('service.start'), true);
    assert.equal(operationTypes.includes('service.reload'), false);
  }
  const storageKinds = (deployPlan.operations as Array<Record<string, unknown>>)
    .map((operation) => (operation.input as Record<string, unknown> | undefined)?.storageKind)
    .filter((value) => value !== undefined);
  assert.ok(storageKinds.every((value) => value === profile.artifactKind));
  if (profile.artifactKind === 'KEYSTORE') {
    assert.equal((deployPlan.operations as Array<Record<string, unknown>>).filter((operation) => operation.expandPathRef === 'paths').length >= 3, true);
    assert.equal(JSON.stringify(deployPlan).includes('secretRefs.0'), true);
  } else {
    assert.equal((deployPlan.operations as Array<Record<string, unknown>>).some((operation) => operation.expandPathRef === 'paths'), true);
  }

  for (const path of Object.values(resources.locales ?? {}).concat(Object.values(resources.presentations ?? {}))) {
    assert.ok(typeof pluginPackage.resources[path] === 'string' && pluginPackage.resources[path].trim() !== '');
    parseResource(pluginPackage.resources, path);
  }
}

function parseResource(resources: Record<string, string>, path: string): unknown {
  assert.ok(path, 'Manifest 资源路径不能为空');
  const content = resources[path];
  assert.ok(content !== undefined, `资源缺失：${path}`);
  return JSON.parse(content);
}
