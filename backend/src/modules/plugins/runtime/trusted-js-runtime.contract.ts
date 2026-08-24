import { AppError } from '../../../common/errors/app-error.js';
import { DeviceDiscoverySchemaService } from '../discovery/device-discovery-schema.service.js';
import type { StandardDeviceDiscoveryV2 } from '../discovery/device-discovery.dto.js';
import type { ProviderOperationResult } from '../../providers/dto/providers.dto.js';
import type { CloudAccountAsset } from '../../providers/dto/providers.dto.js';

export interface TrustedJsCertificateMaterial {
  certificatePem: string;
  privateKeyPem: string;
  certificateChainPem?: string;
  serialNumber?: string;
  sha256Fingerprint?: string;
  notBefore?: string;
  notAfter?: string;
}

export interface TrustedJsHttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  url: string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean>;
  body?: string;
  timeoutMs?: number;
}

export interface TrustedJsHttpResponse {
  status: number;
  headers: Record<string, string>;
  body?: string;
}

export interface TrustedJsAuditEvent {
  action: string;
  status: 'SUCCESS' | 'FAILED' | 'MANUAL_REQUIRED';
  summary?: Record<string, unknown>;
}

export interface TrustedJsCheckpointInput {
  checkpointName: string;
  payload: Record<string, unknown>;
}

export interface TrustedJsCheckpointRef {
  ref: string;
}

export interface TrustedJsLockRef {
  ref: string;
  resourceKey: string;
}

export interface TrustedJsAsyncWaitInput {
  providerKey: string;
  operationName: string;
  requestId?: string;
  timeoutMs: number;
  intervalMs?: number;
  metadata?: Record<string, unknown>;
}

export interface TrustedJsAsyncWaitResult {
  status: 'SUCCESS' | 'FAILED' | 'TIMEOUT';
  summary?: Record<string, unknown>;
}

export interface TrustedPluginHostApi {
  cloudAccount: {
    get(assetId: string): Promise<CloudAccountAsset>;
  };
  credential: {
    resolveCloudCredential(assetId: string): Promise<Record<string, string>>;
  };
  artifact: {
    readCertificateMaterial(ref: string): Promise<TrustedJsCertificateMaterial>;
  };
  http: {
    request(input: TrustedJsHttpRequest): Promise<TrustedJsHttpResponse>;
  };
  audit: {
    record(event: TrustedJsAuditEvent): Promise<void>;
  };
  checkpoint: {
    save(input: TrustedJsCheckpointInput): Promise<TrustedJsCheckpointRef>;
    load(ref: string): Promise<Record<string, unknown>>;
  };
  lock: {
    acquire(resourceKey: string): Promise<TrustedJsLockRef>;
    release(lockRef: TrustedJsLockRef): Promise<void>;
  };
  asyncOperation: {
    wait(input: TrustedJsAsyncWaitInput): Promise<TrustedJsAsyncWaitResult>;
  };
}

export interface TrustedJsPluginContext {
  tenantId: string;
  pluginId: string;
  pluginVersionId: string;
  capabilityKey: string;
  assetId?: string;
  managedTargetId?: string;
  requestId?: string;
  dryRun?: boolean;
}

export interface TrustedJsConnectionResult {
  ok: boolean;
  warnings?: string[];
  details?: Record<string, unknown>;
}

export interface TrustedJsProviderPlugin {
  testConnection?(context: TrustedJsPluginContext): Promise<TrustedJsConnectionResult>;
  discover?(context: TrustedJsPluginContext, input: Record<string, unknown>): Promise<StandardDeviceDiscoveryV2>;
  deployCertificate?(context: TrustedJsPluginContext, input: Record<string, unknown>): Promise<ProviderOperationResult>;
  rollbackCertificate?(context: TrustedJsPluginContext, input: Record<string, unknown>): Promise<ProviderOperationResult>;
}

export interface TrustedJsPluginFactoryContext {
  hostApi: TrustedPluginHostApi;
  plugin: Pick<TrustedJsPluginContext, 'pluginId' | 'pluginVersionId' | 'capabilityKey'> & {
    providerKey?: string;
    supportedProducts?: string[];
    supportedOperations?: string[];
  };
}

export type TrustedJsProviderPluginFactory =
  (context: TrustedJsPluginFactoryContext) => TrustedJsProviderPlugin | Promise<TrustedJsProviderPlugin>;

