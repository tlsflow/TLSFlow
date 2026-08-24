import { AppError } from '../../../common/errors/app-error.js';
import {
  BindingTypes,
  CertificateBindingStatuses,
  type BindingType,
  type CertificateBindingStatus,
} from '../../../shared/enums/core.enums.js';
import { assertTransition } from '../../../shared/state-machine/core-state-machine.js';
import type { BindingDriftDto, BindingVerifyMethod, CreateCertificateBindingDto, DetectBindingDriftDto, KeystoreType, UpdateCertificateBindingDto } from '../dto/bindings.dto.js';

const verifyMethods = ['TLS_CONNECT', 'LOCAL_FILE', 'STORE_QUERY', 'CUSTOM'] as const;
const keystoreTypes = ['JKS', 'PKCS12'] as const;

export class BindingsDomainService {
  normalizeCreate(input: CreateCertificateBindingDto): Required<Pick<CreateCertificateBindingDto, 'serviceInstanceId' | 'bindingType' | 'bindingKey' | 'verifyMethod' | 'status' | 'metadata'>> & CreateCertificateBindingDto {
    const serviceInstanceId = normalizeRequiredString(input.serviceInstanceId, 'serviceInstanceId');
    const bindingType = readEnum(input.bindingType, BindingTypes, 'bindingType');
    const verifyMethod = readEnum(input.verifyMethod, verifyMethods, 'verifyMethod');
    const status = readEnum(input.status ?? 'DISCOVERED', CertificateBindingStatuses, 'status');
    const domain = normalizeOptionalString(input.domain ?? input.domainName)?.toLowerCase();
    const port = input.port === undefined ? undefined : normalizePort(input.port);
    const protocol = normalizeOptionalString(input.protocol)?.toUpperCase();
    const bindingKey = normalizeOptionalString(input.bindingKey) ?? defaultBindingKey({
      serviceInstanceId,
      serviceEndpointId: input.serviceEndpointId,
      domain,
      port,
      protocol,
      bindingType,
      certPath: input.certPath,
      keystorePath: input.keystorePath,
      storeLocation: input.storeLocation,
      storeName: input.storeName,
      storeThumbprint: input.storeThumbprint,
    });
    const normalized: Required<Pick<CreateCertificateBindingDto, 'serviceInstanceId' | 'bindingType' | 'bindingKey' | 'verifyMethod' | 'status' | 'metadata'>> & CreateCertificateBindingDto = {
      ...input,
      serviceInstanceId,
      serviceEndpointId: normalizeOptionalString(input.serviceEndpointId),
      domainName: domain,
      domain,
      port,
      protocol,
      bindingKey,
      bindingType,
      certificateVersionId: normalizeOptionalString(input.certificateVersionId ?? input.targetCertificateVersionId),
      targetCertificateVersionId: normalizeOptionalString(input.targetCertificateVersionId ?? input.certificateVersionId),
      localCertificateVersionId: normalizeOptionalString(input.localCertificateVersionId),
      observedFingerprintSha256: normalizeFingerprint(input.observedFingerprintSha256, 'observedFingerprintSha256'),
      desiredFingerprintSha256: normalizeFingerprint(input.desiredFingerprintSha256 ?? input.targetFingerprintSha256, 'desiredFingerprintSha256'),
      targetFingerprintSha256: normalizeFingerprint(input.targetFingerprintSha256 ?? input.desiredFingerprintSha256, 'targetFingerprintSha256'),
      unmanagedCertificateFingerprint: normalizeFingerprint(input.unmanagedCertificateFingerprint, 'unmanagedCertificateFingerprint'),
      certPath: normalizeOptionalString(input.certPath),
      keyPath: normalizeOptionalString(input.keyPath),
      chainPath: normalizeOptionalString(input.chainPath),
      keystorePath: normalizeOptionalString(input.keystorePath),
      keystoreType: input.keystoreType === undefined ? undefined : readEnum(input.keystoreType, keystoreTypes, 'keystoreType'),
      storeLocation: normalizeOptionalString(input.storeLocation),
      storeName: normalizeOptionalString(input.storeName),
      storeThumbprint: normalizeOptionalString(input.storeThumbprint),
      reloadCommand: normalizeOptionalString(input.reloadCommand),
      reloadHint: input.reloadHint,
      discoverySource: normalizeOptionalString(input.discoverySource) ?? 'MANUAL',
      verifyMethod,
      status,
      metadata: input.metadata ?? {},
    };
    this.assertLocation(normalized);
    return normalized;
  }

  normalizePatch(input: UpdateCertificateBindingDto): UpdateCertificateBindingDto {
    const normalized = this.normalizeCreate({
      serviceInstanceId: input.serviceInstanceId ?? 'placeholder_service',
      bindingType: input.bindingType ?? 'CUSTOM',
      verifyMethod: input.verifyMethod ?? 'CUSTOM',
      ...input,
    });
    const { serviceInstanceId, bindingType, verifyMethod, status, metadata, bindingKey, ...rest } = normalized;
    return {
      ...rest,
      ...(input.serviceInstanceId !== undefined ? { serviceInstanceId } : {}),
      ...(input.bindingKey !== undefined ? { bindingKey } : {}),
      ...(input.bindingType !== undefined ? { bindingType } : {}),
      ...(input.verifyMethod !== undefined ? { verifyMethod } : {}),
      ...(input.status !== undefined ? { status } : {}),
      ...(input.metadata !== undefined ? { metadata } : {}),
      localConfigFingerprint: normalizeFingerprint(input.localConfigFingerprint, 'localConfigFingerprint'),
      localConfigPath: normalizeOptionalString(input.localConfigPath),
      remoteEndpointFingerprint: normalizeFingerprint(input.remoteEndpointFingerprint, 'remoteEndpointFingerprint'),
      remoteStatus: input.remoteStatus,
      tlsVersion: normalizeOptionalString(input.tlsVersion),
      chainSummary: input.chainSummary,
      checkedAt: normalizeOptionalString(input.checkedAt),
      driftStatus: input.driftStatus,
    };
  }

