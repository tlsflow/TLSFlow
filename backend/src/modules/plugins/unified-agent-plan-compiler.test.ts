import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import test from 'node:test';
import { runMigrations } from '../../database/migration-runner.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import type { ResolvedDeploymentInputV1 } from '../deployment-inputs/dto/resolved-deployment-input.dto.js';
import { canonicalAgentPlanJson, UnifiedAgentPlanCompilerService } from './application/unified-agent-plan-compiler.service.js';
import { UnifiedPluginsApplicationService } from './application/unified-plugins.application-service.js';
import { builtinAgentPluginManifests } from './builtin-plugins/agent-recipes.js';
import { PgUnifiedPluginsRepository } from './repository/unified-plugins.repository.js';

test('统一 Agent PluginVersion 和 Binding 编译不可变原子计划', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, undefined, { appliedBy: 'test', checksum: (content) => createHash('sha256').update(content).digest('hex') });
  const tenantId = 'tenant-unified-agent-plan';
  const recipe = structuredClone(builtinAgentPluginManifests.find((item) => item.pluginId === 'builtin.linux.nginx.pem')!);
  recipe.inputContract.artifacts.runtimeMaterial = {
    kind: 'file', required: false, configurationMode: 'advanced', lifecycle: 'pre_execution',
    artifactContract: { outputs: { bundle: { role: 'runtime_bundle', required: false, sensitive: true } } },
  };
  recipe.inputContract.connections.management = {
    transport: 'http',
    host: { type: 'string', required: true, configurationMode: 'required', source: { kind: 'binding' }, lifecycle: 'pre_execution', bindingPolicy: 'required_binding' },
    port: { type: 'number', required: true, configurationMode: 'advanced', source: { kind: 'default' }, lifecycle: 'pre_execution', bindingPolicy: 'default_overridable', default: 443 },
    credentialSlot: 'management',
    tls: { verifyPeer: { type: 'boolean', required: true, configurationMode: 'advanced', source: { kind: 'default' }, lifecycle: 'pre_execution', bindingPolicy: 'default_overridable', default: true } },
  };
  recipe.inputContract.credentials.management = { allowedKinds: ['USERNAME_PASSWORD'], required: true, configurationMode: 'required', lifecycle: 'pre_execution' };
  recipe.operations[0]!.input.runtimeMaterial = '${artifacts.runtimeMaterial}';
  recipe.operations[0]!.input.managementHost = '${connections.management.host}';
  recipe.operations[0]!.input.credentialId = '${credentials.management.credentialId}';
  const resourcePath = 'agent-recipes/nginx.json';
  const plugins = new UnifiedPluginsApplicationService(new PgUnifiedPluginsRepository(db));
  const imported = await plugins.importVersion(tenantId, {
    manifest: {
      apiVersion: 'gcac.plugin-manifest/v1', kind: 'GcacPlugin', pluginId: recipe.pluginId, version: '2.0.0',
      displayNameKey: 'plugin.builtin.nginx.name', publisher: 'GCAC', runtime: 'AGENT_ATOMIC', source: 'BUILTIN',
      scope: 'MANAGED', trust: 'OFFICIAL_SIGNED', support: 'OFFICIAL', minGcacVersion: recipe.minGcacVersion,
      capabilities: [
        { key: 'certificate.deploy', contractVersion: 'v1', actionContractId: 'certificate.deploy.v1', riskLevel: 'HIGH', executionLocations: ['AGENT'] },
        { key: 'certificate.rollback', contractVersion: 'v1', actionContractId: 'certificate.rollback.v1', riskLevel: 'HIGH', executionLocations: ['AGENT'] },
      ],
      permissions: recipe.permissions.map((item) => item.name),
      resources: { agentRecipes: { 'certificate.deploy': resourcePath, 'certificate.rollback': resourcePath } },
    },
    resources: { [resourcePath]: JSON.stringify(recipe) },
  }, 'BUILTIN');
  await plugins.approvePermissions(imported.id, imported.manifest.permissions);
  await plugins.enableVersion(imported.id);
  const compiler = new UnifiedAgentPlanCompilerService(plugins);
  const resolvedInput = resolvedAgentInput();
  const plan = await compiler.compile({
    tenantId, agentId: 'agent-1', executionRunId: 'run-1', executionStepId: 'step-1',
    pluginVersionId: imported.id, pluginBindingId: 'binding-snapshot-1', resolvedInput,
  });

  assert.equal(plan.apiVersion, 'gcac.agent-plan/v1');
  assert.equal(plan.plugin.pluginVersionId, imported.id);
  assert.equal(plan.agentId, 'agent-1');
  assert.ok(plan.operations.some((item) => item.operationType === 'file.atomic_replace'));
  assert.deepEqual(plan.operations[0]?.input.runtimeMaterial, { contentBase64: 'cGZ4', password: 'secret' });
  assert.equal(plan.operations[0]?.input.managementHost, '192.0.2.20');
  assert.equal(plan.operations[0]?.input.credentialId, 'cred-management');
  assert.equal(plan.operations.find((item) => item.operationType === 'service.control')?.input.serviceName, 'nginx-target-service');
  const filesystemPermissions = plan.permissions.filter((item) => item.scope === 'filesystem').flatMap((item) => item.values);
  assert.equal(filesystemPermissions.includes('/etc/gcac-test/certs/test.crt'), true);
  assert.equal(filesystemPermissions.includes('/etc/gcac-test/certs/test.key'), true);
  assert.ok(plan.rollback.length > 0);
  assert.equal(plan.authorization.keyId, 'agent-plan-v1');
  assert.ok(plan.authorization.signature.length > 32);
  const transported = JSON.parse(JSON.stringify(plan)) as typeof plan;
  const { authorization: _, ...unsigned } = transported;
  const expectedSignature = createHmac('sha256', 'gcac-development-agent-plan-key')
    .update(canonicalAgentPlanJson(unsigned))
    .digest('hex');
  assert.equal(transported.authorization.signature, expectedSignature);

  const preflightPlan = await compiler.compile({
    tenantId, agentId: 'agent-1', executionRunId: 'run-preflight', executionStepId: 'step-preflight',
    pluginVersionId: imported.id, pluginBindingId: 'binding-snapshot-1', resolvedInput,
    executionMode: 'PREFLIGHT',
  });
  assert.equal(preflightPlan.executionMode, 'PREFLIGHT');
  assert.equal(preflightPlan.operations.length, recipe.operations.length);
  assert.equal(preflightPlan.operations.some((item) => item.operationType === 'file.atomic_replace'), true);
  assert.equal(preflightPlan.operations.some((item) => item.operationType === 'service.control'), true);
});

