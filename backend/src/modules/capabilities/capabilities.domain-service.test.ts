import assert from 'node:assert/strict';
import test from 'node:test';
import { CapabilitiesApplicationService } from './application/capabilities.application-service.js';
import { CapabilitiesDomainService } from './domain/capabilities.domain-service.js';
import type { CapabilityDeclaration, CapabilityRequirement } from '../../shared/contracts/capability-contracts.js';

test('能力字典包含内置能力和兼容别名定义', async () => {
  const service = new CapabilitiesApplicationService();
  const definitions = service.listDefinitions();

  assert.ok(definitions.length > 50);
  assert.ok(definitions.some((item) => item.key === 'agent.full.online'));
  assert.ok(definitions.some((item) => item.key === 'linux.systemd.v1'));
  assert.ok(definitions.some((item) => item.key === 'linux.openrc.v1'));
  assert.ok(definitions.some((item) => item.key === 'linux.sysv.v1'));
  assert.ok(definitions.some((item) => item.key === 'linux.filesystem.posix-atomic.v1'));
  assert.ok(definitions.some((item) => item.key === 'linux.security.selinux.v1'));

  const deprecated = definitions.find((item) => item.key === 'service.reload.custom');
  assert.ok(deprecated);
  assert.equal(deprecated?.deprecated, true);
  assert.equal(deprecated?.replacedBy, 'process.exec');
});

test('人工能力声明必须带风险证据来源和审计引用', async () => {
  const service = new CapabilitiesApplicationService();
  const manual = await await service.createManualDeclaration({
    tenantId: 'tenant_a',
    targetType: 'host',
    targetId: 'host_1',
    capabilityKey: 'file.write',
    value: true,
    source: 'manual',
    confidence: 85,
    evidence: {
      summary: '值班管理员在变更窗口现场验证目录可写',
      sourceDetail: '工单 CHG-008',
      confidenceReason: '双人复核',
      riskAcknowledgement: '已知为高风险写入能力',
    },
    createdBy: 'user_ops',
    auditRef: 'audit_008',
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });

  assert.equal(manual.source, 'manual');
  assert.equal(manual.riskLevel, 'high');
  assert.equal(manual.evidence?.summary, '值班管理员在变更窗口现场验证目录可写');

  await assert.rejects(
    () => service.createManualDeclaration({
      tenantId: 'tenant_a',
      targetType: 'host',
      targetId: 'host_1',
      capabilityKey: 'agent.full.online',
      value: true,
      source: 'manual',
      confidence: 90,
      evidence: { summary: '手工写了个 true' },
      createdBy: 'user_ops',
      auditRef: 'audit_009',
    }),
    (error: any) => error.errorCode === 'VALIDATION_FAILED',
  );
});

test('匹配算法输出 satisfied missing unknown manualRisk', async () => {
  const service = new CapabilitiesApplicationService();
  const declarations: CapabilityDeclaration[] = [
    await service.createDeclaration({
      tenantId: 'tenant_a',
      targetType: 'execution_target',
      targetId: 'target_1',
      capabilityKey: 'file.backup',
      value: true,
      source: 'auto_probe',
      confidence: 95,
      detectedAt: new Date().toISOString(),
    }),
    await service.createDeclaration({
      tenantId: 'tenant_a',
      targetType: 'execution_target',
      targetId: 'target_1',
      capabilityKey: 'nginx.config_test',
      value: true,
      source: 'auto_probe',
      confidence: 60,
      detectedAt: new Date().toISOString(),
    }),
    await service.createManualDeclaration({
      tenantId: 'tenant_a',
      targetType: 'execution_target',
      targetId: 'target_1',
      capabilityKey: 'file.write',
      value: true,
      source: 'manual',
      confidence: 88,
      evidence: {
        summary: '人工确认 NGINX 证书目录有写权限',
        sourceDetail: '维护窗口验证',
        riskAcknowledgement: '人工写入存在误判风险',
      },
      createdBy: 'user_ops',
      auditRef: 'audit_write',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    }),
  ];

  const requirement: CapabilityRequirement = await service.registerRequirement({
    ownerType: 'provider_action',
    ownerId: 'nginx.install_certificate',
    requiredAll: [
      {
        capabilityKey: 'file.backup',
        operator: 'exists',
        reason: '部署前必须备份',
        riskIfMissing: '无法安全回滚',
      },
      {
        capabilityKey: 'file.write',
        operator: 'exists',
        reason: '必须写入证书文件',
        riskIfMissing: '无法安装证书',
      },
      {
        capabilityKey: 'nginx.config_test',
        operator: 'exists',
        reason: 'reload 前必须执行配置测试',
        riskIfMissing: '错误配置会把服务打挂',
      },
      {
        capabilityKey: 'nginx.reload',
        operator: 'exists',
        reason: '证书安装完成后必须 reload',
        riskIfMissing: '新证书不会生效',
      },
    ],
    minConfidence: 80,
    allowManual: true,
    riskLevel: 'high',
  });

  const result = service.matchRequirement(requirement, declarations, {
    targetType: 'execution_target',
    targetId: 'target_1',
  });

  assert.equal(result.status, 'degraded');
  assert.ok(result.satisfied.some((item) => item.capabilityKey === 'file.backup'));
  assert.ok(result.missing.some((item) => item.capabilityKey === 'nginx.reload'));
  assert.ok(result.unknown.some((item) => item.capabilityKey === 'nginx.config_test' && item.blockingReason === 'low_confidence'));
  assert.ok(result.manualRisk.some((item) => item.capabilityKey === 'file.write'));
  assert.equal(result.requiresApproval, true);
});

