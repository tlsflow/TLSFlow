import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { StructuredLogger, type LogEvent } from './common/logging/structured-logger.js';
import { AppError } from './common/errors/app-error.js';
import {
  buildPluginRefreshChanges,
  discoveredTargetFingerprint,
  initializeBuiltinPlugins,
  mapDiscoveredSiteToOnboardingTarget,
  selectPreferredAdcsAgents,
} from './app.module.js';
import type { PluginRefreshVersionSnapshot } from './modules/plugins/dto/plugin-refresh-result.dto.js';
import type { UnifiedPluginVersionRecord } from './modules/plugins/dto/unified-plugins.dto.js';
import type { PluginWorkflowPublisherService } from './modules/plugins/application/plugin-workflow-publisher.service.js';
import type { BuiltinPluginRegistry } from './modules/plugins/builtin-plugins/builtin-plugin-registry.js';
import { PgUnifiedPluginsRepository } from './modules/plugins/repository/unified-plugins.repository.js';
import { UnifiedPluginsApplicationService } from './modules/plugins/application/unified-plugins.application-service.js';
import { PgliteDatabase } from './database/pglite-database.js';
import { runMigrations } from './database/migration-runner.js';
import { createApp } from './app.module.js';
import { App } from './common/http/app.js';
import { registerPolicyAuthorityServices } from './app.module.js';
import type { ProductionPolicyAuthorityServicesV1 } from './modules/agents/security/policy-authority.service.js';
import type { TaskExecutorRegistry } from './modules/tasks/task-worker-supervisor.js';
import { createSecurityServices } from './modules/security/security.controller.js';
import type { WorkflowTemplatesApplicationService } from './modules/workflow-templates/application/workflow-templates.application-service.js';
import type { WorkflowDslV1 } from './modules/workflow-templates/dto/workflow-templates.dto.js';
import type { DevicesApplicationService } from './modules/devices/application/devices.application-service.js';
import type { AgentRegistration } from './modules/agents/schema/agents.schema.js';

test('插件刷新结果按版本和启用状态生成前后变化', () => {
  const before: PluginRefreshVersionSnapshot[] = [
    { id: 'old-nginx', pluginId: 'web.nginx', version: '1.0.0', status: 'DISABLED' },
    { id: 'old-apache', pluginId: 'web.apache', version: '1.0.0', status: 'ENABLED' },
  ];
  const after: PluginRefreshVersionSnapshot[] = [
    { id: 'new-nginx', pluginId: 'web.nginx', version: '1.1.0', status: 'ENABLED' },
    { id: 'new-tomcat', pluginId: 'app.tomcat', version: '1.0.0', status: 'ENABLED' },
  ];

  assert.deepEqual(buildPluginRefreshChanges(before, after), [
    { pluginId: 'app.tomcat', after: after[1], changeType: 'ADDED' },
    { pluginId: 'web.apache', before: before[1], changeType: 'REMOVED' },
    { pluginId: 'web.nginx', before: before[0], after: after[0], changeType: 'UPDATED' },
  ]);
});

test('AD CS Provider 补偿只选择同一 CA 的在线新 Agent', () => {
  const agent = (id: string, status: AgentRegistration['status'], updatedAt: string): AgentRegistration => ({
    id,
    tenantId: 'tenant-adcs-preference',
    agentKey: id,
    descriptor: {
      agentKey: id,
      hostname: 'ca-host',
      caName: 'Jackson-DC-CA',
      version: '0.1.1',
      osType: 'WINDOWS_ADCS',
      labels: ['adcs_agent'],
    },
    role: 'adcs_agent',
    status,
    registeredAt: updatedAt,
    updatedAt,
    version: 1,
  });
  const selected = selectPreferredAdcsAgents([
    agent('old-offline', 'OFFLINE', '2026-08-20T00:00:00.000Z'),
    agent('new-online', 'ONLINE', '2026-08-26T00:00:00.000Z'),
  ], new Map([['old-offline', 'OFFLINE'], ['new-online', 'ONLINE']]));
  assert.deepEqual(selected.map((item) => item.id), ['new-online']);
});

