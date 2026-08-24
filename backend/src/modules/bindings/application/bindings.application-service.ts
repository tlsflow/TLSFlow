import { AppError } from '../../../common/errors/app-error.js';
import type { PageQuery } from '../../../common/pagination/pagination.js';
import type { AssetsRepository } from '../../assets/repository/assets.repository.js';
import { BindingsDomainService } from '../domain/bindings.domain-service.js';
import type { CreateCertificateBindingDto, DetectBindingDriftDto, PatchCertificateBindingStatusDto } from '../dto/bindings.dto.js';
import { InMemoryBindingsRepository, type BindingsRepository } from '../repository/bindings.repository.js';

export class BindingsApplicationService {
  constructor(
    assetsRepository: AssetsRepository,
    private readonly repository: BindingsRepository = new InMemoryBindingsRepository(assetsRepository),
    private readonly domain = new BindingsDomainService(),
  ) {}

  createCertificateBinding(tenantId: string, input: CreateCertificateBindingDto) {
    return this.repository.createCertificateBinding(tenantId, this.domain.normalizeCreate(input));
  }

  listCertificateBindings(tenantId: string, query: PageQuery) {
    return this.repository.listCertificateBindings(tenantId, query);
  }

  getRepository(): BindingsRepository {
    return this.repository;
  }

  findCertificateBindingUsages(tenantId: string, query: { certificateVersionId?: string; fingerprint?: string }) {
    if (!query.certificateVersionId && !query.fingerprint) {
      throw new AppError('VALIDATION_FAILED', 'certificateVersionId 或 fingerprint 至少提供一个', { fields: ['certificateVersionId', 'fingerprint'] });
    }
    return this.repository.findCertificateBindingUsages(tenantId, query);
  }

  detectDrift(input: DetectBindingDriftDto) {
    return this.domain.detectDrift(input);
  }

  patchCertificateBindingStatus(tenantId: string, input: PatchCertificateBindingStatusDto) {
    const current = this.repository.getCertificateBinding(tenantId, input.bindingId);
    if (!current) {
      throw new AppError('RESOURCE_NOT_FOUND', 'CertificateBinding 不存在', { bindingId: input.bindingId });
    }
    this.domain.assertStatusTransition(current.status, input.status);
    return this.repository.updateCertificateBindingStatus(tenantId, input.bindingId, input.status);
  }
}
