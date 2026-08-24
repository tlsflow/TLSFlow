import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { dirname, resolve } from 'node:path';

const defaultRoot = resolve(process.cwd(), 'dist');
const defaultTimeoutMs = 180_000;
const defaultLogDirectory = resolve(process.cwd(), 'test-results', 'p1');
const sensitiveEnvironmentNamePattern = /(AUTH|CERT|CREDENTIAL|KEY|PASSWORD|PASS|PRIVATE|SECRET|SIGNATURE|TOKEN|URL)/i;
const safeEnvironmentNames = new Set(['CI', 'NODE_ENV', 'GCAC_P1_TEST_FILE_TIMEOUT_MS', 'TZ']);

// 该清单只覆盖 P1 Runner、授权、Agent v2、Gateway、Execution、Deployment 和 Workflow 主链。
// F032 的 Cloud 合同测试属于 Phase 2，必须显式排除，不能由编排器加载。
const p1TestFiles = [
  'app.module.test.js',
  'modules/plugins/runner/protocol/protocol.contract.test.js',
  'modules/plugins/runner/protocol/host-api.registry.test.js',
  'modules/plugins/runner/plugin-runner-host-api.handler.test.js',
  'modules/plugins/runner/plugin-runner.real-process.test.js',
  'modules/plugins/runner/production-runner.real-process.test.js',
  'modules/plugins/runner/runner-server.real-process.test.js',
  'modules/agents/security/agent-security.contract.test.js',
  'modules/agents/security/policy-authority.service.test.js',
  'modules/agents/security/production-agent-local-policy.adapter.test.js',
  'modules/plugins/unified-agent-plan-compiler.test.js',
  'modules/plugins/plugin-runtime-guard.test.js',
  'modules/agents/agent-task-result-status.test.js',
  'modules/agents/application/agents-direct-execution.test.js',
  'modules/agents/application/agent-direct-client.test.js',
  'modules/gateway-agents/gateway-agents.test.js',
  'modules/gateways/gateways-api.test.js',
  'modules/executions/execution-grant-artifact.test.js',
  'modules/executions/plugin-runner-executor.adapter.test.js',
  'modules/executions/agent-direct-executor.test.js',
  'modules/executions/execution-result-sync.service.test.js',
  'modules/executions/executions-scheduler.test.js',
  'modules/executions/workflow-executor-adapter.test.js',
  'modules/executions/plugin-architecture-bypass.todo.test.js',
  'modules/deployment-plans/deployment-input-layer-replay.test.js',
  'modules/deployment-plans/deployment-execution-api.test.js',
  'modules/deployment-inputs/deployment-input-persistence-sanitizer.test.js',
  'modules/workflow-templates/workflow-execution-bindings.test.js',
  'modules/workflow-templates/plugin-workflow-source.test.js',
  'modules/workflow-templates/workflow-templates.security.test.js',
];

const phase2ExcludedTests = [
  {
    file: 'modules/plugins/builtin-plugins/cloud-runtime.contract.test.mjs',
    reason: 'Cloud runtime/index.js 和 Cloud 生产插件属于 Phase 2，当前未开始迁移。',
  },
];

const rawArguments = process.argv.slice(2);
let options;
try {
  options = parseArguments(rawArguments);
} catch (error) {
  process.stderr.write(`P1 测试编排参数错误：${error.message}\n`);
  process.exitCode = 1;
}

if (options?.help) {
  process.stdout.write(`${usage()}\n`);
  process.exitCode = 0;
} else if (options) {
  process.exitCode = runSuite(options, rawArguments);
}

function runSuite(options, commandArguments) {
  let logger;
  try {
    logger = createExecutionLogger(options, commandArguments);
  } catch (error) {
    process.stderr.write(`P1 测试拒绝运行：无法创建持久日志：${error.message}\n`);
    return 1;
  }

  const startedAt = performance.now();
  let summary = {
    exitCode: 1,
    passedFiles: 0,
    failedFiles: 0,
    failures: [],
  };

  logger.output(process.stdout, `P1 测试持久日志：${logger.logPath}\n`);
  logger.record({
    event: 'p1-test-start',
    startedAt: new Date().toISOString(),
    command: formatCommand(commandArguments),
    cwd: process.cwd(),
    root: options.root,
    timeoutMs: options.timeoutMs,
    requireTestSecret: options.requireTestSecret,
    testFileCount: p1TestFiles.length,
    p1TestFiles,
    phase2ExcludedTests,
    environment: snapshotEnvironment(process.env),
  });

  try {
    summary = executeSuite(options, logger);
  } catch (error) {
    logger.output(process.stderr, `P1 测试编排异常：${error.stack ?? error.message}\n`);
  }

  const durationMs = Math.round(performance.now() - startedAt);
  try {
    logger.record({
      event: 'p1-test-finish',
      finishedAt: new Date().toISOString(),
      exitCode: summary.exitCode,
      durationMs,
      passedFiles: summary.passedFiles,
      failedFiles: summary.failedFiles,
      failures: summary.failures,
      logPath: logger.logPath,
    });
  } catch (error) {
    process.stderr.write(`P1 测试警告：无法写入完成记录：${error.message}\n`);
    return 1;
  }

  logger.output(
    process.stdout,
    `P1 测试执行记录：退出码=${summary.exitCode}，耗时=${durationMs}ms，日志=${logger.logPath}\n`,
  );
  return summary.exitCode;
}

