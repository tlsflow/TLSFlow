import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { spawnSync as runProcess } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { copyRuntimeResources } from './copy-runtime-resources.mjs';

const DEFAULT_TEST_ROOT = 'dist';
const DEFAULT_FILE_TIMEOUT_MS = 120_000;
const FAILURE_CATEGORY_ORDER = ['artifact-pollution', 'test-failure', 'environment', 'missing-artifact', 'resource-oom', 'timeout', 'signal', 'spawn-error', 'unknown-exit'];

try {
  const options = parseArguments(process.argv.slice(2), process.env);
  process.exitCode = options.help ? 0 : runTests(options);
  if (options.help) process.stdout.write(`${usage()}\n`);
} catch (error) {
  process.stderr.write(`测试编排参数错误：${error.message}\n`);
  process.exitCode = 1;
}

function runTests(options) {
  if (options.requireTestSecret && !options.environment.GCAC_SECRET_KEK?.trim()) {
    process.stderr.write('测试环境缺失：[environment] GCAC_SECRET_KEK 未配置；拒绝使用默认测试密钥\n');
    return 1;
  }

  let execution;
  try {
    execution = options.buildIsolated
      ? createIsolatedTestWorkspace(options)
      : { testRoot: options.testRoot, cwd: process.cwd(), environment: { ...process.env }, cleanup: () => {} };
  } catch (error) {
    const failure = error.failure ?? { category: 'spawn-error', detail: error.message };
    process.stderr.write(`测试构建失败：[${failure.category}] ${failure.detail}\n`);
    return 1;
  }

  try {
    return executeTests({ ...options, ...execution });
  } finally {
    execution.cleanup();
  }
}

function executeTests({ testRoot, fileTimeoutMs, shard, list, cwd, environment }) {
  let testFiles;
  try {
    testFiles = collectTestFiles(testRoot, cwd);
  } catch (error) {
    const category = error.code === 'ENOENT' ? 'missing-artifact' : 'environment';
    process.stderr.write(`无法读取测试目录：[${category}] ${testRoot}；${error.message}\n`);
    return 1;
  }

  if (testFiles.length === 0) {
    process.stderr.write(`测试目录没有找到 .test.js 或 .test.mjs 文件：[missing-artifact] ${testRoot}\n`);
    return 1;
  }

  const selectedFiles = shard
    ? testFiles.filter((_, index) => index % shard.count === shard.index - 1)
    : testFiles;
  const scope = shard ? `分片 ${shard.index}/${shard.count}` : '全部测试';

  process.stdout.write(
    `测试编排：${scope}，串行执行 ${selectedFiles.length}/${testFiles.length} 个文件，单文件超时 ${fileTimeoutMs}ms\n`,
  );

  if (list) {
    selectedFiles.forEach((testFile) => process.stdout.write(`${toDisplayPath(testFile, cwd)}\n`));
    return 0;
  }

  const childEnvironment = { ...environment };
  delete childEnvironment.NODE_TEST_CONTEXT;
  const failures = [];
  for (const [index, testFile] of selectedFiles.entries()) {
    const displayPath = toDisplayPath(testFile, cwd);
    process.stdout.write(`\n[${index + 1}/${selectedFiles.length}] 运行 ${displayPath}\n`);
    const ignoredArtifacts = environment.GCAC_TEST_ORDER_FILE ? [environment.GCAC_TEST_ORDER_FILE] : [];
    const artifactSnapshot = snapshotArtifacts(testRoot, ignoredArtifacts);
    const result = runProcess(process.execPath, ['--test', '--test-concurrency=1', testFile], {
      cwd,
      env: childEnvironment,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: fileTimeoutMs,
      windowsHide: true,
    });
    const childOutput = combinedOutput(result);
    if (childOutput) process.stdout.write(childOutput);
    const failure = detectArtifactPollution(testRoot, artifactSnapshot, ignoredArtifacts)
      ?? classifyFailure(result, fileTimeoutMs);
    if (failure) {
      failures.push({ path: displayPath, ...failure });
      process.stderr.write(`测试文件失败：[${failure.category}] ${displayPath}；${failure.detail}\n`);
    }
  }

  if (failures.length > 0) {
    process.stderr.write(
      `\nNode 测试失败：${failures.length}/${selectedFiles.length} 个文件失败（${scope}）。\n`,
    );
    for (const category of FAILURE_CATEGORY_ORDER) {
      const categoryFailures = failures.filter((failure) => failure.category === category);
      if (categoryFailures.length === 0) continue;
      process.stderr.write(`失败分类 ${category}：${categoryFailures.length}\n`);
      for (const failure of categoryFailures) {
        process.stderr.write(`- ${failure.path}：${failure.detail}\n`);
      }
    }
    return 1;
  }

  process.stdout.write(`\nNode 测试完成：${selectedFiles.length} 个文件均返回 0（${scope}）。\n`);
  if (shard) process.stdout.write('注意：该分片结果不代表全量测试通过。\n');
  return 0;
}

