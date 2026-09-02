import type { DatabasePort } from '../../../database/database-port.js';
import { newId } from '../../../shared/id.js';
import { AppError } from '../../../common/errors/app-error.js';
import type {
  ApplicationCertificatePolicyEntity,
  ApplicationCertificatePolicyVersionEntity,
} from '../schema/application-certificate-supply.schema.js';
import type { CertificateSupplyCandidateDto } from '../dto/application-certificate-supply.dto.js';

interface ApplicationRow {
  [key: string]: unknown;
  id: string;
  tenant_id: string;
  address: string;
  sni_name?: string | null;
  display_name?: string | null;
  asset_kind: string;
  deleted_at?: string | null;
}

interface PolicyRow {
  [key: string]: unknown;
  id: string;
  tenant_id: string;
  application_asset_id: string;
  current_version_id?: string | null;
  current_dedicated_certificate_asset_id?: string | null;
  created_at: string;
  updated_at: string;
}

interface VersionRow {
  [key: string]: unknown;
  id: string;
  policy_id: string;
  tenant_id: string;
  application_asset_id: string;
  version_no: number;
  is_active: boolean;
  primary_domain: string;
  supply_mode: ApplicationCertificatePolicyVersionEntity['supplyMode'];
  certificate_asset_id?: string | null;
  certificate_version_id?: string | null;
  provider_type?: ApplicationCertificatePolicyVersionEntity['providerType'] | null;
  provider_id?: string | null;
  certificate_authority_id?: string | null;
  acme_provider_profile_id?: string | null;
  dns_provider_id?: string | null;
  credential_ref?: string | null;
  certificate_profile_version_id?: string | null;
  custody_mode?: ApplicationCertificatePolicyVersionEntity['custodyMode'] | null;
  deployment_artifact_mode?: ApplicationCertificatePolicyVersionEntity['deploymentArtifactMode'] | null;
  auto_renew: boolean;
  renewal_window_days?: number | null;
  rotate_key_on_renewal: boolean;
  status: ApplicationCertificatePolicyVersionEntity['status'];
  policy_snapshot: unknown;
  created_at: string;
  updated_at: string;
}

export interface ApplicationCertificateSupplyRepositoryPort {
  getApplication(tenantId: string, applicationAssetId: string): Promise<{ id: string; primaryDomain: string; displayName?: string } | undefined>;
  resolveCustodyCapability(tenantId: string, applicationAssetId: string): Promise<{ mode: 'agent_local' | 'device_local' | 'managed_secret'; evidence: Record<string, unknown> }>;
  getPolicy(tenantId: string, applicationAssetId: string): Promise<{ policy: ApplicationCertificatePolicyEntity; currentVersion?: ApplicationCertificatePolicyVersionEntity } | undefined>;
  listCertificateCandidates(tenantId: string): Promise<CertificateSupplyCandidateDto[]>;
  saveVersion(tenantId: string, applicationAssetId: string, primaryDomain: string, version: Omit<ApplicationCertificatePolicyVersionEntity, 'id' | 'policyId' | 'tenantId' | 'applicationAssetId' | 'versionNo' | 'isActive' | 'primaryDomain' | 'createdAt' | 'updatedAt'>): Promise<{ policy: ApplicationCertificatePolicyEntity; currentVersion: ApplicationCertificatePolicyVersionEntity }>;
  bindVersionCertificate(tenantId: string, applicationAssetId: string, policyVersionId: string, certificateAssetId: string): Promise<ApplicationCertificatePolicyVersionEntity>;
  updateCurrentVersionStatus?(tenantId: string, applicationAssetId: string, status: ApplicationCertificatePolicyVersionEntity['status'], certificateVersionId?: string): Promise<void>;
}

export class ApplicationCertificateSupplyRepository implements ApplicationCertificateSupplyRepositoryPort {
  constructor(private readonly db: DatabasePort) {}

