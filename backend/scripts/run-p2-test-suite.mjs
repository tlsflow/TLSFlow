import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadP2PluginReleaseManifest } from '../../scripts/architecture/p2-plugin-release-manifest.mjs';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(backendRoot, '..');
const defaultRoot = resolve(backendRoot, 'dist');
const defaultTimeoutMs = 180_000;
const defaultLogDirectory = resolve(backendRoot, 'test-results', 'p2');
const sensitiveEnvironmentNamePattern = /(AUTH|CERT|CREDENTIAL|KEY|PASSWORD|PASS|PRIVATE|SECRET|SIGNATURE|TOKEN|URL)/i;
const safeEnvironmentNames = new Set(['CI', 'NODE_ENV', 'TZ', 'GCAC_P2_TEST_FILE_TIMEOUT_MS']);
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// 该清单覆盖 17 个 P2 插件包、统一执行链、开发数据切换和无回退故障矩阵。
// 跨 Phase 全量测试不在此处运行，只能由最终开发门禁显式执行一次。
export const p2TestEntries = Object.freeze([
  { id: 'release-manifest-validator', kind: 'node-command', cwd: 'repository', args: ['scripts/architecture/p2-plugin-release-manifest.mjs'] },
  { id: 'release-manifest-contract', kind: 'source-test', cwd: 'repository', file: 'scripts/architecture/p2-plugin-release-manifest.test.mjs' },
  { id: 'fault-matrix-validator', kind: 'node-command', cwd: 'repository', args: ['scripts/architecture/p2-plugin-fault-matrix.mjs'] },
  { id: 'fault-matrix-contract', kind: 'source-test', cwd: 'repository', file: 'scripts/architecture/p2-plugin-fault-matrix.test.mjs' },
  { id: 'builtin-plugin-versions', kind: 'npm', cwd: 'backend', args: ['run', 'check:builtin-plugin-versions'] },
  { id: 'cloud-batch', batchId: 'cloud', kind: 'source-test', cwd: 'repository', file: 'compatibility/fixtures/cloud/cloud-package.contract.test.mjs', pluginIds: ['cloud.aliyun', 'cloud.tencent', 'cloud.huawei', 'cloud.volcengine'] },
  { id: 'web-app-batch', batchId: 'web-app', kind: 'source-test', cwd: 'repository', file: 'compatibility/fixtures/web-app/p2-web-app.test.mjs', pluginIds: ['web.nginx', 'web.apache', 'app.tomcat', 'app.java-keystore', 'app.rabbitmq', 'app.service-certificate-file'] },
  { id: 'ca-batch', batchId: 'ca', kind: 'source-test', cwd: 'repository', file: 'compatibility/fixtures/ca/ca-plugin-runner.real-process.test.mjs', pluginIds: ['ca.openssl', 'ca.acme', 'ca.acme-dns', 'ca.microsoft-adcs'] },
  { id: 'device-iis-batch', batchId: 'device', kind: 'built-test', cwd: 'backend', file: 'modules/plugins/builtin-plugins/web-iis/runtime/index.test.mjs', pluginIds: ['web.iis'] },
  { id: 'device-citrix-batch', batchId: 'device', kind: 'built-test', cwd: 'backend', file: 'modules/plugins/builtin-plugins/citrix-adc/runtime/index.test.mjs', pluginIds: ['device.citrix.netscaler-adc'] },
  { id: 'device-synology-batch', batchId: 'device', kind: 'built-test', cwd: 'backend', file: 'modules/plugins/builtin-plugins/device-synology-dsm/runtime/index.test.mjs', pluginIds: ['device.synology-dsm'] },
  { id: 'builtin-plugin-registry', kind: 'built-test', cwd: 'backend', file: 'modules/plugins/builtin-plugins/builtin-plugin-registry.test.js' },
  { id: 'builtin-plugin-ledger', kind: 'built-test', cwd: 'backend', file: 'modules/plugins/builtin-plugins/builtin-plugin-package-ledger.test.js' },
  { id: 'builtin-plugin-loader', kind: 'built-test', cwd: 'backend', file: 'modules/plugins/builtin-unified-plugin-loader.test.js' },
  { id: 'plugin-fact-runner', kind: 'built-test', cwd: 'backend', file: 'modules/plugins/application/plugin-fact-runner.adapter.test.js' },
  { id: 'plugin-fact-pipeline', kind: 'built-test', cwd: 'backend', file: 'modules/plugins/application/plugin-fact-pipeline.service.test.js' },
  { id: 'agent-plugin-fact-pipeline', kind: 'built-test', cwd: 'backend', file: 'modules/agents/agent-plugin-fact-pipeline.test.js' },
  { id: 'plugin-workflow-publisher', kind: 'built-test', cwd: 'backend', file: 'modules/plugins/plugin-workflow-publisher.test.js' },
  { id: 'plugin-workflow-source', kind: 'built-test', cwd: 'backend', file: 'modules/workflow-templates/plugin-workflow-source.test.js' },
  { id: 'workflow-execution-bindings', kind: 'built-test', cwd: 'backend', file: 'modules/workflow-templates/workflow-execution-bindings.test.js' },
  { id: 'application-asset-execution', kind: 'built-test', cwd: 'backend', file: 'modules/assets/application-asset-execution.test.js' },
  { id: 'development-database-cutover', kind: 'built-test', cwd: 'backend', file: 'database/development-database-cutover.test.js' },
  { id: 'plugin-runner-real-process', kind: 'built-test', cwd: 'backend', file: 'modules/plugins/runner/plugin-runner.real-process.test.js' },
  { id: 'runner-server-real-process', kind: 'built-test', cwd: 'backend', file: 'modules/plugins/runner/runner-server.real-process.test.js' },
  { id: 'host-api-handler', kind: 'built-test', cwd: 'backend', file: 'modules/plugins/runner/plugin-runner-host-api.handler.test.js' },
  { id: 'host-api-registry', kind: 'built-test', cwd: 'backend', file: 'modules/plugins/runner/protocol/host-api.registry.test.js' },
  { id: 'gateway-receipt-unknown', kind: 'built-test', cwd: 'backend', file: 'modules/gateway-agents/gateway-agents.test.js' },
  { id: 'execution-result-sync', kind: 'built-test', cwd: 'backend', file: 'modules/executions/execution-result-sync.service.test.js' },
  { id: 'recovery-no-replay', kind: 'built-test', cwd: 'backend', file: 'modules/executions/run-recovery-worker.test.js' },
  { id: 'legacy-dispatcher-rejection', kind: 'built-test', cwd: 'backend', file: 'modules/workflow-templates/workflow-step-dispatcher.test.js' },
  { id: 'plugin-architecture-zero', kind: 'node-command', cwd: 'backend', args: ['../scripts/architecture/check-plugin-architecture.mjs', '--require-zero'] },
  { id: 'plugin-retirement-audit', kind: 'node-command', cwd: 'repository', args: ['scripts/architecture/audit-plugin-retirement.mjs'] },
  { id: 'plugin-retirement-contract', kind: 'source-test', cwd: 'repository', file: 'scripts/architecture/audit-plugin-retirement.test.mjs' },
]);

