import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const defaultRoot = resolve(process.cwd(), 'dist');
const defaultTimeoutMs = 180_000;

// 该清单覆盖 P1 Runner、授权、Agent v2、Gateway、Execution、Deployment 和 Workflow 主链。
// 29 个基线失败仍然保留在清单中，测试失败时必须输出真实原因，不能由编排器吞掉。
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

const options = parseArguments(process.argv.slice(2));
if (options.help) {
  process.stdout.write(`${usage()}\n`);
  process.exit(0);
}

if (options.requireTestSecret && !process.env.GCAC_SECRET_KEK?.trim()) {
  process.stderr.write('P1 测试拒绝运行：未显式提供 GCAC_SECRET_KEK，禁止使用默认密钥。\n');
  process.exit(1);
}

if (!existsSync(options.root)) {
  process.stderr.write(`P1 测试产物目录不存在：${options.root}；请先执行 npm run build。\n`);
  process.exit(1);
}

const failures = [];
process.stdout.write(`P1 统一测试：串行执行 ${p1TestFiles.length} 个文件，单文件超时 ${options.timeoutMs}ms\n`);

for (const [index, relativePath] of p1TestFiles.entries()) {
  const testFile = resolve(options.root, relativePath);
  process.stdout.write(`\n[${index + 1}/${p1TestFiles.length}] ${relativePath}\n`);
  if (!existsSync(testFile)) {
    failures.push({ file: relativePath, category: 'missing-artifact', detail: '测试编译产物不存在' });
    process.stderr.write(`失败：[missing-artifact] ${relativePath}\n`);
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
  if (output) process.stdout.write(output);
  const failure = classifyFailure(result, options.timeoutMs);
  if (failure) {
    failures.push({ file: relativePath, ...failure });
    process.stderr.write(`失败：[${failure.category}] ${relativePath}；${failure.detail}\n`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`\nP1 统一测试失败：${failures.length}/${p1TestFiles.length} 个文件失败。\n`);
  for (const failure of failures) {
    process.stderr.write(`- ${failure.file}：${failure.category}；${failure.detail}\n`);
  }
  process.exit(1);
}

process.stdout.write(`\nP1 统一测试完成：${p1TestFiles.length}/${p1TestFiles.length} 个文件返回 0。\n`);

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
    throw new Error(`不支持的参数：${argument}`);
  }

  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('测试超时必须是正整数');
  return { root, timeoutMs, requireTestSecret, help };
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
选项：
  --root PATH                    指定编译产物目录
  --require-test-secret          要求显式提供 GCAC_SECRET_KEK
  --file-timeout-ms MILLISECONDS 单个测试文件超时，默认 180000
  --help                         显示帮助`;
}
