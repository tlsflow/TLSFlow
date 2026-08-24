import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuditLogEntity } from '../../persistence/entities/audit-log.entity.js';
import { buildRecentDashboardAudits } from './application/dashboard.application-service.js';

function audit(overrides: Partial<AuditLogEntity>): AuditLogEntity {
  return {
    id: overrides.id ?? 'aud_default',
    eventType: overrides.eventType ?? 'secret.used',
    actorType: overrides.actorType ?? 'system',
    actorId: overrides.actorId ?? 'system',
    action: overrides.action ?? 'secret.resolve.service',
    resourceType: overrides.resourceType ?? 'secret',
    resourceId: overrides.resourceId ?? 'sec_default',
    result: overrides.result ?? 'success',
    riskLevel: overrides.riskLevel ?? 'high',
    requestId: overrides.requestId,
    sourceIp: overrides.sourceIp,
    detail: overrides.detail,
    createdAt: overrides.createdAt ?? '2026-07-06T09:00:00.000Z',
  };
}

test('首页审计过滤健康检查成功日志，并优先展示高价值事件', () => {
  const result = buildRecentDashboardAudits([
    audit({
      id: 'health_ok_new',
      detail: { purpose: 'secret.health_check' },
      createdAt: '2026-07-06T09:05:00.000Z',
    }),
    audit({
      id: 'http_header_secret_read',
      detail: { purpose: 'http.header' },
      createdAt: '2026-07-06T09:04:30.000Z',
    }),
    audit({
      id: 'normal_secret_read',
      detail: { purpose: 'certificate.export' },
      createdAt: '2026-07-06T09:04:00.000Z',
    }),
    audit({
      id: 'old_user_certificate_import',
      eventType: 'certificate.imported',
      actorType: 'user',
      actorId: 'alice',
      action: 'certificate.import',
      resourceType: 'certificate_version',
      resourceId: 'certver_1',
      riskLevel: 'medium',
      detail: { certificateAssetId: 'cert_1' },
      createdAt: '2026-07-06T09:01:00.000Z',
    }),
    audit({
      id: 'denied_permission',
      eventType: 'permission.denied',
      actorType: 'user',
      actorId: 'bob',
      action: 'deployment.execute',
      resourceType: 'deployment_plan',
      resourceId: 'plan_1',
      result: 'denied',
      riskLevel: 'high',
      detail: { reason: 'no allow policy' },
      createdAt: '2026-07-06T09:00:00.000Z',
    }),
  ]);

  assert.deepEqual(result.map((item) => item.id), [
    'old_user_certificate_import',
  ]);
});

test('首页保留显式权限拒绝和 CA 同步失败，过滤默认拒绝与同步过程', () => {
  const result = buildRecentDashboardAudits([
    audit({
      id: 'permission_default',
      eventType: 'permission.denied',
      actorType: 'user',
      actorId: 'user_default',
      action: 'task.read',
      resourceType: 'task',
      result: 'denied',
      detail: { reason: 'no allow policy' },
    }),
    audit({
      id: 'permission_explicit',
      eventType: 'permission.denied',
      actorType: 'user',
      actorId: 'user_explicit',
      action: 'task.delete',
      resourceType: 'task',
      result: 'denied',
      detail: { reason: 'explicit deny' },
    }),
    audit({
      id: 'ca_started',
      eventType: 'ca.operations.sync.started',
      action: 'ca.operations.sync',
      resourceType: 'caSyncRun',
      result: 'success',
    }),
    audit({
      id: 'ca_failed',
      eventType: 'ca.operations.sync.failed',
      action: 'ca.operations.sync',
      resourceType: 'caSyncRun',
      result: 'failure',
    }),
  ]);

  assert.deepEqual(result.map((item) => item.id), ['permission_explicit', 'ca_failed']);
});

