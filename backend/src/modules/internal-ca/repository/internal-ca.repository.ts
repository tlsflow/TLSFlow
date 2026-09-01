import type { DatabasePort } from '../../../database/database-port.js';
import type {
  CaCapabilityRecordEntity,
  CaCrlPublicationEntity,
  CaIssuanceRecordEntity,
  CaProviderEntity,
  ProviderActionBindingEntity,
  CaTrustDomainEntity,
  CertificatePolicyEntity,
  CertificatePolicyVersionEntity,
  CertificateAuthorityEntity,
  CertificateProfileEntity,
  CertificateProfileVersionEntity,
  CertificateRequestEntity,
  CertificateRenewalJobEntity,
  CertificateRevocationEntity,
  CertificateRotationEntity,
  KeyReferenceEntity,
  TrustDistributionEntity,
} from '../schema/internal-ca.schema.js';

export class InternalCaRepository {
  constructor(private readonly db: DatabasePort) {}

  saveProvider(entity: CaProviderEntity): Promise<CaProviderEntity> {
    return this.upsert('pg_ca_providers', entity.id, entity, {
      tenant_id: entity.tenantId,
      name: entity.name,
      type: entity.type,
      deployment_mode: entity.deploymentMode,
      runtime_platform: entity.runtimePlatform,
      availability_mode: entity.availabilityMode,
      endpoint: entity.endpoint ?? null,
      credential_secret_ref: entity.credentialSecretRef ?? null,
      capabilities: entity.capabilities,
      status: entity.status,
    });
  }

  getProvider(tenantId: string, id: string): Promise<CaProviderEntity | undefined> {
    return this.get('pg_ca_providers', tenantId, id);
  }

  listProviders(tenantId: string): Promise<CaProviderEntity[]> {
    return this.list('pg_ca_providers', tenantId);
  }

  saveProviderActionBinding(entity: ProviderActionBindingEntity): Promise<ProviderActionBindingEntity> {
    return this.upsert('pg_ca_provider_action_bindings', entity.id, entity, {
      tenant_id: entity.tenantId,
      provider_id: entity.providerId,
      plugin_version_id: entity.pluginVersionId,
      execution_location: entity.executionLocation,
      status: entity.status,
      approval_mode: entity.approvalMode,
      capability_evidence: entity.capabilityEvidence,
      created_by: entity.createdBy,
    });
  }

  getProviderActionBinding(tenantId: string, id: string): Promise<ProviderActionBindingEntity | undefined> {
    return this.get('pg_ca_provider_action_bindings', tenantId, id);
  }

