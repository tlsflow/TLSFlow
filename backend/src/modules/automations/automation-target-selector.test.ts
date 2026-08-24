import assert from 'node:assert/strict';
import test from 'node:test';
import { AutomationTargetResolverRegistry } from './application/automation-target-resolver.registry.js';

test('自动化目标解析只注册当前证书版本目标合同', () => {
  const registry = new AutomationTargetResolverRegistry();

  assert.doesNotThrow(() => registry.get('certificate_version_targets'));
  for (const retiredType of ['product_targets', 'legacy_targets', 'agent_targets', 'workflow_targets']) {
    assert.throws(
      () => registry.get(retiredType as never),
      /自动化目标解析器未注册/,
      `旧目标类型不应继续注册：${retiredType}`,
    );
  }
});