const rawArguments = process.argv.slice(2);
let options;
const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirectExecution) {
  try {
    options = parseArguments(rawArguments);
  } catch (error) {
    process.stderr.write(`P2 测试编排参数错误：${error.message}\n`);
    process.exitCode = 1;
  }

  if (options?.help) {
    process.stdout.write(`${usage()}\n`);
  } else if (options) {
    process.exitCode = runSuite(options, rawArguments);
  }
}

export function validateP2TestEntries(entries = p2TestEntries) {
  const ids = new Set();
  const findings = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      findings.push('测试条目必须是对象');
      continue;
    }
    if (typeof entry.id !== 'string' || entry.id.trim() === '') findings.push('测试条目缺少 id');
    else if (ids.has(entry.id)) findings.push(`测试条目 id 重复：${entry.id}`);
    else ids.add(entry.id);
    if (!['node-command', 'source-test', 'built-test', 'npm'].includes(entry.kind)) findings.push(`测试条目类型无效：${entry.id ?? 'unknown'}`);
    if (!['repository', 'backend'].includes(entry.cwd)) findings.push(`测试条目工作目录无效：${entry.id ?? 'unknown'}`);
    if ((entry.kind === 'source-test' || entry.kind === 'built-test') && (typeof entry.file !== 'string' || entry.file.trim() === '')) {
      findings.push(`测试条目缺少文件：${entry.id ?? 'unknown'}`);
    }
    if ((entry.kind === 'node-command' || entry.kind === 'npm') && (!Array.isArray(entry.args) || entry.args.length === 0)) {
      findings.push(`测试条目缺少命令参数：${entry.id ?? 'unknown'}`);
    }
  }
  const releaseManifest = loadP2PluginReleaseManifest();
  const requiredBatchIds = releaseManifest.batches?.map((batch) => batch.id) ?? [];
  const batchEntries = entries.filter((entry) => requiredBatchIds.includes(entry.batchId));
  for (const required of [...requiredBatchIds.map((batchId) => `batch:${batchId}`), 'fault-matrix-contract', 'development-database-cutover', 'plugin-architecture-zero']) {
    const present = required.startsWith('batch:')
      ? batchEntries.some((entry) => entry.batchId === required.slice('batch:'.length))
      : ids.has(required);
    if (!present) findings.push(`P2 清单缺少必要条目：${required.replace(/^batch:/, '')}`);
  }
  for (const batch of releaseManifest.batches ?? []) {
    const batchEntriesForId = batchEntries.filter((entry) => entry.batchId === batch.id);
    const declared = batchEntriesForId.flatMap((entry) => entry.pluginIds ?? []);
    if (declared.length !== batch.pluginIds.length || [...declared].sort().join('|') !== [...batch.pluginIds].sort().join('|')) {
      findings.push(`P2 批次 ${batch.id} 的测试条目与发布清单插件集合不一致`);
    }
  }
  const coveredPluginIds = batchEntries.flatMap((entry) => {
    if (!Array.isArray(entry.pluginIds) || entry.pluginIds.length === 0) {
      findings.push(`批次测试条目缺少 pluginIds：${entry.id}`);
      return [];
    }
    return entry.pluginIds;
  });
  if (new Set(coveredPluginIds).size !== coveredPluginIds.length) findings.push('P2 批次测试清单存在重复 Plugin ID');
  const expectedPluginIds = releaseManifest.plugins?.map((plugin) => plugin.canonicalPluginId) ?? [];
  if (coveredPluginIds.length !== expectedPluginIds.length || [...coveredPluginIds].sort().join('|') !== [...expectedPluginIds].sort().join('|')) {
    findings.push('P2 批次测试清单必须逐项覆盖发布清单中的 17 个 Canonical Plugin ID');
  }
  return findings;
}

