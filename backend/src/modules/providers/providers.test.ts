import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { App } from '../../common/http/app.js';
import { AssetsApplicationService } from '../assets/application/assets.application-service.js';
import { PgAssetsRepository } from '../assets/repository/assets.repository.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { MockProvider } from './application/mock.provider.js';
import { ProviderFallbackAdvisor } from './application/fallback-advisor.js';
import { ProviderPlanRunner } from './application/provider-plan-runner.js';
import { ProviderRegistry } from './application/provider-registry.js';
import { ProviderSdk } from './application/provider-sdk.js';
import { ProviderSelector } from './application/provider-selector.js';
import { ProvidersApplicationService } from './application/providers.application-service.js';
import { ProvidersController } from './controller/providers.controller.js';
import { ProvidersDomainService } from './domain/providers.domain-service.js';

describe('spec018 providers 基础框架', () => {
  it('ProviderRegistry 按优先级返回 provider，重复注册直接拒绝', () => {
    const domain = new ProvidersDomainService();
    const registry = new ProviderRegistry([], domain);
    const provider = new MockProvider(domain);
    registry.register(provider);
    assert.equal(registry.list()[0]?.getDescriptor().metadata.id, 'mock-provider');
    assert.throws(() => registry.register(provider), /provider 已存在/);
  });

  it('ProviderSelector 能按 providerId 和规则选中 provider', () => {
    const domain = new ProvidersDomainService();
    const registry = new ProviderRegistry([new MockProvider(domain)], domain);
    const selector = new ProviderSelector(registry);

    const byId = selector.select({ providerId: 'mock-provider' });
    assert.equal(byId?.getDescriptor().metadata.id, 'mock-provider');

    const byRule = selector.select({ providerType: 'CUSTOM', serviceName: 'mock-web', configPath: '/mock/server.conf', protocol: 'HTTPS', hostname: 'mock-node', tags: ['mock'] });
    assert.equal(byRule?.getDescriptor().metadata.id, 'mock-provider');
  });

  it('发现结果会被规范化并生成部署步骤草案', () => {
    const domain = new ProvidersDomainService();
    const normalized = domain.normalizeDiscoveryResult({
      providerId: 'mock-provider',
      providerType: 'CUSTOM',
      source: 'MANUAL',
      discoveredAt: '2026-06-08T00:00:00.000Z',
      scope: { region: ' cn ' },
      hosts: [{
        key: 'host-1',
        hostname: 'WEB-01.EXAMPLE.COM',
        ipAddresses: ['10.0.0.1', '10.0.0.1'],
        tags: ['prod', 'prod'],
      }],
      services: [{
        key: 'service-1',
        hostKey: 'host-1',
        providerType: 'CUSTOM',
        serviceName: 'MOCK-WEB',
        displayName: 'Mock Web',
        status: 'ACTIVE',
      }],
      endpoints: [{
        key: 'endpoint-1',
        serviceKey: 'service-1',
        protocol: 'HTTPS',
        hostName: 'WWW.EXAMPLE.COM',
        port: 443,
        status: 'ACTIVE',
      }],
      bindings: [{
        key: 'binding-1',
        endpointKey: 'endpoint-1',
        bindingType: 'FILE_PATH',
        domainName: 'WWW.EXAMPLE.COM',
        certificateRef: 'cert://1',
      }],
      rawPayload: { noisy: true },
    });

    assert.equal(normalized.hosts[0]?.hostname, 'web-01.example.com');
    assert.deepEqual(normalized.hosts[0]?.tags, ['prod']);
    assert.equal(normalized.services[0]?.serviceName, 'mock-web');
    assert.equal(normalized.endpoints[0]?.hostName, 'www.example.com');
    assert.equal(normalized.bindings[0]?.domainName, 'www.example.com');
    assert.equal(normalized.serviceAssets?.length, 1);
    assert.equal(normalized.serviceAssets?.[0]?.address, 'www.example.com');
    assert.deepEqual(normalized.scope, { region: 'cn' });

    const draftBundle = domain.buildDraftBundle(normalized);
    assert.equal(draftBundle.summary.bindingCount, 1);
    assert.equal(draftBundle.steps.length, 4);
    assert.equal(draftBundle.steps[0]?.action, 'CONNECT');
    assert.equal(draftBundle.steps[3]?.action, 'VERIFY_BINDING');
    assert.deepEqual(draftBundle.steps[3]?.dependsOn, [draftBundle.steps[2]!.id]);
  });

  it('敏感字段和敏感值会被拒绝', () => {
    const domain = new ProvidersDomainService();
    const base = {
      providerId: 'mock-provider',
      providerType: 'CUSTOM' as const,
      source: 'MANUAL' as const,
      discoveredAt: '2026-06-08T00:00:00.000Z',
      hosts: [{ key: 'host-1', hostname: 'host-1.example.com', ipAddresses: [], tags: [] }],
      services: [{ key: 'service-1', hostKey: 'host-1', providerType: 'CUSTOM' as const, displayName: 'svc' }],
      endpoints: [{ key: 'endpoint-1', serviceKey: 'service-1', protocol: 'HTTPS', port: 443 }],
      bindings: [{ key: 'binding-1', endpointKey: 'endpoint-1', bindingType: 'FILE_PATH' }],
      rawPayload: {},
    };

    const sensitiveKey = domain.normalizeDiscoveryResult({
      ...base,
      services: [{ ...base.services[0]!, rawFacts: { password: 'abc' } }],
    });
    assert.throws(() => domain.assertNoSensitiveFields(sensitiveKey), /敏感字段/);

    const sensitiveValue = domain.normalizeDiscoveryResult({
      ...base,
      bindings: [{ ...base.bindings[0]!, privateKeyRef: '-----BEGIN PRIVATE KEY-----demo' }],
    });
    assert.throws(() => domain.assertNoSensitiveFields(sensitiveValue), /敏感值/);
  });

  it('DiscoveryService 主流程会写入 discovery snapshot，但不会污染资产表', async () => {
    const app = new App();
    const db = new PgliteDatabase();
    await runMigrations(db);
    const assetsService = new AssetsApplicationService(new PgAssetsRepository(db));
    const service = new ProvidersApplicationService({ assetsService });
    new ProvidersController(service).register(app.router);

    const listProviders = await app.inject({
      method: 'GET',
      path: '/api/v1/providers',
      headers: { 'x-tenant-id': 'tenant_spec018' },
    });
    assert.equal(listProviders.statusCode, 200);
    assert.equal((listProviders.body as Array<{ id: string }>)[0]?.id, 'mock-provider');

    const run = await app.inject({
      method: 'POST',
      path: '/api/v1/providers/discovery-runs',
      headers: { 'x-tenant-id': 'tenant_spec018', 'x-request-id': 'req_spec018_1' },
      body: { providerId: 'mock-provider', source: 'AGENT', scope: { hostname: 'node-a' }, payload: { echo: 'ok' } },
    });
    assert.equal(run.statusCode, 201);
    const record = run.body as { id: string; snapshotId: string; normalizedHash: string; draftBundle: { steps: unknown[] } };
    assert.ok(record.id);
    assert.ok(record.snapshotId);
    assert.equal(record.draftBundle.steps.length, 4);

    const results = await app.inject({
      method: 'GET',
      path: `/api/v1/provider-discovery-results?filter[normalizedHash]=${record.normalizedHash}`,
      headers: { 'x-tenant-id': 'tenant_spec018' },
    });
    assert.equal(results.statusCode, 200);
    assert.equal((results.body as { total: number }).total, 1);

    const detail = await app.inject({
      method: 'GET',
      path: `/api/v1/provider-discovery-result?id=${record.id}`,
      headers: { 'x-tenant-id': 'tenant_spec018' },
    });
    assert.equal(detail.statusCode, 200);
    assert.equal((detail.body as { snapshotId: string }).snapshotId, record.snapshotId);

    const snapshots = await assetsService.listDiscoverySnapshots('tenant_spec018', { page: 1, pageSize: 20, filter: { normalizedHash: record.normalizedHash }, sort: undefined });
    assert.equal(snapshots.total, 1);
    const hosts = await assetsService.listHosts('tenant_spec018', { page: 1, pageSize: 20, filter: {}, sort: undefined });
    const services = await assetsService.listFrameworkInstances('tenant_spec018', { page: 1, pageSize: 20, filter: {}, sort: undefined });
    const endpoints = await assetsService.listServiceEndpoints('tenant_spec018', { page: 1, pageSize: 20, filter: {}, sort: undefined });
    assert.equal(hosts.total, 0);
    assert.equal(services.total, 0);
    assert.equal(endpoints.total, 0);
  });

  it('Provider SDK 能运行 fixture、校验 DAG、拒绝明文敏感输入', async () => {
    const domain = new ProvidersDomainService();
    const provider = new MockProvider(domain);
    const sdk = new ProviderSdk(domain);
    const report = await sdk.runFixture(provider, {
      name: 'mock-success',
      context: { tenantId: 'tenant_fixture', requestId: 'req_fixture' },
      input: { providerId: 'mock-provider', source: 'MANUAL', scope: { hostname: 'fixture-host' }, payload: {} },
      expected: { hostCount: 1, serviceCount: 1, endpointCount: 1, bindingCount: 1, minStepCount: 4 },
    });

    assert.equal(report.passed, true);
    assert.equal(report.summary.stepCount, 4);

    assert.throws(() => sdk.assertDraftBundle({
      steps: [{
        id: 'bad',
        title: 'bad',
        action: 'INSTALL_CERTIFICATE',
        providerType: 'CUSTOM',
        target: {},
        inputs: { privateKey: '-----BEGIN PRIVATE KEY-----demo' },
        dependsOn: [],
        requiredCapabilities: ['file.write'],
        idempotencyKey: 'idem-bad',
      }],
    }), /明文敏感信息/);
  });

  it('ProviderPlanRunner 和 fallback advisor 输出可给 009/010 消费的规划结果', () => {
    const domain = new ProvidersDomainService();
    const provider = new MockProvider(domain);
    const result = domain.normalizeDiscoveryResult(provider.discover({ tenantId: 'tenant_plan' }, {
      source: 'MANUAL',
      scope: { hostname: 'plan-host' },
      payload: {},
    }));
    const bundle = new ProviderPlanRunner(new ProviderSdk(domain)).plan(provider, result);
    assert.equal(bundle.steps.every((step) => step.requiredCapabilities?.length), true);
    assert.equal(bundle.steps.every((step) => step.idempotencyKey), true);

    const suggestions = new ProviderFallbackAdvisor().suggest({ missingCapabilities: ['file.write', 'tls.remote_probe'], osType: 'LINUX' });
    assert.equal(suggestions.some((item) => item.strategy === 'SSH'), true);
    assert.equal(suggestions.some((item) => item.strategy === 'MONITOR_ONLY'), true);
  });
});
