import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { App } from '../../common/http/app.js';
import { AssetsApplicationService } from '../assets/application/assets.application-service.js';
import { BindingsApplicationService } from '../bindings/application/bindings.application-service.js';
import { InMemoryBindingsRepository } from '../bindings/repository/bindings.repository.js';
import { InMemoryCertificatesRepository } from '../certificates/repository/certificates.repository.js';
import { InMemoryMonitorsRepository } from './repository/monitors.repository.js';
import { MonitorsApplicationService } from './application/monitors.application-service.js';
import { MonitorsController } from './controller/monitors.controller.js';
import { MonitorsDomainService, riskDedupKey } from './domain/monitors.domain-service.js';
import { ExecutionsRepository } from '../executions/repository/executions.repository.js';
import { newId } from '../../shared/id.js';
import type { RiskEventType } from './schema/monitors.schema.js';

describe('监控风险 API', () => {
  it('生成证书到期、绑定漂移、未知证书和执行失败风险，并返回仪表盘聚合', async () => {
    const { app, assetsService, bindingsService, certificatesRepository, executionsRepository } = createMonitorHarness();
    const headers = { 'x-tenant-id': 'tenant_monitor', 'x-actor-id': 'monitor_bot' };
    const expiredVersionId = seedCertificate(certificatesRepository, { primaryDomain: 'expired.example.com', notAfter: '2026-01-01T00:00:00.000Z' });
    const expiringVersionId = seedCertificate(certificatesRepository, { primaryDomain: 'expiring.example.com', notAfter: '2026-06-20T00:00:00.000Z' });
    void expiredVersionId;
    void expiringVersionId;

    const host = assetsService.createHost('tenant_monitor', { hostname: 'monitor-host.example.com', osType: 'LINUX', compatibilityLevel: 'L1', managementMode: 'AGENT' });
    const service = assetsService.createServiceInstance('tenant_monitor', { hostId: host.id, providerType: 'NGINX', displayName: 'monitor nginx' });
    bindingsService.createCertificateBinding('tenant_monitor', {
      serviceInstanceId: service.id,
      bindingType: 'FILE_PATH',
      certPath: '/etc/nginx/drift.pem',
      verifyMethod: 'LOCAL_FILE',
      certificateVersionId: 'certver_drift',
      desiredFingerprintSha256: 'a'.repeat(64),
      observedFingerprintSha256: 'b'.repeat(64),
      status: 'DRIFTED',
    });
    bindingsService.createCertificateBinding('tenant_monitor', {
      serviceInstanceId: service.id,
      bindingType: 'FILE_PATH',
      certPath: '/etc/nginx/unknown.pem',
      verifyMethod: 'LOCAL_FILE',
    });

    executionsRepository.createRun({
      id: newId('run'),
      tenantId: 'tenant_monitor',
      deploymentPlanId: 'plan_1',
      runNo: 1,
      type: 'apply',
      idempotencyKey: 'idem_monitor_run_1',
      requestHash: 'hash_monitor_run_1',
      status: 'FAILED',
      errorCode: 'MOCK_FAILURE',
      errorMessage: '模拟失败',
      summary: {},
      createdAt: '2026-06-08T00:00:00.000Z',
      updatedAt: '2026-06-08T00:05:00.000Z',
      finishedAt: '2026-06-08T00:05:00.000Z',
      createdBy: 'monitor_bot',
      version: 1,
    });

    const scanned = await app.inject({
      method: 'POST',
      path: '/api/v1/monitors/scan',
      headers,
      body: { scanStartedAt: '2026-06-08T00:10:00.000Z', certificateExpiringThresholdDays: 30 },
    });
    assert.equal(scanned.statusCode, 201);
    const body = scanned.body as {
      risks: Array<{ type: string }>;
      dashboard: {
        expiredCount: number;
        expiringCount: number;
        driftCount: number;
        failedCount: number;
        unknownCertificateCount: number;
        tlsIssueCount: number;
        automationBlockedCount: number;
        totalActiveCount: number;
      };
    };
    assert.equal(body.risks.length, 5);
    assert.deepEqual(body.risks.map((item) => item.type).sort(), [
      'binding_drift',
      'binding_unknown_certificate',
      'certificate_expired',
      'certificate_expiring',
      'execution_failed',
    ]);
    assert.equal(body.dashboard.expiredCount, 1);
    assert.equal(body.dashboard.expiringCount, 1);
    assert.equal(body.dashboard.driftCount, 1);
    assert.equal(body.dashboard.failedCount, 1);
    assert.equal(body.dashboard.unknownCertificateCount, 1);
    assert.equal(body.dashboard.tlsIssueCount, 0);
    assert.equal(body.dashboard.automationBlockedCount, 0);
    assert.equal(body.dashboard.totalActiveCount, 5);

    const dashboard = await app.inject({ method: 'GET', path: '/api/v1/monitors/dashboard', headers });
    assert.equal(dashboard.statusCode, 200);
    assert.equal((dashboard.body as { totalActiveCount: number }).totalActiveCount, 5);
  });

  it('同一 dedupKey 重复扫描不会生成重复风险事件，只增加 occurrenceCount', async () => {
    const { app, certificatesRepository } = createMonitorHarness();
    const headers = { 'x-tenant-id': 'tenant_monitor_dedup', 'x-actor-id': 'monitor_bot' };
    seedCertificate(certificatesRepository, { primaryDomain: 'dedup.example.com', notAfter: '2026-06-10T00:00:00.000Z' });

    const first = await app.inject({
      method: 'POST',
      path: '/api/v1/monitors/scan',
      headers,
      body: { scanStartedAt: '2026-06-08T00:00:00.000Z', certificateExpiringThresholdDays: 30 },
    });
    const second = await app.inject({
      method: 'POST',
      path: '/api/v1/monitors/scan',
      headers,
      body: { scanStartedAt: '2026-06-08T01:00:00.000Z', certificateExpiringThresholdDays: 30 },
    });
    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 201);

    const listed = await app.inject({ method: 'GET', path: '/api/v1/monitors/risks', headers });
    assert.equal(listed.statusCode, 200);
    const page = listed.body as { total: number; items: Array<{ occurrenceCount: number; firstDetectedAt: string; lastDetectedAt: string }> };
    assert.equal(page.total, 1);
    assert.equal(page.items[0]!.occurrenceCount, 2);
    assert.equal(page.items[0]!.firstDetectedAt, '2026-06-08T00:00:00.000Z');
    assert.equal(page.items[0]!.lastDetectedAt, '2026-06-08T01:00:00.000Z');
  });

  it('告警规则支持阈值、范围、状态与静默，并只对命中规则返回 matchedRuleIds', async () => {
    const { app, certificatesRepository } = createMonitorHarness();
    const headers = { 'x-tenant-id': 'tenant_monitor_rules', 'x-actor-id': 'monitor_bot' };
    seedCertificate(certificatesRepository, { primaryDomain: 'rule.example.com', notAfter: '2026-06-09T00:00:00.000Z' });

    const activeRule = await app.inject({
      method: 'POST',
      path: '/api/v1/monitors/alert-rules',
      headers,
      body: {
        name: '高风险证书规则',
        threshold: { metric: 'count', operator: 'gte', value: 1 },
        scope: { tenantId: 'tenant_monitor_rules', riskTypes: ['certificate_expiring'], severities: ['high'] },
        status: 'active',
      },
    });
    assert.equal(activeRule.statusCode, 201);
    const silencedRule = await app.inject({
      method: 'POST',
      path: '/api/v1/monitors/alert-rules',
      headers,
      body: {
        name: '静默规则',
        threshold: { metric: 'count', operator: 'gte', value: 1 },
        scope: { tenantId: 'tenant_monitor_rules', riskTypes: ['certificate_expiring'] },
        status: 'active',
        silence: { startsAt: '2026-06-07T00:00:00.000Z', endsAt: '2026-06-09T23:59:59.000Z', reason: '维护窗口' },
      },
    });
    assert.equal(silencedRule.statusCode, 201);
    const disabledRule = await app.inject({
      method: 'POST',
      path: '/api/v1/monitors/alert-rules',
      headers,
      body: {
        name: '禁用规则',
        threshold: { metric: 'count', operator: 'gte', value: 1 },
        scope: { tenantId: 'tenant_monitor_rules', riskTypes: ['certificate_expiring'] },
        status: 'disabled',
      },
    });
    assert.equal(disabledRule.statusCode, 201);

    const scanned = await app.inject({
      method: 'POST',
      path: '/api/v1/monitors/scan',
      headers,
      body: { scanStartedAt: '2026-06-08T12:00:00.000Z', certificateExpiringThresholdDays: 30 },
    });
    assert.equal(scanned.statusCode, 201);
    const result = scanned.body as { matchedRuleIds: string[] };
    assert.equal(result.matchedRuleIds.length, 1);
    assert.equal(result.matchedRuleIds[0], (activeRule.body as { id: string }).id);
    assert.deepEqual((scanned.body as { alertDispatches: Array<{ ruleId: string; status: string; reason: string }> }).alertDispatches, [
      {
        ruleId: (activeRule.body as { id: string }).id,
        status: 'queued',
        reason: '通知通道未接入，已生成待发送告警记录',
      },
    ]);

    const rules = await app.inject({ method: 'GET', path: '/api/v1/monitors/alert-rules', headers });
    assert.equal(rules.statusCode, 200);
    assert.equal((rules.body as { total: number }).total, 3);
  });

  it('riskDedupKey 保持稳定拼接', () => {
    assert.equal(riskDedupKey(['Certificate', 'Expired', 'Asset_1']), 'certificate|expired|asset_1');
  });

  it('领域聚合按风险类型输出计数', () => {
    const domain = new MonitorsDomainService();
    const snapshot = domain.aggregateDashboard([
      createRisk('certificate_expiring'),
      createRisk('certificate_expired'),
      createRisk('binding_drift'),
      createRisk('execution_failed'),
      createRisk('binding_unknown_certificate'),
      createRisk('tls_chain_invalid'),
      createRisk('tls_domain_mismatch'),
      createRisk('tls_fingerprint_mismatch'),
      createRisk('agent_offline'),
      createRisk('capability_degraded'),
    ]);
    assert.equal(snapshot.expiringCount, 1);
    assert.equal(snapshot.expiredCount, 1);
    assert.equal(snapshot.driftCount, 1);
    assert.equal(snapshot.failedCount, 1);
    assert.equal(snapshot.unknownCertificateCount, 1);
    assert.equal(snapshot.tlsIssueCount, 3);
    assert.equal(snapshot.automationBlockedCount, 2);
    assert.equal(snapshot.totalActiveCount, 10);
  });

  it('监控调度会生成证书、绑定、执行、Agent、Capability 五类 queued job', () => {
    const { monitors } = createMonitorHarness();
    const jobs = monitors.createMonitorJobs({
      tenantId: 'tenant_jobs',
      scope: { hostId: 'host_1' },
      now: '2026-06-08T00:00:00.000Z',
    });
    assert.deepEqual(jobs.map((job) => job.kind).sort(), ['agent', 'binding', 'capability', 'certificate', 'execution']);
    assert.equal(jobs.every((job) => job.status === 'queued'), true);
    assert.equal(jobs.every((job) => job.scope.tenantId === 'tenant_jobs' && job.scope.hostId === 'host_1'), true);
  });

  it('远程 TLS 观测能生成链异常、域名错配和指纹错配风险并进入聚合', () => {
    const { monitors } = createMonitorHarness();
    const risks = monitors.ingestRemoteTlsObservation({
      tenantId: 'tenant_tls',
      bindingId: 'binding_tls_1',
      domainName: 'wrong.example.com',
      expectedDomainName: 'right.example.com',
      observedFingerprintSha256: 'b'.repeat(64),
      desiredFingerprintSha256: 'a'.repeat(64),
      chainStatus: 'invalid',
      checkedAt: '2026-06-08T02:00:00.000Z',
    });
    assert.deepEqual(risks.map((risk) => risk.type).sort(), ['tls_chain_invalid', 'tls_domain_mismatch', 'tls_fingerprint_mismatch']);
    const dashboard = monitors.getDashboard('tenant_tls');
    assert.equal(dashboard.tlsIssueCount, 3);
    assert.equal(dashboard.totalActiveCount, 3);
  });

  it('自动化健康采集能生成 Agent 离线和 Capability 降级风险', () => {
    const { monitors } = createMonitorHarness();
    const offline = monitors.ingestAutomationHealth({
      tenantId: 'tenant_auto',
      hostId: 'host_auto_1',
      agentStatus: 'OFFLINE',
      checkedAt: '2026-06-08T03:00:00.000Z',
    });
    const degraded = monitors.ingestAutomationHealth({
      tenantId: 'tenant_auto',
      serviceInstanceId: 'svc_auto_1',
      capabilityKey: 'manual.record',
      compatibilityLevel: 'L5',
      checkedAt: '2026-06-08T03:05:00.000Z',
    });
    assert.equal(offline?.type, 'agent_offline');
    assert.equal(degraded?.type, 'capability_degraded');
    const dashboard = monitors.getDashboard('tenant_auto');
    assert.equal(dashboard.automationBlockedCount, 2);
    assert.equal(dashboard.totalActiveCount, 2);
  });
});