function createIsolatedTestWorkspace(options) {
  const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'gcac-backend-test-'));
  const isolatedBackendRoot = join(workspaceRoot, 'backend');
  const isolatedDist = join(isolatedBackendRoot, 'dist');
  try {
    mkdirSync(isolatedBackendRoot, { recursive: true });
    symlinkSync(resolve(backendRoot, 'src'), join(isolatedBackendRoot, 'src'), 'junction');
    symlinkSync(resolve(backendRoot, 'node_modules'), join(isolatedBackendRoot, 'node_modules'), 'junction');
    copyFileSync(resolve(backendRoot, 'package.json'), join(isolatedBackendRoot, 'package.json'));
    copyFileSync(resolve(backendRoot, '..', 'version'), join(workspaceRoot, 'version'));
    for (const directory of ['compatibility', 'scripts', 'specs', 'docs', 'agents']) {
      const sourcePath = resolve(backendRoot, '..', directory);
      if (existsSync(sourcePath)) symlinkSync(sourcePath, join(workspaceRoot, directory), 'junction');
    }

    const tscPath = resolve(backendRoot, 'node_modules/typescript/bin/tsc');
    const buildResult = runProcess(process.execPath, [
      tscPath,
      '-p',
      resolve(backendRoot, 'tsconfig.json'),
      '--outDir',
      isolatedDist,
    ], {
      cwd: backendRoot,
      env: { ...options.environment },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const buildOutput = combinedOutput(buildResult);
    if (buildOutput) process.stdout.write(buildOutput);
    if (buildResult.status !== 0 || buildResult.error) {
      const failure = classifyBuildFailure(buildResult);
      throw Object.assign(new Error(failure.detail), { failure });
    }
    copyRuntimeResources(backendRoot, isolatedDist);
    process.stdout.write(`测试构建产物已隔离：${isolatedDist}\n`);
    return {
      testRoot: isolatedDist,
      cwd: isolatedBackendRoot,
      environment: {
        ...options.environment,
        GIT_DIR: resolve(backendRoot, '..', '.git'),
        GIT_WORK_TREE: resolve(backendRoot, '..'),
      },
      cleanup: () => {
        if (!options.keepArtifacts) rmSync(workspaceRoot, { recursive: true, force: true });
        else process.stdout.write(`测试产物已保留：${workspaceRoot}\n`);
      },
    };
  } catch (error) {
    rmSync(workspaceRoot, { recursive: true, force: true });
    throw error;
  }
}

function classifyBuildFailure(result) {
  const output = combinedOutput(result);
  if (result.error?.code === 'ETIMEDOUT') return { category: 'timeout', detail: 'TypeScript 构建超时' };
  if (/JavaScript heap out of memory|heap limit|out of memory|ENOMEM/i.test(output)) {
    return { category: 'resource-oom', detail: `构建退出码=${result.status ?? '未知'}；检测到内存耗尽输出` };
  }
  if (/GCAC_(?:SECRET_KEK|CA_CONFIRMATION_SECRET|TOKEN_SECRET|LICENSE_STORAGE_KEY)[^\r\n]*(?:未配置|缺少|missing|not configured)/i.test(output)
    || /(?:spawn|exec)[^\r\n]*(?:ENOENT|not found|not recognized)/i.test(output)) {
    return { category: 'environment', detail: '构建阶段检测到环境依赖缺失' };
  }
  return { category: 'build-failure', detail: `TypeScript 构建失败，退出码=${result.status ?? '未知'}` };
}

function snapshotArtifacts(directory, ignoredPaths = []) {
  const snapshot = new Map();
  if (!existsSync(directory)) return snapshot;
  const ignored = new Set(ignoredPaths.map((path) => resolve(path)));
  visit(directory, directory);
  return snapshot;

  function visit(current, root) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolutePath = resolve(current, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath, root);
        continue;
      }
      if (!entry.isFile()) continue;
      if (ignored.has(absolutePath)) continue;
      const stat = statSync(absolutePath);
      snapshot.set(relative(root, absolutePath), `${stat.size}:${stat.mtimeMs}`);
    }
  }
}

