import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import test from 'node:test';
import { runMigrations } from '../../database/migration-runner.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { PluginBindingsApplicationService } from './application/plugin-bindings.application-service.js';
import { canonicalAgentPlanJson, UnifiedAgentPlanCompilerService } from './application/unified-agent-plan-compiler.service.js';
import { UnifiedPluginsApplicationService } from './application/unified-plugins.application-service.js';
import { builtinAgentPluginManifests } from './builtin-plugins/agent-recipes.js';
import { PluginBindingsRepository } from './repository/plugin-bindings.repository.js';
import { PgUnifiedPluginsRepository } from './repository/unified-plugins.repository.js';

test('统一 Agent PluginVersion 和 Binding 编译不可变原子计划', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, undefined, { appliedBy: 'test', checksum: (content) => createHash('sha256').update(content).digest('hex') });
  const tenantId = 'tenant-unified-agent-plan';
  const recipe = structuredClone(builtinAgentPluginManifests.find((item) => item.pluginId === 'builtin.linux.nginx.pem')!);
  recipe.variables.serviceName = { type: 'string', required: true, source: { kind: 'execution_context', path: 'service.name' } };
  recipe.artifactInputs.runtimeMaterial = { type: 'bundle', required: false };
  recipe.operations[0]!.input.runtimeMaterial = '${artifacts.runtimeMaterial}';
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
      certificatePath: '/etc/gcac-test/certs/test.crt', privateKeyPath: '/etc/gcac-test/certs/test.key',
      nginxProgram: '/usr/sbin/nginx',
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
      certificate: { outputs: { certificatePem: { artifactRef: 'memory://certificate/<certificate>&chain', sha256: 'aa', size: 10, sensitive: false } } },
      privateKey: { outputs: { privateKeyPem: { artifactRef: 'memory://privateKey/privateKeyPem', sha256: 'bb', size: 10, sensitive: true } } },
      runtimeMaterial: { contentBase64: 'cGZ4', password: 'secret' },
    },
    executionContext: { service: { name: 'nginx-target-service' } },
  });

  assert.equal(plan.apiVersion, 'gcac.agent-plan/v1');
  assert.equal(plan.plugin.pluginVersionId, imported.id);
  assert.equal(plan.agentId, 'agent-1');
  assert.ok(plan.operations.some((item) => item.operationType === 'file.atomic_replace'));
  assert.deepEqual(plan.operations[0]?.input.runtimeMaterial, { contentBase64: 'cGZ4', password: 'secret' });
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
    tenantId, agentId: 'agent-1', executionRunId: 'run-preflight', executionStepId: 'step-preflight', pluginBindingId: binding.id,
    executionMode: 'PREFLIGHT',
    artifacts: {
      certificate: { outputs: { certificatePem: { artifactRef: 'memory://certificate/<certificate>&chain', sha256: 'aa', size: 10, sensitive: false } } },
      privateKey: { outputs: { privateKeyPem: { artifactRef: 'memory://privateKey/privateKeyPem', sha256: 'bb', size: 10, sensitive: true } } },
    },
    executionContext: { service: { name: 'nginx-target-service' } },
  });
  assert.equal(preflightPlan.executionMode, 'PREFLIGHT');
  assert.equal(preflightPlan.operations.length, recipe.operations.length);
  assert.equal(preflightPlan.operations.some((item) => item.operationType === 'file.atomic_replace'), true);
  assert.equal(preflightPlan.operations.some((item) => item.operationType === 'service.control'), true);
});
