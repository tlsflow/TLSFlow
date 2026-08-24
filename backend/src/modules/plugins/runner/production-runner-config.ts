import { existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../../../common/errors/app-error.js';

export interface PluginRunnerConfig {
  executablePath: string;
  workingDirectory: string;
  args: readonly string[];
  executorModulePath: string;
  runnerVersion: string;
  sdkVersion: string;
}

/** 兼容既有调用方；生产与开发均使用同一份不可变启动规格。 */
export type ProductionPluginRunnerConfig = PluginRunnerConfig;

const forbiddenArguments = new Set([
  '-r', '--require', '--loader', '--import', '-e', '--eval', '--inspect', '--inspect-brk', '--inspect-port',
]);
const require = createRequire(import.meta.url);

/** 读取生产 Runner 装配。生产环境不允许缺省值或动态模块加载参数。 */
export function resolveProductionPluginRunnerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ProductionPluginRunnerConfig | undefined {
  if (environment.NODE_ENV !== 'production') return undefined;
  const executablePath = required(environment.GCAC_PLUGIN_RUNNER_EXECUTABLE_PATH, 'GCAC_PLUGIN_RUNNER_EXECUTABLE_PATH');
  const workingDirectory = required(environment.GCAC_PLUGIN_RUNNER_WORKING_DIRECTORY, 'GCAC_PLUGIN_RUNNER_WORKING_DIRECTORY');
  const configuredArgs = parseArgs(required(environment.GCAC_PLUGIN_RUNNER_ARGS_JSON, 'GCAC_PLUGIN_RUNNER_ARGS_JSON'));
  const executorModulePath = required(environment.GCAC_PLUGIN_RUNNER_EXECUTOR_MODULE_PATH, 'GCAC_PLUGIN_RUNNER_EXECUTOR_MODULE_PATH');
  const runnerVersion = required(environment.GCAC_PLUGIN_RUNNER_VERSION, 'GCAC_PLUGIN_RUNNER_VERSION');
  const sdkVersion = required(environment.GCAC_PLUGIN_SDK_VERSION, 'GCAC_PLUGIN_SDK_VERSION');
  if (!isAbsolute(executablePath) || !isAbsolute(workingDirectory) || !isAbsolute(executorModulePath)) {
    throw new AppError('PLUGIN_RUNNER_START_FAILED', '生产 Runner 可执行路径、工作目录和执行器模块必须是绝对路径');
  }
  assertProductionPath(executablePath, false);
  assertProductionPath(workingDirectory, true);
  assertProductionPath(executorModulePath, false);
  if (configuredArgs.some((argument) => argument === '--executor-module' || argument.startsWith('--executor-module='))) throw new AppError('PLUGIN_RUNNER_START_FAILED', '生产 Runner 执行器模块只能由固定配置注入');
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(runnerVersion) || !/^[A-Za-z0-9._:-]{1,128}$/.test(sdkVersion)) {
    throw new AppError('PLUGIN_RUNNER_START_FAILED', '生产 Runner runnerVersion/sdkVersion 格式无效');
  }
  return Object.freeze({
    executablePath,
    workingDirectory,
    executorModulePath,
    args: Object.freeze([...configuredArgs, '--executor-module', executorModulePath]),
    runnerVersion,
    sdkVersion,
  });
}

/**
 * 解析受控开发 Runner。
 *
 * 开发模式仍通过独立 Runner 子进程加载固定 PluginVersion 的 runtime/index.js，
 * 不是在宿主进程直接 import 插件。生产和 Node 测试环境均不允许走此默认值。
 */
export function resolveDevelopmentPluginRunnerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): PluginRunnerConfig | undefined {
  if (!isDevelopmentRunnerEnvironment(environment)) return undefined;

  const runnerServer = resolveDevelopmentRunnerServer();
  const args = runnerServer.kind === 'typescript'
    ? [
      '--import', resolveTsxLoader(),
      runnerServer.path,
      '--executor-module', runnerServer.path,
    ]
    : [runnerServer.path, '--executor-module', runnerServer.path];

  return Object.freeze({
    executablePath: process.execPath,
    workingDirectory: process.cwd(),
    executorModulePath: runnerServer.path,
    args: Object.freeze(args),
    runnerVersion: 'gcac-dev-runner-v1',
    sdkVersion: 'gcac-plugin-sdk-v1',
  });
}

/** 生产严格配置优先；仅本地开发允许使用受控默认 Runner。 */
export function resolvePluginRunnerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): PluginRunnerConfig | undefined {
  return resolveProductionPluginRunnerConfig(environment)
    ?? resolveDevelopmentPluginRunnerConfig(environment);
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new AppError('PLUGIN_RUNNER_START_FAILED', `生产 Runner 缺少必需配置 ${name}`, { name });
  return normalized;
}

function parseArgs(input: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    throw new AppError('PLUGIN_RUNNER_START_FAILED', '生产 Runner 参数必须是 JSON 字符串数组', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 64 || parsed.some((item) => typeof item !== 'string' || item.length === 0 || item.length > 4096)) {
    throw new AppError('PLUGIN_RUNNER_START_FAILED', '生产 Runner 参数必须是非空固定字符串数组');
  }
  if (parsed.some((item) => forbiddenArguments.has(item))) {
    throw new AppError('PLUGIN_RUNNER_START_FAILED', '生产 Runner 参数禁止启用动态模块加载或内联代码执行');
  }
  return [...parsed] as string[];
}

function assertProductionPath(path: string, directory: boolean): void {
  try {
    const stat = statSync(path);
    if (directory ? !stat.isDirectory() : !stat.isFile()) throw new Error('类型不匹配');
  } catch (error) {
    throw new AppError('PLUGIN_RUNNER_START_FAILED', '生产 Runner 路径不存在或类型无效', { path, error: error instanceof Error ? error.message : String(error) });
  }
}

function isDevelopmentRunnerEnvironment(environment: NodeJS.ProcessEnv): boolean {
  if (environment.NODE_ENV === 'production' || environment.NODE_ENV === 'test') return false;
  // node:test 会给子进程注入这个标记；不能让普通测试意外创建真实 Runner 子进程。
  if (environment.NODE_TEST_CONTEXT) return false;
  return environment.NODE_ENV === undefined || environment.NODE_ENV === '' || environment.NODE_ENV === 'development';
}

function resolveDevelopmentRunnerServer(): { path: string; kind: 'typescript' | 'javascript' } {
  const sourceCandidates = [
    fileURLToPath(new URL('./runner-server.ts', import.meta.url)),
    resolve(process.cwd(), 'src/modules/plugins/runner/runner-server.ts'),
    resolve(process.cwd(), 'backend/src/modules/plugins/runner/runner-server.ts'),
  ];
  const sourcePath = sourceCandidates.find(isRegularFile);
  if (sourcePath) return { path: sourcePath, kind: 'typescript' };

  const compiledCandidates = [
    fileURLToPath(new URL('./runner-server.js', import.meta.url)),
    resolve(process.cwd(), 'dist/modules/plugins/runner/runner-server.js'),
    resolve(process.cwd(), 'backend/dist/modules/plugins/runner/runner-server.js'),
  ];
  const compiledPath = compiledCandidates.find(isRegularFile);
  if (compiledPath) return { path: compiledPath, kind: 'javascript' };

  throw new AppError('PLUGIN_RUNNER_START_FAILED', '开发 Runner 找不到固定 runner-server 入口');
}

function resolveTsxLoader(): string {
  try {
    const loaderPath = require.resolve('tsx');
    if (!isRegularFile(loaderPath)) throw new Error('tsx loader 不是普通文件');
    return loaderPath;
  } catch (error) {
    throw new AppError('PLUGIN_RUNNER_START_FAILED', '开发 Runner 找不到本地 tsx loader', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function isRegularFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}