function resolvedAgentInput(): ResolvedDeploymentInputV1 {
  return {
    apiVersion: 'gcac.resolved-deployment-input/v1',
    contractVersion: 'gcac.deployment-input/v1',
    assetContext: {
      apiVersion: 'gcac.deployment-asset-context/v1',
      application: { id: 'asset-1', address: 'nginx.example.com', serverName: 'nginx.example.com', port: 443, protocol: 'https' },
      host: { id: 'host-agent', hostname: 'nginx-host', primaryIp: '192.0.2.10', osType: 'LINUX' },
      target: { id: 'target-1', type: 'SERVICE', key: 'nginx', metadata: {} },
      deployment: { targets: [{ id: 'target-1', name: 'nginx', serverName: 'nginx.example.com', port: 443, metadata: {} }], certificateResourceName: 'nginx.example.com' },
    },
    variables: {
      certificatePath: '/etc/gcac-test/certs/test.crt',
      privateKeyPath: '/etc/gcac-test/certs/test.key',
      nginxProgram: '/usr/sbin/nginx',
      serviceName: 'nginx-target-service',
    },
    connections: { management: { transport: 'http', host: '192.0.2.20', port: 443, credentialSlot: 'management' } },
    credentials: { management: { credentialId: 'cred-management', credentialVersionId: 'credv-1' } },
    artifacts: {
      certificate: { outputs: { certificatePem: { artifactRef: 'memory://certificate/<certificate>&chain', sha256: 'aa', size: 10, sensitive: false } } },
      privateKey: { outputs: { privateKeyPem: { artifactRef: 'memory://privateKey/privateKeyPem', sha256: 'bb', size: 10, sensitive: true } } },
      runtimeMaterial: { outputs: { bundle: { contentBase64: 'cGZ4', password: 'secret' } } },
    },
    provenance: {
      'variables.certificatePath': { source: 'binding', bindingLayer: 'APPLICATION_ASSET' },
      'variables.privateKeyPath': { source: 'binding', bindingLayer: 'APPLICATION_ASSET' },
      'variables.nginxProgram': { source: 'binding', bindingLayer: 'DEVICE' },
      'variables.serviceName': { source: 'asset', sourcePath: 'target.key' },
    },
    sensitivePaths: ['artifacts.privateKey.outputs.privateKeyPem', 'artifacts.runtimeMaterial.outputs.bundle.password'],
    issues: [],
    executable: true,
    resolvedSha256: 'sha256:resolved-agent-input',
  };
}
