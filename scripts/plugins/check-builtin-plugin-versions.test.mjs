import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkBuiltinPluginVersions, findBuiltinPluginManifestViolations, findBuiltinPluginVersionViolations } from './check-builtin-plugin-versions.mjs';

test('内置插件资源变化但 Manifest 版本不变时报告违规', () => {
  const violations = findBuiltinPluginVersionViolations({
    changedPaths: ['backend/src/modules/plugins/builtin-plugins/example/workflows/discover.json'],
    readCurrentManifest: () => ({ pluginId: 'example.plugin', version: '1.0.0' }),
    readBaseManifest: () => ({ pluginId: 'example.plugin', version: '1.0.0' }),
  });

  assert.deepEqual(violations, [{
    kind: 'plugin',
    pluginId: 'example.plugin',
    pluginDirectory: 'example',
    previousVersion: '1.0.0',
    nextVersion: '1.0.0',
    manifestPath: 'backend/src/modules/plugins/builtin-plugins/example/manifest.json',
  }]);
});

test('资源变化且 Manifest 版本递进时允许通过，不检查 Workflow 自身版本', () => {
  const manifest = {
    pluginId: 'example.plugin',
    version: '1.0.1',
    resources: { workflows: { discover: 'workflows/discover.json' } },
  };
  const violations = findBuiltinPluginVersionViolations({
    changedPaths: ['backend/src/modules/plugins/builtin-plugins/example/workflows/discover.json'],
    readCurrentManifest: () => manifest,
    readBaseManifest: () => ({ ...manifest, version: '1.0.0' }),
    readCurrentResource: () => ({ metadata: { name: 'example-discover', version: '9.0.0' } }),
    readBaseResource: () => ({ metadata: { name: 'example-discover', version: '1.0.0' } }),
  });

  assert.deepEqual(violations, []);
});

test('新增内置 Workflow 只要求递进 Manifest 版本', () => {
  const violations = findBuiltinPluginVersionViolations({
    changedPaths: [
      'backend/src/modules/plugins/builtin-plugins/example/manifest.json',
      'backend/src/modules/plugins/builtin-plugins/example/workflows/deploy.json',
    ],
    readCurrentManifest: () => ({
      pluginId: 'example.plugin',
      version: '1.0.1',
      resources: { workflows: { deploy: 'workflows/deploy.json' } },
    }),
    readBaseManifest: () => ({
      pluginId: 'example.plugin',
      version: '1.0.0',
      resources: { workflows: {} },
    }),
  });

  assert.deepEqual(violations, []);
});

test('预发布 SemVer 递进与领域服务保持一致', () => {
  const violations = findBuiltinPluginVersionViolations({
    changedPaths: ['backend/src/modules/plugins/builtin-plugins/example/manifest.json'],
    readCurrentManifest: () => ({ pluginId: 'example.plugin', version: '1.0.0-beta.2' }),
    readBaseManifest: () => ({ pluginId: 'example.plugin', version: '1.0.0-beta.1' }),
  });

  assert.deepEqual(violations, []);
});

test('Git 工作区资源变化必须同步升级 Manifest 版本', () => {
  const root = createGitFixture();
  try {
    const pluginDirectory = join(root, 'backend/src/modules/plugins/builtin-plugins/example');
    writeFileSync(join(pluginDirectory, 'workflows/discover.json'), JSON.stringify({ ...createWorkflow('9.0.0'), changed: true }), 'utf8');
    assert.deepEqual(checkBuiltinPluginVersions(root, { baseRef: 'HEAD' }).map((violation) => violation.kind), ['plugin']);

    writeFileSync(join(pluginDirectory, 'manifest.json'), JSON.stringify(createManifest('1.0.1')), 'utf8');
    assert.deepEqual(checkBuiltinPluginVersions(root, { baseRef: 'HEAD' }), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('即使没有 Git 变更，非法 Manifest SemVer 也必须失败关闭', () => {
  const root = createGitFixture();
  try {
    const manifestPath = join(root, 'backend/src/modules/plugins/builtin-plugins/example/manifest.json');
    writeFileSync(manifestPath, JSON.stringify(createManifest('1.0')), 'utf8');
    assert.deepEqual(findBuiltinPluginManifestViolations(root).map((violation) => violation.kind), ['manifest']);
    assert.deepEqual(checkBuiltinPluginVersions(root, { baseRef: 'HEAD' }).map((violation) => violation.kind), ['manifest']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Git 已提交资源变化必须同步升级 Manifest 版本', () => {
  const root = createGitFixture();
  try {
    const pluginDirectory = join(root, 'backend/src/modules/plugins/builtin-plugins/example');
    writeFileSync(join(pluginDirectory, 'workflows/discover.json'), JSON.stringify({ ...createWorkflow('1.0.0'), changed: true }), 'utf8');
    git(root, ['add', '.']);
    git(root, ['commit', '-m', '修改插件资源']);

    assert.deepEqual(checkBuiltinPluginVersions(root, { baseRef: 'HEAD^' }).map((violation) => violation.kind), ['plugin']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function createGitFixture() {
  const root = mkdtempSync(join(tmpdir(), 'gcac-builtin-plugin-version-'));
  const pluginDirectory = join(root, 'backend/src/modules/plugins/builtin-plugins/example');
  mkdirSync(join(pluginDirectory, 'workflows'), { recursive: true });
  writeFileSync(join(pluginDirectory, 'manifest.json'), JSON.stringify(createManifest('1.0.0')), 'utf8');
  writeFileSync(join(pluginDirectory, 'workflows/discover.json'), JSON.stringify(createWorkflow('1.0.0')), 'utf8');
  git(root, ['init']);
  git(root, ['config', 'user.email', 'gcac-test@example.com']);
  git(root, ['config', 'user.name', 'GCAC Test']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', '初始化测试插件']);
  return root;
}

function createManifest(version) {
  return {
    pluginId: 'example.plugin',
    version,
    resources: { workflows: { discover: 'workflows/discover.json' } },
  };
}

function createWorkflow(version) {
  return { metadata: { name: 'example-discover', version } };
}

function git(root, arguments_) {
  execFileSync('git', arguments_, { cwd: root, stdio: 'ignore' });
}