function runSuite(runOptions, commandArguments) {
  const logger = createExecutionLogger(runOptions, commandArguments);
  const startedAt = performance.now();
  const findings = validateP2TestEntries();
  if (findings.length > 0) return finish(runOptions, logger, startedAt, createFailureSummary(findings.map((detail) => ({ id: 'manifest', category: 'invalid-manifest', detail }))));
  if (runOptions.requireTestSecret && !process.env.GCAC_SECRET_KEK?.trim()) {
    return finish(runOptions, logger, startedAt, createFailureSummary([{ id: 'environment', category: 'missing-test-secret', detail: 'GCAC_SECRET_KEK 未显式提供' }]));
  }

  const commit = resolveGitCommit();
  logger.record({
    event: 'p2-test-start',
    startedAt: new Date().toISOString(),
    commit,
    command: formatCommand(commandArguments),
    repositoryRoot,
    backendRoot,
    root: runOptions.root,
    timeoutMs: runOptions.timeoutMs,
    build: runOptions.build,
    testEntryCount: p2TestEntries.length,
    environment: snapshotEnvironment(process.env),
  });

  let entries = p2TestEntries;
  if (runOptions.build) entries = [{ id: 'backend-build', kind: 'npm', cwd: 'backend', args: ['run', 'build'] }, ...entries];
  const summary = executeEntries(entries, runOptions, logger, commit);
  return finish(runOptions, logger, startedAt, summary);
}

