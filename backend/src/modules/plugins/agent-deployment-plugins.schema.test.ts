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
