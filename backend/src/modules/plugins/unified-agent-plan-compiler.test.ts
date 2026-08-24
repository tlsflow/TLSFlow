import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { runMigrations } from '../../database/migration-runner.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { PluginBindingsApplicationService } from './application/plugin-bindings.application-service.js';
import { UnifiedAgentPlanCompilerService } from './application/unified-agent-plan-compiler.service.js';
import { UnifiedPluginsApplicationService } from './application/unified-plugins.application-service.js';
import { builtinAgentPluginManifests } from './builtin-plugins/agent-recipes.js';
import { PluginBindingsRepository } from './repository/plugin-bindings.repository.js';
import { PgUnifiedPluginsRepository } from './repository/unified-plugins.repository.js';

test('统一 Agent PluginVersion 和 Binding 编译不可变原子计划', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, undefined, { appliedBy: 'test', checksum: (content) => createHash('sha256').update(content).digest('hex') });
  const tenantId = 'tenant-unified-agent-plan';
  const recipe = builtinAgentPluginManifests.find((item) => item.pluginId === 'builtin.linux.nginx.pem')!;
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
  const bindings = new PluginBindingsApplicationService(new PluginBindingsRepository(db));
  const binding = await bindings.createBinding(tenantId, {
    pluginVersionId: imported.id,
    mode: 'MANAGED',
    variableBindings: {
      certificatePath: '/etc/nginx/tls/server.crt', privateKeyPath: '/etc/nginx/tls/server.key',
      serviceName: 'nginx', nginxProgram: '/usr/sbin/nginx', verifyHost: 'example.test', verifyPort: 443,
    },
    secretBindings: {},
    certificateArtifactBindings: {
      certificate: { certificateFormatId: 'format-pem', outputBindings: { certificatePem: 'certificatePem' } },
      privateKey: { certificateFormatId: 'format-pem', outputBindings: { privateKeyPem: 'privateKeyPem' } },
    },
    connectionBindings: {},
    managedContext: { hostId: 'host-agent', managedTargetId: 'target-1' },
  });
  const compiler = new UnifiedAgentPlanCompilerService(plugins, bindings);
  const plan = await compiler.compile({
    tenantId, agentId: 'agent-1', executionRunId: 'run-1', executionStepId: 'step-1', pluginBindingId: binding.id,
    artifacts: {
      certificate: { outputs: { certificatePem: { artifactRef: 'memory://certificate/certificatePem', sha256: 'aa', size: 10, sensitive: false } } },
      privateKey: { outputs: { privateKeyPem: { artifactRef: 'memory://privateKey/privateKeyPem', sha256: 'bb', size: 10, sensitive: true } } },
    },
  });

  assert.equal(plan.apiVersion, 'gcac.agent-plan/v1');
  assert.equal(plan.plugin.pluginVersionId, imported.id);
  assert.equal(plan.agentId, 'agent-1');
  assert.ok(plan.operations.some((item) => item.operationType === 'file.atomic_replace'));
  assert.ok(plan.rollback.length > 0);
  assert.equal(plan.authorization.keyId, 'agent-plan-v1');
  assert.ok(plan.authorization.signature.length > 32);
});
