import { AppError } from '../../../common/errors/app-error.js';
import type { PageQuery } from '../../../common/pagination/pagination.js';
import type { PageResult, AssetsRepository } from '../../assets/repository/assets.repository.js';
import { newId } from '../../../shared/id.js';
import type {
  CertificateBindingDto,
  CertificateBindingUsageDto,
  CreateCertificateBindingDto,
} from '../dto/bindings.dto.js';

export interface BindingsRepository {
  readonly moduleName: 'bindings';
  createCertificateBinding(tenantId: string, input: CreateCertificateBindingDto): CertificateBindingDto;
  listCertificateBindings(tenantId: string, query: PageQuery): PageResult<CertificateBindingDto>;
  findCertificateBindingUsages(tenantId: string, query: { certificateVersionId?: string; fingerprint?: string }): CertificateBindingUsageDto[];
  getCertificateBinding(tenantId: string, bindingId: string): CertificateBindingDto | undefined;
  updateCertificateBindingStatus(tenantId: string, bindingId: string, status: CertificateBindingDto['status']): CertificateBindingDto;
}

export class InMemoryBindingsRepository implements BindingsRepository {
  readonly moduleName = 'bindings' as const;
  private readonly certificateBindings = new Map<string, CertificateBindingDto>();

  constructor(private readonly assets: AssetsRepository) {}

