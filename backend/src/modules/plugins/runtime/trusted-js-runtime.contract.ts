import { AppError } from '../../../common/errors/app-error.js';

/** Trusted JS 只能提交固定身份、制品摘要和能力的 Runner 请求。 */
export interface TrustedJsRunnerRequest {
  pluginVersionId: string;
  pluginId: string;
  pluginVersion: string;
  tenantId: string;
  packageHash: string;
  manifestHash: string;
  resourceHash: string;
  capability: string;
  executionId: string;
  executionStepId: string;
  input: Record<string, unknown>;
  grantRefs: readonly string[];
}

export function validateTrustedJsRunnerRequest(value: unknown): TrustedJsRunnerRequest {
  const record = requireRecord(value, 'runnerRequest');
  const grantRefs = requireGrantRefs(record.grantRefs);
  return {
    pluginVersionId: requireIdentifier(record.pluginVersionId, 'runnerRequest.pluginVersionId'),
    pluginId: requireIdentifier(record.pluginId, 'runnerRequest.pluginId'),
    pluginVersion: requireIdentifier(record.pluginVersion, 'runnerRequest.pluginVersion'),
    tenantId: requireIdentifier(record.tenantId, 'runnerRequest.tenantId'),
    packageHash: requireHash(record.packageHash, 'runnerRequest.packageHash'),
    manifestHash: requireHash(record.manifestHash, 'runnerRequest.manifestHash'),
    resourceHash: requireHash(record.resourceHash, 'runnerRequest.resourceHash'),
    capability: requireIdentifier(record.capability, 'runnerRequest.capability'),
    executionId: requireIdentifier(record.executionId, 'runnerRequest.executionId'),
    executionStepId: requireIdentifier(record.executionStepId, 'runnerRequest.executionStepId'),
    input: requireRecord(record.input, 'runnerRequest.input'),
    grantRefs,
  };
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(path, '必须是对象');
  return value as Record<string, unknown>;
}

function requireIdentifier(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(value)) throw invalid(path, '必须是有效的非空标识');
  return value;
}

function requireHash(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) throw invalid(path, '必须是 sha256 摘要');
  return value;
}

function requireGrantRefs(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100 || value.some((ref) => typeof ref !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/.test(ref))) {
    throw invalid('runnerRequest.grantRefs', '必须是有效的 Grant 引用数组');
  }
  if (new Set(value).size !== value.length) throw invalid('runnerRequest.grantRefs', '不得包含重复引用');
  return [...value];
}

function invalid(path: string, message: string): AppError {
  return new AppError('PLUGIN_CONTRACT_INVALID', `${path}${message}`);
}