  async getApplication(tenantId: string, applicationAssetId: string): Promise<{ id: string; primaryDomain: string; displayName?: string } | undefined> {
    const row = (await this.db.query<ApplicationRow>(
      `select id, tenant_id, address, sni_name, display_name, asset_kind, deleted_at
         from pg_service_assets
        where tenant_id = $1 and id = $2 and asset_kind = 'APPLICATION' and deleted_at is null`,
      [tenantId, applicationAssetId],
    )).rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      primaryDomain: normalizeDomain(row.sni_name || row.address),
      ...(typeof row.display_name === 'string' && row.display_name.trim() ? { displayName: row.display_name.trim() } : {}),
    };
  }

  async getPolicy(tenantId: string, applicationAssetId: string): Promise<{ policy: ApplicationCertificatePolicyEntity; currentVersion?: ApplicationCertificatePolicyVersionEntity } | undefined> {
    const policyRow = (await this.db.query<PolicyRow>(
      `select * from pg_application_certificate_policies
        where tenant_id = $1 and application_asset_id = $2`,
      [tenantId, applicationAssetId],
    )).rows[0];
    if (!policyRow) return undefined;
    const versionRow = policyRow.current_version_id
      ? (await this.db.query<VersionRow>(
        `select * from pg_application_certificate_policy_versions
          where tenant_id = $1 and policy_id = $2 and id = $3`,
        [tenantId, policyRow.id, policyRow.current_version_id],
      )).rows[0]
      : undefined;
    return {
      policy: toPolicy(policyRow),
      ...(versionRow ? { currentVersion: toVersion(versionRow) } : {}),
    };
  }

  async resolveCustodyCapability(tenantId: string, applicationAssetId: string): Promise<{ mode: 'agent_local' | 'device_local' | 'managed_secret'; evidence: Record<string, unknown> }> {
    const rows = (await this.db.query<Record<string, unknown>>(
      `select target.id, target.managed_target_id, managed.supported_capabilities, managed.execution_locations,
              managed.target_type
         from pg_application_asset_targets target
         join pg_managed_targets managed on managed.id = target.managed_target_id and managed.tenant_id = target.tenant_id
        where target.tenant_id = $1 and target.application_asset_id = $2
          and target.deleted_at is null and managed.deleted_at is null
        order by target.created_at asc`,
      [tenantId, applicationAssetId],
    )).rows;
    const hasCsr = (row: Record<string, unknown>) => jsonStrings(row.supported_capabilities).some((item) => /(?:key\.generate_csr|generate_csr|csr)/i.test(item));
    const locations = (row: Record<string, unknown>) => jsonStrings(row.execution_locations).map((item) => item.toLowerCase());
    const agent = rows.find((row) => hasCsr(row) && locations(row).some((item) => item === 'agent'));
    if (agent) return { mode: 'agent_local', evidence: { targetId: agent.managed_target_id, capability: 'key.generate_csr', executionLocation: 'agent' } };
    const device = rows.find((row) => hasCsr(row) && locations(row).some((item) => item === 'gateway' || item === 'device'));
    if (device) return { mode: 'device_local', evidence: { targetId: device.managed_target_id, capability: 'key.generate_csr', executionLocation: 'gateway' } };
    return { mode: 'managed_secret', evidence: { targetCount: rows.length, reason: rows.length ? 'target_without_local_csr' : 'target_missing' } };
  }

  async listCertificateCandidates(tenantId: string): Promise<CertificateSupplyCandidateDto[]> {
    const rows = (await this.db.query<Record<string, unknown>>(
      `select a.id as certificate_asset_id, a.name, a.primary_domain, a.source_type,
              a.current_version_id, v.id as certificate_version_id, v.common_name,
              v.sans as version_sans, v.issuer, v.not_after, v.deployable, v.status as version_status,
              a.sans as asset_sans, v.version_no
         from pg_certificate_assets a
         join pg_certificate_versions v
           on v.tenant_id = a.tenant_id
          and v.certificate_asset_id = a.id
          and v.status <> 'deleted'
        where a.tenant_id = $1 and a.status <> 'deleted'
          and a.application_asset_id is null
        order by a.created_at asc, a.id asc, (v.id = a.current_version_id) desc,
                 v.version_no desc, v.created_at desc`,
      [tenantId],
    )).rows;
    return rows.map((row) => ({
      certificateAssetId: String(row.certificate_asset_id),
      ...(typeof row.certificate_version_id === 'string' ? { certificateVersionId: row.certificate_version_id } : {}),
      ...(row.version_no !== undefined && row.version_no !== null ? { versionNo: Number(row.version_no) } : {}),
      name: String(row.name),
      primaryDomain: normalizeDomain(String(row.primary_domain)),
      ...(typeof row.common_name === 'string' ? { commonName: row.common_name } : {}),
      sans: jsonStrings(row.version_sans ?? row.asset_sans),
      sourceType: String(row.source_type),
      ...(Object.keys(asRecord(row.issuer)).length > 0 ? { issuer: issuerRecord(row.issuer) } : {}),
      ...(row.not_after ? { notAfter: String(row.not_after) } : {}),
      deployable: row.deployable !== false && row.version_status !== 'revoked' && row.version_status !== 'deleted',
      matchesPrimaryDomain: false,
    }));
  }

  async saveVersion(
    tenantId: string,
    applicationAssetId: string,
    primaryDomain: string,
    input: Omit<ApplicationCertificatePolicyVersionEntity, 'id' | 'policyId' | 'tenantId' | 'applicationAssetId' | 'versionNo' | 'isActive' | 'primaryDomain' | 'createdAt' | 'updatedAt'>,
  ): Promise<{ policy: ApplicationCertificatePolicyEntity; currentVersion: ApplicationCertificatePolicyVersionEntity }> {
    const application = await this.getApplication(tenantId, applicationAssetId);
    if (!application) throw new AppError('RESOURCE_NOT_FOUND', 'Application 不存在', { applicationAssetId });
    return this.db.transaction(async (tx) => {
      const repo = new ApplicationCertificateSupplyRepository(tx);
      let existing = await repo.getPolicy(tenantId, applicationAssetId);
      const now = new Date().toISOString();
      let policy: ApplicationCertificatePolicyEntity;
      if (!existing) {
        policy = { id: newId('acp'), tenantId, applicationAssetId, createdAt: now, updatedAt: now };
        await tx.query(
          `insert into pg_application_certificate_policies
             (id, tenant_id, application_asset_id, created_at, updated_at)
           values ($1, $2, $3, $4::timestamptz, $4::timestamptz)`,
          [policy.id, tenantId, applicationAssetId, now],
        );
        existing = { policy };
      } else {
        policy = existing.policy;
      }
      const max = (await tx.query<{ max_version: number | null }>(
        `select max(version_no)::int as max_version
           from pg_application_certificate_policy_versions
          where tenant_id = $1 and policy_id = $2`,
        [tenantId, policy.id],
      )).rows[0]?.max_version ?? 0;
      const version: ApplicationCertificatePolicyVersionEntity = {
        ...input,
        id: newId('acpv'),
        policyId: policy.id,
        tenantId,
        applicationAssetId,
        versionNo: max + 1,
        isActive: true,
        primaryDomain: normalizeDomain(primaryDomain),
        createdAt: now,
        updatedAt: now,
      };
      await tx.query(
        `update pg_application_certificate_policy_versions
            set is_active = false, updated_at = $3::timestamptz
          where tenant_id = $1 and policy_id = $2 and is_active`,
        [tenantId, policy.id, now],
      );
      await tx.query(
        `insert into pg_application_certificate_policy_versions (
           id, policy_id, tenant_id, application_asset_id, version_no, is_active,
           primary_domain, supply_mode, certificate_asset_id, certificate_version_id,
           provider_type, provider_id, certificate_authority_id, acme_provider_profile_id,
           dns_provider_id, credential_ref, certificate_profile_version_id, custody_mode,
           deployment_artifact_mode, auto_renew, renewal_window_days, rotate_key_on_renewal,
           status, policy_snapshot, created_at, updated_at
         ) values ($1,$2,$3,$4,$5,true,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::jsonb,$24::timestamptz,$24::timestamptz)`,
        [version.id, version.policyId, tenantId, applicationAssetId, version.versionNo, version.primaryDomain,
          version.supplyMode, version.certificateAssetId ?? null, version.certificateVersionId ?? null,
          version.providerType ?? null, version.providerId ?? null, version.certificateAuthorityId ?? null,
          version.acmeProviderProfileId ?? null, version.dnsProviderId ?? null, version.credentialRef ?? null,
          version.certificateProfileVersionId ?? null, version.custodyMode ?? null, version.deploymentArtifactMode ?? null,
          version.autoRenew, version.renewalWindowDays ?? null, version.rotateKeyOnRenewal,
          version.status, JSON.stringify(version.policySnapshot), now],
      );
      const nextPolicy = {
        ...policy,
        currentVersionId: version.id,
        currentDedicatedCertificateAssetId: version.supplyMode === 'dedicated' ? version.certificateAssetId : undefined,
        updatedAt: now,
      };
      await tx.query(
        `update pg_application_certificate_policies
            set current_version_id = $3, current_dedicated_certificate_asset_id = $4,
                updated_at = $5::timestamptz
          where tenant_id = $1 and application_asset_id = $2`,
        [tenantId, applicationAssetId, version.id, nextPolicy.currentDedicatedCertificateAssetId ?? null, now],
      );
      return { policy: nextPolicy, currentVersion: version };
    });
  }

  async bindVersionCertificate(tenantId: string, applicationAssetId: string, policyVersionId: string, certificateAssetId: string): Promise<ApplicationCertificatePolicyVersionEntity> {
    const now = new Date().toISOString();
    return this.db.transaction(async (tx) => {
      const asset = (await tx.query<{ id: string; application_asset_id?: string | null }>(
        `select id, application_asset_id
           from pg_certificate_assets
          where tenant_id = $1 and id = $2 and status <> 'deleted'`,
        [tenantId, certificateAssetId],
      )).rows[0];
      if (!asset || asset.application_asset_id !== applicationAssetId) {
        throw new AppError('DEDICATED_CERTIFICATE_OWNERSHIP_CONFLICT', '证书资产不属于当前应用，禁止绑定', { certificateAssetId, applicationAssetId });
      }
      const result = await tx.query<VersionRow>(
        `update pg_application_certificate_policy_versions
            set certificate_asset_id = $4, updated_at = $5::timestamptz
          where tenant_id = $1 and application_asset_id = $2 and id = $3
            and is_active = true and supply_mode = 'dedicated'
          returning *`,
        [tenantId, applicationAssetId, policyVersionId, certificateAssetId, now],
      );
      const row = result.rows[0];
      if (!row) throw new AppError('RESOURCE_NOT_FOUND', '应用证书策略版本不存在或不是活动专属版本', { policyVersionId });
      await tx.query(
        `update pg_application_certificate_policies
            set current_dedicated_certificate_asset_id = $3, updated_at = $4::timestamptz
          where tenant_id = $1 and application_asset_id = $2 and current_version_id = $5`,
        [tenantId, applicationAssetId, certificateAssetId, now, policyVersionId],
      );
      return toVersion(row);
    });
  }

  async updateCurrentVersionStatus(tenantId: string, applicationAssetId: string, status: ApplicationCertificatePolicyVersionEntity['status'], certificateVersionId?: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.query(
      `update pg_application_certificate_policy_versions
          set status = $3,
              certificate_version_id = coalesce($4, certificate_version_id),
              updated_at = $5::timestamptz
        where tenant_id = $1 and application_asset_id = $2 and is_active = true and supply_mode = 'dedicated'`,
      [tenantId, applicationAssetId, status, certificateVersionId ?? null, now],
    );
  }
}