function executeEntries(entries, options, logger, commit) {
  const failures = [];
  let passedFiles = 0;
  for (const [index, entry] of entries.entries()) {
    const startedAt = performance.now();
    const resolved = resolveEntry(entry, options);
    logger.output(process.stdout, `\n[${index + 1}/${entries.length}] ${entry.id}\n`);
    if (resolved.error) {
      const failure = { id: entry.id, category: 'missing-artifact', detail: resolved.error };
      failures.push(failure);
      logger.record({ event: 'p2-test-file-finish', commit, id: entry.id, file: entry.file ?? null, exitCode: null, durationMs: Math.round(performance.now() - startedAt), failure });
      continue;
    }
    const result = spawnSync(resolved.command, resolved.args, {
      cwd: resolved.cwd,
      env: { ...process.env },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: options.timeoutMs,
      windowsHide: true,
      // Windows 的 npm.cmd 是批处理入口，必须由 shell 解析才能稳定启动。
      shell: resolved.shell ?? false,
    });
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
    if (output) logger.output(process.stdout, output);
    const failure = classifyFailure(result, options.timeoutMs);
    logger.record({
      event: 'p2-test-file-finish',
      commit,
      id: entry.id,
      file: entry.file ?? null,
      cwd: resolved.cwd,
      command: formatSpawnCommand(resolved.command, resolved.args),
      exitCode: result.status ?? null,
      signal: result.signal ?? null,
      durationMs: Math.round(performance.now() - startedAt),
      failure: failure ?? null,
    });
    if (failure) failures.push({ id: entry.id, ...failure });
    else passedFiles += 1;
  }
  return { exitCode: failures.length === 0 ? 0 : 1, passedFiles, failedFiles: failures.length, failures };
}

export function resolveEntry(entry, options) {
  const cwd = entry.cwd === 'backend' ? backendRoot : repositoryRoot;
  if (entry.kind === 'node-command') return { command: process.execPath, args: entry.args, cwd };
  if (entry.kind === 'npm') return { command: npmCommand, args: entry.args, cwd, shell: process.platform === 'win32' };
  const testFile = entry.kind === 'built-test' ? resolve(options.root, entry.file) : resolve(repositoryRoot, entry.file);
  if (!existsSync(testFile)) return { error: `测试文件不存在：${testFile}` };
  return { command: process.execPath, args: ['--test', '--test-concurrency=1', testFile], cwd };
}

function finish(options, logger, startedAt, summary) {
  const durationMs = Math.round(performance.now() - startedAt);
  logger.record({
    event: 'p2-test-finish',
    finishedAt: new Date().toISOString(),
    exitCode: summary.exitCode,
    durationMs,
    passedFiles: summary.passedFiles,
    failedFiles: summary.failedFiles,
    failures: summary.failures,
    logPath: options.logPath,
  });
  logger.output(process.stdout, `\nP2 显式测试完成：${summary.passedFiles}/${summary.passedFiles + summary.failedFiles} 个条目通过，退出码=${summary.exitCode}，耗时=${durationMs}ms，日志=${options.logPath}\n`);
  return summary.exitCode;
}

function createFailureSummary(failures) {
  return { exitCode: 1, passedFiles: 0, failedFiles: failures.length, failures };
}

