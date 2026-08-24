import { AppError } from '../../../common/errors/app-error.js';
import type { PageQuery } from '../../../common/pagination/pagination.js';
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
  findCertificateBindingUsages(tenantId: string, query: { certificateVersionId?: string; fingerprint?: string }): Promise<CertificateBindingUsageDto[]>;
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
    const serviceInstance = await this.assets.getServiceInstance(tenantId, input.serviceInstanceId);
    if (!serviceInstance) {
      throw new AppError('RESOURCE_NOT_FOUND', 'ServiceInstance 不存在', { serviceInstanceId: input.serviceInstanceId });
    }
    if (input.serviceEndpointId) {
      const endpoint = await this.assets.getServiceEndpoint(tenantId, input.serviceEndpointId);
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
    const now = new Date().toISOString();
    const metadata = input.metadata ?? {};
    const binding: CertificateBindingDto = {
      id: newId('bnd'),
      tenantId,
      serviceInstanceId: input.serviceInstanceId,
      serviceEndpointId: input.serviceEndpointId,
      hostId: serviceInstance.hostId,
      domainName: input.domainName ?? input.domain,
      domain: input.domain ?? input.domainName,
      port: input.port,
      protocol: input.protocol,
      bindingKey: input.bindingKey ?? [input.serviceInstanceId, input.domainName ?? input.domain ?? '_', input.port ?? '_', input.protocol ?? '_'].join(':'),
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
      id, tenant_id, service_instance_id, service_endpoint_id, host_id, domain_name, domain, port, protocol, binding_key, binding_type,
      certificate_version_id, target_certificate_version_id, local_certificate_version_id, observed_fingerprint_sha256, desired_fingerprint_sha256,
      target_fingerprint_sha256, unmanaged_certificate_fingerprint, cert_path, key_path, chain_path, keystore_path, keystore_type,
      store_location, store_name, store_thumbprint, reload_command, reload_hint, discovery_source, verify_method, local_config_fingerprint,
      local_config_path, remote_endpoint_fingerprint, remote_status, tls_version, chain_summary, checked_at, drift_status, last_verified_at,
      last_deployed_at, status, metadata, created_at, updated_at, version
    ) values (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28::jsonb,$29,$30,$31,$32,$33,$34,$35,$36::jsonb,$37::timestamptz,$38,$39::timestamptz,$40::timestamptz,$41,$42::jsonb,$43::timestamptz,$44::timestamptz,$45
    )`, [
      binding.id, tenantId, binding.serviceInstanceId, binding.serviceEndpointId ?? null, binding.hostId, binding.domainName ?? null, binding.domain ?? null, binding.port ?? null, binding.protocol ?? null, binding.bindingKey, binding.bindingType,
      binding.certificateVersionId ?? null, binding.targetCertificateVersionId ?? null, binding.localCertificateVersionId ?? null, binding.observedFingerprintSha256 ?? null, binding.desiredFingerprintSha256 ?? null,
      binding.targetFingerprintSha256 ?? null, binding.unmanagedCertificateFingerprint ?? null, binding.certPath ?? null, binding.keyPath ?? null, binding.chainPath ?? null, binding.keystorePath ?? null, binding.keystoreType ?? null,
      binding.storeLocation ?? null, binding.storeName ?? null, binding.storeThumbprint ?? null, binding.reloadCommand ?? null, JSON.stringify(binding.reloadHint ?? null), binding.discoverySource ?? null, binding.verifyMethod, binding.localConfigFingerprint ?? null,
      binding.localConfigPath ?? null, binding.remoteEndpointFingerprint ?? null, binding.remoteStatus ?? null, binding.tlsVersion ?? null, JSON.stringify(binding.chainSummary ?? null), binding.checkedAt ?? null, binding.driftStatus ?? null, binding.lastVerifiedAt ?? null,
      binding.lastDeployedAt ?? null, binding.status, JSON.stringify(binding.metadata), binding.createdAt, binding.updatedAt, binding.version,
    ]);
    return binding;
  }

  async listCertificateBindings(tenantId: string, query: PageQuery): Promise<PageResult<CertificateBindingDto>> {
    const rows = (await this.db.query<CertificateBindingRow>(`select * from pg_certificate_bindings where tenant_id = $1 and deleted_at is null`, [tenantId])).rows.map(toBinding);
    return page(rows, query, bindingFilter);
  }

  async findCertificateBindingUsages(tenantId: string, query: { certificateVersionId?: string; fingerprint?: string }): Promise<CertificateBindingUsageDto[]> {
    const fingerprint = query.fingerprint?.toLowerCase();
    const rows = (await this.db.query<CertificateBindingRow>(`select * from pg_certificate_bindings where tenant_id = $1 and deleted_at is null`, [tenantId])).rows.map(toBinding);
    const bindings = rows.filter((binding) => {
      if (query.certificateVersionId && (binding.certificateVersionId === query.certificateVersionId || binding.targetCertificateVersionId === query.certificateVersionId || binding.localCertificateVersionId === query.certificateVersionId)) return true;
      return fingerprint !== undefined && [binding.observedFingerprintSha256, binding.desiredFingerprintSha256, binding.targetFingerprintSha256, binding.localConfigFingerprint, binding.remoteEndpointFingerprint, binding.unmanagedCertificateFingerprint].includes(fingerprint);
    });
    const result: CertificateBindingUsageDto[] = [];
    for (const binding of bindings) {
      const service = await this.assets.getServiceInstanceIncludingDeleted(tenantId, binding.serviceInstanceId);
      const host = await this.assets.getHostIncludingDeleted(tenantId, binding.hostId);
      result.push({
        binding,
        service: service === undefined
          ? undefined
          : { id: service.id, displayName: service.displayName, providerType: service.providerType, status: service.status, deletedAt: service.deletedAt },
        host: host === undefined
          ? undefined
          : { id: host.id, hostname: host.hostname ?? host.primaryIp ?? host.id, primaryIp: host.primaryIp, status: host.status, deletedAt: host.deletedAt },
      });
    }
    return result;
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
      const serviceInstance = await this.assets.getServiceInstance(tenantId, input.serviceInstanceId);
      if (!serviceInstance) throw new AppError('RESOURCE_NOT_FOUND', 'ServiceInstance 不存在', { serviceInstanceId: input.serviceInstanceId });
      nextHostId = serviceInstance.hostId;
    }
    this.assertNoDuplicate(tenantId, { ...current, ...input, serviceInstanceId: input.serviceInstanceId ?? current.serviceInstanceId, bindingType: input.bindingType ?? current.bindingType, verifyMethod: input.verifyMethod ?? current.verifyMethod } as CreateCertificateBindingDto, current.id);
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
    await this.db.query(`update pg_certificate_bindings set service_instance_id=$2, service_endpoint_id=$3, host_id=$4, domain_name=$5, domain=$6, port=$7, protocol=$8, binding_key=$9, binding_type=$10, certificate_version_id=$11, target_certificate_version_id=$12, local_certificate_version_id=$13, observed_fingerprint_sha256=$14, desired_fingerprint_sha256=$15, target_fingerprint_sha256=$16, unmanaged_certificate_fingerprint=$17, cert_path=$18, key_path=$19, chain_path=$20, keystore_path=$21, keystore_type=$22, store_location=$23, store_name=$24, store_thumbprint=$25, reload_command=$26, reload_hint=$27::jsonb, discovery_source=$28, verify_method=$29, local_config_fingerprint=$30, local_config_path=$31, remote_endpoint_fingerprint=$32, remote_status=$33, tls_version=$34, chain_summary=$35::jsonb, checked_at=$36::timestamptz, drift_status=$37, last_verified_at=$38::timestamptz, last_deployed_at=$39::timestamptz, status=$40, metadata=$41::jsonb, updated_at=$42::timestamptz, version=$43 where id=$1`, [
      updated.id, updated.serviceInstanceId, updated.serviceEndpointId ?? null, updated.hostId, updated.domainName ?? null, updated.domain ?? null, updated.port ?? null, updated.protocol ?? null, updated.bindingKey, updated.bindingType, updated.certificateVersionId ?? null, updated.targetCertificateVersionId ?? null, updated.localCertificateVersionId ?? null, updated.observedFingerprintSha256 ?? null, updated.desiredFingerprintSha256 ?? null, updated.targetFingerprintSha256 ?? null, updated.unmanagedCertificateFingerprint ?? null, updated.certPath ?? null, updated.keyPath ?? null, updated.chainPath ?? null, updated.keystorePath ?? null, updated.keystoreType ?? null, updated.storeLocation ?? null, updated.storeName ?? null, updated.storeThumbprint ?? null, updated.reloadCommand ?? null, JSON.stringify(updated.reloadHint ?? null), updated.discoverySource ?? null, updated.verifyMethod, updated.localConfigFingerprint ?? null, updated.localConfigPath ?? null, updated.remoteEndpointFingerprint ?? null, updated.remoteStatus ?? null, updated.tlsVersion ?? null, JSON.stringify(updated.chainSummary ?? null), updated.checkedAt ?? null, updated.driftStatus ?? null, updated.lastVerifiedAt ?? null, updated.lastDeployedAt ?? null, updated.status, JSON.stringify(updated.metadata), updated.updatedAt, updated.version,
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

  private assertNoDuplicate(tenantId: string, input: CreateCertificateBindingDto, excludedId?: string): void {
    void tenantId;
    void input;
    void excludedId;
  }

  private isDuplicate(tenantId: string, binding: CertificateBindingDto, input: CreateCertificateBindingDto): boolean {
    if (binding.tenantId !== tenantId || binding.deletedAt !== undefined) return false;
    if (binding.serviceInstanceId !== input.serviceInstanceId) return false;
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
}

type CertificateBindingRow = {
  id: string;
  tenant_id: string;
  service_instance_id: string;
  service_endpoint_id?: string | null;
  host_id: string;
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
    serviceInstanceId: row.service_instance_id,
    serviceEndpointId: row.service_endpoint_id ?? undefined,
    hostId: row.host_id,
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

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