  getActiveProviderActionBinding(tenantId: string, providerId: string): Promise<ProviderActionBindingEntity | undefined> {
    return this.listProviderActionBindings(tenantId, providerId)
      .then((items) => items.filter((item) => item.status !== 'disabled').sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]);
  }

  listProviderActionBindings(tenantId: string, providerId?: string): Promise<ProviderActionBindingEntity[]> {
    return this.list('pg_ca_provider_action_bindings', tenantId, providerId ? { provider_id: providerId } : undefined);
  }

  async deleteUnboundProvider(tenantId: string, providerId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const authorities = await tx.query('select id from pg_certificate_authorities where tenant_id = $1 and provider_id = $2 limit 1', [tenantId, providerId]);
      if (authorities.rows[0]) return false;
      await tx.query('delete from pg_ca_capability_records where tenant_id = $1 and owner_type = $2 and owner_id = $3', [tenantId, 'provider', providerId]);
      await tx.query('delete from pg_ca_provider_action_bindings where tenant_id = $1 and provider_id = $2', [tenantId, providerId]);
      await tx.query('delete from pg_certificate_issuances where tenant_id = $1 and provider_id = $2', [tenantId, providerId]);
      const deleted = await tx.query('delete from pg_ca_providers where tenant_id = $1 and id = $2 returning id', [tenantId, providerId]);
      return deleted.rows.length === 1;
    });
  }

  saveCapabilityRecord(entity: CaCapabilityRecordEntity): Promise<CaCapabilityRecordEntity> {
    return this.upsert('pg_ca_capability_records', entity.id, entity, {
      tenant_id: entity.tenantId,
      owner_type: entity.ownerType,
      owner_id: entity.ownerId,
      capability_key: entity.capabilityKey,
      state: entity.state,
      source: entity.source,
      evidence: entity.evidence,
      verified_at: entity.verifiedAt ?? null,
      expires_at: entity.expiresAt ?? null,
      failure_reason: entity.failureReason ?? null,
    });
  }

  listCapabilityRecords(tenantId: string, ownerType: CaCapabilityRecordEntity['ownerType'], ownerId: string): Promise<CaCapabilityRecordEntity[]> {
    return this.list('pg_ca_capability_records', tenantId, { owner_type: ownerType, owner_id: ownerId });
  }

  async allocateSerialNumber(tenantId: string, caId: string, now = new Date()): Promise<string> {
    const result = await this.db.query<{ allocated_serial: string | number }>(
      `insert into pg_ca_serial_states (tenant_id, ca_id, next_serial, created_at, updated_at)
       values ($1, $2, 2, $3, $3)
       on conflict (tenant_id, ca_id) do update
       set next_serial = pg_ca_serial_states.next_serial + 1,
           updated_at = excluded.updated_at
       returning next_serial - 1 as allocated_serial`,
      [tenantId, caId, now.toISOString()],
    );
    const allocated = result.rows[0]?.allocated_serial;
    if (allocated === undefined) throw new Error('CA 序列号分配未返回结果');
    const hexadecimal = BigInt(String(allocated)).toString(16).toUpperCase();
    return hexadecimal.length % 2 === 0 ? hexadecimal : `0${hexadecimal}`;
  }

  async saveIssuanceRecord(entity: CaIssuanceRecordEntity): Promise<CaIssuanceRecordEntity> {
    const existing = await this.getIssuanceBySerial(entity.tenantId, entity.caId, entity.serialNumber);
    if (existing?.status === 'revoked' && entity.status !== 'revoked') {
      throw new Error('已吊销的 CA 签发记录不可恢复为其他状态');
    }
    return this.upsert('pg_ca_issuance_records', entity.id, entity, {
      tenant_id: entity.tenantId,
      ca_id: entity.caId,
      serial_number: entity.serialNumber,
      certificate_request_id: entity.certificateRequestId ?? null,
      certificate_version_id: entity.certificateVersionId ?? null,
      application_asset_id: entity.applicationAssetId ?? null,
      status: entity.status,
      record_origin: entity.recordOrigin,
      subject_common_name: entity.subjectCommonName ?? null,
      sans: entity.sans,
      certificate_fingerprint_sha256: entity.certificateFingerprintSha256 ?? null,
      public_key_fingerprint_sha256: entity.publicKeyFingerprintSha256 ?? null,
      not_before: entity.notBefore ?? null,
      not_after: entity.notAfter ?? null,
      issued_at: entity.issuedAt ?? null,
      revocation_reason: entity.revocationReason ?? null,
      revoked_at: entity.revokedAt ?? null,
      invalidity_date: entity.invalidityDate ?? null,
      observed_at: entity.observedAt,
    });
  }

  getIssuanceBySerial(tenantId: string, caId: string, serialNumber: string): Promise<CaIssuanceRecordEntity | undefined> {
    return this.getByColumns('pg_ca_issuance_records', tenantId, { ca_id: caId, serial_number: serialNumber });
  }

  getIssuanceByRequest(tenantId: string, certificateRequestId: string): Promise<CaIssuanceRecordEntity | undefined> {
    return this.getByColumns('pg_ca_issuance_records', tenantId, { certificate_request_id: certificateRequestId });
  }

  getIssuanceByCertificateVersion(tenantId: string, certificateVersionId: string): Promise<CaIssuanceRecordEntity | undefined> {
    return this.getByColumns('pg_ca_issuance_records', tenantId, { certificate_version_id: certificateVersionId });
  }

  listIssuanceRecords(tenantId: string, caId?: string): Promise<CaIssuanceRecordEntity[]> {
    return this.list('pg_ca_issuance_records', tenantId, caId ? { ca_id: caId } : undefined);
  }

  async allocateCrlNumber(tenantId: string, caId: string, now = new Date()): Promise<number> {
    const result = await this.db.query<{ crl_number: number | string }>(
      `insert into pg_ca_crl_states (tenant_id, ca_id, next_crl_number, created_at, updated_at)
       values ($1, $2, 2, $3, $3)
       on conflict (tenant_id, ca_id) do update
       set next_crl_number = pg_ca_crl_states.next_crl_number + 1,
           updated_at = excluded.updated_at
       returning next_crl_number - 1 as crl_number`,
      [tenantId, caId, now.toISOString()],
    );
    const value = result.rows[0]?.crl_number;
    if (value === undefined) throw new Error('CRL Number 分配未返回结果');
    return Number(value);
  }

  saveCrlPublication(entity: CaCrlPublicationEntity): Promise<CaCrlPublicationEntity> {
    return this.upsert('pg_ca_crl_publications', entity.id, entity, {
      tenant_id: entity.tenantId,
      ca_id: entity.caId,
      crl_number: entity.crlNumber,
      this_update: entity.thisUpdate,
      next_update: entity.nextUpdate,
      distribution_point: entity.distributionPoint ?? null,
      crl_fingerprint_sha256: entity.crlFingerprintSha256,
      publication_status: entity.publicationStatus,
    });
  }

  listCrlPublications(tenantId: string, caId?: string): Promise<CaCrlPublicationEntity[]> {
    return this.list('pg_ca_crl_publications', tenantId, caId ? { ca_id: caId } : undefined);
  }

  getLatestCrlPublication(tenantId: string, caId: string): Promise<CaCrlPublicationEntity | undefined> {
    return this.db.query<{ payload: CaCrlPublicationEntity }>(
      'select payload from pg_ca_crl_publications where tenant_id = $1 and ca_id = $2 order by crl_number desc limit 1',
      [tenantId, caId],
    ).then((result) => result.rows[0]?.payload ? structuredClone(result.rows[0].payload) : undefined);
  }

  /**
   * 公开 CDP 只读取已发布的最新制品，失败或未知状态不能被客户端当成有效 CRL。
   * 租户和 CA 都来自发布 URL，避免把一个租户的 CRL 暴露给另一个租户。
   */
  getPublicCrlPublication(tenantId: string, caId: string): Promise<CaCrlPublicationEntity | undefined> {
    return this.db.query<{ payload: CaCrlPublicationEntity }>(
      `select payload
         from pg_ca_crl_publications
        where tenant_id = $1
          and ca_id = $2
          and publication_status = 'published'
          and coalesce(payload->>'crlDerBase64', '') <> ''
          and coalesce(payload->'verification'->>'signatureVerified', 'false') = 'true'
          and coalesce(payload->'verification'->>'serialsVerified', 'false') = 'true'
        order by crl_number desc
        limit 1`,
      [tenantId, caId],
    ).then((result) => result.rows[0]?.payload ? structuredClone(result.rows[0].payload) : undefined);
  }

  saveTrustDomain(entity: CaTrustDomainEntity): Promise<CaTrustDomainEntity> {
    return this.upsert('pg_ca_trust_domains', entity.id, entity, {
      tenant_id: entity.tenantId,
      name: entity.name,
      code: entity.code,
      purpose: entity.purpose,
      status: entity.status,
      is_default: entity.isDefault,
      isolation_level: entity.isolationLevel,
      root_policy: entity.rootPolicy,
      trust_policy: entity.trustPolicy,
    });
  }

  getTrustDomain(tenantId: string, id: string): Promise<CaTrustDomainEntity | undefined> {
    return this.get('pg_ca_trust_domains', tenantId, id);
  }

  getTrustDomainByName(tenantId: string, name: string): Promise<CaTrustDomainEntity | undefined> {
    return this.getByColumns('pg_ca_trust_domains', tenantId, { name: name.trim().toLowerCase() }, 'lower(name)');
  }

  listTrustDomains(tenantId: string): Promise<CaTrustDomainEntity[]> {
    return this.list('pg_ca_trust_domains', tenantId);
  }

  async saveTrustDomainWithDefaultSwitch(entity: CaTrustDomainEntity): Promise<CaTrustDomainEntity> {
    return this.db.transaction(async (tx) => {
      const repository = new InternalCaRepository(tx);
      if (entity.isDefault) {
        const existing = await repository.listTrustDomains(entity.tenantId);
        const now = entity.updatedAt;
        for (const domain of existing) {
          if (domain.id !== entity.id && domain.isDefault) {
            await repository.saveTrustDomain({ ...domain, isDefault: false, updatedAt: now });
          }
        }
      }
      return repository.saveTrustDomain(entity);
    });
  }

  saveAuthority(entity: CertificateAuthorityEntity): Promise<CertificateAuthorityEntity> {
    return this.upsert('pg_certificate_authorities', entity.id, entity, {
      tenant_id: entity.tenantId,
      name: entity.name,
      role: entity.role,
      parent_ca_id: entity.parentCaId ?? null,
      topology_mode: entity.topologyMode,
      provider_id: entity.providerId,
      trust_domain_id: entity.trustDomainId ?? null,
      key_reference_id: entity.keyReferenceId ?? null,
      certificate_version_id: entity.certificateVersionId ?? null,
      security_domain: entity.securityDomain,
      status: entity.status,
      path_length_constraint: entity.pathLengthConstraint ?? null,
    });
  }

  getAuthority(tenantId: string, id: string): Promise<CertificateAuthorityEntity | undefined> {
    return this.get('pg_certificate_authorities', tenantId, id);
  }

  listAuthorities(tenantId: string): Promise<CertificateAuthorityEntity[]> {
    return this.list('pg_certificate_authorities', tenantId);
  }

  saveKeyReference(entity: KeyReferenceEntity): Promise<KeyReferenceEntity> {
    return this.upsert('pg_key_references', entity.id, entity, {
      tenant_id: entity.tenantId,
      owner_type: entity.ownerType,
      owner_id: entity.ownerId,
      custody_mode: entity.custodyMode,
      backend_type: entity.backendType,
      opaque_reference: entity.opaqueReference ?? null,
      secret_ref: entity.secretRef ?? null,
      public_key_fingerprint_sha256: entity.publicKeyFingerprintSha256,
      exportability: entity.exportability,
      protection_level: entity.protectionLevel,
      status: entity.status,
      rotated_from_key_id: entity.rotatedFromKeyId ?? null,
    });
  }

  getKeyReference(tenantId: string, id: string): Promise<KeyReferenceEntity | undefined> {
    return this.get('pg_key_references', tenantId, id);
  }

  listKeyReferences(tenantId: string): Promise<KeyReferenceEntity[]> {
    return this.list('pg_key_references', tenantId);
  }

  async createProfile(profile: CertificateProfileEntity, version: CertificateProfileVersionEntity): Promise<void> {
    await this.db.transaction(async (tx) => {
      const repository = new InternalCaRepository(tx);
      await repository.saveProfile(profile);
      await repository.saveProfileVersion(version);
    });
  }

  saveProfile(entity: CertificateProfileEntity): Promise<CertificateProfileEntity> {
    return this.upsert('pg_certificate_profiles', entity.id, entity, {
      tenant_id: entity.tenantId,
      name: entity.name,
      security_domain: entity.securityDomain,
      trust_domain_id: entity.trustDomainId ?? null,
      status: entity.status,
      current_version: entity.currentVersion,
    });
  }

  saveProfileVersion(entity: CertificateProfileVersionEntity): Promise<CertificateProfileVersionEntity> {
    return this.upsert('pg_certificate_profile_versions', entity.id, entity, {
      profile_id: entity.profileId,
      version_no: entity.versionNo,
      rules: entity.rules,
      created_by: entity.createdBy,
    });
  }

  async createCertificatePolicy(policy: CertificatePolicyEntity, version: CertificatePolicyVersionEntity): Promise<void> {
    await this.db.transaction(async (tx) => {
      const repository = new InternalCaRepository(tx);
      await repository.saveCertificatePolicy(policy);
      await repository.saveCertificatePolicyVersion(version);
    });
  }

  saveCertificatePolicy(entity: CertificatePolicyEntity): Promise<CertificatePolicyEntity> {
    return this.upsert('pg_certificate_policies', entity.id, entity, {
      tenant_id: entity.tenantId,
      status: entity.status,
      current_version: entity.currentVersion,
    });
  }

  saveCertificatePolicyVersion(entity: CertificatePolicyVersionEntity): Promise<CertificatePolicyVersionEntity> {
    return this.upsert('pg_certificate_policy_versions', entity.id, entity, {
      policy_id: entity.policyId,
      version_no: entity.versionNo,
      rules: entity.rules,
      created_by: entity.createdBy,
    });
  }

  getCertificatePolicy(tenantId: string, id: string): Promise<CertificatePolicyEntity | undefined> {
    return this.get('pg_certificate_policies', tenantId, id);
  }

  listCertificatePolicies(tenantId: string): Promise<CertificatePolicyEntity[]> {
    return this.list('pg_certificate_policies', tenantId);
  }

  async getCertificatePolicyVersion(id: string): Promise<CertificatePolicyVersionEntity | undefined> {
    const result = await this.db.query<{ payload: CertificatePolicyVersionEntity }>(
      'select payload from pg_certificate_policy_versions where id = $1',
      [id],
    );
    return result.rows[0]?.payload ? structuredClone(result.rows[0].payload) : undefined;
  }

  listCertificatePolicyVersions(policyId: string): Promise<CertificatePolicyVersionEntity[]> {
    return this.listWithoutTenant('pg_certificate_policy_versions', { policy_id: policyId });
  }

  getProfile(tenantId: string, id: string): Promise<CertificateProfileEntity | undefined> {
    return this.get('pg_certificate_profiles', tenantId, id);
  }

  listProfiles(tenantId: string): Promise<CertificateProfileEntity[]> {
    return this.list('pg_certificate_profiles', tenantId);
  }

  async getProfileVersion(id: string): Promise<CertificateProfileVersionEntity | undefined> {
    const result = await this.db.query<{ payload: CertificateProfileVersionEntity }>(
      'select payload from pg_certificate_profile_versions where id = $1',
      [id],
    );
    return result.rows[0]?.payload ? structuredClone(result.rows[0].payload) : undefined;
  }

  listProfileVersions(profileId: string): Promise<CertificateProfileVersionEntity[]> {
    return this.listWithoutTenant('pg_certificate_profile_versions', { profile_id: profileId });
  }

  saveRequest(entity: CertificateRequestEntity): Promise<CertificateRequestEntity> {
    return this.upsert('pg_certificate_requests', entity.id, entity, {
      tenant_id: entity.tenantId,
      application_asset_id: entity.applicationAssetId,
      certificate_asset_id: entity.certificateAssetId ?? null,
      application_certificate_policy_version_id: entity.applicationCertificatePolicyVersionId ?? null,
      ca_id: entity.caId,
      trust_domain_id: entity.trustDomainId ?? null,
      profile_version_id: entity.profileVersionId,
      certificate_policy_version_id: entity.certificatePolicyVersionId ?? null,
      provider_action_binding_id: entity.providerActionBindingId ?? null,
      key_reference_id: entity.keyReferenceId,
      csr_pem: entity.csrPem,
      csr_sha256: entity.csrSha256,
      public_key_fingerprint_sha256: entity.publicKeyFingerprintSha256,
      idempotency_key: entity.idempotencyKey,
      status: entity.status,
      requested_by: entity.requestedBy,
      approved_by: entity.approvedBy ?? null,
      provider_request_id: entity.providerRequestId ?? null,
      certificate_version_id: entity.certificateVersionId ?? null,
      failure_code: entity.failureCode ?? null,
      failure_message: entity.failureMessage ?? null,
    });
  }

  async getRequest(tenantId: string, id: string): Promise<CertificateRequestEntity | undefined> {
    const result = await this.db.query<RequestRow>(
      `select payload, certificate_asset_id, application_certificate_policy_version_id
         from pg_certificate_requests
        where tenant_id = $1 and id = $2`,
      [tenantId, id],
    );
    return result.rows[0] ? requestFromRow(result.rows[0]) : undefined;
  }

  async getRequestByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<CertificateRequestEntity | undefined> {
    const result = await this.db.query<RequestRow>(
      'select payload, certificate_asset_id, application_certificate_policy_version_id from pg_certificate_requests where tenant_id = $1 and idempotency_key = $2',
      [tenantId, idempotencyKey],
    );
    return result.rows[0] ? requestFromRow(result.rows[0]) : undefined;
  }

  async listRequests(tenantId: string): Promise<CertificateRequestEntity[]> {
    const result = await this.db.query<RequestRow>(
      `select payload, certificate_asset_id, application_certificate_policy_version_id
         from pg_certificate_requests
        where tenant_id = $1
        order by created_at desc`,
      [tenantId],
    );
    return result.rows.map(requestFromRow);
  }

  saveRenewal(entity: CertificateRenewalJobEntity): Promise<CertificateRenewalJobEntity> {
    return this.upsert('pg_certificate_renewal_jobs', entity.id, entity, {
      tenant_id: entity.tenantId,
      certificate_version_id: entity.certificateVersionId,
      renewal_window_key: entity.renewalWindowKey,
      status: entity.status,
      certificate_request_id: entity.certificateRequestId ?? null,
      scheduled_at: entity.scheduledAt,
    });
  }

  listRenewals(tenantId: string): Promise<CertificateRenewalJobEntity[]> {
    return this.list('pg_certificate_renewal_jobs', tenantId);
  }

  saveRevocation(entity: CertificateRevocationEntity): Promise<CertificateRevocationEntity> {
    return this.upsert('pg_certificate_revocations', entity.id, entity, {
      tenant_id: entity.tenantId,
      certificate_version_id: entity.certificateVersionId,
      ca_id: entity.caId,
      trust_domain_id: entity.trustDomainId ?? null,
      reason: entity.reason,
      status: entity.status,
      requested_by: entity.requestedBy,
      revoked_at: entity.revokedAt ?? null,
    });
  }

  listRevocations(tenantId: string): Promise<CertificateRevocationEntity[]> {
    return this.list('pg_certificate_revocations', tenantId);
  }

  saveRotation(entity: CertificateRotationEntity): Promise<CertificateRotationEntity> {
    return this.upsert('pg_certificate_rotations', entity.id, entity, {
      tenant_id: entity.tenantId,
      application_asset_id: entity.applicationAssetId,
      source_certificate_version_id: entity.sourceCertificateVersionId,
      source_key_reference_id: entity.sourceKeyReferenceId ?? null,
      target_key_reference_id: entity.targetKeyReferenceId ?? null,
      target_certificate_request_id: entity.targetCertificateRequestId ?? null,
      target_certificate_version_id: entity.targetCertificateVersionId ?? null,
      policy_version_id: entity.policyVersionId ?? null,
      idempotency_key: entity.idempotencyKey,
      status: entity.status,
      evidence: entity.evidence,
      warnings: entity.warnings,
      requested_by: entity.requestedBy,
    });
  }

  getRotation(tenantId: string, id: string): Promise<CertificateRotationEntity | undefined> {
    return this.get('pg_certificate_rotations', tenantId, id);
  }

  getRotationByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<CertificateRotationEntity | undefined> {
    return this.getByColumns('pg_certificate_rotations', tenantId, { idempotency_key: idempotencyKey });
  }

  listRotations(tenantId: string): Promise<CertificateRotationEntity[]> {
    return this.list('pg_certificate_rotations', tenantId);
  }

  saveTrustDistribution(entity: TrustDistributionEntity): Promise<TrustDistributionEntity> {
    return this.upsert('pg_trust_distributions', entity.id, entity, {
      tenant_id: entity.tenantId,
      ca_id: entity.caId,
      trust_domain_id: entity.trustDomainId ?? null,
      target_scope: entity.targetScope,
      status: entity.status,
      requested_by: entity.requestedBy,
    });
  }

  listTrustDistributions(tenantId: string): Promise<TrustDistributionEntity[]> {
    return this.list('pg_trust_distributions', tenantId);
  }

  private async upsert<T extends { id: string; createdAt: string; updatedAt?: string }>(
    table: string,
    id: string,
    entity: T,
    columns: Record<string, unknown>,
  ): Promise<T> {
    const values: Record<string, unknown> = {
      id,
      ...columns,
      payload: entity,
      created_at: entity.createdAt,
      updated_at: entity.updatedAt ?? entity.createdAt,
    };
    const names = Object.keys(values);
    const placeholders = names.map((name, index) => `${jsonColumns.has(name) ? `$${index + 1}::jsonb` : `$${index + 1}`}`);
    const updates = names.filter((name) => name !== 'id' && name !== 'created_at').map((name) => `${name} = excluded.${name}`);
    await this.db.query(
      `insert into ${table} (${names.join(', ')}) values (${placeholders.join(', ')})
       on conflict (id) do update set ${updates.join(', ')}`,
      names.map((name) => jsonColumns.has(name) ? JSON.stringify(values[name]) : values[name]),
    );
    return structuredClone(entity);
  }

  private async get<T>(table: string, tenantId: string, id: string): Promise<T | undefined> {
    const result = await this.db.query<{ payload: T }>(`select payload from ${table} where tenant_id = $1 and id = $2`, [tenantId, id]);
    return result.rows[0]?.payload ? structuredClone(result.rows[0].payload) : undefined;
  }

  private async getByColumns<T>(
    table: string,
    tenantId: string,
    filter: Record<string, unknown>,
    columnExpression?: string,
  ): Promise<T | undefined> {
    const entries = Object.entries(filter);
    const clauses = ['tenant_id = $1', ...entries.map(([column], index) => `${columnExpression ?? column} = $${index + 2}`)];
    const result = await this.db.query<{ payload: T }>(
      `select payload from ${table} where ${clauses.join(' and ')} limit 1`,
      [tenantId, ...entries.map(([, value]) => value)],
    );
    return result.rows[0]?.payload ? structuredClone(result.rows[0].payload) : undefined;
  }

  private async list<T>(table: string, tenantId: string, extra?: Record<string, unknown>): Promise<T[]> {
    const clauses = ['tenant_id = $1'];
    const params: unknown[] = [tenantId];
    for (const [column, value] of Object.entries(extra ?? {})) {
      params.push(value);
      clauses.push(`${column} = $${params.length}`);
    }
    const result = await this.db.query<{ payload: T }>(`select payload from ${table} where ${clauses.join(' and ')} order by created_at desc`, params);
    return result.rows.map((row) => structuredClone(row.payload));
  }

  private async listWithoutTenant<T>(table: string, filter: Record<string, unknown>): Promise<T[]> {
    const entries = Object.entries(filter);
    const result = await this.db.query<Record<string, unknown>>(
      `select * from ${table} where ${entries.map(([column], index) => `${column} = $${index + 1}`).join(' and ')} order by created_at desc`,
      entries.map(([, value]) => value),
    );
    if (table === 'pg_certificate_profile_versions') return result.rows.map(profileVersionFromRow) as T[];
    if (table === 'pg_certificate_policy_versions') return result.rows.map(certificatePolicyVersionFromRow) as T[];
    return [];
  }
}

