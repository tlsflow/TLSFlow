import assert from 'node:assert/strict';
import test from 'node:test';

import { builtinAgentPluginManifests } from './builtin-plugins/agent-recipes.js';
import { validateAgentDeploymentPluginManifest } from './schema/agent-deployment-plugins.schema.js';

test('Agent Recipe 根对象严格拒绝旧输入字段和未知字段', () => {
  const manifest = builtinAgentPluginManifests[0];
  assert.ok(manifest);

  for (const field of ['variables', 'artifactInputs', 'unexpected']) {
    assert.throws(
      () => validateAgentDeploymentPluginManifest({ ...manifest, [field]: {} }),
      (error: unknown) => {
        assert.equal((error as { errorCode?: string }).errorCode, 'AGENT_PLUGIN_MANIFEST_INVALID');
        assert.match(String((error as Error).message), /manifest 包含未知字段/);
        return true;
      },
    );
  }
});

test('Agent Recipe 接受插件声明的开放 Operation 与权限 Scope', () => {
  const manifest = structuredClone(builtinAgentPluginManifests[0]);
  manifest.permissions.push({
    name: 'storage-admin',
    risk: 'high',
    scope: 'storage_admin',
    values: ['pool-a'],
  });
  manifest.operations[0] = {
    ...manifest.operations[0],
    operationType: 'storage.nas.inspect',
  };

  const validated = validateAgentDeploymentPluginManifest(manifest);
  assert.equal(validated.operations[0]?.operationType, 'storage.nas.inspect');
  assert.equal(validated.permissions.at(-1)?.scope, 'storage_admin');
});

test('Agent Recipe 拒绝不能作为开放标识使用的 Operation 与权限 Scope', () => {
  const manifest = structuredClone(builtinAgentPluginManifests[0]);
  manifest.operations[0] = { ...manifest.operations[0], operationType: 'Bad Operation' };
  assert.throws(() => validateAgentDeploymentPluginManifest(manifest), /operationType 格式不合法/);

  const invalidScope = structuredClone(builtinAgentPluginManifests[0]);
  invalidScope.permissions[0] = { ...invalidScope.permissions[0], scope: 'Bad Scope' };
  assert.throws(() => validateAgentDeploymentPluginManifest(invalidScope), /scope 格式不合法/);
});
