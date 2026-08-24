import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('统一插件 Manifest Schema 覆盖现行运行时集合', () => {
  const schema = JSON.parse(readFileSync(new URL('./unified-plugin-manifest.v1.schema.json', import.meta.url), 'utf8'));

  assert.deepEqual(schema.properties.runtime.enum, ['AGENT_PLAN', 'WORKFLOW_DSL', 'TRUSTED_JS']);
});