test('首页审计避免同一类型日志霸屏，并按时间倒序展示', () => {
  const result = buildRecentDashboardAudits([
    ...Array.from({ length: 10 }, (_, index) => audit({
      id: `deployment_${index}`,
      eventType: 'deployment.executed',
      actorType: 'user',
      actorId: 'user_admin',
      action: 'execution.apply.enqueue',
      resourceType: 'executionRun',
      resourceId: `run_${index}`,
      riskLevel: 'high',
      detail: { deploymentPlanId: `pln_${index}` },
      createdAt: `2026-07-02T2${index % 4}:00:00.000Z`,
    })),
    audit({
      id: 'asset_manage_new',
      eventType: 'service_asset.updated',
      actorType: 'user',
      actorId: 'user_admin',
      action: 'service_asset.manage',
      resourceType: 'service_asset',
      resourceId: 'sat_1',
      riskLevel: 'medium',
      createdAt: '2026-07-06T21:06:00.000Z',
    }),
    audit({
      id: 'login_new',
      eventType: 'auth.login.success',
      actorType: 'user',
      actorId: 'user_admin',
      action: 'auth.login',
      resourceType: 'authSession',
      result: 'success',
      riskLevel: 'low',
      createdAt: '2026-07-06T20:16:00.000Z',
    }),
    audit({
      id: 'secret_new',
      eventType: 'secret.created',
      actorType: 'user',
      actorId: 'user_admin',
      action: 'secret.create',
      resourceType: 'secret',
      resourceId: 'sec_1',
      riskLevel: 'high',
      createdAt: '2026-07-06T11:36:00.000Z',
    }),
  ]);

  assert.equal(result.some((item) => item.id === 'asset_manage_new'), true);
  assert.equal(result.some((item) => item.id === 'login_new'), true);
  assert.equal(result.some((item) => item.id === 'secret_new'), true);
  assert.equal(result.filter((item) => item.eventType === 'deployment.executed').length < result.length, true);
  assert.deepEqual(result.map((item) => item.createdAt), [...result.map((item) => item.createdAt)].sort((left, right) => Date.parse(right) - Date.parse(left)));
});

test('部署执行审计摘要使用部署计划名称和资产名称', () => {
  const result = buildRecentDashboardAudits([
    audit({
      id: 'deployment_executed',
      eventType: 'deployment.executed',
      actorType: 'user',
      actorId: 'user_admin',
      action: 'execution.apply.enqueue',
      resourceType: 'executionRun',
      resourceId: 'run_1',
      detail: { deploymentPlanId: 'pln_1' },
    }),
  ], {
    deploymentPlanById: new Map([['pln_1', {
      id: 'pln_1',
      tenantId: 'tenant_1',
      name: '生产 NGINX 证书更新',
      planType: 'UPDATE',
      selectionMode: 'EXPLICIT',
      certificateVersionId: 'certver_1',
      status: 'READY',
      approvalStatus: 'NOT_REQUIRED',
      snapshotHash: 'hash',
      idempotencyKey: 'idem',
      requestHash: 'req_hash',
      policy: { riskLevel: 'high', approvalRequired: false, failurePolicy: 'rollback' },
      createdReason: 'MANUAL',
      createdAt: '2026-07-06T09:00:00.000Z',
      updatedAt: '2026-07-06T09:00:00.000Z',
      createdBy: 'user_admin',
      version: 1,
    }]]),
    deploymentTargetsByPlanId: new Map([['pln_1', [{
      id: 'dpt_1',
      tenantId: 'tenant_1',
      deploymentPlanId: 'pln_1',
      certificateBindingId: 'bnd_1',
      executorType: 'AGENT',
      requiredCapabilities: [],
      status: 'READY',
      createdAt: '2026-07-06T09:00:00.000Z',
      updatedAt: '2026-07-06T09:00:00.000Z',
      version: 1,
    }]]]),
    bindingById: new Map([['bnd_1', {
      id: 'bnd_1',
      tenantId: 'tenant_1',
      serviceAssetId: 'svc_1',
      serviceInstanceId: 'srv_1',
      domainName: 'api.example.com',
      port: 443,
      protocol: 'https',
      bindingKey: 'api.example.com:443:https',
      bindingType: 'FILE_PATH',
      discoverySource: 'MANUAL',
      verifyMethod: 'TLS_CONNECT',
      status: 'MANAGED',
      metadata: {},
      createdAt: '2026-07-06T09:00:00.000Z',
      updatedAt: '2026-07-06T09:00:00.000Z',
      version: 1,
    }]]),
    applicationAssetLabelById: new Map([['svc_1', '生产 API 网关']]),
    objectLabelByKey: new Map(),
  });

  assert.equal(result[0]?.summary, '管理员完成“执行部署”，部署计划：生产 NGINX 证书更新，资产：生产 API 网关。');
});

test('普通审计摘要使用对象名称和对象 ID', () => {
  const result = buildRecentDashboardAudits([
    audit({
      id: 'asset_manage',
      eventType: 'service_asset.updated',
      actorType: 'user',
      actorId: 'user_admin',
      action: 'service_asset.manage',
      resourceType: 'service_asset',
      resourceId: 'sat_4c0c29c525094eaabedb9e02',
      riskLevel: 'medium',
    }),
  ], {
    deploymentPlanById: new Map(),
    deploymentTargetsByPlanId: new Map(),
    bindingById: new Map(),
    applicationAssetLabelById: new Map(),
    objectLabelByKey: new Map([['service_asset:sat_4c0c29c525094eaabedb9e02', '生产 API 网关（sat_4c0c29c525094eaabedb9e02）']]),
  });

  assert.equal(result[0]?.summary, '管理员完成“维护应用资产”，对象：应用资产 生产 API 网关（sat_4c0c29c525094eaabedb9e02）。');
});