test('AD CS Provider 补偿不把无心跳的历史 ONLINE Agent 当作在线目标', () => {
  const agent = (id: string, updatedAt: string): AgentRegistration => ({
    id,
    tenantId: 'tenant-adcs-stale-online',
    agentKey: id,
    descriptor: {
      agentKey: id,
      hostname: 'ca-host',
      caName: 'Jackson-DC-CA',
      version: '0.1.1',
      osType: 'WINDOWS_ADCS',
      labels: ['adcs_agent'],
    },
    role: 'adcs_agent',
    status: 'ONLINE',
    registeredAt: updatedAt,
    updatedAt,
    version: 1,
  });
  const selected = selectPreferredAdcsAgents([
    agent('old-stale-online', '2026-08-20T00:00:00.000Z'),
    agent('new-online', '2026-08-26T00:00:00.000Z'),
  ], new Map([
    ['old-stale-online', 'OFFLINE'],
    ['new-online', 'ONLINE'],
  ]));
  assert.deepEqual(selected.map((item) => item.id), ['new-online']);
});

test('AD CS Agent 暂时读不到 CA 名称时仍按同一主机归并历史注册', () => {
  const agent = (id: string, caName: string | undefined, status: AgentRegistration['status']): AgentRegistration => ({
    id,
    tenantId: 'tenant-adcs-hostname-fallback',
    agentKey: id,
    descriptor: {
      agentKey: id,
      hostname: 'ca-host',
      ...(caName ? { caName } : {}),
      version: '0.1.1',
      osType: 'WINDOWS_ADCS',
      labels: ['adcs_agent'],
    },
    role: 'adcs_agent',
    status,
    registeredAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
    version: 1,
  });
  const selected = selectPreferredAdcsAgents([
    agent('old-without-ca-name', undefined, 'OFFLINE'),
    agent('new-with-ca-name', 'Jackson-DC-CA', 'ONLINE'),
  ], new Map([
    ['old-without-ca-name', 'OFFLINE'],
    ['new-with-ca-name', 'ONLINE'],
  ]));
  assert.deepEqual(selected.map((item) => item.id), ['new-with-ca-name']);
});

test('插件刷新变化从多版本历史快照中选择最高语义版本', () => {
  const before: PluginRefreshVersionSnapshot[] = [
    { id: 'old-nginx-010', pluginId: 'device.nginx-proxy-manager', version: '0.1.0', status: 'ENABLED' },
    { id: 'old-nginx-011', pluginId: 'device.nginx-proxy-manager', version: '0.1.1', status: 'DISABLED' },
  ];
  const after: PluginRefreshVersionSnapshot[] = [
    { id: 'new-nginx-012', pluginId: 'device.nginx-proxy-manager', version: '0.1.2', status: 'ENABLED' },
  ];

  const [change] = buildPluginRefreshChanges(before, after);

  assert.deepEqual(change, {
    pluginId: 'device.nginx-proxy-manager',
    before: before[1],
    after: after[0],
    changeType: 'UPDATED',
  });
});

test('网络设备统一向导保留全部已发现站点，Agent 仍拒绝缺少真实配置指纹的目标', () => {
  const sites = ['LB:lb-one', 'VPN:vpn-one', 'CS:cs-one'].map((stableKey, index) => ({
    id: `psa_${index}`,
    siteAssetId: `psa_${index}`,
    managedTargetId: `pmt_${index}`,
    kind: 'network.virtual-server',
    frameworkType: ['citrix.lb-server', 'citrix.vpn-server', 'citrix.cs-server'][index]!,
    name: stableKey,
    endpoint: { address: `10.0.0.${41 + index}`, port: 443, protocol: 'HTTPS' },
    metadata: { virtualServerType: ['LB', 'VPN', 'CS'][index] },
  }));

  const targets = sites.map((site) => mapDiscoveredSiteToOnboardingTarget(site, true));
  assert.equal(targets.length, 3);
  assert.equal(targets.every((target) => target.selectable), true);
  assert.equal(new Set(targets.map((target) => target.configFingerprint)).size, 3);
  assert.ok(targets.every((target) => /^[a-f0-9]{64}$/.test(target.configFingerprint)));

  const repeated = discoveredTargetFingerprint(sites[0]!);
  assert.equal(repeated, discoveredTargetFingerprint({ ...sites[0]!, metadata: { virtualServerType: 'LB' } }));
  assert.equal(
    mapDiscoveredSiteToOnboardingTarget({ ...sites[0]!, bindings: [{ deploymentTarget: { configFingerprint: 'a'.repeat(64) } }] }, true).configFingerprint,
    'a'.repeat(64),
    '已有真实配置指纹时必须优先保留原事实',
  );
  assert.equal(
    mapDiscoveredSiteToOnboardingTarget(sites[0]!, false).selectable,
    false,
    'Agent/非插件路径不得使用发现事实摘要冒充 configFingerprint',
  );
});