function createExecutionLogger(options, commandArguments) {
  mkdirSync(dirname(options.logPath), { recursive: true });
  appendFileSync(options.logPath, '');
  const write = (value) => appendFileSync(options.logPath, redactText(value));
  const output = (stream, value) => {
    const safeText = redactText(value);
    stream.write(safeText);
    appendFileSync(options.logPath, safeText);
  };
  write(`${JSON.stringify({ event: 'p2-test-log-created', logPath: options.logPath, command: formatCommand(commandArguments) })}\n`);
  return { record: (entry) => write(`${JSON.stringify(entry)}\n`), output };
}

function snapshotEnvironment(environment) {
  const names = Object.keys(environment).sort();
  return {
    names,
    redactedValues: Object.fromEntries(names.filter((name) => sensitiveEnvironmentNamePattern.test(name)).map((name) => [name, '[REDACTED]'])),
    tracked: Object.fromEntries(['GCAC_SECRET_KEK', 'GCAC_INITIAL_ADMIN_PASSWORD', 'GCAC_P2_TEST_FILE_TIMEOUT_MS'].map((name) => [name, {
      present: Boolean(environment[name]?.trim()),
      value: sensitiveEnvironmentNamePattern.test(name) ? '[REDACTED]' : environment[name] ?? null,
    }])),
    safeValues: Object.fromEntries([...safeEnvironmentNames].filter((name) => environment[name] !== undefined).map((name) => [name, environment[name]])),
  };
}

function redactText(value) {
  let text = String(value);
  for (const [name, environmentValue] of Object.entries(process.env)) {
    if (environmentValue && sensitiveEnvironmentNamePattern.test(name)) text = text.split(environmentValue).join('[REDACTED]');
  }
  return text.replace(/((?:authorization|credential|password|private[_-]?key|secret|signing[_-]?key|token)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}\]]+)/gi, '$1[REDACTED]');
}

function resolveGitCommit() {
  const result = spawnSync('git', ['-C', repositoryRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : 'UNAVAILABLE';
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
  let timeoutMs = Number(process.env.GCAC_P2_TEST_FILE_TIMEOUT_MS ?? defaultTimeoutMs);
  let logPath = resolve(defaultLogDirectory, `p2-test-${Date.now()}-${process.pid}.log`);
  let requireTestSecret = false;
  let build = false;
  let help = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') help = true;
    else if (argument === '--build') build = true;
    else if (argument === '--require-test-secret') requireTestSecret = true;
    else if (argument === '--root') root = resolve(backendRoot, readArgument(args, ++index, argument));
    else if (argument.startsWith('--root=')) root = resolve(backendRoot, argument.slice('--root='.length));
    else if (argument === '--file-timeout-ms') timeoutMs = positiveInteger(readArgument(args, ++index, argument), argument);
    else if (argument.startsWith('--file-timeout-ms=')) timeoutMs = positiveInteger(argument.slice('--file-timeout-ms='.length), '--file-timeout-ms');
    else if (argument === '--log-path') logPath = resolve(backendRoot, readArgument(args, ++index, argument));
    else if (argument.startsWith('--log-path=')) logPath = resolve(backendRoot, argument.slice('--log-path='.length));
    else throw new Error(`不支持的参数：${argument}`);
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('测试超时必须是正整数');
  return { root, timeoutMs, logPath, requireTestSecret, build, help };
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

function formatCommand(argumentsList) {
  return [process.execPath, process.argv[1], ...argumentsList].map((argument) => JSON.stringify(argument)).join(' ');
}

function formatSpawnCommand(command, args) {
  return [command, ...args].map((argument) => JSON.stringify(argument)).join(' ');
}

function usage() {
  return `用法：node scripts/run-p2-test-suite.mjs [选项]

在后端 dist 与仓库根目录串行执行 P2 显式测试，并生成带 commit、环境、命令、退出码、耗时和逐条结果的持久日志。

选项：
  --build                         先运行后端构建并记录结果
  --root PATH                     指定后端编译产物目录，默认 dist
  --require-test-secret           要求显式提供 GCAC_SECRET_KEK
  --file-timeout-ms MILLISECONDS  单个条目超时，默认 180000
  --log-path PATH                 指定日志路径，默认 backend/test-results/p2/
  --help                          显示帮助`;
}
