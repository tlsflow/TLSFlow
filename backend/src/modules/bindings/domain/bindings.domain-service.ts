import { AppError } from '../../../common/errors/app-error.js';
import {
  BindingTypes,
  CertificateBindingStatuses,
  type BindingType,
  type CertificateBindingStatus,
} from '../../../shared/enums/core.enums.js';
import { assertTransition } from '../../../shared/state-machine/core-state-machine.js';
import type { BindingDriftDto, BindingVerifyMethod, CreateCertificateBindingDto, DetectBindingDriftDto, KeystoreType } from '../dto/bindings.dto.js';

const verifyMethods = ['TLS_CONNECT', 'LOCAL_FILE', 'STORE_QUERY', 'CUSTOM'] as const;
const keystoreTypes = ['JKS', 'PKCS12'] as const;

export class BindingsDomainService {
  normalizeCreate(input: CreateCertificateBindingDto): Required<Pick<CreateCertificateBindingDto, 'serviceInstanceId' | 'bindingType' | 'verifyMethod' | 'status' | 'metadata'>> & CreateCertificateBindingDto {
    const serviceInstanceId = normalizeRequiredString(input.serviceInstanceId, 'serviceInstanceId');
    const bindingType = readEnum(input.bindingType, BindingTypes, 'bindingType');
    const verifyMethod = readEnum(input.verifyMethod, verifyMethods, 'verifyMethod');
    const status = readEnum(input.status ?? 'DISCOVERED', CertificateBindingStatuses, 'status');
    const normalized: Required<Pick<CreateCertificateBindingDto, 'serviceInstanceId' | 'bindingType' | 'verifyMethod' | 'status' | 'metadata'>> & CreateCertificateBindingDto = {
      ...input,
      serviceInstanceId,
      serviceEndpointId: normalizeOptionalString(input.serviceEndpointId),
      domainName: normalizeOptionalString(input.domainName)?.toLowerCase(),
      bindingType,
      certificateVersionId: normalizeOptionalString(input.certificateVersionId),
      observedFingerprintSha256: normalizeFingerprint(input.observedFingerprintSha256, 'observedFingerprintSha256'),
      desiredFingerprintSha256: normalizeFingerprint(input.desiredFingerprintSha256, 'desiredFingerprintSha256'),
      certPath: normalizeOptionalString(input.certPath),
      keyPath: normalizeOptionalString(input.keyPath),
      chainPath: normalizeOptionalString(input.chainPath),
      keystorePath: normalizeOptionalString(input.keystorePath),
      keystoreType: input.keystoreType === undefined ? undefined : readEnum(input.keystoreType, keystoreTypes, 'keystoreType'),
      storeLocation: normalizeOptionalString(input.storeLocation),
      storeName: normalizeOptionalString(input.storeName),
      storeThumbprint: normalizeOptionalString(input.storeThumbprint),
      reloadCommand: normalizeOptionalString(input.reloadCommand),
      verifyMethod,
      status,
      metadata: input.metadata ?? {},
    };
    this.assertLocation(normalized);
    return normalized;
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