  createCertificateBinding(tenantId: string, input: CreateCertificateBindingDto): CertificateBindingDto {
    const serviceInstance = this.assets.getServiceInstance(tenantId, input.serviceInstanceId);
    if (!serviceInstance) {
      throw new AppError('RESOURCE_NOT_FOUND', 'ServiceInstance 不存在', { serviceInstanceId: input.serviceInstanceId });
    }
    if (input.serviceEndpointId) {
      const endpoint = this.assets.getServiceEndpoint(tenantId, input.serviceEndpointId);
      if (!endpoint) {
        throw new AppError('RESOURCE_NOT_FOUND', 'ServiceEndpoint 不存在', { serviceEndpointId: input.serviceEndpointId });
      }
      if (endpoint.serviceInstanceId !== input.serviceInstanceId) {
        throw new AppError('VALIDATION_FAILED', 'ServiceEndpoint 必须属于同一个 ServiceInstance', {
          serviceEndpointId: input.serviceEndpointId,
          serviceInstanceId: input.serviceInstanceId,
        });
      }
    }
    this.assertNoDuplicate(tenantId, input);

    const now = new Date().toISOString();
    const binding: CertificateBindingDto = {
      id: newId('bnd'),
      tenantId,
      serviceInstanceId: input.serviceInstanceId,
      serviceEndpointId: input.serviceEndpointId,
      hostId: serviceInstance.hostId,
      domainName: input.domainName,
      bindingType: input.bindingType,
      certificateVersionId: input.certificateVersionId,
      observedFingerprintSha256: input.observedFingerprintSha256,
      desiredFingerprintSha256: input.desiredFingerprintSha256,
      certPath: input.certPath,
      keyPath: input.keyPath,
      chainPath: input.chainPath,
      keystorePath: input.keystorePath,
      keystoreType: input.keystoreType,
      storeLocation: input.storeLocation,
      storeName: input.storeName,
      storeThumbprint: input.storeThumbprint,
      reloadCommand: input.reloadCommand,
      verifyMethod: input.verifyMethod,
      lastVerifiedAt: input.lastVerifiedAt,
      lastDeployedAt: input.lastDeployedAt,
      status: input.status ?? 'DISCOVERED',
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    this.certificateBindings.set(binding.id, binding);
    return binding;
  }

  listCertificateBindings(tenantId: string, query: PageQuery): PageResult<CertificateBindingDto> {
    return page([...this.certificateBindings.values()].filter((binding) => binding.tenantId === tenantId && binding.deletedAt === undefined), query, bindingFilter);
  }

  findCertificateBindingUsages(tenantId: string, query: { certificateVersionId?: string; fingerprint?: string }): CertificateBindingUsageDto[] {
    const fingerprint = query.fingerprint?.toLowerCase();
    return [...this.certificateBindings.values()]
      .filter((binding) => {
        if (binding.tenantId !== tenantId || binding.deletedAt !== undefined) return false;
        if (query.certificateVersionId && binding.certificateVersionId === query.certificateVersionId) return true;
        return fingerprint !== undefined && (binding.observedFingerprintSha256 === fingerprint || binding.desiredFingerprintSha256 === fingerprint);
      })
      .map((binding) => {
        const service = this.assets.getServiceInstanceIncludingDeleted(tenantId, binding.serviceInstanceId);
        const host = this.assets.getHostIncludingDeleted(tenantId, binding.hostId);
        return {
          binding,
          service: service === undefined
            ? undefined
            : {
                id: service.id,
                displayName: service.displayName,
                providerType: service.providerType,
                status: service.status,
                deletedAt: service.deletedAt,
              },
          host: host === undefined
            ? undefined
            : {
                id: host.id,
                hostname: host.hostname,
                primaryIp: host.primaryIp,
                status: host.status,
                deletedAt: host.deletedAt,
              },
        };
      });
  }

  getCertificateBinding(tenantId: string, bindingId: string): CertificateBindingDto | undefined {
    const binding = this.certificateBindings.get(bindingId);
    return binding?.tenantId === tenantId && binding.deletedAt === undefined ? binding : undefined;
  }

  updateCertificateBindingStatus(tenantId: string, bindingId: string, status: CertificateBindingDto['status']): CertificateBindingDto {
    const current = this.getCertificateBinding(tenantId, bindingId);
    if (!current) {
      throw new AppError('RESOURCE_NOT_FOUND', 'CertificateBinding 不存在', { bindingId });
    }
    const updated: CertificateBindingDto = {
      ...current,
      status,
      updatedAt: new Date().toISOString(),
      version: current.version + 1,
    };
    this.certificateBindings.set(updated.id, updated);
    return updated;
  }

  private assertNoDuplicate(tenantId: string, input: CreateCertificateBindingDto): void {
    const duplicate = [...this.certificateBindings.values()].find((binding) => {
      if (binding.tenantId !== tenantId || binding.deletedAt !== undefined) return false;
      if (binding.serviceInstanceId !== input.serviceInstanceId) return false;
      if ((binding.domainName ?? '') !== (input.domainName ?? '')) return false;
      if (binding.bindingType !== input.bindingType) return false;
      if (binding.bindingType === 'FILE_PATH') return binding.certPath === input.certPath;
      if (binding.bindingType === 'KEYSTORE') return binding.keystorePath === input.keystorePath;
      if (binding.bindingType === 'WINDOWS_CERT_STORE') {
        return binding.storeLocation === input.storeLocation && binding.storeName === input.storeName && (binding.storeThumbprint ?? '') === (input.storeThumbprint ?? '');
      }
      return (binding.serviceEndpointId ?? '') === (input.serviceEndpointId ?? '');
    });
    if (duplicate) {
      throw new AppError('RESOURCE_ALREADY_EXISTS', 'CertificateBinding 已存在', { existingId: duplicate.id });
    }
  }
}

function page<T extends object>(items: T[], query: PageQuery, filterFn: (item: T, field: string, expected: string) => boolean): PageResult<T> {
  let filtered = items;
  for (const [field, expected] of Object.entries(query.filter)) {
    filtered = filtered.filter((item) => filterFn(item, field, expected));
  }
  if (query.sort) {
    const { field, direction } = query.sort;
    filtered = [...filtered].sort((left, right) => compareValues(readField(left, field), readField(right, field), direction));
  }
  const start = (query.page - 1) * query.pageSize;
  return {
    items: filtered.slice(start, start + query.pageSize),
    page: query.page,
    pageSize: query.pageSize,
    total: filtered.length,
  };
}

function bindingFilter(binding: CertificateBindingDto, field: string, expected: string): boolean {
  return String(readField(binding, field) ?? '').toLowerCase().includes(expected.toLowerCase());
}

function readField(item: object, field: string): unknown {
  return (item as Record<string, unknown>)[field];
}

function compareValues(left: unknown, right: unknown, direction: 'asc' | 'desc'): number {
  const normalizedLeft = left === undefined || left === null ? '' : String(left);
  const normalizedRight = right === undefined || right === null ? '' : String(right);
  const result = normalizedLeft.localeCompare(normalizedRight);
  return direction === 'asc' ? result : -result;
}