function executeSuite(options, logger) {
  assertP1TestScope();

  if (options.requireTestSecret && !process.env.GCAC_SECRET_KEK?.trim()) {
    logger.output(process.stderr, 'P1 测试拒绝运行：未显式提供 GCAC_SECRET_KEK，禁止使用默认密钥。\n');
    return createFailureSummary([]);
  }

  if (!existsSync(options.root)) {
    logger.output(process.stderr, `P1 测试产物目录不存在：${options.root}；请先执行 npm run build。\n`);
    return createFailureSummary([]);
  }

  logger.output(
    process.stdout,
    `P1 统一测试：串行执行 ${p1TestFiles.length} 个文件，单文件超时 ${options.timeoutMs}ms；不加载 Phase 2 Cloud 测试或生产资源。\n`,
  );

  const failures = [];
  let passedFiles = 0;
  for (const [index, relativePath] of p1TestFiles.entries()) {
    const testFile = resolve(options.root, relativePath);
    logger.output(process.stdout, `\n[${index + 1}/${p1TestFiles.length}] ${relativePath}\n`);
    const testStartedAt = performance.now();

    if (!existsSync(testFile)) {
      const failure = { file: relativePath, category: 'missing-artifact', detail: '测试编译产物不存在' };
      failures.push(failure);
      logger.record({
        event: 'p1-test-file-finish',
        file: relativePath,
        exitCode: null,
        durationMs: Math.round(performance.now() - testStartedAt),
        failure,
      });
      logger.output(process.stderr, `失败：[missing-artifact] ${relativePath}\n`);
      continue;
    }

    const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', testFile], {
      cwd: process.cwd(),
      env: { ...process.env },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: options.timeoutMs,
      windowsHide: true,
    });
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
    if (output) logger.output(process.stdout, output);
    const failure = classifyFailure(result, options.timeoutMs);
    const durationMs = Math.round(performance.now() - testStartedAt);
    logger.record({
      event: 'p1-test-file-finish',
      file: relativePath,
      exitCode: result.status ?? null,
      signal: result.signal ?? null,
      durationMs,
      failure: failure ?? null,
    });
    if (failure) {
      failures.push({ file: relativePath, ...failure });
      logger.output(process.stderr, `失败：[${failure.category}] ${relativePath}；${failure.detail}\n`);
    } else {
      passedFiles += 1;
    }
  }

  if (failures.length > 0) {
    logger.output(
      process.stderr,
      `\nP1 统一测试失败：${failures.length}/${p1TestFiles.length} 个文件失败。\n`,
    );
    for (const failure of failures) {
      logger.output(process.stderr, `- ${failure.file}：${failure.category}；${failure.detail}\n`);
    }
    return {
      exitCode: 1,
      passedFiles,
      failedFiles: failures.length,
      failures,
    };
  }

  logger.output(process.stdout, `\nP1 统一测试完成：${p1TestFiles.length}/${p1TestFiles.length} 个文件返回 0。\n`);
  return {
    exitCode: 0,
    passedFiles,
    failedFiles: 0,
    failures: [],
  };
}

function createFailureSummary(failures) {
  return {
    exitCode: 1,
    passedFiles: 0,
    failedFiles: failures.length,
    failures,
  };
}

function createExecutionLogger(options, commandArguments) {
  const logPath = options.logPath;
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, '');

  const write = (text) => appendFileSync(logPath, redactText(text));
  const output = (stream, text) => {
    const safeText = redactText(text);
    stream.write(safeText);
    appendFileSync(logPath, safeText);
  };
  const record = (entry) => write(`${JSON.stringify(entry)}\n`);

  record({
    event: 'p1-test-log-created',
    logPath,
    command: formatCommand(commandArguments),
  });

  return { logPath, output, record };
}

