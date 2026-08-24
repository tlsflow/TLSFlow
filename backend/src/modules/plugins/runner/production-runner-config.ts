import { isAbsolute } from 'node:path';
import { statSync } from 'node:fs';
import { AppError } from '../../../common/errors/app-error.js';

export interface ProductionPluginRunnerConfig {
  executablePath: string;
  workingDirectory: string;
  args: readonly string[];
  executorModulePath: string;
  runnerVersion: string;
  sdkVersion: string;
}

const forbiddenArguments = new Set([
  '-r', '--require', '--loader', '--import', '-e', '--eval', '--inspect', '--inspect-brk', '--inspect-port',
]);

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
