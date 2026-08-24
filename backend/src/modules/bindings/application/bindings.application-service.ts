import { AppError } from '../../../common/errors/app-error.js';
import type { PageQuery } from '../../../common/pagination/pagination.js';
import type { AssetsApplicationService } from '../../assets/application/assets.application-service.js';
import type { AssetsRepository } from '../../assets/repository/assets.repository.js';
import type { BindingDriftPersistenceDto } from '../../assets/dto/assets.dto.js';
import { BindingsDomainService } from '../domain/bindings.domain-service.js';
import type { CreateCertificateBindingDto, DeleteCertificateBindingDto, DetectBindingDriftDto, PatchCertificateBindingStatusDto, UpdateCertificateBindingDto } from '../dto/bindings.dto.js';
import { PgBindingsRepository, type BindingsRepository } from '../repository/bindings.repository.js';

export class BindingsApplicationService {
  constructor(
    assetsRepository: AssetsRepository,
    private readonly repository: BindingsRepository = new PgBindingsRepository(assetsRepository),
    private readonly domain = new BindingsDomainService(),
    private readonly assetsService?: AssetsApplicationService,
  ) {}

  async createCertificateBinding(tenantId: string, input: CreateCertificateBindingDto) {
    return this.repository.createCertificateBinding(tenantId, this.domain.normalizeCreate(input));
  }

  async listCertificateBindings(tenantId: string, query: PageQuery) {
    return this.repository.listCertificateBindings(tenantId, query);
  }

  async updateCertificateBinding(tenantId: string, bindingId: string, input: UpdateCertificateBindingDto) {
    return this.repository.updateCertificateBinding(tenantId, bindingId, this.domain.normalizePatch(input));
  }

  async deleteCertificateBinding(tenantId: string, input: DeleteCertificateBindingDto) {
    return this.repository.deleteCertificateBinding(tenantId, input.bindingId);
  }

  getRepository(): BindingsRepository {
    return this.repository;
  }

  async findCertificateBindingUsages(tenantId: string, query: { certificateVersionId?: string; fingerprint?: string; domains?: string[] }) {
    if (!query.certificateVersionId && !query.fingerprint && !(query.domains && query.domains.length > 0)) {
      throw new AppError('VALIDATION_FAILED', 'certificateVersionId、fingerprint 或 domains 至少提供一个', { fields: ['certificateVersionId', 'fingerprint', 'domains'] });
    }
    return this.repository.findCertificateBindingUsages(tenantId, query);
  }

  detectDrift(input: DetectBindingDriftDto) {
    return this.domain.detectDrift(input);
  }

  async persistDrift(tenantId: string, input: BindingDriftPersistenceDto) {
    if (!this.assetsService) {
      throw new AppError('SYSTEM_INTERNAL_ERROR', 'AssetsApplicationService 未注入，无法持久化 drift');
    }
    return this.assetsService.persistBindingDrift(tenantId, input);
  }

  async patchCertificateBindingStatus(tenantId: string, input: PatchCertificateBindingStatusDto) {
    const current = await this.repository.getCertificateBinding(tenantId, input.bindingId);
    if (!current) {
      throw new AppError('RESOURCE_NOT_FOUND', 'CertificateBinding 不存在', { bindingId: input.bindingId });
    }
    this.domain.assertStatusTransition(current.status, input.status);
    return this.repository.updateCertificateBindingStatus(tenantId, input.bindingId, input.status);
  }
}
