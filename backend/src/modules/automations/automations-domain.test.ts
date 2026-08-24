import assert from 'node:assert/strict';
import test from 'node:test';
import { AutomationsDomainService } from './domain/automations.domain-service.js';
import type { AutomationConfigurationDto } from './dto/automations.dto.js';

function configuration(): AutomationConfigurationDto {
  return {
    trigger: { type: 'schedule', cron: '0 2 * * *', timeZone: 'Asia/Shanghai' },
    targetSelector: { expiresWithinDays: 30, environments: ['production'] },
    actions: [
      { type: 'create_deployment_plan', position: 1, config: { workflowTemplateId: 'wftpl_1' } },
      { type: 'execute_deployment_plan', position: 2, config: { source: 'created_by_previous_action', dryRunFirst: true } },
    ],
    guardrails: { maxTargetsPerRun: 100, concurrencyLimit: 5, requirePreview: true, requireDryRun: true, requireApproval: true },
  };
}

test('拒绝非法 Cron、时区、动作和护栏', () => {
  const domain = new AutomationsDomainService();
  assert.throws(() => domain.validateConfiguration({ ...configuration(), trigger: { type: 'schedule', cron: '* * *', timeZone: 'Asia/Shanghai' } }));
  assert.throws(() => domain.validateConfiguration({ ...configuration(), trigger: { type: 'schedule', cron: '0 2 * * *', timeZone: 'Mars/Base' } }));
  assert.throws(() => domain.validateConfiguration({ ...configuration(), trigger: { type: 'once', runAt: 'not-a-date' } }));
  assert.throws(() => domain.validateConfiguration({ ...configuration(), guardrails: { ...configuration().guardrails, concurrencyLimit: 101 } }));
  assert.throws(() => domain.validateConfiguration({ ...configuration(), actions: [{ type: 'send_notification', position: 2, config: { templateKey: 'x', eventKey: 'x' } }] }));
});

test('配置摘要与键顺序无关，版本实体保持输入快照', () => {
  const domain = new AutomationsDomainService();
  const source = configuration();
  const version = domain.createVersion({ tenantId: 'tenant_1', automationId: 'aut_1', version: 1, configuration: source, actorId: 'user_1', now: '2026-07-21T00:00:00.000Z' });
  const repeated = domain.createVersion({ tenantId: 'tenant_1', automationId: 'aut_2', version: 1, configuration: configuration(), actorId: 'user_1', now: '2026-07-21T00:00:00.000Z' });
  source.targetSelector?.environments?.push('test');
  assert.deepEqual(version.targetSelector?.environments, ['production']);
  assert.equal(version.checksum.length, 64);
  assert.equal(repeated.checksum, version.checksum);
});

test('状态流转和乐观并发冲突明确拒绝', () => {
  const domain = new AutomationsDomainService();
  domain.assertTransition('draft', 'active');
  assert.throws(() => domain.assertTransition('deleted', 'active'));
  assert.throws(() => domain.assertVersion({ id: 'aut_1', tenantId: 'tenant_1', name: 'A', status: 'draft', currentVersion: 1, createdBy: 'u', createdAt: '', updatedAt: '', version: 3 }, 2));
});