test('非生产 App 只注册显式注入的 Policy Authority 资源', () => {
  const app = new App();
  const services = {
    service: {},
    trustRoot: {},
    keySet: {},
    signingKeys: {},
    policy: {},
    state: {},
  } as unknown as ProductionPolicyAuthorityServicesV1;

  assert.equal(registerPolicyAuthorityServices(app, services, { NODE_ENV: 'test' }), services);
  assert.equal(app.getResource('policyAuthorityService'), services.service);
  assert.equal(app.getResource('policyAuthorityTrustRootService'), services.trustRoot);
  assert.equal(app.getResource('policyAuthorityKeySetService'), services.keySet);
  assert.equal(app.getResource('policyAuthoritySigningKeySource'), services.signingKeys);
});

test('生产 App 缺少 Policy Authority 配置时失败关闭', () => {
  assert.throws(
    () => registerPolicyAuthorityServices(new App(), undefined, { NODE_ENV: 'production' }),
    /失败关闭/,
  );
});

test('主装配移除 ACME HTTP-01 和旧 Provider 资源，同时保留通用 CA 与统一任务 Worker', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const app = createApp({ db, corePersistence: { mode: 'memory' } });
  const response = await app.inject({
    method: 'GET',
    path: '/.well-known/acme-challenge/retired-route',
  });

  assert.equal(response.statusCode, 404);
  assert.ok(app.getResource('certificateServices'));
  assert.ok(app.getResource('taskWorkerSupervisor'));
  assert.ok(app.getResource('cloudAccountAssetsService'));
  assert.ok(app.getResource('internalCaService'));
  const taskExecutorRegistry = app.getResource<TaskExecutorRegistry>('taskExecutorRegistry');
  assert.ok(taskExecutorRegistry?.keys().includes('ca.node-task'));
  assert.ok(app.router.match('GET', '/api/v1/ca-operations/tree'));
  assert.ok(app.router.match('GET', '/api/v1/ca-providers'));
  assert.ok(app.router.match('GET', '/api/v1/ca-trust-domains'));
  assert.ok(app.router.match('GET', '/api/v1/certificate-authorities'));
  assert.ok(app.router.match('GET', '/api/v1/cloud-account-assets'));
  assert.ok(app.router.match('POST', '/api/v1/cloud-account-assets'));
  assert.ok(app.router.match('PATCH', '/api/v1/cloud-account-assets'));
  assert.ok(app.router.match('POST', '/api/v1/cloud-account-assets/delete'));
  assert.equal(app.getResource('acmeRepository'), undefined);
  assert.equal(app.getResource('providerOperationLedgerService'), undefined);
  assert.equal(app.getResource('cloudProviderDiscoveryService'), undefined);
  assert.equal(app.getResource('providerCatalogService'), undefined);
  assert.equal(app.getResource('trustedJsProviderRuntime'), undefined);
});

test('显式注入 Agent Plan 授权依赖时装配 Web 发现任务工厂', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const app = createApp({
    db,
    corePersistence: { mode: 'memory' },
    agentPlanAuthorization: {
      policyAuthority: {},
      grants: {},
      localPolicy: {},
    } as never,
  });

  assert.ok(app.getResource('agentDiscoveryTaskFactory'));
});

