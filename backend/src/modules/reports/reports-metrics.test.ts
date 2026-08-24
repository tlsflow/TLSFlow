import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getMetricDefinition,
  listMetricDefinitions,
  metricDefinitions,
} from './domain/metric-definition-registry.js';

test('首期指标键唯一且版本稳定', () => {
  const keys = metricDefinitions.map((definition) => definition.key);

  assert.equal(new Set(keys).size, keys.length);
  assert.ok(metricDefinitions.length >= 30);
  assert.ok(metricDefinitions.every((definition) => definition.version === 1));
  assert.deepEqual(
    new Set(metricDefinitions.map((definition) => definition.reportType)),
    new Set(['incident_window', 'risk_response', 'automation_effectiveness']),
  );
});

test('所有比率明确分子、分母和排除项', () => {
  const rateDefinitions = metricDefinitions.filter((definition) => definition.valueType === 'rate');

  assert.deepEqual(
    rateDefinitions.map((definition) => definition.key),
    [
      'risks.ack_sla_rate',
      'risks.resolve_sla_rate',
      'automations.runs.success_rate',
      'automations.targets.success_rate',
    ],
  );
  for (const definition of rateDefinitions) {
    assert.ok(definition.ratio?.numerator);
    assert.ok(definition.ratio?.denominator);
    assert.ok(definition.ratio?.excludedStatuses);
  }
});

test('自动化运行级和目标级成功率使用不同统计对象', () => {
  const runRate = getMetricDefinition('automations.runs.success_rate');
  const targetRate = getMetricDefinition('automations.targets.success_rate');

  assert.equal(runRate.objectType, 'automation_run');
  assert.equal(targetRate.objectType, 'automation_run_target');
  assert.deepEqual(runRate.ratio?.excludedStatuses, ['skipped', 'cancelled', 'waiting_approval']);
  assert.deepEqual(targetRate.ratio?.excludedStatuses, ['skipped', 'cancelled', 'waiting_approval']);
});

test('事故窗口指标以证书资产为统计主体', () => {
  const definitions = listMetricDefinitions('incident_window');

  assert.equal(definitions.length, 10);
  assert.ok(definitions.every((definition) => definition.objectType === 'certificate_asset'));
  assert.ok(definitions.every((definition) => definition.dimensions.includes('usage_status')));
});

test('未知指标返回稳定业务错误', () => {
  assert.throws(
    () => getMetricDefinition('unknown.metric'),
    (error: unknown) => {
      assert.equal((error as { errorCode?: string }).errorCode, 'RESOURCE_NOT_FOUND');
      return true;
    },
  );
});