function detectArtifactPollution(directory, before, ignoredPaths = []) {
  if (!existsSync(directory)) return { category: 'artifact-pollution', detail: '测试期间测试产物目录被删除' };
  const after = snapshotArtifacts(directory, ignoredPaths);
  for (const [path, signature] of before) {
    if (!after.has(path)) return { category: 'artifact-pollution', detail: `测试期间产物被删除：${path}` };
    if (after.get(path) !== signature) return { category: 'artifact-pollution', detail: `测试期间产物被修改：${path}` };
  }
  for (const path of after.keys()) {
    if (!before.has(path)) return { category: 'artifact-pollution', detail: `测试期间产生未登记产物：${path}` };
  }
  return null;
}

function classifyFailure(result, fileTimeoutMs) {
  const output = combinedOutput(result);
  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      return {
        category: 'timeout',
        detail: `超过 ${fileTimeoutMs}ms，子进程已请求终止`,
      };
    }
    return {
      category: 'spawn-error',
      detail: `${result.error.code ?? '无错误码'}：${result.error.message}`,
    };
  }
  if (/JavaScript heap out of memory|heap limit|out of memory|ENOMEM/i.test(output) || result.status === 137) {
    return {
      category: 'resource-oom',
      detail: `退出码=${result.status ?? '未知'}；检测到内存耗尽输出或 SIGKILL(137)`,
    };
  }
  if (/GCAC_(?:SECRET_KEK|CA_CONFIRMATION_SECRET|TOKEN_SECRET|LICENSE_STORAGE_KEY)[^\r\n]*(?:未配置|缺少|missing|not configured)/i.test(output)
    || /(?:spawn|exec)[^\r\n]*(?:ENOENT|not found|not recognized)/i.test(output)) {
    return {
      category: 'environment',
      detail: `退出码=${result.status ?? '未知'}；检测到环境依赖缺失`,
    };
  }
  if (/Could not find ['"].*\.(?:test\.)?(?:js|mjs)['"]|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/i.test(output)) {
    return {
      category: 'missing-artifact',
      detail: `退出码=${result.status ?? '未知'}；检测到测试或模块产物缺失`,
    };
  }
  if (result.signal) {
    return {
      category: 'signal',
      detail: `收到 ${result.signal}`,
    };
  }
  if (!Number.isInteger(result.status)) {
    return {
      category: 'unknown-exit',
      detail: '未取得子进程退出码',
    };
  }
  if (result.status !== 0) {
    return {
      category: 'test-failure',
      detail: `退出码=${result.status}`,
    };
  }
  return null;
}

function combinedOutput(result) {
  return [result.stdout, result.stderr]
    .filter((value) => typeof value === 'string' && value.length > 0)
    .join('\n');
}

function collectTestFiles(directory, cwd = process.cwd()) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(absolutePath, cwd));
      continue;
    }
    if (entry.name.endsWith('.test.js') || entry.name.endsWith('.test.mjs')) files.push(absolutePath);
  }
  return files.sort((left, right) => comparePaths(toDisplayPath(left, cwd), toDisplayPath(right, cwd)));
}

