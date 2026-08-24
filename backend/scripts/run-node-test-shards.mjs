import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const runnerPath = fileURLToPath(new URL('./run-node-test-files.mjs', import.meta.url));
const DEFAULT_SHARD_COUNT = 2;
const DEFAULT_MAX_PARALLEL = 2;
const DEFAULT_FILE_TIMEOUT_MS = 180_000;
const MAX_CAPTURE_BYTES = 64 * 1024 * 1024;

try {
  const options = parseArguments(process.argv.slice(2), process.env);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
  } else {
    process.exitCode = await runShards(options);
  }
} catch (error) {
  process.stderr.write(`测试分片编排参数错误：${error.message}\n`);
  process.exitCode = 1;
}

async function runShards(options) {
  if (options.requireTestSecret && !options.environment.GCAC_SECRET_KEK?.trim()) {
    process.stderr.write('测试环境缺失：[environment] GCAC_SECRET_KEK 未配置；拒绝使用默认测试密钥\n');
    return 1;
  }

  process.stdout.write(
    `测试分片编排：${options.shardCount} 个独立分片，最多并行 ${options.maxParallel} 个，单文件超时 ${options.fileTimeoutMs}ms\n`,
  );

  const results = [];
  for (let start = 1; start <= options.shardCount; start += options.maxParallel) {
    const indexes = Array.from(
      { length: Math.min(options.maxParallel, options.shardCount - start + 1) },
      (_, offset) => start + offset,
    );
    const batch = await Promise.all(indexes.map((index) => runShard(index, options)));
    results.push(...batch);
  }

  for (const result of results.sort((left, right) => left.index - right.index)) {
    const heading = `\n===== 分片 ${result.index}/${options.shardCount} =====\n`;
    process.stdout.write(heading);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(`${heading}${result.stderr}`);
    if (result.failure) process.stderr.write(`分片 ${result.index}/${options.shardCount} 失败：${result.failure}\n`);
  }

  const failures = results.filter((result) => result.exitCode !== 0);
  if (failures.length > 0) {
    process.stderr.write(`\nNode 分片测试失败：${failures.length}/${options.shardCount} 个分片失败。\n`);
    return 1;
  }

  process.stdout.write(`\nNode 分片测试完成：${options.shardCount}/${options.shardCount} 个分片均通过。\n`);
  return 0;
}

function runShard(index, options) {
  const argumentsList = [runnerPath, '--shard', `${index}/${options.shardCount}`, '--file-timeout-ms', String(options.fileTimeoutMs)];
  if (options.buildIsolated) argumentsList.push('--build-isolated');
  else argumentsList.push('--root', options.testRoot);
  if (options.keepArtifacts) argumentsList.push('--keep-artifacts');
  if (options.requireTestSecret) argumentsList.push('--require-test-secret');

  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, argumentsList, {
      cwd: process.cwd(),
      env: { ...options.environment },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    let capturedBytes = 0;
    let captureOverflow = false;
    let spawnError;

    const capture = (target, chunk) => {
      const text = chunk.toString('utf8');
      capturedBytes += Buffer.byteLength(text);
      if (capturedBytes > MAX_CAPTURE_BYTES) {
        captureOverflow = true;
        child.kill();
        return;
      }
      target.push(text);
    };

    child.stdout.on('data', (chunk) => capture(stdout, chunk));
    child.stderr.on('data', (chunk) => capture(stderr, chunk));
    child.on('error', (error) => {
      spawnError = error;
    });
    child.on('close', (code, signal) => {
      const failure = captureOverflow
        ? `协议输出超过 ${MAX_CAPTURE_BYTES} 字节，已终止`
        : spawnError
          ? `${spawnError.code ?? '无错误码'}：${spawnError.message}`
          : signal
            ? `收到 ${signal}`
            : code === 0
              ? undefined
              : `退出码=${code ?? '未知'}`;
      resolvePromise({
        index,
        exitCode: failure ? 1 : 0,
        failure,
        stdout: stdout.join(''),
        stderr: stderr.join(''),
      });
    });
  });
}

function parseArguments(argumentsList, environment) {
  let testRoot = 'dist';
  let shardCount = DEFAULT_SHARD_COUNT;
  let maxParallel = DEFAULT_MAX_PARALLEL;
  let fileTimeoutMs = DEFAULT_FILE_TIMEOUT_MS;
  let buildIsolated = false;
  let keepArtifacts = false;
  let requireTestSecret = false;
  let help = false;

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--help' || argument === '-h') {
      help = true;
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
    if (argument === '--root' || argument === '--test-root') {
      testRoot = readArgumentValue(argumentsList, ++index, argument);
      continue;
    }
    if (argument === '--shard-count' || argument === '--max-parallel' || argument === '--file-timeout-ms') {
      const value = readArgumentValue(argumentsList, ++index, argument);
      if (argument === '--shard-count') shardCount = parsePositiveInteger(value, argument);
      else if (argument === '--max-parallel') maxParallel = parsePositiveInteger(value, argument);
      else fileTimeoutMs = parsePositiveInteger(value, argument);
      continue;
    }
    if (argument.startsWith('--root=') || argument.startsWith('--test-root=')) {
      testRoot = argument.slice(argument.indexOf('=') + 1);
      if (!testRoot) throw new Error(`${argument.split('=')[0]} 不能为空`);
      continue;
    }
    if (argument.startsWith('--shard-count=') || argument.startsWith('--max-parallel=') || argument.startsWith('--file-timeout-ms=')) {
      const separator = argument.indexOf('=');
      const value = argument.slice(separator + 1);
      if (!value) throw new Error(`${argument.slice(0, separator)} 不能为空`);
      if (argument.startsWith('--shard-count=')) shardCount = parsePositiveInteger(value, '--shard-count');
      else if (argument.startsWith('--max-parallel=')) maxParallel = parsePositiveInteger(value, '--max-parallel');
      else fileTimeoutMs = parsePositiveInteger(value, '--file-timeout-ms');
      continue;
    }
    throw new Error(`不支持的参数：${argument}`);
  }

  if (maxParallel > shardCount) maxParallel = shardCount;
  return {
    testRoot,
    shardCount,
    maxParallel,
    fileTimeoutMs,
    buildIsolated,
    keepArtifacts,
    requireTestSecret,
    help,
    environment,
  };
}

function parsePositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} 必须是正整数：${value}`);
  return parsed;
}

function readArgumentValue(argumentsList, index, name) {
  const value = argumentsList[index];
  if (value === undefined || value.startsWith('-')) throw new Error(`${name} 需要一个值`);
  return value;
}

function usage() {
  return `用法：node scripts/run-node-test-shards.mjs [选项]

按稳定分片启动 run-node-test-files.mjs。每个分片独立构建时可避免测试互相污染，默认最多并行两个分片。
选项：
  --root, --test-root PATH       测试目录，默认 dist
  --build-isolated               每个分片使用独立临时构建产物
  --require-test-secret          要求显式提供 GCAC_SECRET_KEK
  --keep-artifacts               保留失败分片的临时构建产物
  --shard-count COUNT            分片总数，默认 2
  --max-parallel COUNT           最大并发分片数，默认 2
  --file-timeout-ms MILLISECONDS 单个测试文件超时，默认 180000
  --help                         显示帮助`;
}
