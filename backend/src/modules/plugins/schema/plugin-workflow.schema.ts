import { AppError } from '../../../common/errors/app-error.js';
import type { UnifiedPluginCapabilityDescriptor } from '../dto/unified-plugins.dto.js';

export interface PluginWorkflowMetadataV1 {
  name: string;
  version: string;
  pluginId: string;
  capability: string;
  readOnly: boolean;
}

export interface PluginWorkflowInputContractV1 {
  required: string[];
}

export interface PluginWorkflowExecutionBindingV1 {
  capability: string;
  runner: 'gcac.plugin-runner/v1';
  writeEffect?: boolean;
}

export interface PluginWorkflowStepV1 {
  type: 'plugin.execute';
  capability: string;
  writeEffect?: boolean;
}

export interface PluginWorkflowV1 {
  apiVersion: 'gcac.workflow/v1';
  kind: 'PluginWorkflow';
  metadata: PluginWorkflowMetadataV1;
  inputContract: PluginWorkflowInputContractV1;
  executionBinding: PluginWorkflowExecutionBindingV1;
  steps: PluginWorkflowStepV1[];
}

/**
 * 已带固定 Runner 入口的内置插件包可以携带自己的结构化工作流载荷。
 * 该载荷只做边界校验并原样保存，不会被投影为宿主 Curl/SSH DSL。
 */
export interface PluginWorkflowRunnerResourceV1 {
  apiVersion: 'gcac.workflow/v1';
  kind: 'CurlSshWorkflow';
  metadata: { name: string; version: string; [key: string]: unknown };
  inputContract: Record<string, unknown>;
  steps: Array<Record<string, unknown> & { name: string; type: string }>;
  rollback?: Array<Record<string, unknown> & { name: string; type: string }>;
}

export type PluginWorkflowResourceV1 = PluginWorkflowV1 | PluginWorkflowRunnerResourceV1;

export interface PluginWorkflowValidationContext {
  pluginId: string;
  capability: UnifiedPluginCapabilityDescriptor;
}

const rootKeys = new Set(['apiVersion', 'kind', 'metadata', 'inputContract', 'executionBinding', 'steps']);
const metadataKeys = new Set(['name', 'version', 'pluginId', 'capability', 'readOnly']);
const inputContractKeys = new Set(['required']);
const executionBindingKeys = new Set(['capability', 'runner', 'writeEffect']);
const stepKeys = new Set(['type', 'capability', 'writeEffect']);
const semanticVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export class PluginWorkflowSchemaRegistry {
  validate(input: unknown, context: PluginWorkflowValidationContext): PluginWorkflowV1 {
    const root = record(input, 'root');
    assertKnownKeys(root, rootKeys, 'root');
    if (root.apiVersion !== 'gcac.workflow/v1') fail('apiVersion', '只支持 gcac.workflow/v1');
    if (root.kind !== 'PluginWorkflow') fail('kind', '只支持 PluginWorkflow');

    const metadata = validateMetadata(root.metadata, context);
    const inputContract = validateInputContract(root.inputContract);
    const executionBinding = validateExecutionBinding(root.executionBinding, context);
    const steps = validateSteps(root.steps, context);
    const writeEffect = context.capability.riskLevel === 'HIGH';
    if (metadata.readOnly === writeEffect) {
      fail('metadata.readOnly', 'readOnly 必须与能力风险和 writeEffect 一致', { expected: !writeEffect });
    }
    if (executionBinding.writeEffect !== undefined && executionBinding.writeEffect !== writeEffect) {
      fail('executionBinding.writeEffect', 'writeEffect 与能力风险不一致', { expected: writeEffect });
    }
    if (writeEffect && executionBinding.writeEffect !== true) {
      fail('executionBinding.writeEffect', 'HIGH 风险能力必须显式声明 writeEffect=true');
    }

    return {
      apiVersion: 'gcac.workflow/v1',
      kind: 'PluginWorkflow',
      metadata,
      inputContract,
      executionBinding,
      steps,
    };
  }

  validateRunnerResource(input: unknown, context: PluginWorkflowValidationContext): PluginWorkflowRunnerResourceV1 {
    const root = record(input, 'root');
    const runnerRootKeys = new Set(['apiVersion', 'kind', 'metadata', 'inputContract', 'steps', 'rollback']);
    assertKnownKeys(root, runnerRootKeys, 'root');
    if (root.apiVersion !== 'gcac.workflow/v1') fail('apiVersion', '只支持 gcac.workflow/v1');
    if (root.kind !== 'CurlSshWorkflow') fail('kind', 'Runner 资源必须保持包内声明的 CurlSshWorkflow 载荷');
    const metadata = record(root.metadata, 'metadata');
    const name = nonEmptyString(metadata.name, 'metadata.name');
    const version = nonEmptyString(metadata.version, 'metadata.version');
    if (!semanticVersionPattern.test(version)) fail('metadata.version', '必须是 SemVer 语义版本');
    const inputContract = record(root.inputContract, 'inputContract');
    const steps = runnerSteps(root.steps, 'steps');
    const rollback = root.rollback === undefined ? undefined : runnerSteps(root.rollback, 'rollback');
    scanRunnerSecrets(root, []);
    return {
      apiVersion: 'gcac.workflow/v1',
      kind: 'CurlSshWorkflow',
      metadata: structuredClone(metadata) as PluginWorkflowRunnerResourceV1['metadata'],
      inputContract: structuredClone(inputContract),
      steps,
      ...(rollback ? { rollback } : {}),
    };
  }
}

