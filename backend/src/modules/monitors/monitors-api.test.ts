import assert from 'node:assert/strict';
import { createHash, X509Certificate } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { describe, it } from 'node:test';
import { App } from '../../common/http/app.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { AssetsApplicationService } from '../assets/application/assets.application-service.js';
import { PgAssetsRepository } from '../assets/repository/assets.repository.js';
import { BindingsApplicationService } from '../bindings/application/bindings.application-service.js';
import { PgBindingsRepository } from '../bindings/repository/bindings.repository.js';
import type { CertificateBindingDto } from '../bindings/dto/bindings.dto.js';
import { PgCertificatesRepository } from '../certificates/repository/certificates.repository.js';
import { MonitorsApplicationService } from './application/monitors.application-service.js';
import { MonitorsController } from './controller/monitors.controller.js';
import { MonitorsDomainService, riskDedupKey } from './domain/monitors.domain-service.js';
import { PgMonitorsRepository } from './repository/monitors.repository.js';
import { ExecutionsRepository } from '../executions/repository/executions.repository.js';
import { newId } from '../../shared/id.js';
import type { RiskEventType } from './schema/monitors.schema.js';
import { NotificationsApplicationService } from '../notifications/application/notifications.application-service.js';
import { NotificationsController } from '../notifications/controller/notifications.controller.js';
import { PgNotificationsRepository } from '../notifications/repository/notifications.repository.js';

const CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDVDCCAjygAwIBAgIUG5ildtPXNPyfiDQ1eus6hH5dRFowDQYJKoZIhvcNAQEL
BQAwJTEUMBIGA1UEAwwLZXhhbXBsZS5jb20xDTALBgNVBAoMBEdDQUMwHhcNMjYw
NjA4MDkwOTU0WhcNMjcwNjA4MDkwOTU0WjAlMRQwEgYDVQQDDAtleGFtcGxlLmNv
bTENMAsGA1UECgwER0NBQzCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEB
ANnmaaLnxtwDFZBfUmKgdJL5NPCkxIWunc+vrTi1dEXkGLlzppat6C8YGWc+fFvY
Ym+IBrukthZ7KEsjnum2rkKMEMl+a+lUPi2NDVAvy6ZyswouyxtuJnh5rC5GcReu
esZTQ0bR/SMgI8umYUu2A7fDfna9LnXjkXxqyb7ZY5gvVUyjaC3/gINJQ945JBxC
BO8PerlOXuRKbHXPAbeOuo0nsaiD7nMcmZ6BE5c4HvTLDfDKBzZNLaKwxwWrIr5l
tEhg0Zm7mhtLTYZkg/UzKpbuNOr4Zd48tMtVUzlyQeRxgGTJHcnZdSX3oaizfv88
FFhExjQwqpWaTHoiTXfk5SMCAwEAAaN8MHowHQYDVR0OBBYEFM3GnbaMzOx3k1qa
8XB2S4Zq+lw1MB8GA1UdIwQYMBaAFM3GnbaMzOx3k1qa8XB2S4Zq+lw1MA8GA1Ud
EwEB/wQFMAMBAf8wJwYDVR0RBCAwHoILZXhhbXBsZS5jb22CD3d3dy5leGFtcGxl
LmNvbTANBgkqhkiG9w0BAQsFAAOCAQEAsW/aieACElxUDvOF4jcto6lQAv30DZg3
q82o2sGsTcInQC987HN2AYK5v3uj9CyWT5OJmeFkJrRekeaFnnutGYyQoRsfJ16u
YrVXYshRygqzFzQ6WoWEnD9mN+eILLl9kkrPlNX8mV7ly+NuMEk+Y43WTo19lrg3
li+tUg7XYIzac937W72xTG2rrZ2MUqM+rNNSWjKh8hw32x6b0s1t6j7kKJxuPDJ7
ypU+DoduyO53xf/mnvIGcDUESJvwRZ7Iffi1pp99oPh73SWPRyLTaYBcsPbbsi/f
aAQqw3mzHJgVJXhAdmNXmxWG/TCNanalPXMpyLNYSW32L2rZKdE+UQ==
-----END CERTIFICATE-----`;

const PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQDZ5mmi58bcAxWQ
X1JioHSS+TTwpMSFrp3Pr604tXRF5Bi5c6aWregvGBlnPnxb2GJviAa7pLYWeyhL
I57ptq5CjBDJfmvpVD4tjQ1QL8umcrMKLssbbiZ4eawuRnEXrnrGU0NG0f0jICPL
pmFLtgO3w352vS5145F8asm+2WOYL1VMo2gt/4CDSUPeOSQcQgTvD3q5Tl7kSmx1
zwG3jrqNJ7Gog+5zHJmegROXOB70yw3wygc2TS2isMcFqyK+ZbRIYNGZu5obS02G
ZIP1MyqW7jTq+GXePLTLVVM5ckHkcYBkyR3J2XUl96Gos37/PBRYRMY0MKqVmkx6
Ik135OUjAgMBAAECggEAGW5futsZOvlYgsfqmhyHA9ZLsaBRWBbX+p19dpEQTSNA
0s18I7mP+oXHWo+Q57lFTSYPlHE2ApaveQw4Z6eMsV3z4Z28eM1+ZPDsR6+5sXym
h77hW/C1qGRETlxQplu/SYv93fNJJi3XRP/vUBeiBHMFEf+kv1k8KXdfLMPmG08y
Tu4TGdu6prKXluOjKJKCmxyjcMMiMKs3KGEHFeZpehhCBZw/BAcUeJj4P0IOax5G
MLMyouiH8qz1ZZ43tOBGgF9gc2x7WK5yvEmAyfVE9bkehD7dzEyeYTzoym5tEebX
MK785Iu3z8fma7qmxDHG5tIrooaN/TNq2b6582pc0QKBgQD+XWrIQYCFM21tk1E9
GcgttA2xmYHne6gq+ZaFWE2Bemzf/oKFFtVyuauyASYnKLqv7uEc0LnTSF2hIkAP
qA/jSGUJ9wqbvcakz6TvDUfgYDamTnqp0EdlQj3Z+uMd/uoT+SOblJnyJTOi+NdR
EMUCxzY1OoaQ5gBun1JezQ4GMQKBgQDbTP0r2XUvodx2oJFzMC7/bEEV0Qg6KrJc
OsEdGsQL/W9+JW5IUqQlYb97F97Cg5MPPRkjlLM8tBHkUdiNbjyrHnpdt8d50P/O
ViMiFIPKDhUzimka32fKoPN7bkdmJ5EPP0Qa8YC4UcPZQi9Ptm5DVP0OzqDANAOE
EA2y2mwHkwKBgQCzM2cWXCdKMDgIuX/DVxWTNUVseKRvS8vnMt1bZiF8dZ6ck/aq
ArMv1yTiDDMv5V7YsaeAoIA6HMJx0epl3VYMHqWoRpX/sMxwsiUVkTqxFbeKpMGA
P079RJTErB8zs7J/jccLRb7LPHBLgZpX70OMuII1L9072f418SKbzUTzEQKBgQCj
rTigS7NtE6/KUll80Y+iUBfbwqITV967e5a6tElycXuPeTxwek3NIMGbi9tU7oMK
Mp3aspd8TSG1eWjZVletmBfYbtxRDS5/wEaEny8l1ZD5YOrFhcyfrbVMgKiFlC5u
ZNfeDDX4W/6C3yUUp6JwWrRtIsdT7P5ayOiQfvl2RQKBgQCajPXye+yJqWQboUyF
C38mSIcEm7mdLCLa7psXWxsMvH15ynl34RzjI/Ne3iWIVWHbnJ9yitudvM1UcdiX
PyyRtpZNjzHF1i72Y3Ox3WRenxBqp+KjnkkOMTrK8YqxeMXgQ1XBPXXSjhrn8yD8
HVlUi9P3lKu3lUEi2bOiP2KYvg==
-----END PRIVATE KEY-----`;

