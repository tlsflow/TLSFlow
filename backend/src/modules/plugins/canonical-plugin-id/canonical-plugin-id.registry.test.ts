import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { validateJsonSchema, type JsonSchema } from '../../../common/validation/json-schema.js';
import {
  canonicalPluginIdRegistry,
  canonicalPluginIds,
  validateCanonicalPluginIdRegistry,
} from './canonical-plugin-id.registry.js';

const fixtureRoot = resolve(process.cwd(), 'src/modules/plugins/canonical-plugin-id/fixtures');
const schema = readJson(resolve(process.cwd(), 'src/modules/plugins/canonical-plugin-id/schemas/canonical-plugin-id-registry-v1.schema.json')) as JsonSchema;
const validFixture = readJson(resolve(fixtureRoot, 'canonical-plugin-id-registry.valid.json'));
const invalidFixture = readJson(resolve(fixtureRoot, 'canonical-plugin-id-registry.invalid.json')) as { cases: Array<{ name: string; change: Record<string, unknown> }> };

test('Canonical Registry 完整覆盖当前 Canonical ID 并通过 JSON Schema', () => {
  assert.deepEqual(canonicalPluginIdRegistry.entries.map((item) => item.canonicalId), canonicalPluginIds);
  assert.ok(canonicalPluginIds.length > 0);
  assert.equal(validateJsonSchema(validFixture, schema, { maxDepth: 12, maxArrayItems: 100 }).valid, true);
  assert.doesNotThrow(() => validateCanonicalPluginIdRegistry(validFixture));
  assert.deepEqual(
    validateCanonicalPluginIdRegistry(validFixture).entries.map((item) => item.canonicalId),
    canonicalPluginIds,
  );
});

test('Canonical Registry 不携带历史别名或兼容身份字段', () => {
  for (const entry of canonicalPluginIdRegistry.entries) {
    assert.deepEqual(Object.keys(entry).sort(), ['canonicalId', 'displayKey', 'executionMode', 'supportedPlatformProfiles']);
  }
});

test('Canonical Registry 负例 Fixture 拒绝重复、旧 ID、历史字段和进程内执行模式', () => {
  for (const item of invalidFixture.cases) {
    const candidate = structuredClone(validFixture) as Record<string, unknown>;
    setPath(candidate, item.change);
    assert.throws(() => validateCanonicalPluginIdRegistry(candidate), item.name);
  }
});

function setPath(target: Record<string, unknown>, changes: Record<string, unknown>): void {
  for (const [path, value] of Object.entries(changes)) {
    const segments = path.replaceAll(']', '').split(/[.[]/).filter(Boolean);
    let current: any = target;
    for (const segment of segments.slice(0, -1)) current = current[segment];
    current[segments.at(-1)!] = value;
  }
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}