export const pluginWorkflowSchemaRegistry = new PluginWorkflowSchemaRegistry();

export function isPluginWorkflowResource(input: unknown): input is { kind: 'PluginWorkflow' } {
  return isRecord(input) && input.kind === 'PluginWorkflow';
}

export function isPluginWorkflowRunnerResource(input: unknown): input is PluginWorkflowRunnerResourceV1 {
  return isRecord(input) && input.apiVersion === 'gcac.workflow/v1' && input.kind === 'CurlSshWorkflow';
}

/**
 * WorkflowTemplateVersion 的持久化记录使用该字段把 Runner 载荷和宿主 DSL 分开。
 * 不能只看 content.kind，因为 Runner 为保持包内摘要可能仍使用 CurlSshWorkflow kind。
 */
export function isPluginRunnerWorkflowVersion(input: unknown): boolean {
  return isRecord(input) && input.executionMode === 'PLUGIN_RUNNER';
}

function validateMetadata(input: unknown, context: PluginWorkflowValidationContext): PluginWorkflowMetadataV1 {
  const metadata = record(input, 'metadata');
  assertKnownKeys(metadata, metadataKeys, 'metadata');
  const name = nonEmptyString(metadata.name, 'metadata.name');
  const version = nonEmptyString(metadata.version, 'metadata.version');
  if (!semanticVersionPattern.test(version)) fail('metadata.version', '必须是 SemVer 语义版本');
  const pluginId = nonEmptyString(metadata.pluginId, 'metadata.pluginId');
  if (pluginId !== context.pluginId) fail('metadata.pluginId', '必须与 Manifest Plugin ID 一致', { expected: context.pluginId, actual: pluginId });
  const capability = nonEmptyString(metadata.capability, 'metadata.capability');
  if (capability !== context.capability.key) fail('metadata.capability', '必须与 Manifest 能力一致', { expected: context.capability.key, actual: capability });
  if (typeof metadata.readOnly !== 'boolean') fail('metadata.readOnly', '必须是布尔值');
  return { name, version, pluginId, capability, readOnly: metadata.readOnly };
}

function validateInputContract(input: unknown): PluginWorkflowInputContractV1 {
  const contract = record(input, 'inputContract');
  assertKnownKeys(contract, inputContractKeys, 'inputContract');
  const required = stringArray(contract.required, 'inputContract.required');
  if (new Set(required).size !== required.length) fail('inputContract.required', '不得包含重复字段');
  return { required };
}

function validateExecutionBinding(input: unknown, context: PluginWorkflowValidationContext): PluginWorkflowExecutionBindingV1 {
  const binding = record(input, 'executionBinding');
  assertKnownKeys(binding, executionBindingKeys, 'executionBinding');
  const capability = nonEmptyString(binding.capability, 'executionBinding.capability');
  if (capability !== context.capability.key) fail('executionBinding.capability', '必须与 Manifest 能力一致', { expected: context.capability.key, actual: capability });
  if (binding.runner !== 'gcac.plugin-runner/v1') fail('executionBinding.runner', '只支持 gcac.plugin-runner/v1');
  if (binding.writeEffect !== undefined && typeof binding.writeEffect !== 'boolean') fail('executionBinding.writeEffect', '必须是布尔值');
  return {
    capability,
    runner: 'gcac.plugin-runner/v1',
    ...(binding.writeEffect === undefined ? {} : { writeEffect: binding.writeEffect }),
  };
}

