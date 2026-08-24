import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPluginCertificateArtifactBindings } from './artifacts/plugin-certificate-artifact-binding.js';
import { builtinAgentPluginManifests } from './builtin-plugins/agent-recipes.js';
import type { UnifiedPluginVersionRecord } from './dto/unified-plugins.dto.js';

test('根据 Workflow artifactContract 生成 Citrix 证书产物绑定', () => {
  const plugin = {
    id: 'plugin-version-citrix',
    runtime: 'WORKFLOW_DSL',
    manifest: {
      resources: { workflows: { 'certificate.deploy': 'workflows/certificate-deploy.json' } },
    },
    resources: {
      'workflows/certificate-deploy.json': JSON.stringify({
        variables: {
          certificate: {
            type: 'certificate',
            artifactContract: {
              outputs: {
                leafPem: { role: 'public_certificate', required: true },
                privateKeyPem: { role: 'private_key', required: true },
                orderedChainPem: { role: 'certificate_chain', required: false },
                fingerprintSha256: { role: 'fingerprint_sha256', required: true },
              },
            },
          },
        },
      }),
    },
  } as unknown as UnifiedPluginVersionRecord;

  assert.deepEqual(buildPluginCertificateArtifactBindings(plugin, 'certificate.deploy', 'certfmt-pem'), {
    certificate: {
      certificateFormatId: 'certfmt-pem',
      outputBindings: {
        leafPem: 'leafPem',
        privateKeyPem: 'privateKeyPem',
        orderedChainPem: 'orderedChainPem',
        fingerprintSha256: 'fingerprintSha256',
      },
    },
  });
});

test('根据 Agent Recipe artifactInputs 生成通用原子插件证书产物绑定', () => {
  const recipe = {
    apiVersion: 'gcac.agent-plugin/v1',
    kind: 'AgentDeploymentPlugin',
    pluginId: 'fixture.atomic.certificate',
    name: 'fixture-atomic-certificate',
    publisher: 'fixture',
    version: '1.0.0',
    compatibility: {
      platforms: ['LINUX'],
      requiredCapabilities: ['agent.atomic_plan.execute'],
    },
    variables: {},
    artifactInputs: {
      publicMaterial: { type: 'certificate', required: true },
      secretMaterial: { type: 'private_key', required: true },
      chainMaterial: { type: 'certificate_chain', required: false },
      packagedMaterial: { type: 'bundle', required: false },
      unrelatedFile: { type: 'file', required: false },
    },
    permissions: [],
    operations: [{
      id: 'fixture-preflight',
      name: 'fixture-preflight',
      stage: 'prepare',
      operationType: 'preflight.assert',
      schemaVersion: '1.0',
      input: {},
    }],
  };
  const plugin = {
    id: 'plugin-version-atomic',
    runtime: 'AGENT_ATOMIC',
    manifest: {
      resources: { agentRecipes: { 'certificate.deploy': 'agent-recipes/deploy.json' } },
    },
    resources: {
      'agent-recipes/deploy.json': JSON.stringify(recipe),
    },
  } as unknown as UnifiedPluginVersionRecord;

  assert.deepEqual(buildPluginCertificateArtifactBindings(plugin, 'certificate.deploy', 'certfmt-generic'), {
    publicMaterial: {
      certificateFormatId: 'certfmt-generic',
      outputBindings: { publicMaterial: 'leafPem' },
    },
    secretMaterial: {
      certificateFormatId: 'certfmt-generic',
      outputBindings: { secretMaterial: 'privateKeyPem' },
    },
  });
});

test('不同插件运行时只解析各自的能力资源', () => {
  const atomicPlugin = {
    id: 'plugin-version-atomic-missing',
    runtime: 'AGENT_ATOMIC',
    manifest: { resources: { workflows: { 'certificate.deploy': 'workflows/deploy.json' } } },
    resources: { 'workflows/deploy.json': '{}' },
  } as unknown as UnifiedPluginVersionRecord;
  assert.throws(
    () => buildPluginCertificateArtifactBindings(atomicPlugin, 'certificate.deploy', 'certfmt-generic'),
    (error: unknown) => error instanceof Error
      && 'details' in error
      && (error as { details?: { code?: string } }).details?.code === 'PLUGIN_AGENT_RECIPE_RESOURCE_MISSING',
  );

  const workflowPlugin = {
    id: 'plugin-version-workflow-missing',
    runtime: 'WORKFLOW_DSL',
    manifest: { resources: { agentRecipes: { 'certificate.deploy': 'agent-recipes/deploy.json' } } },
    resources: { 'agent-recipes/deploy.json': '{}' },
  } as unknown as UnifiedPluginVersionRecord;
  assert.throws(
    () => buildPluginCertificateArtifactBindings(workflowPlugin, 'certificate.deploy', 'certfmt-generic'),
    (error: unknown) => error instanceof Error
      && 'details' in error
      && (error as { details?: { code?: string } }).details?.code === 'PLUGIN_WORKFLOW_RESOURCE_MISSING',
  );
});

test('所有内置 Agent Atomic 证书插件都从必需 artifactInputs 生成绑定', () => {
  for (const recipe of builtinAgentPluginManifests) {
    const resourcePath = `agent-recipes/${recipe.pluginId}.json`;
    const plugin = {
      id: `plugin-version-${recipe.pluginId}`,
      runtime: 'AGENT_ATOMIC',
      manifest: {
        resources: { agentRecipes: { 'certificate.deploy': resourcePath } },
      },
      resources: { [resourcePath]: JSON.stringify(recipe) },
    } as unknown as UnifiedPluginVersionRecord;
    const expectedNames = Object.entries(recipe.artifactInputs)
      .filter(([, definition]) => definition.required === true && definition.type !== 'file')
      .map(([artifactName]) => artifactName)
      .sort();

    const bindings = buildPluginCertificateArtifactBindings(plugin, 'certificate.deploy', 'certfmt-builtin');

    assert.deepEqual(Object.keys(bindings).sort(), expectedNames, recipe.pluginId);
  }
});
