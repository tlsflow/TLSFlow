import assert from 'node:assert/strict';
import test from 'node:test';
import { AutomationFilterEvaluator } from './application/automation-filter-evaluator.js';

test('事件来源过滤器使用 ACME 自动续期作为规范来源', () => {
  const evaluator = new AutomationFilterEvaluator();
  const result = evaluator.evaluate([
    { field: 'event.sourceType', operator: 'in', value: ['acme_issue'] },
  ], { event: { sourceType: 'acme_issue' } });

  assert.equal(result.matched, true);
});

test('事件来源过滤器兼容历史 external_source 别名', () => {
  const evaluator = new AutomationFilterEvaluator();
  const result = evaluator.evaluate([
    { field: 'event.sourceType', operator: 'in', value: ['external_source'] },
  ], { event: { sourceType: 'acme_issue' } });

  assert.equal(result.matched, true);
});