function createMonitorHarness() {
  const app = new App();
  const assetsService = new AssetsApplicationService();
  const bindingsRepository = new InMemoryBindingsRepository(assetsService.getRepository());
  const bindingsService = new BindingsApplicationService(assetsService.getRepository(), bindingsRepository);

  const certificatesRepository = new InMemoryCertificatesRepository();
  const executionsRepository = new ExecutionsRepository();
  const monitors = new MonitorsApplicationService({
    repository: new InMemoryMonitorsRepository(),
    certificates: certificatesRepository,
    bindings: bindingsRepository,
    executions: executionsRepository,
  });
  new MonitorsController(monitors).register(app.router);
  return {
    app,
    assetsService,
    bindingsService,
    certificatesRepository,
    executionsRepository,
    monitors,
  };
}

function seedCertificate(
  repository: InMemoryCertificatesRepository,
  input: { primaryDomain: string; notAfter: string },
): string {
  const assetId = newId('certasset');
  repository.createAsset({
    id: assetId,
    name: input.primaryDomain,
    primaryDomain: input.primaryDomain,
    sans: [input.primaryDomain],
    sourceType: 'manual',
    status: 'active',
    tags: [],
    createdBy: 'seed',
    createdAt: '2026-06-08T00:00:00.000Z',
    updatedAt: '2026-06-08T00:00:00.000Z',
  });
  const versionId = newId('certver');
  repository.createVersion({
    id: versionId,
    certificateAssetId: assetId,
    versionNo: 1,
    commonName: input.primaryDomain,
    sans: [input.primaryDomain],
    issuer: { raw: 'CN=GCAC' },
    subject: { raw: `CN=${input.primaryDomain}` },
    serialNumber: `serial_${input.primaryDomain}`,
    notBefore: '2026-01-01T00:00:00.000Z',
    notAfter: input.notAfter,
    fingerprintSha256: newId('fp').replace(/_/g, '').padEnd(64, 'a').slice(0, 64),
    publicKeyAlgorithm: 'RSA',
    signatureAlgorithm: 'sha256WithRSAEncryption',
    leafStorageRef: `artifact://certificate-leaf/${versionId}`,
    chainCertificateRefs: [],
    chainOrder: [],
    chainDiagnostics: [],
    chainStatus: 'valid',
    deployable: true,
    sourceType: 'manual',
    status: 'active',
    createdBy: 'seed',
    createdAt: '2026-06-08T00:00:00.000Z',
  });
  repository.updateAsset(assetId, { currentVersionId: versionId });
  return versionId;
}

function createRisk(type: RiskEventType) {
  return {
    id: newId('risk'),
    dedupKey: newId('dedup'),
    type,
    source: 'certificate' as const,
    status: 'OPEN' as const,
    severity: 'high' as const,
    title: type,
    summary: type,
    scope: {},
    metadata: {},
    firstDetectedAt: '2026-06-08T00:00:00.000Z',
    lastDetectedAt: '2026-06-08T00:00:00.000Z',
    occurrenceCount: 1,
  };
}