function snapshotEnvironment(environment) {
  const names = Object.keys(environment).sort();
  const redactedValues = Object.fromEntries(
    names
      .filter((name) => sensitiveEnvironmentNamePattern.test(name))
      .map((name) => [name, '[REDACTED]']),
  );
  const tracked = Object.fromEntries(
    ['GCAC_SECRET_KEK', 'GCAC_INITIAL_ADMIN_PASSWORD', 'GCAC_P1_TEST_FILE_TIMEOUT_MS']
      .map((name) => [name, {
        present: Boolean(environment[name]?.trim()),
        value: sensitiveEnvironmentNamePattern.test(name) ? '[REDACTED]' : environment[name] ?? null,
      }]),
  );
  const safeValues = Object.fromEntries(
    [...safeEnvironmentNames]
      .filter((name) => environment[name] !== undefined)
      .map((name) => [name, environment[name]]),
  );
  return { names, redactedValues, tracked, safeValues };
}

function redactText(value) {
  let text = String(value);
  for (const [name, environmentValue] of Object.entries(process.env)) {
    if (!environmentValue || !sensitiveEnvironmentNamePattern.test(name)) continue;
    text = text.split(environmentValue).join('[REDACTED]');
  }
  return text.replace(
    /((?:authorization|credential|password|private[_-]?key|secret|signing[_-]?key|token)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}\]]+)/gi,
    '$1[REDACTED]',
  );
}

function assertP1TestScope() {
  const phase2Paths = new Set(phase2ExcludedTests.map(({ file }) => file));
  const overlap = p1TestFiles.filter((file) => phase2Paths.has(file));
  if (overlap.length > 0) {
    throw new Error(`P1 测试清单越界，包含 Phase 2 测试：${overlap.join(', ')}`);
  }
}

function formatCommand(commandArguments) {
  return [process.execPath, process.argv[1], ...commandArguments]
    .map((argument) => JSON.stringify(argument))
    .join(' ');
}

function classifyFailure(result, timeoutMs) {
  if (result.error?.code === 'ETIMEDOUT') return { category: 'timeout', detail: `超过 ${timeoutMs}ms` };
  if (result.error) return { category: 'spawn-error', detail: `${result.error.code ?? 'unknown'}：${result.error.message}` };
  if (result.signal) return { category: 'signal', detail: result.signal };
  if (result.status !== 0) return { category: 'test-failure', detail: `退出码=${result.status ?? 'unknown'}` };
  return undefined;
}

function parseArguments(args) {
  let root = defaultRoot;
  let timeoutMs = Number(process.env.GCAC_P1_TEST_FILE_TIMEOUT_MS ?? defaultTimeoutMs);
  let requireTestSecret = false;
  let logPath = resolve(defaultLogDirectory, `p1-test-${Date.now()}-${process.pid}.log`);
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    if (argument === '--require-test-secret') {
      requireTestSecret = true;
      continue;
    }
    if (argument === '--root') {
      root = resolve(process.cwd(), readArgument(args, ++index, argument));
      continue;
    }
    if (argument.startsWith('--root=')) {
      root = resolve(process.cwd(), argument.slice('--root='.length));
      continue;
    }
    if (argument === '--file-timeout-ms') {
      timeoutMs = positiveInteger(readArgument(args, ++index, argument), argument);
      continue;
    }
    if (argument.startsWith('--file-timeout-ms=')) {
      timeoutMs = positiveInteger(argument.slice('--file-timeout-ms='.length), '--file-timeout-ms');
      continue;
    }
    if (argument === '--log-path') {
      logPath = resolve(process.cwd(), readArgument(args, ++index, argument));
      continue;
    }
    if (argument.startsWith('--log-path=')) {
      logPath = resolve(process.cwd(), argument.slice('--log-path='.length));
      continue;
    }
    throw new Error(`不支持的参数：${argument}`);
  }

  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('测试超时必须是正整数');
  return { root, timeoutMs, requireTestSecret, logPath, help };
}

function readArgument(args, index, name) {
  const value = args[index];
  if (!value || value.startsWith('-')) throw new Error(`${name} 需要一个值`);
  return value;
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} 必须是正整数：${value}`);
  return parsed;
}

function usage() {
  return `用法：node scripts/run-p1-test-suite.mjs [选项]

默认在 backend/dist 中串行执行 P1 主链测试；执行前应先完成 npm run build。
P1 清单不加载 Phase 2 Cloud 合同测试或 Cloud 生产资源。
选项：
  --root PATH                    指定编译产物目录
  --require-test-secret          要求显式提供 GCAC_SECRET_KEK
  --file-timeout-ms MILLISECONDS 单个测试文件超时，默认 180000
  --log-path PATH                指定持久日志路径，默认 backend/test-results/p1/
  --help                         显示帮助`;
}
