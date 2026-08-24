import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const scriptPath = fileURLToPath(new URL('./run-node-test-shards.mjs', import.meta.url));

test('受控分片并发执行全部测试文件并汇总成功结果', () => {
  const fixture = createFixture(['a.test.js', 'b.test.js', 'nested/c.test.mjs', 'd.test.js']);
  try {
    const result = runShards(fixture.root, ['--shard-count', '2', '--max-parallel', '2']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /2 个独立分片，最多并行 2 个/);
    assert.match(result.stdout, /2\/2 个分片均通过/);
  } finally {
    fixture.cleanup();
  }
});

test('任一分片失败时返回非零并保留该分片输出', () => {
  const fixture = createFixture(['a.test.js', 'b.test.js'], { b: 'process.exitCode = 9;' });
  try {
    const result = runShards(fixture.root, ['--shard-count=2', '--max-parallel=2']);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /Node 分片测试失败：1\/2 个分片失败/);
    assert.match(result.stderr, /失败分类 test-failure：1/);
  } finally {
    fixture.cleanup();
  }
});

test('要求密钥时缺少显式密钥必须失败关闭', () => {
  const fixture = createFixture(['a.test.js']);
  try {
    const result = runShards(fixture.root, ['--require-test-secret'], { GCAC_SECRET_KEK: undefined });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /GCAC_SECRET_KEK 未配置/);
  } finally {
    fixture.cleanup();
  }
});

function createFixture(fileNames, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'gcac-node-test-shards-'));
  for (const fileName of fileNames) {
    const path = join(root, fileName);
    mkdirSync(dirname(path), { recursive: true });
    const name = fileName.split('/').at(-1).replace(/\.test\.(?:m?js)$/, '');
    writeFileSync(path, `${overrides[name] ?? ''}\n`, 'utf8');
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runShards(root, extraArguments = [], environmentOverrides = {}) {
  const environment = { ...process.env };
  for (const [name, value] of Object.entries(environmentOverrides)) {
    if (value === undefined) delete environment[name];
    else environment[name] = value;
  }
  return spawnSync(
    process.execPath,
    [scriptPath, '--root', root, '--file-timeout-ms', '5000', ...extraArguments],
    { cwd: process.cwd(), env: environment, encoding: 'utf8', stdio: 'pipe', windowsHide: true },
  );
}