test('内置插件 Workflow 发布失败时启动初始化仍继续', async () => {
  const plugins = [
    pluginRecord('plugin.publish-failure', '1.0.0'),
    pluginRecord('plugin.continues', '1.0.1'),
  ];
  const published: string[] = [];
  const disabled: string[] = [];
  const warnings: LogEvent[] = [];
  const logger = new StructuredLogger((event) => warnings.push(event));
  const registry = {
    registerAll: async () => plugins,
  } as unknown as BuiltinPluginRegistry;
  const publisher = {
    publishPlugin: async (plugin: UnifiedPluginVersionRecord) => {
      published.push(plugin.pluginId);
      if (plugin.pluginId === 'plugin.publish-failure') {
        throw new AppError('VALIDATION_FAILED', '模拟 Workflow 发布失败');
      }
      return [];
    },
  } as unknown as PluginWorkflowPublisherService;
  const unifiedPlugins = {
    disableVersion: async (id: string) => {
      disabled.push(id);
      const plugin = plugins.find((item) => item.id === id)!;
      return { ...plugin, status: 'DISABLED' as const };
    },
  } as unknown as UnifiedPluginsApplicationService;
  await initializeBuiltinPlugins(
    unifiedPlugins,
    publisher,
    { registry, logger },
  );

  assert.deepEqual(published, ['plugin.publish-failure', 'plugin.continues']);
  assert.deepEqual(disabled, ['plugin-version-1']);
  assert.deepEqual(
    warnings.map((event) => {
      const details = event.details as { phase: string; pluginId: string; version: string; errorCode: string };
      return {
        phase: details.phase,
        pluginId: details.pluginId,
        version: details.version,
        errorCode: details.errorCode,
      };
    }),
    [
      { phase: 'publishWorkflow', pluginId: 'plugin.publish-failure', version: '1.0.0', errorCode: 'VALIDATION_FAILED' },
    ],
  );
});

test('Registry 包摘要冲突只跳过违规插件并继续后端初始化', async () => {
  const warnings: LogEvent[] = [];
  const logger = new StructuredLogger((event) => warnings.push(event));
  const registry = {
    registerAll: async () => {
      throw new AppError('RESOURCE_VERSION_CONFLICT', '同一插件版本存在不同包内容', {
        pluginId: 'web.nginx',
        version: '1.0.0',
      });
    },
  };
  const publisher = { publishPlugin: async () => [] } as unknown as PluginWorkflowPublisherService;

  const installed = await initializeBuiltinPlugins({} as UnifiedPluginsApplicationService, publisher, { registry: registry as never, logger });
  assert.deepEqual(installed, []);
  assert.equal((warnings[0]?.details as { phase?: string } | undefined)?.phase, 'registry');
});

test('Registry 基础设施错误仍然阻止初始化', async () => {
  const registry = {
    registerAll: async () => {
      throw new Error('数据库不可用');
    },
  };
  const publisher = { publishPlugin: async () => [] } as unknown as PluginWorkflowPublisherService;

  await assert.rejects(
    () => initializeBuiltinPlugins({} as UnifiedPluginsApplicationService, publisher, { registry: registry as never }),
    /数据库不可用/,
  );
});