const jsonColumns = new Set(['payload', 'capabilities', 'configuration', 'rules', 'target_scope', 'root_policy', 'trust_policy', 'evidence', 'warnings', 'sans', 'capability_evidence']);

interface RequestRow {
  [key: string]: unknown;
  payload?: unknown;
  certificate_asset_id?: string | null;
  application_certificate_policy_version_id?: string | null;
}

function requestFromRow(row: RequestRow): CertificateRequestEntity {
  const payload = row.payload && typeof row.payload === 'object'
    ? structuredClone(row.payload as CertificateRequestEntity)
    : {} as CertificateRequestEntity;
  return {
    ...payload,
    ...(row.certificate_asset_id ? { certificateAssetId: row.certificate_asset_id } : {}),
    ...(row.application_certificate_policy_version_id
      ? { applicationCertificatePolicyVersionId: row.application_certificate_policy_version_id }
      : {}),
  };
}

function profileVersionFromRow(row: Record<string, unknown>): CertificateProfileVersionEntity {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    versionNo: Number(row.version_no),
    rules: (row.rules ?? {}) as CertificateProfileVersionEntity['rules'],
    createdBy: String(row.created_by),
    createdAt: toIso(row.created_at),
  };
}

function certificatePolicyVersionFromRow(row: Record<string, unknown>): CertificatePolicyVersionEntity {
  return {
    id: String(row.id),
    policyId: String(row.policy_id),
    versionNo: Number(row.version_no),
    rules: (row.rules ?? {}) as CertificatePolicyVersionEntity['rules'],
    createdBy: String(row.created_by),
    createdAt: toIso(row.created_at),
  };
}

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
