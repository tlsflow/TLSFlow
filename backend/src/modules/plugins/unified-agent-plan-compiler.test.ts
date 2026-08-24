import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import test from 'node:test';
import { runMigrations } from '../../database/migration-runner.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { ProductionDeploymentInputResolverService } from '../deployment-inputs/application/production-deployment-input-resolver.service.js';
import type { DeploymentAssetContextV1 } from '../deployment-inputs/dto/deployment-asset-context.dto.js';
import { emptyInputBindingsV1, type InputBindingsV1 } from '../deployment-inputs/dto/input-bindings.dto.js';
import type { ResolvedArtifactV1, ResolvedDeploymentInputV1 } from '../deployment-inputs/dto/resolved-deployment-input.dto.js';
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

test('IIS 与 NGINX 仅通过统一 Contract、Asset Context 和 Binding 编译 Agent 计划', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, undefined, { appliedBy: 'test', checksum: (content) => createHash('sha256').update(content).digest('hex') });
  const plugins = new UnifiedPluginsApplicationService(new PgUnifiedPluginsRepository(database));
  const compiler = new UnifiedAgentPlanCompilerService(plugins);
  const resolver = new ProductionDeploymentInputResolverService();

  for (const fixture of agentContractFixtures()) {
    const recipe = builtinAgentPluginManifests.find((item) => item.pluginId === fixture.pluginId)!;
    const imported = await importAgentRecipe(plugins, fixture.tenantId, recipe);
    const resolvedInput = resolver.resolve({
      phase: 'preflight',
      contract: recipe.inputContract,
      assetContext: fixture.assetContext,
      bindingLayers: {
        deviceDefault: { pluginVersionId: recipe.version, inputBindings: emptyInputBindingsV1() },
        assetOverride: { pluginVersionId: recipe.version, inputBindings: fixture.assetBinding },
      },
      artifactSnapshots: fixture.artifactSnapshots,
    });
    const plan = await compiler.compile({
      tenantId: fixture.tenantId,
      agentId: fixture.agentId,
      executionRunId: `${fixture.pluginId}-run`,
      executionStepId: `${fixture.pluginId}-step`,
      pluginVersionId: imported.id,
      pluginBindingId: `${fixture.pluginId}-binding`,
      resolvedInput,
      executionMode: 'PREFLIGHT',
    });

    assert.equal(resolvedInput.executable, true);
    assert.equal(resolvedInput.contractVersion, 'gcac.deployment-input/v1');
    assert.equal(plan.executionMode, 'PREFLIGHT');
    fixture.assertPlan(plan);
  }
});

async function importAgentRecipe(
  plugins: UnifiedPluginsApplicationService,
  tenantId: string,
  recipe: (typeof builtinAgentPluginManifests)[number],
) {
  const resourcePath = `agent-recipes/${recipe.pluginId}.json`;
  const imported = await plugins.importVersion(tenantId, {
    manifest: {
      apiVersion: 'gcac.plugin-manifest/v1', kind: 'GcacPlugin', pluginId: recipe.pluginId, version: recipe.version,
      displayNameKey: `plugin.${recipe.pluginId}.name`, publisher: recipe.publisher, runtime: 'AGENT_ATOMIC', source: 'BUILTIN',
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
  return imported;
}

function agentContractFixtures(): Array<{
  pluginId: string;
  tenantId: string;
  agentId: string;
  assetContext: DeploymentAssetContextV1;
  assetBinding: InputBindingsV1;
  artifactSnapshots: Record<string, ResolvedArtifactV1>;
  assertPlan: (plan: Awaited<ReturnType<UnifiedAgentPlanCompilerService['compile']>>) => void;
}> {
  const nginxBinding = emptyInputBindingsV1();
  nginxBinding.artifacts = {
    certificate: { outputBindings: { certificate: 'certificatePem' } },
    privateKey: { outputBindings: { privateKey: 'privateKeyPem' } },
  };
  const iisBinding = emptyInputBindingsV1();
  iisBinding.artifacts = { certificate: { outputBindings: { certificate: 'pfx' } } };
  const nginxArtifacts: Record<string, ResolvedArtifactV1> = {
    certificate: { outputs: { certificate: { artifactRef: 'memory://nginx/certificate.pem' } } },
    privateKey: { outputs: { privateKey: { artifactRef: 'memory://nginx/private-key.pem' } } },
  };
  const iisArtifacts: Record<string, ResolvedArtifactV1> = {
    certificate: { outputs: { certificate: { artifactRef: 'memory://iis/certificate.pfx' } } },
  };
  return [
    {
      pluginId: 'builtin.linux.nginx.pem', tenantId: 'tenant-nginx-unified-contract', agentId: 'agent-nginx',
      assetContext: assetContext('LINUX'), assetBinding: nginxBinding,
      artifactSnapshots: nginxArtifacts,
      assertPlan: (plan: Awaited<ReturnType<UnifiedAgentPlanCompilerService['compile']>>) => {
        assert.equal(plan.operations.find((item) => item.id === 'nginx-cert-install')?.input.path, '/etc/nginx/tls/server.crt');
        assert.deepEqual(plan.operations.find((item) => item.id === 'nginx-key-install')?.input.artifact, { artifactRef: 'memory://nginx/private-key.pem' });
      },
    },
    {
      pluginId: 'builtin.windows.iis.pfx', tenantId: 'tenant-iis-unified-contract', agentId: 'agent-iis',
      assetContext: assetContext('WINDOWS'), assetBinding: iisBinding,
      artifactSnapshots: iisArtifacts,
      assertPlan: (plan: Awaited<ReturnType<UnifiedAgentPlanCompilerService['compile']>>) => {
        assert.equal(plan.operations.find((item) => item.id === 'iis-binding-capture')?.input.siteName, 'GCAC Site');
        assert.deepEqual(plan.operations.find((item) => item.id === 'iis-binding-update')?.input.bindingSelector, { bindingInformation: '*:443:gcac.example.com' });
        assert.deepEqual(plan.operations.find((item) => item.id === 'iis-pfx-import')?.input.artifact, { artifactRef: 'memory://iis/certificate.pfx' });
      },
    },
  ];
}

function assetContext(osType: string): DeploymentAssetContextV1 {
  return {
    apiVersion: 'gcac.deployment-asset-context/v1',
    application: { id: `asset-${osType}`, address: 'gcac.example.com', serverName: 'gcac.example.com', port: 443, protocol: 'HTTPS' },
    host: { id: `host-${osType}`, hostname: 'gcac-host', primaryIp: '192.0.2.20', osType },
    site: { id: 'site-gcac', type: 'web.site', name: 'GCAC Site', bindingInformation: '*:443:gcac.example.com', metadata: {} },
    target: { id: 'target-gcac', type: 'tls.binding', key: 'gcac-target', bindingKey: '*:443:gcac.example.com', metadata: {} },
    deployment: { targets: [{ id: 'target-gcac', name: 'GCAC Site', serverName: 'gcac.example.com', port: 443, sni: true, metadata: {} }], certificateResourceName: 'gcac-example-com' },
  };
}

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