test('主装配的 WorkflowTemplatesApplicationService 具备受控 Curl 执行能力（017.CURL_HTTP 真实调用）', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const app = createApp({ db, corePersistence: { mode: 'memory' } });
  const workflows = app.getResource<WorkflowTemplatesApplicationService>('workflowTemplatesService');
  assert.ok(workflows);

  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ errorcode: 0, nsversion: { version: 'NetScaler NS13.1: Build 55.29.nc' } }));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as AddressInfo).port;
  try {
    const content: WorkflowDslV1 = {
      apiVersion: 'gcac.workflow/v1',
      kind: 'CurlSshWorkflow',
      metadata: { name: 'app-assembly-curl', displayName: 'app assembly curl', version: '1.0.0' },
      inputContract: {
        apiVersion: 'gcac.deployment-input/v1',
        variables: {},
        connections: {
          management: {
            transport: 'http',
            host: { type: 'string', required: true, configurationMode: 'required', source: { kind: 'binding' }, lifecycle: 'pre_execution', bindingPolicy: 'required_binding' },
            port: { type: 'number', required: true, configurationMode: 'advanced', source: { kind: 'default' }, lifecycle: 'pre_execution', bindingPolicy: 'default_overridable', default: 443 },
          },
        },
        credentials: {},
        artifacts: {},
      },
      steps: [{
        name: 'readVersion',
        type: 'http',
        stage: 'prepare',
        request: {
          method: 'GET',
          connectionRef: 'management',
          url: '/nitro/v1/config/nsversion',
          headers: { Accept: 'application/json' },
          timeoutSeconds: 5,
          successStatusCodes: [200],
        },
        assert: [{ type: 'statusCode', equals: 200 }, { type: 'jsonPath', path: '$.errorcode', equals: 0 }],
      }],
    };
    const { version } = await workflows.createTemplate({ content });
    const run = await workflows.execute({
      templateVersionId: version.id,
      mode: 'real_test',
      tenantId: 'tenant-app-assembly-curl',
      resolvedInput: {
        apiVersion: 'gcac.resolved-deployment-input/v1',
        contractVersion: 'gcac.deployment-input/v1',
        assetContext: {
          apiVersion: 'gcac.deployment-asset-context/v1',
          application: { id: 'asset_app_assembly', address: '127.0.0.1', serverName: '127.0.0.1', port, protocol: 'http' },
          deployment: { targets: [], certificateResourceName: 'certificate-app-assembly' },
        },
        variables: {},
        connections: { management: { transport: 'http', host: '127.0.0.1', port, credentialSlot: 'credential' } },
        credentials: {},
        artifacts: {},
        provenance: {},
        sensitivePaths: [],
        issues: [],
        executable: true,
        resolvedSha256: 'app-assembly-curl-resolved',
      },
    });

    assert.equal(run.status, 'success');
    assert.equal(run.stepResults[0]?.status, 'success');
    assert.equal(run.plannedOnly, false);
  } finally {
    server.close();
  }
});