function validateSteps(input: unknown, context: PluginWorkflowValidationContext): PluginWorkflowStepV1[] {
  if (!Array.isArray(input) || input.length === 0) fail('steps', '至少声明一个 plugin.execute 步骤');
  const writeEffect = context.capability.riskLevel === 'HIGH';
  return input.map((item, index) => {
    const path = `steps.${index}`;
    const step = record(item, path);
    assertKnownKeys(step, stepKeys, path);
    if (step.type !== 'plugin.execute') fail(`${path}.type`, '只支持 plugin.execute');
    const capability = nonEmptyString(step.capability, `${path}.capability`);
    if (capability !== context.capability.key) fail(`${path}.capability`, '必须与 Manifest 能力一致', { expected: context.capability.key, actual: capability });
    if (step.writeEffect !== undefined && typeof step.writeEffect !== 'boolean') fail(`${path}.writeEffect`, '必须是布尔值');
    if (step.writeEffect !== undefined && step.writeEffect !== writeEffect) {
      fail(`${path}.writeEffect`, 'writeEffect 与能力风险不一致', { expected: writeEffect });
    }
    return {
      type: 'plugin.execute',
      capability,
      ...(step.writeEffect === undefined ? {} : { writeEffect: step.writeEffect }),
    };
  });
}

function runnerSteps(input: unknown, path: string): PluginWorkflowRunnerResourceV1['steps'] {
  if (!Array.isArray(input) || input.length === 0) fail(path, '至少声明一个 Runner 步骤');
  return input.map((item, index) => {
    const stepPath = `${path}.${index}`;
    const step = record(item, stepPath);
    const name = nonEmptyString(step.name, `${stepPath}.name`);
    const type = nonEmptyString(step.type, `${stepPath}.type`);
    if (!['http', 'ssh', 'sftp', 'scp', 'browser', 'condition', 'transform', 'foreach', 'checkpoint', 'checkpoint_verify', 'wait', 'manual'].includes(type)) {
      fail(`${stepPath}.type`, 'Runner 资源包含不允许的步骤类型', { type });
    }
    if (step.stage !== undefined && typeof step.stage !== 'string') fail(`${stepPath}.stage`, '必须是字符串');
    rejectUnsafeRunnerKeys(step, stepPath);
    return { ...structuredClone(step), name, type };
  });
}

function rejectUnsafeRunnerKeys(input: unknown, path: string): void {
  if (Array.isArray(input)) {
    input.forEach((item, index) => rejectUnsafeRunnerKeys(item, `${path}.${index}`));
    return;
  }
  if (!isRecord(input)) return;
  for (const [key, value] of Object.entries(input)) {
    if (['shell', 'cmd', 'powershell', 'script', 'command.execute', 'downloadAndExecute', 'plugin.invoke'].includes(key)) {
      fail(`${path}.${key}`, 'Runner 资源不得声明任意命令或脚本入口');
    }
    rejectUnsafeRunnerKeys(value, `${path}.${key}`);
  }
}

function scanRunnerSecrets(input: unknown, path: string[]): void {
  if (Array.isArray(input)) {
    input.forEach((item, index) => scanRunnerSecrets(item, [...path, String(index)]));
    return;
  }
  if (!isRecord(input)) return;
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string' && /(password|token|privateKey|secret|authorization)/i.test(key)
      && !/^\s*\{\{[^}]+\}\}\s*$/.test(value)
      && !value.startsWith('secret://')) {
      fail([...path, key].join('.'), 'Runner 资源不得保存明文 Secret');
    }
    scanRunnerSecrets(value, [...path, key]);
  }
}

function assertKnownKeys(value: Record<string, unknown>, allowed: Set<string>, path: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) fail(path, '包含未知字段', { unknown });
}

function stringArray(input: unknown, path: string): string[] {
  if (!Array.isArray(input)) fail(path, '必须是字符串数组');
  return input.map((item, index) => nonEmptyString(item, `${path}.${index}`));
}

function nonEmptyString(input: unknown, path: string): string {
  if (typeof input !== 'string' || input.trim() === '') fail(path, '必须是非空字符串');
  return input;
}

function record(input: unknown, path: string): Record<string, unknown> {
  if (!isRecord(input)) fail(path, '必须是对象');
  return input;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input);
}

function fail(path: string, message: string, details: Record<string, unknown> = {}): never {
  throw new AppError('VALIDATION_FAILED', `PluginWorkflow 无效：${message}`, { path, ...details });
}