export const trustedJsHostApiPermissionRequirements = {
  'cloudAccount.get': [],
  'credential.resolveCloudCredential': ['secret.read'],
  'artifact.readCertificateMaterial': ['artifact.read'],
  'http.request': ['network.connect'],
  'audit.record': [],
  'checkpoint.save': [],
  'checkpoint.load': [],
  'lock.acquire': [],
  'lock.release': [],
  'asyncOperation.wait': [],
} as const;

const operationStatuses = new Set<ProviderOperationResult['status']>(['SUCCESS', 'FAILED', 'TIMEOUT', 'MANUAL_REQUIRED']);

export function assertTrustedJsHostApiAccess(
  capability: keyof typeof trustedJsHostApiPermissionRequirements,
  grantedPermissions: string[],
): void {
  const granted = new Set(grantedPermissions);
  const required = trustedJsHostApiPermissionRequirements[capability];
  const missing = required.filter((permission) => !granted.has(permission));
  if (missing.length > 0) {
    throw new AppError('PLUGIN_PERMISSION_DENIED', 'TRUSTED_JS Host API 权限未授权', {
      capability,
      missing,
    });
  }
}

export function validateTrustedJsConnectionResult(value: unknown): TrustedJsConnectionResult {
  const record = requireRecord(value, 'connectionResult');
  if (typeof record.ok !== 'boolean') throw invalid('connectionResult.ok', '必须是布尔值');
  const warnings = record.warnings === undefined ? undefined : requireStringArray(record.warnings, 'connectionResult.warnings');
  const details = record.details === undefined ? undefined : requireRecord(record.details, 'connectionResult.details');
  return {
    ok: record.ok,
    ...(warnings ? { warnings } : {}),
    ...(details ? { details } : {}),
  };
}

export function validateTrustedJsDiscoveryPayload(value: unknown): StandardDeviceDiscoveryV2 {
  return new DeviceDiscoverySchemaService().validate(value);
}

export function validateTrustedJsOperationResult(value: unknown): ProviderOperationResult {
  const record = requireRecord(value, 'operationResult');
  const status = requireString(record.status, 'operationResult.status');
  if (!operationStatuses.has(status as ProviderOperationResult['status'])) {
    throw invalid('operationResult.status', '状态不受支持');
  }
  if (record.resultSummary !== undefined) requireRecord(record.resultSummary, 'operationResult.resultSummary');
  if (record.resourceRef !== undefined) requireStringMap(record.resourceRef, 'operationResult.resourceRef');
  if (record.asyncOperation !== undefined) {
    const asyncOperation = requireRecord(record.asyncOperation, 'operationResult.asyncOperation');
    requireString(asyncOperation.taskId, 'operationResult.asyncOperation.taskId');
    requireString(asyncOperation.status, 'operationResult.asyncOperation.status');
  }
  return {
    operationId: requireString(record.operationId, 'operationResult.operationId'),
    providerKey: requireString(record.providerKey, 'operationResult.providerKey'),
    operationKey: requireString(record.operationKey, 'operationResult.operationKey'),
    status: status as ProviderOperationResult['status'],
    ...(record.resourceRef ? { resourceRef: requireStringMap(record.resourceRef, 'operationResult.resourceRef') } : {}),
    ...(record.asyncOperation ? {
      asyncOperation: {
        taskId: requireString((record.asyncOperation as Record<string, unknown>).taskId, 'operationResult.asyncOperation.taskId'),
        status: requireString((record.asyncOperation as Record<string, unknown>).status, 'operationResult.asyncOperation.status'),
      },
    } : {}),
    ...(record.resultSummary ? { resultSummary: requireRecord(record.resultSummary, 'operationResult.resultSummary') } : {}),
  };
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(path, '必须是对象');
  return value as Record<string, unknown>;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw invalid(path, '必须是非空字符串');
  return value;
}

function requireStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw invalid(path, '必须是字符串数组');
  return value.map((item, index) => requireString(item, `${path}.${index}`));
}

function requireStringMap(value: unknown, path: string): Record<string, string> {
  const record = requireRecord(value, path);
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, requireString(item, `${path}.${key}`)]));
}

function invalid(path: string, message: string): AppError {
  return new AppError('VALIDATION_FAILED', `TRUSTED_JS 合同无效：${message}`, { path });
}
