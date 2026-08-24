import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const runnerPath = fileURLToPath(new URL('./run-node-test-files.mjs', import.meta.url));

test('按稳定路径顺序逐文件串行执行', () => {
  const fixture = createFixture(['a.test.js', 'nested/c.test.mjs', 'b.test.js']);
  try {
    const result = runRunner(fixture.root, fixture.orderFile);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(fixture.orderFile), `${result.stdout}\n${result.stderr}`);
    assert.deepEqual(readOrder(fixture.orderFile), ['a', 'b', 'c']);
    assert.match(result.stdout, /串行执行 3\/3 个文件/);
  } finally {
    fixture.cleanup();
  }
});

test('按照稳定文件序号选择分片', () => {
  const fixture = createFixture(['a.test.js', 'b.test.js', 'nested/c.test.js', 'd.test.js']);
  try {
    const result = runRunner(fixture.root, fixture.orderFile, ['--shard=2/2']);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(fixture.orderFile), `${result.stdout}\n${result.stderr}`);
    assert.deepEqual(readOrder(fixture.orderFile), ['b', 'c']);
    assert.match(result.stdout, /分片 2\/2，串行执行 2\/4 个文件/);
    assert.match(result.stdout, /该分片结果不代表全量测试通过/);
  } finally {
    fixture.cleanup();
  }
});

test('列出分片时不启动测试文件', () => {
  const fixture = createFixture(['a.test.js', 'b.test.js']);
  try {
    const result = runRunner(fixture.root, fixture.orderFile, ['--shard=1/2', '--list']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /a\.test\.js/);
    assert.doesNotMatch(result.stdout, /b\.test\.js/);
    assert.equal(existsSync(fixture.orderFile), false);
  } finally {
    fixture.cleanup();
  }
});

test('测试文件非零退出时保留失败分类并返回非零', () => {
  const fixture = createFixture(['failing.test.js'], { failing: 'process.exitCode = 7;' });
  try {
    const result = runRunner(fixture.root, fixture.orderFile);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /失败分类 test-failure：1/);
    assert.match(result.stderr, /退出码=1/);
  } finally {
    fixture.cleanup();
  }
});

test('环境依赖缺失和内存耗尽必须保留独立失败分类', () => {
  const fixture = createFixture(['environment.test.js', 'oom.test.mjs'], {
    environment: "console.error('GCAC_SECRET_KEK 未配置，拒绝初始化密钥管理器'); process.exitCode = 1;",
    oom: "console.error('FATAL ERROR: JavaScript heap out of memory'); process.exitCode = 1;",
  });
  try {
    const result = runRunner(fixture.root, fixture.orderFile);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /失败分类 environment：1/);
    assert.match(result.stderr, /失败分类 resource-oom：1/);
  } finally {
    fixture.cleanup();
  }
});

test('正式测试入口缺少显式密钥时失败关闭', () => {
  const fixture = createFixture(['a.test.js']);
  try {
    const result = runRunner(fixture.root, fixture.orderFile, ['--require-test-secret'], { GCAC_SECRET_KEK: undefined });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /\[environment\] GCAC_SECRET_KEK 未配置/);
    assert.equal(existsSync(fixture.orderFile), false);
  } finally {
    fixture.cleanup();
  }
});

test('测试期间删除产物时归类为产物污染', () => {
  const fixture = createFixture(['polluting.test.js'], {
    polluting: "import { rmSync } from 'node:fs'; rmSync(process.env.GCAC_TEST_ARTIFACT_ROOT, { recursive: true, force: true });",
  });
  try {
    const result = runRunner(fixture.root, fixture.orderFile);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /失败分类 artifact-pollution：1/);
  } finally {
    fixture.cleanup();
  }
});

test('单文件超时保留 timeout 分类并继续返回非零', () => {
  const fixture = createFixture(['slow.test.js'], { slow: 'setTimeout(() => {}, 5000);' });
  try {
    const result = runRunner(fixture.root, fixture.orderFile, ['--file-timeout-ms', '50']);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /失败分类 timeout：1/);
  } finally {
    fixture.cleanup();
  }
});

test('测试产物目录缺失时明确归类为 missing-artifact', () => {
  const fixture = createFixture(['a.test.js']);
  try {
    rmSync(fixture.root, { recursive: true, force: true });
    const result = runRunner(fixture.root, fixture.orderFile);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /\[missing-artifact\]/);
  } finally {
    fixture.cleanup();
  }
});

function createFixture(fileNames, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'gcac-node-test-runner-'));
  const orderFile = join(root, 'order.log');
  for (const fileName of fileNames) {
    const path = join(root, fileName);
    mkdirSync(dirname(path), { recursive: true });
    const name = fileName.split('/').at(-1).replace(/\.test\.(?:m?js)$/, '');
    const body = overrides[name] ?? `import { appendFileSync } from 'node:fs';\nappendFileSync(process.env.GCAC_TEST_ORDER_FILE, '${name}\\n');`;
    writeFileSync(path, `${body}\n`, 'utf8');
  }
  return {
    root,
    orderFile,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function runRunner(root, orderFile, extraArguments = [], environmentOverrides = {}) {
  const environment = { ...process.env, GCAC_TEST_ORDER_FILE: orderFile, GCAC_TEST_ARTIFACT_ROOT: root };
  for (const [name, value] of Object.entries(environmentOverrides)) {
    if (value === undefined) delete environment[name];
    else environment[name] = value;
  }
  delete environment.GCAC_TEST_SHARD;
  delete environment.GCAC_TEST_SHARD_INDEX;
  delete environment.GCAC_TEST_SHARD_COUNT;
  delete environment.NODE_TEST_CONTEXT;
  return spawnSync(
    process.execPath,
    [runnerPath, '--root', root, '--file-timeout-ms', '5000', ...extraArguments],
    { cwd: process.cwd(), env: environment, encoding: 'utf8', stdio: 'pipe', windowsHide: true },
  );
}

function readOrder(orderFile) {
  return readFileSync(orderFile, 'utf8').trim().split(/\r?\n/).filter(Boolean);
}