function toPolicy(row: PolicyRow): ApplicationCertificatePolicyEntity {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    applicationAssetId: row.application_asset_id,
    ...(row.current_version_id ? { currentVersionId: row.current_version_id } : {}),
    ...(row.current_dedicated_certificate_asset_id ? { currentDedicatedCertificateAssetId: row.current_dedicated_certificate_asset_id } : {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toVersion(row: VersionRow): ApplicationCertificatePolicyVersionEntity {
  return {
    id: row.id,
    policyId: row.policy_id,
    tenantId: row.tenant_id,
    applicationAssetId: row.application_asset_id,
    versionNo: Number(row.version_no),
    isActive: Boolean(row.is_active),
    primaryDomain: row.primary_domain,
    supplyMode: row.supply_mode,
    ...(row.certificate_asset_id ? { certificateAssetId: row.certificate_asset_id } : {}),
    ...(row.certificate_version_id ? { certificateVersionId: row.certificate_version_id } : {}),
    ...(row.provider_type ? { providerType: row.provider_type } : {}),
    ...(row.provider_id ? { providerId: row.provider_id } : {}),
    ...(row.certificate_authority_id ? { certificateAuthorityId: row.certificate_authority_id } : {}),
    ...(row.acme_provider_profile_id ? { acmeProviderProfileId: row.acme_provider_profile_id } : {}),
    ...(row.dns_provider_id ? { dnsProviderId: row.dns_provider_id } : {}),
    ...(row.credential_ref ? { credentialRef: row.credential_ref } : {}),
    ...(row.certificate_profile_version_id ? { certificateProfileVersionId: row.certificate_profile_version_id } : {}),
    ...(row.custody_mode ? { custodyMode: row.custody_mode } : {}),
    ...(row.deployment_artifact_mode ? { deploymentArtifactMode: row.deployment_artifact_mode } : {}),
    autoRenew: Boolean(row.auto_renew),
    ...(row.renewal_window_days !== null && row.renewal_window_days !== undefined ? { renewalWindowDays: Number(row.renewal_window_days) } : {}),
    rotateKeyOnRenewal: Boolean(row.rotate_key_on_renewal),
    status: row.status,
    policySnapshot: asRecord(row.policy_snapshot),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '');
}

function jsonStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string').map(normalizeDomain);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function issuerRecord(value: unknown): NonNullable<CertificateSupplyCandidateDto['issuer']> {
  const issuer = asRecord(value);
  const text = (key: string): string | undefined => typeof issuer[key] === 'string' && issuer[key].trim() ? issuer[key].trim() : undefined;
  return {
    ...(text('raw') ? { raw: text('raw') } : {}),
    ...(text('commonName') ?? text('common_name') ?? text('CN') ? { commonName: text('commonName') ?? text('common_name') ?? text('CN') } : {}),
    ...(text('organization') ?? text('O') ? { organization: text('organization') ?? text('O') } : {}),
    ...(text('organizationalUnit') ?? text('organizational_unit') ?? text('OU') ? { organizationalUnit: text('organizationalUnit') ?? text('organizational_unit') ?? text('OU') } : {}),
    ...(text('country') ?? text('C') ? { country: text('country') ?? text('C') } : {}),
    ...(text('state') ?? text('ST') ? { state: text('state') ?? text('ST') } : {}),
    ...(text('locality') ?? text('L') ? { locality: text('locality') ?? text('L') } : {}),
  };
}
