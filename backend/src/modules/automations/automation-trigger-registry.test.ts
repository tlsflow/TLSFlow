import assert from 'node:assert/strict';
import test from 'node:test';
import { AutomationTriggerRegistry } from './application/automation-trigger-registry.js';

test('证书事件触发器匹配 ACME 自动续期并兼容历史外部来源别名', () => {
  const registry = new AutomationTriggerRegistry();
  const trigger = { type: 'certificate_version_created' as const, sources: ['acme_issue' as const] };

  assert.equal(registry.matchesContext(trigger, {
    eventType: 'certificate.version.created',
    sourceType: 'acme_issue',
    certificateVersionId: 'version_1',
  }), true);
  assert.equal(registry.matchesContext(trigger, {
    eventType: 'certificate.version.created',
    sourceType: 'external_source',
    certificateVersionId: 'version_legacy',
  }), true);
  assert.equal(registry.matchesContext(trigger, {
    eventType: 'certificate.version.created',
    sourceType: 'manual_import',
    certificateVersionId: 'version_2',
  }), false);
});

test('证书事件触发器保留手工导入来源的独立匹配', () => {
  const registry = new AutomationTriggerRegistry();
  const trigger = { type: 'certificate_version_created' as const, sources: ['manual_import' as const] };

  assert.doesNotThrow(() => registry.validate(trigger));
  assert.equal(registry.matchesContext(trigger, {
    eventType: 'certificate.version.created',
    sourceType: 'manual_import',
    certificateVersionId: 'version_1',
  }), true);
});

test('证书事件部署时间校验小时分钟和时区', () => {
  const registry = new AutomationTriggerRegistry();
  assert.doesNotThrow(() => registry.validate({ type: 'certificate_version_created', deploymentSchedule: { hour: 23, minute: 59, timeZone: 'Asia/Shanghai' } }));
  assert.throws(() => registry.validate({ type: 'certificate_version_created', deploymentSchedule: { hour: 24, minute: 0, timeZone: 'Asia/Shanghai' } }));
  assert.throws(() => registry.validate({ type: 'certificate_version_created', deploymentSchedule: { hour: 1, minute: 0, timeZone: 'Invalid/Zone' } }));
});
