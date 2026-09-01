import { AppError } from '../../../common/errors/app-error.js';
import { applyAuthorizationFilter, type PageQuery } from '../../../common/pagination/pagination.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import type { PageResult, AssetsRepository } from '../../assets/repository/assets.repository.js';
import { newId } from '../../../shared/id.js';
import type {
  CertificateBindingDto,
  CertificateBindingUsageDto,
  CreateCertificateBindingDto,
  UpdateCertificateBindingDto,
} from '../dto/bindings.dto.js';

export interface BindingsRepository {
  readonly moduleName: 'bindings';
  createCertificateBinding(tenantId: string, input: CreateCertificateBindingDto): Promise<CertificateBindingDto>;
  listCertificateBindings(tenantId: string, query: PageQuery): Promise<PageResult<CertificateBindingDto>>;
  findCertificateBindingUsages(tenantId: string, query: { certificateVersionId?: string; fingerprint?: string; domains?: string[] }): Promise<CertificateBindingUsageDto[]>;
  getCertificateBinding(tenantId: string, bindingId: string): Promise<CertificateBindingDto | undefined>;
  findCertificateBindingByIdentity(tenantId: string, input: CreateCertificateBindingDto): Promise<CertificateBindingDto | undefined>;
  updateCertificateBinding(tenantId: string, bindingId: string, input: UpdateCertificateBindingDto): Promise<CertificateBindingDto>;
  deleteCertificateBinding(tenantId: string, bindingId: string): Promise<CertificateBindingDto>;
  updateCertificateBindingStatus(tenantId: string, bindingId: string, status: CertificateBindingDto['status']): Promise<CertificateBindingDto>;
}

export class PgBindingsRepository implements BindingsRepository {
  readonly moduleName = 'bindings' as const;

  constructor(
    private readonly assets: AssetsRepository,
    private readonly db: DatabasePort = new PgliteDatabase(),
  ) {}