test('统一应用向导按配方能力执行连接测试，TEST-POC 仍出现在已有设备列表', async () => {
  const adminPassword = process.env.GCAC_INITIAL_ADMIN_PASSWORD?.trim();
  assert.ok(adminPassword, '测试环境必须显式设置 GCAC_INITIAL_ADMIN_PASSWORD');
  const db = new PgliteDatabase();
  await runMigrations(db);

  // 导入 Citrix 内置插件，使平台配方可被向导加载。
  const plugins = new UnifiedPluginsApplicationService(new PgUnifiedPluginsRepository(db));
  const pluginRoot = resolve('src/modules/plugins/builtin-plugins/citrix-adc');
  const manifest = JSON.parse(await readFile(resolve(pluginRoot, 'manifest.json'), 'utf8')) as {
    pluginId: string;
    permissions: string[];
    resources: Record<string, string | Record<string, string>>;
  };
  const resourcePaths = flattenResourcePaths(manifest.resources);
  const resources = Object.fromEntries(await Promise.all(
    resourcePaths.map(async (path) => [path, await readFile(resolve(pluginRoot, path), 'utf8')]),
  ));
  const imported = await plugins.importVersion('tenant-poc', { manifest, resources }, 'BUILTIN');
  await plugins.approvePermissions(imported.id, manifest.permissions);
  await plugins.enableVersion(imported.id);

  // 注入受控设备服务：TEST-POC 可选中，连接测试记录配方能力名。
  const executedCapabilities: Array<{ deviceId: string; capabilityKey: string }> = [];
  const devices = {
    list: async () => ({
      items: [{ id: 'device-test-poc', displayName: 'TEST-POC', managementAddress: '10.255.0.49', health: 'HEALTHY' }],
      total: 1,
      page: 1,
      pageSize: 200,
    }),
    get: async () => ({
      id: 'device-test-poc',
      displayName: 'TEST-POC',
      managementAddress: '10.255.0.49',
      health: 'HEALTHY',
      capabilities: ['device.connection.test', 'device.discover'],
      extension: { type: 'PLUGIN', deviceAssetId: 'asset-test-poc', pluginVersionId: imported.id, pluginBindingId: 'binding-test-poc' },
      pluginUi: { pluginId: 'device.citrix.netscaler-adc' },
    }),
    executeCapability: async (tenantId: string, deviceId: string, capabilityKey: string) => {
      executedCapabilities.push({ deviceId, capabilityKey });
      return { id: `run-${capabilityKey}`, status: 'success', mode: 'real_test', executionBranch: 'deploy', plannedOnly: false, renderedSteps: [], stepResults: [], rollbackResults: [], logs: [] };
    },
  } as unknown as DevicesApplicationService;

  const app = createApp({
    db,
    corePersistence: { mode: 'memory' },
    security: createSecurityServices(),
    devices,
  });
  const login = await app.inject({
    method: 'POST',
    path: '/api/v1/auth/login',
    body: { username: 'admin', password: adminPassword },
  });
  assert.equal(login.statusCode, 200);
  const token = (login.body as { token: string }).token;
  const headers = { authorization: `Bearer ${token}` };

  const session = await app.inject({
    method: 'POST',
    path: '/api/v1/application-onboarding/sessions',
    headers: { ...headers, 'x-idempotency-key': 'onboarding-test-poc-session' },
    body: { platformKey: 'citrix.netscaler-adc' },
  });
  assert.equal(session.statusCode, 201);
  const sessionId = (session.body as { id: string }).id;

  const devicesResponse = await app.inject({
    method: 'GET',
    path: `/api/v1/application-onboarding/sessions/${sessionId}/devices`,
    headers,
  });
  assert.equal(devicesResponse.statusCode, 200);
  const deviceItems = (devicesResponse.body as { items: Array<{ deviceId: string; displayName: string; selectable: boolean }> }).items;
  assert.equal(deviceItems.some((item) => item.deviceId === 'device-test-poc' && item.displayName === 'TEST-POC' && item.selectable === true), true);

  const selected = await app.inject({
    method: 'POST',
    path: `/api/v1/application-onboarding/sessions/${sessionId}/resource-selection`,
    headers,
    body: { expectedStateVersion: 1, mode: 'EXISTING_DEVICE', deviceId: 'device-test-poc' },
  });
  assert.equal(selected.statusCode, 200);
  assert.equal((selected.body as { state: string }).state, 'CONNECTION_TESTING');

  const tested = await app.inject({
    method: 'POST',
    path: `/api/v1/application-onboarding/sessions/${sessionId}/test`,
    headers,
    body: { expectedStateVersion: 2 },
  });
  assert.equal(tested.statusCode, 200);
  assert.equal((tested.body as { state: string }).state, 'DISCOVERING');
  // Citrix 配方声明 device.connection.test，宿主必须按配方能力名执行，不能硬编码。
  assert.deepEqual(executedCapabilities, [{ deviceId: 'device-test-poc', capabilityKey: 'device.connection.test' }]);
});

function pluginRecord(pluginId: string, version: string): UnifiedPluginVersionRecord {
  return {
    id: pluginId === 'plugin.publish-failure' ? 'plugin-version-1' : 'plugin-version-2',
    tenantId: 'SYSTEM',
    ownerType: 'SYSTEM',
    pluginId,
    version,
    source: 'BUILTIN',
    runtime: 'WORKFLOW_DSL',
    scope: 'BOTH',
    trust: 'OFFICIAL_SIGNED',
    support: 'OFFICIAL',
    manifest: {
      apiVersion: 'gcac.plugin-manifest/v1',
      kind: 'GcacPlugin',
      pluginId,
      version,
      displayNameKey: 'plugin.test.name',
      publisher: 'GCAC',
      runtime: 'WORKFLOW_DSL',
      source: 'BUILTIN',
      scope: 'BOTH',
      trust: 'OFFICIAL_SIGNED',
      support: 'OFFICIAL',
      capabilities: [],
      permissions: [],
      resources: {},
    },
    packageSha256: 'sha256:package',
    manifestSha256: 'sha256:manifest',
    resourceSha256: {},
    resources: {},
    status: 'ENABLED',
    permissionApprovalStatus: 'APPROVED',
    approvedPermissions: [],
    validationReport: {
      valid: true,
      errors: [],
      warnings: [],
      manifestSha256: 'sha256:manifest',
      resourceSha256: {},
    },
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  };
}

function flattenResourcePaths(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.values(value).flatMap(flattenResourcePaths);
}
