import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkBuiltinPluginVersions, findBuiltinPluginVersionViolations } from './check-builtin-plugin-versions.mjs';

test('内置插件资源变化但版本不变时报告违规', () => {
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

test('内置插件资源变化且版本升级时允许通过', () => {
  const violations = findBuiltinPluginVersionViolations({
    changedPaths: ['backend/src/modules/plugins/builtin-plugins/example/workflows/discover.json'],
    readCurrentManifest: () => ({ pluginId: 'example.plugin', version: '1.0.1' }),
    readBaseManifest: () => ({ pluginId: 'example.plugin', version: '1.0.0' }),
  });

  assert.deepEqual(violations, []);
});

test('内置 Workflow 内容变化但插件版本未递进时只报告插件版本违规', () => {
  const manifest = {
    pluginId: 'example.plugin',
    version: '1.0.0',
    resources: { workflows: { discover: 'workflows/discover.json' } },
  };
  const violations = findBuiltinPluginVersionViolations({
    changedPaths: ['backend/src/modules/plugins/builtin-plugins/example/workflows/discover.json'],
    readCurrentManifest: () => manifest,
    readBaseManifest: () => manifest,
    readCurrentResource: () => ({ metadata: { name: 'example-discover', version: '1.0.0' }, changed: true }),
    readBaseResource: () => ({ metadata: { name: 'example-discover', version: '1.0.0' } }),
  });

  assert.deepEqual(violations.map((violation) => violation.kind), ['plugin']);
});

test('内置 Workflow 内容变化且 metadata.version 与插件版本同步时允许通过', () => {
  const manifest = {
    pluginId: 'example.plugin',
    version: '1.0.1',
    resources: { workflows: { discover: 'workflows/discover.json' } },
  };
  const violations = findBuiltinPluginVersionViolations({
    changedPaths: ['backend/src/modules/plugins/builtin-plugins/example/workflows/discover.json'],
    readCurrentManifest: () => manifest,
    readBaseManifest: () => ({ ...manifest, version: '1.0.0' }),
    readCurrentResource: () => ({ metadata: { name: 'example-discover', version: '1.0.1' } }),
    readBaseResource: () => ({ metadata: { name: 'example-discover', version: '1.0.0' } }),
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
  const root = mkdtempSync(join(tmpdir(), 'gcac-builtin-plugin-version-'));
  try {
    const pluginDirectory = join(root, 'backend/src/modules/plugins/builtin-plugins/example');
    mkdirSync(join(pluginDirectory, 'workflows'), { recursive: true });
    writeFileSync(join(pluginDirectory, 'manifest.json'), JSON.stringify(createManifest('1.0.0')), 'utf8');
    writeFileSync(join(pluginDirectory, 'workflows/discover.json'), JSON.stringify(createWorkflow('1.0.0')), 'utf8');
    git(root, ['init']);
    git(root, ['config', 'user.email', 'gcac-test@example.com']);
    git(root, ['config', 'user.name', 'GCAC Test']);
    git(root, ['add', '.']);
    git(root, ['commit', '-m', '初始化测试插件']);

    writeFileSync(join(pluginDirectory, 'workflows/discover.json'), JSON.stringify({ ...createWorkflow('1.0.0'), changed: true }), 'utf8');
    assert.deepEqual(checkBuiltinPluginVersions(root, { baseRef: 'HEAD' }).map((violation) => violation.kind), ['plugin']);

    writeFileSync(join(pluginDirectory, 'manifest.json'), JSON.stringify(createManifest('1.0.1')), 'utf8');
    assert.deepEqual(checkBuiltinPluginVersions(root, { baseRef: 'HEAD' }).map((violation) => violation.kind), ['workflow']);

    writeFileSync(join(pluginDirectory, 'workflows/discover.json'), JSON.stringify({ ...createWorkflow('1.0.1'), changed: true }), 'utf8');
    assert.deepEqual(checkBuiltinPluginVersions(root, { baseRef: 'HEAD' }), []);
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