test('L1-L5 兼容等级按能力集合而不是按 OS 标签计算', async () => {
  const service = new CapabilitiesApplicationService();
  const domain = new CapabilitiesDomainService();
  const now = new Date().toISOString();

  const l1 = await service.evaluateCompatibility({
    tenantId: 'tenant_a',
    targetType: 'agent',
    targetId: 'agent_1',
    declarations: [
      declaration('agent.full.online', now),
      declaration('agent.task.receive', now),
      declaration('agent.log.report', now),
      declaration('file.read', now),
      declaration('file.write', now),
      declaration('file.backup', now),
      declaration('process.exec', now, ['nginx -s reload']),
      declaration('rollback.snapshot', now),
      declaration('rollback.restore', now),
      declaration('nginx.reload', now),
    ],
    criticalCapabilityKeys: ['nginx.reload'],
  });
  assert.equal(l1.level, 'L1');

  const l3 = domain.evaluateCompatibility({
    targetType: 'execution_target',
    targetId: 'target_3',
    declarations: [
      declaration('gateway.reachable', now),
      declaration('ssh.connect', now),
      declaration('ssh.sftp', now),
      declaration('ssh.exec', now),
    ],
  });
  assert.equal(l3.level, 'L3');

  const l5 = domain.evaluateCompatibility({
    targetType: 'host',
    targetId: 'host_5',
    declarations: [declaration('manual.record', now)],
  });
  assert.equal(l5.level, 'L5');
  assert.ok(l5.reasonCodes.includes('monitor_only'));
});

test('契约校验入口拒绝非法能力键，供 Provider Executor Agent 插件复用', async () => {
  const service = new CapabilitiesApplicationService();
  assert.throws(() => service.validateCapabilityContract({
    ownerType: 'provider_action',
    ownerId: 'bad-provider',
    requirements: [{
      id: 'req_bad_provider',
      ownerType: 'provider_action',
      ownerId: 'bad-provider',
      requiredAll: [{ capabilityKey: 'Bad Key', operator: 'exists', reason: 'bad', riskIfMissing: 'bad' }],
      optional: [],
      anyOfGroups: [],
      forbidden: [],
      minConfidence: 80,
      allowManual: false,
      riskLevel: 'low',
    }],
  }), /能力键不合法|能力键不存在于字典中/);
});

test('插件扩展能力无需进入宿主产品字典即可声明和匹配', () => {
  const domain = new CapabilitiesDomainService();
  const detectedAt = new Date().toISOString();
  const extension = domain.normalizeDeclaration({
    tenantId: 'tenant_a',
    targetType: 'plugin',
    targetId: 'plugin_storage',
    capabilityKey: 'storage.snapshot.create',
    value: { supported: true },
    source: 'plugin_manifest',
    confidence: 100,
    detectedAt,
    status: 'active',
    parameters: {},
  });
  const requirement = domain.normalizeRequirement({
    id: 'req_storage',
    ownerType: 'plugin_action',
    ownerId: 'plugin_storage',
    requiredAll: [{
      capabilityKey: 'storage.snapshot.create',
      operator: 'exists',
      reason: '需要创建快照',
      riskIfMissing: '无法回滚',
    }],
    optional: [],
    anyOfGroups: [],
    forbidden: [],
    minConfidence: 80,
    allowManual: false,
    riskLevel: 'high',
  });

  const result = domain.matchRequirement(requirement, [extension]);
  assert.equal(result.status, 'matched');
  assert.equal(result.satisfied[0]?.capabilityKey, 'storage.snapshot.create');
});

function declaration(capabilityKey: string, detectedAt: string, value: unknown = true): CapabilityDeclaration {
  const service = new CapabilitiesDomainService();
  return service.normalizeDeclaration({
    tenantId: 'tenant_a',
    targetType: 'agent',
    targetId: 'target_x',
    capabilityKey,
    value,
    source: 'auto_probe',
    confidence: 95,
    detectedAt,
    status: 'active',
    parameters: {},
  });
}