  async createCertificateBinding(tenantId: string, input: CreateCertificateBindingDto): Promise<CertificateBindingDto> {
    const serviceInstance = await this.assets.getFrameworkInstance(tenantId, input.serviceInstanceId);
    if (!serviceInstance) {
      throw new AppError('RESOURCE_NOT_FOUND', 'ServiceInstance 不存在', { serviceInstanceId: input.serviceInstanceId });
    }
    const endpoint = input.serviceEndpointId ? await this.assets.getServiceEndpoint(tenantId, input.serviceEndpointId) : undefined;
    if (input.serviceEndpointId) {
      if (!endpoint) {
        throw new AppError('RESOURCE_NOT_FOUND', 'ServiceEndpoint 不存在', { serviceEndpointId: input.serviceEndpointId });
      }
      if (endpoint.serviceInstanceId !== input.serviceInstanceId) {
        throw new AppError('VALIDATION_FAILED', 'ServiceEndpoint 必须属于同一 ServiceInstance', {
          serviceEndpointId: input.serviceEndpointId,
          serviceInstanceId: input.serviceInstanceId,
        });
      }
    }

    // 中文说明：SiteAsset/ManagedTarget 是扫描得到的运行时事实，不能因为创建绑定而自动晋升为 Application。
    // 但同地址的应用 ServiceAsset 已存在时必须继续复用，避免历史应用绑定在重新发现后丢失关联。
    const serviceAsset = input.serviceAssetId
      ? await this.assets.getServiceAsset(tenantId, input.serviceAssetId)
      : input.siteAssetId || input.managedTargetId
        ? await resolveExistingServiceAsset(this.assets, tenantId, input, serviceInstance.deviceId, endpoint)
        : await this.resolveOrCreateServiceAsset(tenantId, input, serviceInstance.deviceId, endpoint);
    if (input.serviceAssetId && !serviceAsset) {
      throw new AppError('RESOURCE_NOT_FOUND', 'ServiceAsset 不存在', { serviceAssetId: input.serviceAssetId });
    }
    if (serviceAsset?.serviceInstanceId && serviceAsset.serviceInstanceId !== input.serviceInstanceId) {
      throw new AppError('VALIDATION_FAILED', 'ServiceAsset 必须属于同一 ServiceInstance', { serviceAssetId: serviceAsset.id, serviceInstanceId: input.serviceInstanceId });
    }

    const siteAsset = input.siteAssetId ? await this.assets.getSiteAsset(tenantId, input.siteAssetId) : undefined;
    if (input.siteAssetId && !siteAsset) {
      throw new AppError('RESOURCE_NOT_FOUND', 'SiteAsset 不存在', { siteAssetId: input.siteAssetId });
    }
    const managedTarget = input.managedTargetId ? await this.assets.getManagedTarget(tenantId, input.managedTargetId) : undefined;
    if (input.managedTargetId && !managedTarget) {
      throw new AppError('RESOURCE_NOT_FOUND', 'ManagedTarget 不存在', { managedTargetId: input.managedTargetId });
    }
    this.assertBindingRelations(input, serviceInstance.deviceId, serviceAsset?.id, siteAsset, managedTarget);
    await this.assertNoDuplicate(tenantId, {
      ...input,
      serviceAssetId: serviceAsset?.id,
      siteAssetId: siteAsset?.id,
      managedTargetId: managedTarget?.id,
    });

    const now = new Date().toISOString();
    const metadata = input.metadata ?? {};
    const binding: CertificateBindingDto = {
      id: newId('bnd'),
      tenantId,
      serviceAssetId: serviceAsset?.id,
      siteAssetId: siteAsset?.id,
      managedTargetId: managedTarget?.id,
      serviceInstanceId: input.serviceInstanceId,
      serviceEndpointId: input.serviceEndpointId,
      hostId: serviceInstance.deviceId,
      domainName: input.domainName ?? input.domain,
      domain: input.domain ?? input.domainName,
      port: input.port,
      protocol: input.protocol,
      bindingKey: input.bindingKey ?? [serviceAsset?.id ?? input.serviceInstanceId, input.domainName ?? input.domain ?? serviceAsset?.address ?? '_', input.port ?? serviceAsset?.port ?? '_', input.protocol ?? serviceAsset?.protocol ?? '_'].join(':'),
      bindingType: input.bindingType,
      certificateVersionId: input.certificateVersionId ?? input.targetCertificateVersionId,
      targetCertificateVersionId: input.targetCertificateVersionId ?? input.certificateVersionId,
      localCertificateVersionId: input.localCertificateVersionId,
      observedFingerprintSha256: input.observedFingerprintSha256,
      desiredFingerprintSha256: input.desiredFingerprintSha256 ?? input.targetFingerprintSha256,
      targetFingerprintSha256: input.targetFingerprintSha256 ?? input.desiredFingerprintSha256,
      unmanagedCertificateFingerprint: input.unmanagedCertificateFingerprint,
      certPath: input.certPath,
      keyPath: input.keyPath,
      chainPath: input.chainPath,
      keystorePath: input.keystorePath,
      keystoreType: input.keystoreType,
      storeLocation: input.storeLocation,
      storeName: input.storeName,
      storeThumbprint: input.storeThumbprint,
      reloadCommand: input.reloadCommand,
      reloadHint: input.reloadHint,
      discoverySource: input.discoverySource ?? 'MANUAL',
      verifyMethod: input.verifyMethod,
      lastVerifiedAt: input.lastVerifiedAt,
      lastDeployedAt: input.lastDeployedAt,
      status: input.status ?? 'DISCOVERED',
      metadata,
      ...(typeof metadata.localConfigFingerprint === 'string' ? { localConfigFingerprint: metadata.localConfigFingerprint } : {}),
      ...(typeof metadata.localConfigPath === 'string' ? { localConfigPath: metadata.localConfigPath } : {}),
      ...(typeof metadata.remoteEndpointFingerprint === 'string' ? { remoteEndpointFingerprint: metadata.remoteEndpointFingerprint } : {}),
      ...(isRemoteStatus(metadata.remoteStatus) ? { remoteStatus: metadata.remoteStatus } : {}),
      ...(typeof metadata.tlsVersion === 'string' ? { tlsVersion: metadata.tlsVersion } : {}),
      ...(isRecord(metadata.chainSummary) ? { chainSummary: metadata.chainSummary } : {}),
      ...(typeof metadata.checkedAt === 'string' ? { checkedAt: metadata.checkedAt } : {}),
      ...(isDriftState(metadata.driftStatus) ? { driftStatus: metadata.driftStatus } : {}),
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    await this.db.query(`insert into pg_certificate_bindings (
      id, tenant_id, service_asset_id, site_asset_id, managed_target_id, service_instance_id, service_endpoint_id, host_id, domain_name, domain, port, protocol, binding_key, binding_type,
      certificate_version_id, target_certificate_version_id, local_certificate_version_id, observed_fingerprint_sha256, desired_fingerprint_sha256,
      target_fingerprint_sha256, unmanaged_certificate_fingerprint, cert_path, key_path, chain_path, keystore_path, keystore_type,
      store_location, store_name, store_thumbprint, reload_command, reload_hint, discovery_source, verify_method, local_config_fingerprint,
      local_config_path, remote_endpoint_fingerprint, remote_status, tls_version, chain_summary, checked_at, drift_status, last_verified_at,
      last_deployed_at, status, metadata, created_at, updated_at, version
    ) values (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31::jsonb,$32,$33,$34,$35,$36,$37,$38,$39::jsonb,$40::timestamptz,$41,$42::timestamptz,$43::timestamptz,$44,$45::jsonb,$46::timestamptz,$47::timestamptz,$48
    )`, [
      binding.id, tenantId, binding.serviceAssetId ?? null, binding.siteAssetId ?? null, binding.managedTargetId ?? null, binding.serviceInstanceId, binding.serviceEndpointId ?? null, binding.hostId, binding.domainName ?? null, binding.domain ?? null, binding.port ?? null, binding.protocol ?? null, binding.bindingKey, binding.bindingType,
      binding.certificateVersionId ?? null, binding.targetCertificateVersionId ?? null, binding.localCertificateVersionId ?? null, binding.observedFingerprintSha256 ?? null, binding.desiredFingerprintSha256 ?? null,
      binding.targetFingerprintSha256 ?? null, binding.unmanagedCertificateFingerprint ?? null, binding.certPath ?? null, binding.keyPath ?? null, binding.chainPath ?? null, binding.keystorePath ?? null, binding.keystoreType ?? null,
      binding.storeLocation ?? null, binding.storeName ?? null, binding.storeThumbprint ?? null, binding.reloadCommand ?? null, JSON.stringify(binding.reloadHint ?? null), binding.discoverySource ?? null, binding.verifyMethod, binding.localConfigFingerprint ?? null,
      binding.localConfigPath ?? null, binding.remoteEndpointFingerprint ?? null, binding.remoteStatus ?? null, binding.tlsVersion ?? null, JSON.stringify(binding.chainSummary ?? null), binding.checkedAt ?? null, binding.driftStatus ?? null, binding.lastVerifiedAt ?? null,
      binding.lastDeployedAt ?? null, binding.status, JSON.stringify(binding.metadata), binding.createdAt, binding.updatedAt, binding.version,
    ]);
    return binding;
  }

  async listCertificateBindings(tenantId: string, query: PageQuery): Promise<PageResult<CertificateBindingDto>> {
    if (canUseSqlPage(query)) {
      const countResult = await this.db.query<{ count: string }>(
        `select count(*)::text as count from pg_certificate_bindings where tenant_id = $1 and deleted_at is null`,
        [tenantId],
      );
      const sortColumn = certificateBindingSortColumn(query.sort?.field);
      const direction = query.sort?.direction === 'asc' ? 'asc' : 'desc';
      const offset = Math.max(0, (query.page - 1) * query.pageSize);
      const rows = (await this.db.query<CertificateBindingRow>(
        `select * from pg_certificate_bindings
          where tenant_id = $1 and deleted_at is null
          order by ${sortColumn} ${direction}, id desc
          limit $2 offset $3`,
        [tenantId, query.pageSize, offset],
      )).rows.map(toBinding);
      return { items: rows, page: query.page, pageSize: query.pageSize, total: Number(countResult.rows[0]?.count ?? 0) };
    }
    const rows = (await this.db.query<CertificateBindingRow>(`select * from pg_certificate_bindings where tenant_id = $1 and deleted_at is null`, [tenantId])).rows.map(toBinding);
    return page(rows, query, bindingFilter);
  }

  async findCertificateBindingUsages(tenantId: string, query: { certificateVersionId?: string; fingerprint?: string; domains?: string[] }): Promise<CertificateBindingUsageDto[]> {
    const fingerprint = query.fingerprint?.toLowerCase();
    const domains = uniqueNormalizedDomains(query.domains ?? []);
    const rows = (await this.db.query<CertificateBindingRow>(`select * from pg_certificate_bindings where tenant_id = $1 and deleted_at is null`, [tenantId])).rows.map(toBinding);
    const bindings = rows.filter((binding) => {
      if (query.certificateVersionId) {
        const relatedVersionIds = [
          binding.certificateVersionId,
          binding.targetCertificateVersionId,
          binding.localCertificateVersionId,
        ].filter(Boolean);
        if (relatedVersionIds.length > 0) {
          // 中文说明：绑定已有明确版本关系时，禁止用指纹或域名把其他版本带入。
          return relatedVersionIds.includes(query.certificateVersionId);
        }
        // 中文说明：旧绑定没有版本 ID 时，才允许用证书指纹恢复精确关联。
        return fingerprint !== undefined && [
          binding.observedFingerprintSha256,
          binding.desiredFingerprintSha256,
          binding.targetFingerprintSha256,
          binding.localConfigFingerprint,
          binding.remoteEndpointFingerprint,
          binding.unmanagedCertificateFingerprint,
        ].includes(fingerprint);
      }
      if (fingerprint !== undefined && [binding.observedFingerprintSha256, binding.desiredFingerprintSha256, binding.targetFingerprintSha256, binding.localConfigFingerprint, binding.remoteEndpointFingerprint, binding.unmanagedCertificateFingerprint].includes(fingerprint)) return true;
      if (domains.length > 0 && matchesBindingDomain(binding, domains)) return true;
      return false;
    });
    const result: CertificateBindingUsageDto[] = [];
    for (const binding of bindings) {
      const service = await this.assets.getFrameworkInstanceIncludingDeleted(tenantId, binding.serviceInstanceId);
      const host = binding.hostId ? await this.assets.getHostIncludingDeleted(tenantId, binding.hostId) : undefined;
      const siteAsset = binding.siteAssetId ? await this.assets.getSiteAssetIncludingDeleted(tenantId, binding.siteAssetId) : undefined;
      const managedTarget = binding.managedTargetId ? await this.assets.getManagedTargetIncludingDeleted(tenantId, binding.managedTargetId) : undefined;
      const serviceAssets = await this.resolveUsageServiceAssets(tenantId, binding, siteAsset, managedTarget);
      const baseUsage = {
        binding,
        service: service === undefined
          ? undefined
          : { id: service.id, displayName: service.displayName, providerType: service.frameworkType, status: service.status, deletedAt: service.deletedAt },
        host: host === undefined
          ? undefined
          : {
            id: host.id,
            hostname: host.hostname ?? host.primaryIp ?? host.id,
            displayName: host.displayName,
            agentId: host.agentId,
            primaryIp: host.primaryIp,
            status: host.status,
            deletedAt: host.deletedAt,
          },
        siteAsset: siteAsset === undefined
          ? undefined
          : {
            id: siteAsset.id,
            serviceAssetId: siteAsset.serviceAssetId,
            deviceId: siteAsset.deviceId,
            frameworkInstanceId: siteAsset.frameworkInstanceId,
            discoveryProviderKey: siteAsset.discoveryProviderKey,
            siteName: siteAsset.siteName,
            bindingInformation: siteAsset.bindingInformation,
            hostHeader: siteAsset.hostHeader,
            port: siteAsset.port,
            protocol: siteAsset.protocol,
            status: siteAsset.status,
            deletedAt: siteAsset.deletedAt,
          },
        managedTarget: managedTarget === undefined
          ? undefined
          : {
            id: managedTarget.id,
            serviceAssetId: managedTarget.serviceAssetId,
            deviceId: managedTarget.deviceId,
            frameworkInstanceId: managedTarget.frameworkInstanceId,
            siteId: managedTarget.siteId,
            discoveryProviderKey: managedTarget.discoveryProviderKey,
            targetKey: managedTarget.targetKey,
            bindingKey: managedTarget.bindingKey,
            status: managedTarget.status,
            deletedAt: managedTarget.deletedAt,
          },
      };
      if (serviceAssets.length === 0) {
        result.push(baseUsage);
        continue;
      }
      for (const serviceAsset of serviceAssets) {
        result.push({
          ...baseUsage,
          serviceAsset: {
            id: serviceAsset.id,
            address: serviceAsset.address,
            displayName: serviceAsset.displayName,
            port: serviceAsset.port,
            protocol: serviceAsset.protocol,
            status: serviceAsset.status,
            deletedAt: serviceAsset.deletedAt,
          },
        });
      }
    }
    return result;
  }

  private async resolveUsageServiceAssets(
    tenantId: string,
    binding: CertificateBindingDto,
    siteAsset: Awaited<ReturnType<AssetsRepository['getSiteAssetIncludingDeleted']>>,
    managedTarget: Awaited<ReturnType<AssetsRepository['getManagedTargetIncludingDeleted']>>,
  ): Promise<NonNullable<Awaited<ReturnType<AssetsRepository['getServiceAsset']>>>[]> {
    const ids = new Set<string>();
    const candidates = [
      binding.serviceAssetId,
      siteAsset?.serviceAssetId,
      managedTarget?.serviceAssetId,
    ].filter((id): id is string => Boolean(id));
    const applicationTargets = managedTarget?.id && this.assets.listApplicationAssetTargetsByManagedTargetId
      ? await this.assets.listApplicationAssetTargetsByManagedTargetId(tenantId, managedTarget.id)
      : [];
    candidates.push(...applicationTargets.map((target) => target.applicationAssetId));

    const serviceAssets: NonNullable<Awaited<ReturnType<AssetsRepository['getServiceAsset']>>>[] = [];
    for (const candidate of candidates) {
      if (ids.has(candidate)) continue;
      ids.add(candidate);
      const serviceAsset = await this.assets.getServiceAsset(tenantId, candidate);
      if (serviceAsset) serviceAssets.push(serviceAsset);
    }
    return serviceAssets;
  }

  async getCertificateBinding(tenantId: string, bindingId: string): Promise<CertificateBindingDto | undefined> {
    const row = (await this.db.query<CertificateBindingRow>(`select * from pg_certificate_bindings where tenant_id = $1 and id = $2 and deleted_at is null`, [tenantId, bindingId])).rows[0];
    return row ? toBinding(row) : undefined;
  }

  async findCertificateBindingByIdentity(tenantId: string, input: CreateCertificateBindingDto): Promise<CertificateBindingDto | undefined> {
    const rows = (await this.db.query<CertificateBindingRow>(`select * from pg_certificate_bindings where tenant_id = $1 and deleted_at is null`, [tenantId])).rows.map(toBinding);
    return rows.find((binding) => this.isDuplicate(tenantId, binding, input));
  }

  async updateCertificateBinding(tenantId: string, bindingId: string, input: UpdateCertificateBindingDto): Promise<CertificateBindingDto> {
    const current = await this.getCertificateBinding(tenantId, bindingId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'CertificateBinding 不存在', { bindingId });

    let nextHostId = current.hostId;
    if (input.serviceInstanceId && input.serviceInstanceId !== current.serviceInstanceId) {
      const serviceInstance = await this.assets.getFrameworkInstance(tenantId, input.serviceInstanceId);
      if (!serviceInstance) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceInstance 不存在', { serviceInstanceId: input.serviceInstanceId });
      nextHostId = serviceInstance.deviceId;
    }

    const nextServiceAsset = input.serviceAssetId ? await this.assets.getServiceAsset(tenantId, input.serviceAssetId) : (current.serviceAssetId ? await this.assets.getServiceAsset(tenantId, current.serviceAssetId) : undefined);
    const nextSiteAsset = input.siteAssetId ? await this.assets.getSiteAsset(tenantId, input.siteAssetId) : (current.siteAssetId ? await this.assets.getSiteAsset(tenantId, current.siteAssetId) : undefined);
    const nextManagedTarget = input.managedTargetId ? await this.assets.getManagedTarget(tenantId, input.managedTargetId) : (current.managedTargetId ? await this.assets.getManagedTarget(tenantId, current.managedTargetId) : undefined);
    if (input.serviceAssetId && !nextServiceAsset) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceAsset 不存在', { serviceAssetId: input.serviceAssetId });
    if (input.siteAssetId && !nextSiteAsset) throw new AppError('RESOURCE_NOT_FOUND', 'SiteAsset 不存在', { siteAssetId: input.siteAssetId });
    if (input.managedTargetId && !nextManagedTarget) throw new AppError('RESOURCE_NOT_FOUND', 'ManagedTarget 不存在', { managedTargetId: input.managedTargetId });

    this.assertBindingRelations(
      {
        ...current,
        ...input,
        serviceAssetId: input.serviceAssetId ?? current.serviceAssetId,
        siteAssetId: input.siteAssetId ?? current.siteAssetId,
        managedTargetId: input.managedTargetId ?? current.managedTargetId,
        serviceInstanceId: input.serviceInstanceId ?? current.serviceInstanceId,
      },
      nextHostId,
      nextServiceAsset?.id,
      nextSiteAsset,
      nextManagedTarget,
    );

    await this.assertNoDuplicate(tenantId, { ...current, ...input, serviceInstanceId: input.serviceInstanceId ?? current.serviceInstanceId, bindingType: input.bindingType ?? current.bindingType, verifyMethod: input.verifyMethod ?? current.verifyMethod } as CreateCertificateBindingDto, current.id);
    const metadataPatch = {
      ...current.metadata,
      ...(input.metadata ?? {}),
      ...pickDefined({
        localConfigFingerprint: input.localConfigFingerprint,
        localConfigPath: input.localConfigPath,
        remoteEndpointFingerprint: input.remoteEndpointFingerprint,
        remoteStatus: input.remoteStatus,
        tlsVersion: input.tlsVersion,
        chainSummary: input.chainSummary,
        checkedAt: input.checkedAt,
        driftStatus: input.driftStatus,
      }),
    };
    const updated: CertificateBindingDto = {
      ...current,
      ...dropUndefined(input),
      serviceAssetId: input.serviceAssetId ?? current.serviceAssetId,
      siteAssetId: input.siteAssetId ?? current.siteAssetId,
      managedTargetId: input.managedTargetId ?? current.managedTargetId,
      domainName: input.domainName ?? input.domain ?? current.domainName,
      domain: input.domain ?? input.domainName ?? current.domain,
      certificateVersionId: input.certificateVersionId ?? input.targetCertificateVersionId ?? current.certificateVersionId,
      targetCertificateVersionId: input.targetCertificateVersionId ?? input.certificateVersionId ?? current.targetCertificateVersionId,
      desiredFingerprintSha256: input.desiredFingerprintSha256 ?? input.targetFingerprintSha256 ?? current.desiredFingerprintSha256,
      targetFingerprintSha256: input.targetFingerprintSha256 ?? input.desiredFingerprintSha256 ?? current.targetFingerprintSha256,
      hostId: nextHostId,
      metadata: metadataPatch,
      updatedAt: new Date().toISOString(),
      version: current.version + 1,
    };
    await this.db.query(`update pg_certificate_bindings set service_asset_id=$2, site_asset_id=$3, managed_target_id=$4, service_instance_id=$5, service_endpoint_id=$6, host_id=$7, domain_name=$8, domain=$9, port=$10, protocol=$11, binding_key=$12, binding_type=$13, certificate_version_id=$14, target_certificate_version_id=$15, local_certificate_version_id=$16, observed_fingerprint_sha256=$17, desired_fingerprint_sha256=$18, target_fingerprint_sha256=$19, unmanaged_certificate_fingerprint=$20, cert_path=$21, key_path=$22, chain_path=$23, keystore_path=$24, keystore_type=$25, store_location=$26, store_name=$27, store_thumbprint=$28, reload_command=$29, reload_hint=$30::jsonb, discovery_source=$31, verify_method=$32, local_config_fingerprint=$33, local_config_path=$34, remote_endpoint_fingerprint=$35, remote_status=$36, tls_version=$37, chain_summary=$38::jsonb, checked_at=$39::timestamptz, drift_status=$40, last_verified_at=$41::timestamptz, last_deployed_at=$42::timestamptz, status=$43, metadata=$44::jsonb, updated_at=$45::timestamptz, version=$46 where id=$1`, [
      updated.id, updated.serviceAssetId ?? null, updated.siteAssetId ?? null, updated.managedTargetId ?? null, updated.serviceInstanceId, updated.serviceEndpointId ?? null, updated.hostId, updated.domainName ?? null, updated.domain ?? null, updated.port ?? null, updated.protocol ?? null, updated.bindingKey, updated.bindingType, updated.certificateVersionId ?? null, updated.targetCertificateVersionId ?? null, updated.localCertificateVersionId ?? null, updated.observedFingerprintSha256 ?? null, updated.desiredFingerprintSha256 ?? null, updated.targetFingerprintSha256 ?? null, updated.unmanagedCertificateFingerprint ?? null, updated.certPath ?? null, updated.keyPath ?? null, updated.chainPath ?? null, updated.keystorePath ?? null, updated.keystoreType ?? null, updated.storeLocation ?? null, updated.storeName ?? null, updated.storeThumbprint ?? null, updated.reloadCommand ?? null, JSON.stringify(updated.reloadHint ?? null), updated.discoverySource ?? null, updated.verifyMethod, updated.localConfigFingerprint ?? null, updated.localConfigPath ?? null, updated.remoteEndpointFingerprint ?? null, updated.remoteStatus ?? null, updated.tlsVersion ?? null, JSON.stringify(updated.chainSummary ?? null), updated.checkedAt ?? null, updated.driftStatus ?? null, updated.lastVerifiedAt ?? null, updated.lastDeployedAt ?? null, updated.status, JSON.stringify(updated.metadata), updated.updatedAt, updated.version,
    ]);
    return updated;
  }

  async deleteCertificateBinding(tenantId: string, bindingId: string): Promise<CertificateBindingDto> {
    const current = await this.getCertificateBinding(tenantId, bindingId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'CertificateBinding 不存在', { bindingId });
    const now = new Date().toISOString();
    const deleted: CertificateBindingDto = { ...current, deletedAt: now, updatedAt: now, version: current.version + 1 };
    await this.db.query(`update pg_certificate_bindings set deleted_at=$2::timestamptz, updated_at=$3::timestamptz, version=$4 where id=$1`, [deleted.id, deleted.deletedAt, deleted.updatedAt, deleted.version]);
    return deleted;
  }

  async updateCertificateBindingStatus(tenantId: string, bindingId: string, status: CertificateBindingDto['status']): Promise<CertificateBindingDto> {
    const current = await this.getCertificateBinding(tenantId, bindingId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'CertificateBinding 不存在', { bindingId });
    const updated: CertificateBindingDto = { ...current, status, updatedAt: new Date().toISOString(), version: current.version + 1 };
    await this.db.query(`update pg_certificate_bindings set status=$2, updated_at=$3::timestamptz, version=$4 where id=$1`, [updated.id, updated.status, updated.updatedAt, updated.version]);
    return updated;
  }

  private async resolveOrCreateServiceAsset(
    tenantId: string,
    input: CreateCertificateBindingDto,
    hostId: string | undefined,
    endpoint?: { id: string; hostName?: string; port: number; protocol: string },
  ) {
      const existing = await resolveExistingServiceAsset(this.assets, tenantId, input, hostId, endpoint);
    if (existing) return existing;
    const address = (input.domainName ?? input.domain ?? endpoint?.hostName)?.toLowerCase();
    const port = input.port ?? endpoint?.port;
    const protocol = input.protocol ?? endpoint?.protocol;
    if (!address || !port || !protocol) return undefined;
    return this.assets.createServiceAsset(tenantId, {
      address,
      port,
      protocol: protocol as any,
      serviceInstanceId: input.serviceInstanceId,
      serviceEndpointId: input.serviceEndpointId,
      hostId,
      discoverySource: (input.discoverySource as any) ?? 'MANUAL',
      status: 'ACTIVE',
      metadata: {},
    });
  }

  private isDuplicate(tenantId: string, binding: CertificateBindingDto, input: CreateCertificateBindingDto): boolean {
    if (binding.tenantId !== tenantId || binding.deletedAt !== undefined) return false;
    if (binding.serviceInstanceId !== input.serviceInstanceId) return false;
    const bindingDomain = normalizeBindingDomain(binding.domainName ?? binding.domain);
    const inputDomain = normalizeBindingDomain(input.domainName ?? input.domain);
    const hasScopedIdentity = Boolean(binding.managedTargetId || input.managedTargetId || binding.siteAssetId || input.siteAssetId);
    if (hasScopedIdentity) {
      return (binding.managedTargetId ?? '') === (input.managedTargetId ?? '')
        && normalizeBindingKey(binding.bindingKey) === normalizeBindingKey(input.bindingKey)
        && bindingDomain === inputDomain;
    }
    if (input.bindingKey && binding.bindingKey === input.bindingKey) return true;
    if ((binding.domainName ?? binding.domain ?? '') !== (input.domainName ?? input.domain ?? '')) return false;
    if ((binding.port ?? undefined) !== (input.port ?? undefined)) return false;
    if ((binding.protocol ?? '') !== (input.protocol ?? '')) return false;
    if (binding.bindingType !== input.bindingType) return false;
    if (binding.bindingType === 'FILE_PATH') return binding.certPath === input.certPath;
    if (binding.bindingType === 'KEYSTORE') return binding.keystorePath === input.keystorePath;
    if (binding.bindingType === 'WINDOWS_CERT_STORE') {
      return binding.storeLocation === input.storeLocation && binding.storeName === input.storeName && (binding.storeThumbprint ?? '') === (input.storeThumbprint ?? '');
    }
    return (binding.serviceEndpointId ?? '') === (input.serviceEndpointId ?? '');
  }

  private assertBindingRelations(
    input: Pick<CreateCertificateBindingDto, 'serviceInstanceId' | 'serviceAssetId' | 'siteAssetId' | 'managedTargetId'>,
    hostId: string | undefined,
    serviceAssetId: string | undefined,
    siteAsset: Awaited<ReturnType<AssetsRepository['getSiteAsset']>>,
    managedTarget: Awaited<ReturnType<AssetsRepository['getManagedTarget']>>,
  ): void {
    if (siteAsset) {
      if (siteAsset.frameworkInstanceId !== input.serviceInstanceId) {
        throw new AppError('VALIDATION_FAILED', 'SiteAsset 必须属于同一 ServiceInstance', { siteAssetId: siteAsset.id, serviceInstanceId: input.serviceInstanceId });
      }
      if (hostId && siteAsset.deviceId !== hostId) {
        throw new AppError('VALIDATION_FAILED', 'SiteAsset 必须属于同一 Host', { siteAssetId: siteAsset.id, hostId });
      }
    }
    if (managedTarget) {
      if (hostId && managedTarget.deviceId !== hostId) {
        throw new AppError('VALIDATION_FAILED', 'ManagedTarget 必须属于同一 Host', { managedTargetId: managedTarget.id, hostId });
      }
      if (managedTarget.frameworkInstanceId && managedTarget.frameworkInstanceId !== input.serviceInstanceId) {
        throw new AppError('VALIDATION_FAILED', 'ManagedTarget 必须属于同一 ServiceInstance', { managedTargetId: managedTarget.id, serviceInstanceId: input.serviceInstanceId });
      }
      if (siteAsset?.id && managedTarget.siteId && managedTarget.siteId !== siteAsset.id) {
        throw new AppError('VALIDATION_FAILED', 'ManagedTarget 与 SiteAsset 关联不一致', { managedTargetId: managedTarget.id, siteAssetId: siteAsset.id });
      }
    }
  }

  private async assertNoDuplicate(tenantId: string, input: CreateCertificateBindingDto, excludedId?: string): Promise<void> {
    const duplicated = await this.findCertificateBindingByIdentity(tenantId, input);
    if (!duplicated || duplicated.id === excludedId) return;
    throw new AppError('RESOURCE_ALREADY_EXISTS', 'CertificateBinding 已存在相同目标绑定关系', {
      bindingId: duplicated.id,
      managedTargetId: input.managedTargetId,
      bindingKey: input.bindingKey,
      domain: input.domainName ?? input.domain,
    });
  }
}

function uniqueNormalizedDomains(domains: string[]): string[] {
  return [...new Set(domains.map(normalizeDomainForUsage).filter(Boolean) as string[])]
}

function normalizeDomainForUsage(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase()
  return normalized ? normalized : undefined
}

function matchesBindingDomain(binding: CertificateBindingDto, domains: string[]): boolean {
  const bindingDomain = normalizeDomainForUsage(binding.domainName ?? binding.domain)
  if (!bindingDomain) return false
  return domains.some((domain) => domain === bindingDomain || wildcardMatchesDomain(domain, bindingDomain))
}

function wildcardMatchesDomain(certificateDomain: string, bindingDomain: string): boolean {
  if (!certificateDomain.startsWith('*.')) return false
  const suffix = certificateDomain.slice(1)
  if (!bindingDomain.endsWith(suffix)) return false
  const prefix = bindingDomain.slice(0, bindingDomain.length - suffix.length)
  return prefix.length > 0 && !prefix.includes('.')
}

function normalizeBindingDomain(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function normalizeBindingKey(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

type CertificateBindingRow = {
  id: string;
  tenant_id: string;
  service_asset_id?: string | null;
  site_asset_id?: string | null;
  managed_target_id?: string | null;
  service_instance_id: string;
  service_endpoint_id?: string | null;
  host_id?: string | null;
  domain_name?: string | null;
  domain?: string | null;
  port?: number | null;
  protocol?: string | null;
  binding_key: string;
  binding_type: string;
  certificate_version_id?: string | null;
  target_certificate_version_id?: string | null;
  local_certificate_version_id?: string | null;
  observed_fingerprint_sha256?: string | null;
  desired_fingerprint_sha256?: string | null;
  target_fingerprint_sha256?: string | null;
  unmanaged_certificate_fingerprint?: string | null;
  cert_path?: string | null;
  key_path?: string | null;
  chain_path?: string | null;
  keystore_path?: string | null;
  keystore_type?: string | null;
  store_location?: string | null;
  store_name?: string | null;
  store_thumbprint?: string | null;
  reload_command?: string | null;
  reload_hint?: unknown;
  discovery_source?: string | null;
  verify_method: string;
  local_config_fingerprint?: string | null;
  local_config_path?: string | null;
  remote_endpoint_fingerprint?: string | null;
  remote_status?: string | null;
  tls_version?: string | null;
  chain_summary?: unknown;
  checked_at?: string | null;
  drift_status?: string | null;
  last_verified_at?: string | null;
  last_deployed_at?: string | null;
  status: CertificateBindingDto['status'];
  metadata: unknown;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  version: number;
};

function toBinding(row: CertificateBindingRow): CertificateBindingDto {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    serviceAssetId: row.service_asset_id ?? undefined,
    siteAssetId: row.site_asset_id ?? undefined,
    managedTargetId: row.managed_target_id ?? undefined,
    serviceInstanceId: row.service_instance_id,
    serviceEndpointId: row.service_endpoint_id ?? undefined,
    hostId: row.host_id ?? undefined,
    domainName: row.domain_name ?? undefined,
    domain: row.domain ?? undefined,
    port: row.port ?? undefined,
    protocol: row.protocol ?? undefined,
    bindingKey: row.binding_key,
    bindingType: row.binding_type as CertificateBindingDto['bindingType'],
    certificateVersionId: row.certificate_version_id ?? undefined,
    targetCertificateVersionId: row.target_certificate_version_id ?? undefined,
    localCertificateVersionId: row.local_certificate_version_id ?? undefined,
    observedFingerprintSha256: row.observed_fingerprint_sha256 ?? undefined,
    desiredFingerprintSha256: row.desired_fingerprint_sha256 ?? undefined,
    targetFingerprintSha256: row.target_fingerprint_sha256 ?? undefined,
    unmanagedCertificateFingerprint: row.unmanaged_certificate_fingerprint ?? undefined,
    certPath: row.cert_path ?? undefined,
    keyPath: row.key_path ?? undefined,
    chainPath: row.chain_path ?? undefined,
    keystorePath: row.keystore_path ?? undefined,
    keystoreType: row.keystore_type as CertificateBindingDto['keystoreType'] | undefined,
    storeLocation: row.store_location ?? undefined,
    storeName: row.store_name ?? undefined,
    storeThumbprint: row.store_thumbprint ?? undefined,
    reloadCommand: row.reload_command ?? undefined,
    reloadHint: asObject(row.reload_hint),
    discoverySource: row.discovery_source ?? undefined,
    verifyMethod: row.verify_method as CertificateBindingDto['verifyMethod'],
    localConfigFingerprint: row.local_config_fingerprint ?? undefined,
    localConfigPath: row.local_config_path ?? undefined,
    remoteEndpointFingerprint: row.remote_endpoint_fingerprint ?? undefined,
    remoteStatus: row.remote_status as CertificateBindingDto['remoteStatus'] | undefined,
    tlsVersion: row.tls_version ?? undefined,
    chainSummary: asObject(row.chain_summary),
    checkedAt: row.checked_at ?? undefined,
    driftStatus: row.drift_status as CertificateBindingDto['driftStatus'] | undefined,
    lastVerifiedAt: row.last_verified_at ?? undefined,
    lastDeployedAt: row.last_deployed_at ?? undefined,
    status: row.status,
    metadata: asObject(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? undefined,
    version: row.version,
  };
}

async function resolveExistingServiceAsset(
  assets: AssetsRepository,
  tenantId: string,
  input: CreateCertificateBindingDto,
  hostId: string | undefined,
  endpoint?: { id: string; hostName?: string; port: number; protocol: string },
) {
  const address = (input.domainName ?? input.domain ?? endpoint?.hostName)?.toLowerCase();
  const port = input.port ?? endpoint?.port;
  const protocol = input.protocol ?? endpoint?.protocol;
  if (!address || !port || !protocol) return undefined;
  return assets.findServiceAssetByIdentity(tenantId, { address, port, protocol });
}

function dropUndefined<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function pickDefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isRemoteStatus(value: unknown): value is CertificateBindingDto['remoteStatus'] {
  return value === 'reachable' || value === 'unreachable' || value === 'unknown';
}

function isDriftState(value: unknown): value is NonNullable<CertificateBindingDto['driftStatus']> {
  return value === 'synced' || value === 'mismatch' || value === 'unreachable' || value === 'unknown' || value === 'incomplete';
}

function page<T extends object>(items: T[], query: PageQuery, filterFn: (item: T, field: string, expected: string) => boolean): PageResult<T> {
  let filtered = applyAuthorizationFilter(items, query);
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

function certificateBindingSortColumn(field?: string): string {
  const columns: Record<string, string> = {
    domainName: 'domain_name',
    domain: 'domain',
    port: 'port',
    protocol: 'protocol',
    bindingKey: 'binding_key',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    lastVerifiedAt: 'last_verified_at',
    status: 'status',
    bindingType: 'binding_type',
    serviceInstanceId: 'service_instance_id',
    hostId: 'host_id',
  };
  return columns[field ?? ''] ?? 'created_at';
}

function canUseSqlPage(query: PageQuery): boolean {
  if (Object.keys(query.filter).length > 0) return false;
  const authorization = query.authorization;
  if (!authorization) return true;
  return authorization.unrestricted === true
    && !authorization.empty
    && !(authorization.objectIds?.length)
    && !(authorization.dynamicConditions?.length)
    && !(authorization.deniedObjectIds?.length)
    && !(authorization.deniedDynamicConditions?.length);
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

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