  assertStatusTransition(current: CertificateBindingStatus, next: CertificateBindingStatus): void {
    assertTransition('certificateBinding', current, next);
  }

  detectDrift(input: DetectBindingDriftDto): BindingDriftDto {
    const localFingerprintSha256 = normalizeFingerprint(input.localFingerprintSha256, 'localFingerprintSha256');
    const remoteFingerprintSha256 = normalizeFingerprint(input.remoteFingerprintSha256, 'remoteFingerprintSha256');
    const desiredFingerprintSha256 = normalizeFingerprint(input.desiredFingerprintSha256, 'desiredFingerprintSha256');
    if (input.reachable === false) {
      return { state: 'unreachable', localFingerprintSha256, remoteFingerprintSha256, desiredFingerprintSha256 };
    }
    if (!desiredFingerprintSha256) {
      return { state: 'unknown', localFingerprintSha256, remoteFingerprintSha256 };
    }
    if (!localFingerprintSha256 && !remoteFingerprintSha256) {
      return { state: 'incomplete', desiredFingerprintSha256 };
    }
    const observed = remoteFingerprintSha256 ?? localFingerprintSha256;
    return {
      state: observed === desiredFingerprintSha256 ? 'synced' : 'mismatch',
      localFingerprintSha256,
      remoteFingerprintSha256,
      desiredFingerprintSha256,
    };
  }

  private assertLocation(input: CreateCertificateBindingDto & { bindingType: BindingType }): void {
    if (input.bindingType === 'FILE_PATH' && !input.certPath) {
      throw new AppError('VALIDATION_FAILED', 'FILE_PATH 绑定必须提供 certPath', { field: 'certPath' });
    }
    if (input.bindingType === 'KEYSTORE' && !input.keystorePath) {
      throw new AppError('VALIDATION_FAILED', 'KEYSTORE 绑定必须提供 keystorePath', { field: 'keystorePath' });
    }
    if (input.bindingType === 'WINDOWS_CERT_STORE' && (!input.storeLocation || !input.storeName)) {
      throw new AppError('VALIDATION_FAILED', 'WINDOWS_CERT_STORE 绑定必须提供 storeLocation 和 storeName', { fields: ['storeLocation', 'storeName'] });
    }
  }
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeRequiredString(value: string | undefined, field: string): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) throw new AppError('VALIDATION_FAILED', `${field} 不能为空`, { field });
  return normalized;
}

function normalizePort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new AppError('VALIDATION_FAILED', 'port 必须在 1 到 65535 之间', { field: 'port' });
  }
  return port;
}

function normalizeFingerprint(value: string | undefined, field: string): string | undefined {
  const normalized = normalizeOptionalString(value)?.toLowerCase();
  if (normalized !== undefined && !/^[0-9a-f]{64}$/.test(normalized)) {
    throw new AppError('VALIDATION_FAILED', `${field} 必须是 64 位小写 sha256 hex`, { field });
  }
  return normalized;
}

function readEnum<T extends string>(value: string, allowed: readonly T[], field: string): T {
  if (!allowed.includes(value as T)) {
    throw new AppError('VALIDATION_FAILED', '枚举值不合法', { field, allowedValues: allowed });
  }
  return value as T;
}

function defaultBindingKey(input: {
  serviceInstanceId: string;
  serviceEndpointId?: string;
  domain?: string;
  port?: number;
  protocol?: string;
  bindingType: BindingType;
  certPath?: string;
  keystorePath?: string;
  storeLocation?: string;
  storeName?: string;
  storeThumbprint?: string;
}): string {
  // 默认自然键必须包含绑定位置。只按 service/domain/port/protocol 拼接会把同一服务下
  // 不同 certPath 或不同证书仓库的绑定误判成重复。
  const location = bindingLocationKey(input);
  return [
    input.serviceInstanceId,
    input.serviceEndpointId ?? '_',
    input.domain ?? '_',
    input.port ?? '_',
    input.protocol ?? '_',
    input.bindingType,
    location,
  ].map((part) => String(part).trim().toLowerCase()).join(':');
}

function bindingLocationKey(input: {
  bindingType: BindingType;
  certPath?: string;
  keystorePath?: string;
  storeLocation?: string;
  storeName?: string;
  storeThumbprint?: string;
}): string {
  if (input.bindingType === 'FILE_PATH') return input.certPath ?? '_';
  if (input.bindingType === 'KEYSTORE') return input.keystorePath ?? '_';
  if (input.bindingType === 'WINDOWS_CERT_STORE') {
    return [input.storeLocation ?? '_', input.storeName ?? '_', input.storeThumbprint ?? '_'].join('|');
  }
  return '_';
}

export const bindingsEnumValues = {
  verifyMethods,
  keystoreTypes,
  bindingTypes: BindingTypes,
  certificateBindingStatuses: CertificateBindingStatuses,
} as const;

export type BindingsDomainEnums = {
  bindingType: BindingType;
  bindingStatus: CertificateBindingStatus;
  verifyMethod: BindingVerifyMethod;
  keystoreType: KeystoreType;
};