describe('监控风险 API', () => {
  it('生成证书到期、绑定漂移、未知证书和执行失败风险，并返回仪表盘聚合', async () => {
    const { app, assetsService, bindingsService, certificatesRepository, executionsRepository } = await createMonitorHarness();
    const headers = { 'x-tenant-id': 'tenant_monitor', 'x-actor-id': 'monitor_bot' };
    await seedCertificate(certificatesRepository, { primaryDomain: 'expired.example.com', notAfter: '2026-01-01T00:00:00.000Z' });
    const driftCertificateVersionId = await seedCertificate(certificatesRepository, { primaryDomain: 'expiring.example.com', notAfter: '2026-06-20T00:00:00.000Z' });

    const host = await assetsService.createHost('tenant_monitor', {
      hostname: 'monitor-host.example.com',
      osType: 'LINUX',
      compatibilityLevel: 'L1',
      managementMode: 'AGENT',
    });
    const service = await assetsService.createFrameworkInstance('tenant_monitor', {
      deviceId: host.id,
      frameworkType: 'web.nginx',
      frameworkKey: 'nginx:default',
      discoveryProviderKey: 'manual.discovery',
      displayName: 'monitor nginx',
    });
    await bindingsService.createCertificateBinding('tenant_monitor', {
      serviceInstanceId: service.id,
      domainName: 'drift.example.com',
      port: 443,
      protocol: 'HTTPS',
      bindingType: 'FILE_PATH',
      certPath: '/etc/nginx/drift.pem',
      verifyMethod: 'LOCAL_FILE',
      certificateVersionId: driftCertificateVersionId,
      desiredFingerprintSha256: 'a'.repeat(64),
      observedFingerprintSha256: 'b'.repeat(64),
      status: 'DRIFTED',
    });
    await bindingsService.createCertificateBinding('tenant_monitor', {
      serviceInstanceId: service.id,
      domainName: 'unknown.example.com',
      port: 8443,
      protocol: 'HTTPS',
      bindingType: 'FILE_PATH',
      certPath: '/etc/nginx/unknown.pem',
      verifyMethod: 'LOCAL_FILE',
    });

    await executionsRepository.createRun({
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
    const { app, certificatesRepository } = await createMonitorHarness();
    const headers = { 'x-tenant-id': 'tenant_monitor_dedup', 'x-actor-id': 'monitor_bot' };
    await seedCertificate(certificatesRepository, { primaryDomain: 'dedup.example.com', notAfter: '2026-06-10T00:00:00.000Z' });

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
    const { app, certificatesRepository } = await createMonitorHarness();
    const headers = { 'x-tenant-id': 'tenant_monitor_rules', 'x-actor-id': 'monitor_bot' };
    await seedCertificate(certificatesRepository, { primaryDomain: 'rule.example.com', notAfter: '2026-06-09T00:00:00.000Z' });

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
    const result = scanned.body as { matchedRuleIds: string[]; alertDispatches: Array<{ ruleId: string; riskId: string; status: string; requestId: string; reason: string }> };
    assert.equal(result.matchedRuleIds.length, 1);
    assert.equal(result.matchedRuleIds[0], (activeRule.body as { id: string }).id);
    assert.equal(result.alertDispatches.length, 1);
    assert.equal(result.alertDispatches[0]?.ruleId, (activeRule.body as { id: string }).id);
    assert.equal(result.alertDispatches[0]?.status, 'persisted', JSON.stringify(result.alertDispatches));
    assert.equal(result.alertDispatches[0]?.reason, 'notification_request_persisted');
    assert.ok(result.alertDispatches[0]?.requestId);

    const notificationRequest = await app.inject({
      method: 'GET',
      path: `/api/v1/notification-requests/${result.alertDispatches[0]!.requestId}`,
      headers,
    });
    assert.equal(notificationRequest.statusCode, 200);
    assert.equal((notificationRequest.body as { source: string }).source, 'monitor');

    const rescanned = await app.inject({
      method: 'POST',
      path: '/api/v1/monitors/scan',
      headers,
      body: { scanStartedAt: '2026-06-08T12:00:00.000Z', certificateExpiringThresholdDays: 30 },
    });
    assert.equal(rescanned.statusCode, 201);
    const repeated = rescanned.body as { alertDispatches: Array<{ requestId: string }> };
    assert.equal(repeated.alertDispatches[0]?.requestId, result.alertDispatches[0]?.requestId);

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

  it('监控调度会生成证书、绑定、执行、Agent、Capability 五类 queued job', async () => {
    const { monitors } = await createMonitorHarness();
    const jobs = monitors.createMonitorJobs({
      tenantId: 'tenant_jobs',
      scope: { hostId: 'host_1' },
      now: '2026-06-08T00:00:00.000Z',
    });
    assert.deepEqual(jobs.map((job) => job.kind).sort(), ['agent', 'binding', 'capability', 'certificate', 'execution']);
    assert.equal(jobs.every((job) => job.status === 'queued'), true);
    assert.equal(jobs.every((job) => job.scope.tenantId === 'tenant_jobs' && job.scope.hostId === 'host_1'), true);
  });

  it('监控目标通过后端持久化，并由后端调度写入探测结果', async () => {
    const { app, assetsService, monitors } = await createMonitorHarness();
    const headers = { 'x-tenant-id': 'tenant_monitor_targets', 'x-actor-id': 'monitor_bot' };
    const asset = await assetsService.createServiceAsset('tenant_monitor_targets', {
      address: '127.0.0.1',
      port: 9,
      protocol: 'HTTP',
      platform: 'LINUX',
      discoverySource: 'MANUAL',
      status: 'ACTIVE',
    });

    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/monitors/targets',
      headers,
      body: { serviceAssetId: asset.id, intervalSeconds: 60, metrics: ['availability', 'latency'] },
    });
    assert.equal(created.statusCode, 201);
    const target = created.body as { id: string; serviceAssetId: string; assetId: string; intervalSeconds: number; createdBy: string };
    assert.equal(target.serviceAssetId, asset.id);
    assert.equal(target.assetId, asset.id);
    assert.equal(target.intervalSeconds, 60);
    assert.equal(target.createdBy, 'monitor_bot');

    const duplicate = await app.inject({
      method: 'POST',
      path: '/api/v1/monitors/targets',
      headers,
      body: { serviceAssetId: asset.id, intervalSeconds: 60 },
    });
    assert.equal(duplicate.statusCode, 409);

    const listed = await app.inject({ method: 'GET', path: '/api/v1/monitors/targets?page=1&pageSize=20', headers });
    assert.equal(listed.statusCode, 200);
    assert.equal((listed.body as { total: number }).total, 1);

    const firstRun = await monitors.runDueMonitorTargetProbes({ maxTargets: 5, now: '2026-07-04T00:00:00.000Z' });
    assert.equal(firstRun.checkedCount, 1);
    const probeResults = await app.inject({ method: 'GET', path: '/api/v1/monitors/probe-results?page=1&pageSize=20', headers });
    assert.equal(probeResults.statusCode, 200);
    const probePage = probeResults.body as { total: number; items: Array<{ monitorTargetId: string; serviceAssetId: string; status: string }> };
    assert.equal(probePage.total, 1);
    assert.equal(probePage.items[0]!.monitorTargetId, target.id);
    assert.equal(probePage.items[0]!.serviceAssetId, asset.id);
    assert.equal(['READY', 'WARNING', 'ERROR'].includes(probePage.items[0]!.status), true);

    const secondRun = await monitors.runDueMonitorTargetProbes({ maxTargets: 5, now: '2026-07-04T00:00:10.000Z' });
    assert.equal(secondRun.checkedCount, 0);
    assert.equal(secondRun.skippedCount >= 1, true);

    const updated = await app.inject({
      method: 'PATCH',
      path: '/api/v1/monitors/targets',
      headers,
      body: { id: target.id, intervalSeconds: 120 },
    });
    assert.equal(updated.statusCode, 200);
    assert.equal((updated.body as { intervalSeconds: number; version: number }).intervalSeconds, 120);
    assert.equal((updated.body as { intervalSeconds: number; version: number }).version, 2);

    const deleted = await app.inject({
      method: 'POST',
      path: '/api/v1/monitors/targets/delete',
      headers,
      body: { id: target.id },
    });
    assert.equal(deleted.statusCode, 200);
    assert.equal(typeof (deleted.body as { deletedAt?: string }).deletedAt, 'string');

    const empty = await app.inject({ method: 'GET', path: '/api/v1/monitors/targets?page=1&pageSize=20', headers });
    assert.equal((empty.body as { total: number }).total, 0);
  });

  it('应用资产探测由监控 API 发起，不依赖浏览器或资产绑定 Agent 直连业务地址', async () => {
    const { app, assetsService, monitors } = await createMonitorHarness();
    const headers = { 'x-tenant-id': 'tenant_probe', 'x-actor-id': 'monitor_bot' };
    const asset = await assetsService.createServiceAsset('tenant_probe', {
      address: '127.0.0.1',
      port: 9,
      protocol: 'HTTP',
      platform: 'LINUX',
      discoverySource: 'MANUAL',
      status: 'ACTIVE',
    });

    const direct = await monitors.probeServiceAsset({
      tenantId: 'tenant_probe',
      serviceAssetId: asset.id,
      timeoutMs: 1000,
    });
    assert.equal(direct.serviceAssetId, asset.id);
    assert.equal(direct.source, 'control_plane');
    assert.equal(direct.url, 'http://127.0.0.1:9/');
    assert.equal(typeof direct.latencyMs, 'number');

    const response = await app.inject({
      method: 'POST',
      path: '/api/v1/monitors/probe',
      headers,
      body: { serviceAssetId: asset.id, timeoutMs: 1000 },
    });
    assert.equal(response.statusCode, 200);
    assert.equal((response.body as { serviceAssetId: string }).serviceAssetId, asset.id);
  });

  it('应用资产存在活动风险时每次探测都持久化为警告状态', async () => {
    const server = createHttpServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as { port: number }).port;

    try {
      const { assetsService, monitors } = await createMonitorHarness();
      const tenantId = 'tenant_probe_active_risk';
      const asset = await assetsService.createServiceAsset(tenantId, {
        address: '127.0.0.1',
        port,
        protocol: 'HTTP',
        platform: 'LINUX',
        discoverySource: 'MANUAL',
        status: 'ACTIVE',
      });
      const target = await monitors.createMonitorTarget({
        tenantId,
        serviceAssetId: asset.id,
        intervalSeconds: 60,
        metrics: ['availability', 'latency'],
        createdBy: 'monitor_test',
      });
      await monitors.getRepository().upsertRiskEvent({
        dedupKey: riskDedupKey(['certificate', 'expiring', tenantId, asset.id]),
        type: 'certificate_expiring',
        source: 'certificate',
        severity: 'medium',
        title: '证书待更新',
        summary: '系统探测证书尚未应用最新版本',
        scope: { tenantId, serviceAssetId: asset.id },
        detectedAt: '2026-08-01T00:00:00.000Z',
      });

      const result = await monitors.probeServiceAsset({
        tenantId,
        monitorTargetId: target.id,
        serviceAssetId: asset.id,
        timeoutMs: 1000,
      });
      assert.equal(result.status, 'WARNING');
      assert.match(result.message, /系统探测证书尚未应用最新版本/);
      assert.deepEqual(result.detail?.activeRiskTypes, ['certificate_expiring']);

      const saved = await monitors.listMonitorProbeResults({ tenantId, serviceAssetId: asset.id });
      assert.equal(saved[0]?.status, 'WARNING');
      assert.deepEqual(saved[0]?.detail.activeRiskTypes, ['certificate_expiring']);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('实测证书切换到绑定指向的最新版本后自动解决证书未切换风险', async () => {
    const server = createHttpsServer({
      key: PRIVATE_KEY_PEM,
      cert: CERT_PEM,
    }, (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as { port: number }).port;

    try {
      const { assetsService, bindingsService, certificatesRepository, monitors } = await createMonitorHarness();
      const tenantId = 'tenant_probe_certificate_recovered';
      const asset = await assetsService.createServiceAsset(tenantId, {
        address: '127.0.0.1',
        port,
        protocol: 'HTTPS',
        sniName: 'example.com',
        platform: 'LINUX',
        discoverySource: 'MANUAL',
        status: 'ACTIVE',
      });
      const host = await assetsService.createHost(tenantId, {
        hostname: 'certificate-recovered.example.com',
        osType: 'LINUX',
        compatibilityLevel: 'L1',
        managementMode: 'AGENT',
      });
      const service = await assetsService.createFrameworkInstance(tenantId, {
        deviceId: host.id,
        frameworkType: 'web.nginx',
        frameworkKey: 'nginx:certificate-recovered',
        discoveryProviderKey: 'manual.discovery',
        displayName: 'certificate recovered nginx',
      });
      const versionId = await seedCertificate(certificatesRepository, {
        primaryDomain: 'certificate-recovered.example.com',
        notAfter: '2026-10-30T00:00:00.000Z',
      });
      const version = await certificatesRepository.getVersion(versionId);
      assert.ok(version);
      const certificate = new X509Certificate(CERT_PEM);
      const fingerprint = createHash('sha256').update(certificate.raw).digest('hex').toUpperCase();
      await certificatesRepository.updateVersion(version.id, { fingerprintSha256: fingerprint });
      await certificatesRepository.updateAsset(version.certificateAssetId, { currentVersionId: version.id });
      const binding = await bindingsService.createCertificateBinding(tenantId, {
        serviceAssetId: asset.id,
        serviceInstanceId: service.id,
        domainName: 'certificate-recovered.example.com',
        port,
        protocol: 'HTTPS',
        bindingType: 'FILE_PATH',
        certPath: '/etc/nginx/certificate-recovered.pem',
        verifyMethod: 'TLS_CONNECT',
        certificateVersionId: version.id,
        desiredFingerprintSha256: fingerprint,
        status: 'DRIFTED',
      });
      const risk = await monitors.getRepository().upsertRiskEvent({
        dedupKey: riskDedupKey(['certificate', 'observed-update-pending', tenantId, asset.id, version.certificateAssetId]),
        type: 'certificate_update_pending',
        source: 'certificate',
        severity: 'medium',
        title: '证书待更新',
        summary: '系统探测证书尚未切换到最新版本',
        scope: { tenantId, serviceAssetId: asset.id },
        metadata: {
          latestFingerprintSha256: fingerprint,
          latestCertificateVersionId: version.id,
        },
        detectedAt: '2026-08-02T11:20:50.000Z',
      });

      const target = await monitors.createMonitorTarget({
        tenantId,
        serviceAssetId: asset.id,
        intervalSeconds: 60,
        metrics: ['availability', 'certificate'],
        createdBy: 'monitor_test',
      });
      await monitors.getRepository().saveCertificateObservation({
        tenantId,
        serviceAssetId: asset.id,
        source: 'control_plane',
        url: `https://127.0.0.1:${port}/`,
        observedAt: '2026-08-02T11:20:49.000Z',
        fingerprintSha256: fingerprint,
        subject: 'CN=example.com',
        issuer: 'CN=example.com',
        serialNumber: 'serial',
        notBefore: '2026-06-08T09:09:54.000Z',
        notAfter: '2027-06-08T09:09:54.000Z',
        verified: true,
        rawResult: { source: 'test' },
      });
      await monitors.getRepository().saveMonitorProbeResult({
        tenantId,
        monitorTargetId: target.id,
        result: {
          serviceAssetId: asset.id,
          source: 'control_plane',
          url: `https://127.0.0.1:${port}/`,
          status: 'WARNING',
          success: true,
          latencyMs: 1,
          checkedAt: '2026-08-02T11:20:49.000Z',
          message: '历史探测结果',
          certificate: { fingerprintSha256: fingerprint },
        },
      });

      const scheduled = await monitors.runDueMonitorTargetProbes({
        maxTargets: 5,
        now: '2026-08-02T11:20:51.000Z',
      });
      assert.equal(scheduled.checkedCount, 0);
      assert.equal(scheduled.skippedCount, 1);

      const recoveredFromStoredObservation = (await monitors.listRiskEvents({ tenantId }))
        .find((item) => item.id === risk.id);
      assert.equal(recoveredFromStoredObservation?.status, 'RESOLVED');

      const result = await monitors.probeServiceAsset({
        tenantId,
        serviceAssetId: asset.id,
        timeoutMs: 1000,
      });
      assert.equal(result.certificate?.fingerprintSha256, fingerprint);

      const resolved = (await monitors.listRiskEvents({ tenantId })).find((item) => item.id === risk.id);
      assert.equal(resolved?.status, 'RESOLVED');
      const updatedBinding = await bindingsService.getRepository().getCertificateBinding(tenantId, binding.id);
      assert.equal(updatedBinding?.observedFingerprintSha256?.toUpperCase(), fingerprint);
      assert.equal(updatedBinding?.driftStatus, 'synced');
      assert.equal(updatedBinding?.status, 'MANAGED');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('监控 URL 含 @ 时返回明确配置错误，避免误测到用户名后的主机', async () => {
    const { assetsService, monitors } = await createMonitorHarness();
    const asset = await assetsService.createServiceAsset('tenant_probe_userinfo', {
      address: 'test03@jacksonz.cn',
      port: 8444,
      protocol: 'HTTPS',
      platform: 'LINUX',
      discoverySource: 'MANUAL',
      status: 'ACTIVE',
    });

    const result = await monitors.probeServiceAsset({
      tenantId: 'tenant_probe_userinfo',
      serviceAssetId: asset.id,
      timeoutMs: 1000,
    });

    assert.equal(result.status, 'ERROR');
    assert.equal(result.success, false);
    assert.match(result.message, /实际解析主机为 jacksonz\.cn/);
    assert.match(result.message, /test03\.jacksonz\.cn/);
    assert.equal(result.detail?.invalidUrlUserInfo, true);
  });

  it('HTTPS 站点可达但证书不受系统信任时返回黄色警告并保留证书观测', async () => {
    const server = createHttpsServer({
      key: PRIVATE_KEY_PEM,
      cert: CERT_PEM,
    }, (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as { port: number }).port;

    try {
      const { app, assetsService, monitors } = await createMonitorHarness();
      const headers = { 'x-tenant-id': 'tenant_probe_tls_warning', 'x-actor-id': 'monitor_bot' };
      const asset = await assetsService.createServiceAsset('tenant_probe_tls_warning', {
        address: '127.0.0.1',
        port,
        protocol: 'HTTPS',
        sniName: 'example.com',
        platform: 'LINUX',
        discoverySource: 'MANUAL',
        status: 'ACTIVE',
      });

      const direct = await monitors.probeServiceAsset({
        tenantId: 'tenant_probe_tls_warning',
        serviceAssetId: asset.id,
        timeoutMs: 1000,
      });
      assert.equal(direct.status, 'WARNING');
      assert.equal(direct.success, true);
      assert.equal(direct.httpStatus, 200);
      assert.match(direct.message, /站点可达，但证书存在错误/);
      assert.equal(direct.certificate?.verified, false);
      assert.ok(direct.certificate?.fingerprintSha256);

      const observations = await app.inject({
        method: 'GET',
        path: `/api/v1/monitors/certificate-observations?serviceAssetId=${asset.id}`,
        headers,
      });
      assert.equal(observations.statusCode, 200);
      const observationPage = observations.body as { total: number; items: Array<{ serviceAssetId: string; verified?: boolean; verificationError?: string }> };
      assert.equal(observationPage.total, 1);
      assert.equal(observationPage.items[0]!.serviceAssetId, asset.id);
      assert.equal(observationPage.items[0]!.verified, false);
      assert.ok(observationPage.items[0]!.verificationError);

      const risks = await monitors.listRiskEvents({ tenantId: 'tenant_probe_tls_warning' });
      const chainRisk = risks.find((risk) => risk.type === 'tls_chain_invalid');
      assert.equal(chainRisk?.source, 'monitor');
      assert.equal(chainRisk?.scope.serviceAssetId, asset.id);
      assert.match(chainRisk?.summary ?? '', /系统探测证书链验证失败/);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('HTTPS 实测证书指纹未变化但链状态变化时更新原有证书观测', async () => {
    const server = createHttpsServer({
      key: PRIVATE_KEY_PEM,
      cert: CERT_PEM,
    }, (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as { port: number }).port;

    try {
      const { app, assetsService, monitors } = await createMonitorHarness();
      const tenantId = 'tenant_probe_tls_unchanged';
      const headers = { 'x-tenant-id': tenantId, 'x-actor-id': 'monitor_bot' };
      const asset = await assetsService.createServiceAsset(tenantId, {
        address: '127.0.0.1',
        port,
        protocol: 'HTTPS',
        sniName: 'example.com',
        platform: 'LINUX',
        discoverySource: 'MANUAL',
        status: 'ACTIVE',
      });
      const certificate = new X509Certificate(CERT_PEM);
      const fingerprint = createHash('sha256').update(certificate.raw).digest('hex').toUpperCase();
      const url = `https://127.0.0.1:${port}/`;
      await monitors.getRepository().saveCertificateObservation({
        tenantId,
        serviceAssetId: asset.id,
        source: 'control_plane',
        url,
        observedAt: '2026-07-07T10:00:00.000Z',
        fingerprintSha256: fingerprint,
        subject: 'CN=example.com, O=GCAC',
        issuer: 'CN=example.com, O=GCAC',
        serialNumber: certificate.serialNumber,
        notBefore: certificate.validFrom,
        notAfter: certificate.validTo,
        dnsNames: ['example.com', 'www.example.com'],
        verified: false,
        verificationError: 'SELF_SIGNED_CERT_IN_CHAIN',
      });

      const direct = await monitors.probeServiceAsset({
        tenantId,
        serviceAssetId: asset.id,
        timeoutMs: 1000,
      });
      assert.equal(direct.status, 'WARNING');
      assert.equal(direct.certificate?.fingerprintSha256, fingerprint);

      const observations = await app.inject({
        method: 'GET',
        path: `/api/v1/monitors/certificate-observations?serviceAssetId=${asset.id}`,
        headers,
      });
      assert.equal(observations.statusCode, 200);
      const observationPage = observations.body as { total: number; items: Array<{ fingerprintSha256: string; observedAt: string }> };
      assert.equal(observationPage.total, 1);
      assert.equal(observationPage.items[0]!.fingerprintSha256, fingerprint);
      assert.equal(new Date(observationPage.items[0]!.observedAt).toISOString(), '2026-07-07T10:00:00.000Z');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('工作流资产探测会使用 metadata.workflowTarget 的验证地址和 SNI', async () => {
    const server = createHttpsServer({
      key: PRIVATE_KEY_PEM,
      cert: CERT_PEM,
    }, (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as { port: number }).port;

    try {
      const { assetsService, monitors } = await createMonitorHarness();
      const asset = await assetsService.createServiceAsset('tenant_probe_workflow_target', {
        address: 'bad@address.example',
        port: 443,
        protocol: 'HTTPS',
        platform: 'LINUX',
        discoverySource: 'MANUAL',
        status: 'ACTIVE',
        metadata: {
          workflowTarget: {
            verifyUrl: `https://127.0.0.1:${port}/health`,
            sniName: 'example.com',
            port,
            protocol: 'HTTPS',
          },
        },
      });

      const result = await monitors.probeServiceAsset({
        tenantId: 'tenant_probe_workflow_target',
        serviceAssetId: asset.id,
        timeoutMs: 1000,
      });

      assert.equal(result.url, `https://127.0.0.1:${port}/health`);
      assert.equal(result.status, 'WARNING');
      assert.ok(result.certificate?.fingerprintSha256);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('远程 TLS 观测能生成链异常、域名错配和指纹错配风险并进入聚合', async () => {
    const { monitors } = await createMonitorHarness();
    const risks = await monitors.ingestRemoteTlsObservation({
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
    const dashboard = await monitors.getDashboard('tenant_tls');
    assert.equal(dashboard.tlsIssueCount, 3);
    assert.equal(dashboard.totalActiveCount, 3);
  });

  it('绑定目标版本或目标指纹可单独作为证书映射依据', () => {
    const baseBinding: CertificateBindingDto = {
      id: 'binding_target_mapping',
      tenantId: 'tenant_target_mapping',
      serviceInstanceId: 'service_target_mapping',
      bindingKey: 'test.jacksonz.cn:443',
      bindingType: 'FILE_PATH',
      verifyMethod: 'TLS_CONNECT',
      status: 'MANAGED',
      metadata: {},
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      version: 1,
    };
    const domain = new MonitorsDomainService();

    assert.equal(domain.buildBindingRiskEvent({ ...baseBinding, targetCertificateVersionId: 'certver_target' }), undefined);
    assert.equal(domain.buildBindingRiskEvent({ ...baseBinding, targetFingerprintSha256: 'a'.repeat(64) }), undefined);
    assert.equal(domain.buildBindingRiskEvent(baseBinding)?.type, 'binding_unknown_certificate');
  });

  it('绑定补齐证书映射后自动解决历史未知证书风险', async () => {
    const { assetsService, bindingsService, monitors } = await createMonitorHarness();
    const tenantId = 'tenant_binding_mapping_reconciled';
    const host = await assetsService.createHost(tenantId, {
      hostname: 'mapping-reconciled.example.com',
      osType: 'LINUX',
      compatibilityLevel: 'L1',
      managementMode: 'AGENT',
    });
    const service = await assetsService.createFrameworkInstance(tenantId, {
      deviceId: host.id,
      frameworkType: 'web.nginx',
      frameworkKey: 'nginx:mapping-reconciled',
      discoveryProviderKey: 'manual.discovery',
      displayName: 'mapping reconciled nginx',
    });
    const binding = await bindingsService.createCertificateBinding(tenantId, {
      serviceInstanceId: service.id,
      domainName: 'mapping-reconciled.example.com',
      port: 443,
      protocol: 'HTTPS',
      bindingType: 'FILE_PATH',
      certPath: '/etc/nginx/mapping-reconciled.pem',
      verifyMethod: 'TLS_CONNECT',
    });

    await monitors.collectRisks({ tenantId, scanStartedAt: '2026-08-01T10:00:00.000Z' });
    const openRisk = (await monitors.listRiskEvents({ tenantId }))
      .find((risk) => risk.type === 'binding_unknown_certificate');
    assert.equal(openRisk?.status, 'OPEN');

    await bindingsService.updateCertificateBinding(tenantId, binding.id, {
      targetFingerprintSha256: 'a'.repeat(64),
    });
    await monitors.collectRisks({ tenantId, scanStartedAt: '2026-08-01T10:05:00.000Z' });
    const resolvedRisk = (await monitors.listRiskEvents({ tenantId }))
      .find((risk) => risk.id === openRisk?.id);
    assert.equal(resolvedRisk?.status, 'RESOLVED');
  });

  it('绑定移出监控范围后自动解决历史未知证书风险', async () => {
    const { assetsService, bindingsService, monitors } = await createMonitorHarness();
    const tenantId = 'tenant_binding_removed';
    const host = await assetsService.createHost(tenantId, {
      hostname: 'binding-removed.example.com',
      osType: 'LINUX',
      compatibilityLevel: 'L1',
      managementMode: 'AGENT',
    });
    const service = await assetsService.createFrameworkInstance(tenantId, {
      deviceId: host.id,
      frameworkType: 'web.nginx',
      frameworkKey: 'nginx:binding-removed',
      discoveryProviderKey: 'manual.discovery',
      displayName: 'binding removed nginx',
    });
    const binding = await bindingsService.createCertificateBinding(tenantId, {
      serviceInstanceId: service.id,
      domainName: 'binding-removed.example.com',
      port: 443,
      protocol: 'HTTPS',
      bindingType: 'FILE_PATH',
      certPath: '/etc/nginx/binding-removed.pem',
      verifyMethod: 'TLS_CONNECT',
    });

    await monitors.collectRisks({ tenantId, scanStartedAt: '2026-08-01T10:00:00.000Z' });
    const openRisk = (await monitors.listRiskEvents({ tenantId }))
      .find((risk) => risk.type === 'binding_unknown_certificate');
    assert.equal(openRisk?.status, 'OPEN');

    await bindingsService.deleteCertificateBinding(tenantId, { bindingId: binding.id });
    await monitors.collectRisks({ tenantId, scanStartedAt: '2026-08-01T10:05:00.000Z' });
    const resolvedRisk = (await monitors.listRiskEvents({ tenantId }))
      .find((risk) => risk.id === openRisk?.id);
    assert.equal(resolvedRisk?.status, 'RESOLVED');
  });

  it('自动化健康采集能生成 Agent 离线和 Capability 降级风险', async () => {
    const { monitors } = await createMonitorHarness();
    const offline = await monitors.ingestAutomationHealth({
      tenantId: 'tenant_auto',
      hostId: 'host_auto_1',
      agentStatus: 'OFFLINE',
      checkedAt: '2026-06-08T03:00:00.000Z',
    });
    const degraded = await monitors.ingestAutomationHealth({
      tenantId: 'tenant_auto',
      serviceInstanceId: 'svc_auto_1',
      capabilityKey: 'manual.record',
      compatibilityLevel: 'L5',
      checkedAt: '2026-06-08T03:05:00.000Z',
    });
    assert.equal(offline?.type, 'agent_offline');
    assert.equal(degraded?.type, 'capability_degraded');
    const dashboard = await monitors.getDashboard('tenant_auto');
    assert.equal(dashboard.automationBlockedCount, 2);
    assert.equal(dashboard.totalActiveCount, 2);
  });
});

async function createMonitorHarness() {
  const db = new PgliteDatabase();
  await runMigrations(db);

  const app = new App();
  const assetsRepository = new PgAssetsRepository(db);
  const assetsService = new AssetsApplicationService(assetsRepository);
  const bindingsRepository = new PgBindingsRepository(assetsRepository, db);
  const bindingsService = new BindingsApplicationService(assetsRepository, bindingsRepository);
  assetsService.setBindingsRepository(bindingsRepository);

  const certificatesRepository = new PgCertificatesRepository(db);
  const executionsRepository = new ExecutionsRepository();
  const notifications = new NotificationsApplicationService(new PgNotificationsRepository(db));
  const monitors = new MonitorsApplicationService({
    repository: new PgMonitorsRepository(db),
    certificates: certificatesRepository,
    bindings: bindingsRepository,
    executions: executionsRepository,
    assets: assetsRepository,
    notifications,
  });
  new MonitorsController(monitors).register(app.router);
  new NotificationsController(notifications).register(app.router);
  return {
    app,
    assetsService,
    bindingsService,
    certificatesRepository,
    executionsRepository,
    monitors,
  };
}

async function seedCertificate(
  repository: PgCertificatesRepository,
  input: { primaryDomain: string; notAfter: string },
): Promise<string> {
  const assetId = newId('certasset');
  await repository.createAsset({
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
  await repository.createVersion({
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
  await repository.updateAsset(assetId, { currentVersionId: versionId });
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