function parseArguments(args, environment) {
  let testRoot;
  let fileTimeoutMs = parsePositiveInteger(
    environment.GCAC_TEST_FILE_TIMEOUT_MS ?? DEFAULT_FILE_TIMEOUT_MS,
    'GCAC_TEST_FILE_TIMEOUT_MS',
  );
  let shardSpec = environment.GCAC_TEST_SHARD;
  let shardIndex = environment.GCAC_TEST_SHARD_INDEX;
  let shardCount = environment.GCAC_TEST_SHARD_COUNT;
  let list = false;
  let help = false;
  let buildIsolated = false;
  let keepArtifacts = false;
  let requireTestSecret = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    if (argument === '--list') {
      list = true;
      continue;
    }
    if (argument === '--build-isolated') {
      buildIsolated = true;
      continue;
    }
    if (argument === '--keep-artifacts') {
      keepArtifacts = true;
      continue;
    }
    if (argument === '--require-test-secret') {
      requireTestSecret = true;
      continue;
    }
    if (argument === '--serial') continue;
    if (argument === '--root' || argument === '--test-root') {
      testRoot = readArgumentValue(args, ++index, argument);
      continue;
    }
    if (argument.startsWith('--root=') || argument.startsWith('--test-root=')) {
      testRoot = argument.slice(argument.indexOf('=') + 1);
      if (!testRoot) throw new Error(`${argument.split('=')[0]} 不能为空`);
      continue;
    }
    if (argument === '--shard') {
      shardSpec = readArgumentValue(args, ++index, argument);
      continue;
    }
    if (argument.startsWith('--shard=')) {
      shardSpec = argument.slice('--shard='.length);
      if (!shardSpec) throw new Error('--shard 不能为空');
      continue;
    }
    if (argument === '--shard-index' || argument === '--shard-count') {
      const value = readArgumentValue(args, ++index, argument);
      if (argument === '--shard-index') shardIndex = value;
      else shardCount = value;
      continue;
    }
    if (argument.startsWith('--shard-index=') || argument.startsWith('--shard-count=')) {
      const separator = argument.indexOf('=');
      const value = argument.slice(separator + 1);
      if (!value) throw new Error(`${argument.slice(0, separator)} 不能为空`);
      if (argument.startsWith('--shard-index=')) shardIndex = value;
      else shardCount = value;
      continue;
    }
    if (argument === '--file-timeout-ms') {
      fileTimeoutMs = parsePositiveInteger(readArgumentValue(args, ++index, argument), argument);
      continue;
    }
    if (argument.startsWith('--file-timeout-ms=')) {
      fileTimeoutMs = parsePositiveInteger(argument.slice('--file-timeout-ms='.length), '--file-timeout-ms');
      continue;
    }
    if (argument.startsWith('-')) throw new Error(`不支持的参数：${argument}`);
    if (testRoot !== undefined) throw new Error(`只能指定一个测试目录：${testRoot}、${argument}`);
    testRoot = argument;
  }

  const hasShardSpec = shardSpec !== undefined;
  const hasShardParts = shardIndex !== undefined || shardCount !== undefined;
  if (hasShardSpec && hasShardParts) {
    throw new Error('--shard/GCAC_TEST_SHARD 不能与 --shard-index/--shard-count 混用');
  }
  const shard = hasShardSpec
    ? parseShard(shardSpec)
    : hasShardParts
      ? parseShard(`${shardIndex ?? ''}/${shardCount ?? ''}`)
      : undefined;

  return {
    testRoot: resolve(process.cwd(), testRoot ?? DEFAULT_TEST_ROOT),
    fileTimeoutMs,
    shard,
    list,
    help,
    buildIsolated,
    keepArtifacts,
    requireTestSecret,
    environment,
  };
}

function parseShard(value) {
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(String(value));
  if (!match) throw new Error(`分片必须使用 INDEX/COUNT 格式且从 1 开始：${value}`);
  const index = parsePositiveInteger(match[1], '分片索引');
  const count = parsePositiveInteger(match[2], '分片总数');
  if (index > count) throw new Error(`分片索引不能大于分片总数：${index}/${count}`);
  return { index, count };
}

function parsePositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} 必须是正整数：${value}`);
  }
  return parsed;
}

function readArgumentValue(args, index, name) {
  const value = args[index];
  if (value === undefined || value.startsWith('-')) throw new Error(`${name} 需要一个值`);
  return value;
}

function toDisplayPath(absolutePath, cwd = process.cwd()) {
  return relative(cwd, absolutePath).replaceAll('\\', '/');
}

function comparePaths(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function usage() {
  return `用法：node scripts/run-node-test-files.mjs [测试目录] [选项]

默认按稳定路径顺序逐文件启动独立 Node 测试进程，并强制 --test-concurrency=1；支持 .test.js 和 .test.mjs。
正式全量命令使用 --build-isolated，在临时工作区独立编译和装配 dist，不修改共享 backend/dist。
选项：
  --root, --test-root PATH       测试目录，默认 dist
  --build-isolated               在临时工作区编译 TypeScript 并装配运行时资源
  --require-test-secret          要求显式提供 GCAC_SECRET_KEK，禁止默认密钥
  --keep-artifacts               失败后保留临时测试工作区用于诊断
  --list                         只列出当前分片，不启动测试文件
  --serial                       显式使用串行模式（默认）
  --shard INDEX/COUNT            只运行指定的一份分片，例如 2/4
  --shard-index INDEX            与 --shard-count 一起指定分片
  --shard-count COUNT            与 --shard-index 一起指定分片
  --file-timeout-ms MILLISECONDS 单个测试文件超时，默认 120000
  --help                         显示帮助

也可以使用环境变量 GCAC_TEST_SHARD、GCAC_TEST_SHARD_INDEX、GCAC_TEST_SHARD_COUNT 和 GCAC_TEST_FILE_TIMEOUT_MS。`;
}
