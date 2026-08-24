import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { normalizeFingerprint, resolveCertificateVersionId } from '../discovery/certificate-version-matcher.js';

export interface PluginCertificateDeploymentResultV1 {
  apiVersion: 'gcac.certificate-deploy-result/v1';
  bindingStableKey: string;
  status: 'VERIFIED' | 'FAILED' | 'ROLLED_BACK';
  observedFingerprintSha256?: string;
  certificateVersionId?: string;
  /** 正式部署成功时记录本次计划的目标版本；回滚不应覆盖原目标。 */
  desiredCertificateVersionId?: string;
  rollbackCertificateVersionId?: string;
  verifiedAt: string;
  evidence?: Record<string, unknown>;
}

export class PluginCertificateResultService {
  constructor(private readonly db: DatabasePort) {}

  async reconcileDiscovery(tenantId: string, deviceAssetId: string): Promise<{ linked: number; incomplete: number; drifted: number }> {
    const certificates = await this.db.query<{
      id: string;
      fingerprint_sha256: string | null;
      subject: string | null;
      issuer: string | null;
      not_before: string | null;
      not_after: string | null;
    }>(
      `select id, fingerprint_sha256, subject, issuer, not_before, not_after
         from plugin_discovered_certificates
        where tenant_id=$1 and device_asset_id=$2 and status=$3`,
      [tenantId, deviceAssetId, 'ACTIVE'],
    );
    let linked = 0;
    let incomplete = 0;
    for (const certificate of certificates.rows) {
      const fingerprint = normalizeFingerprint(certificate.fingerprint_sha256);
      const versionId = await resolveCertificateVersionId(this.db, tenantId, {
        fingerprintSha256: certificate.fingerprint_sha256,
        subject: certificate.subject,
        issuer: certificate.issuer,
        notBefore: certificate.not_before,
        notAfter: certificate.not_after,
      });
      if (!versionId && !fingerprint) incomplete += 1;
      await this.db.query('update plugin_discovered_certificates set certificate_version_id=$1 where id=$2', [versionId ?? null, certificate.id]);
      if (versionId) linked += 1;
    }
    await this.db.query(
      `update plugin_discovered_certificate_bindings binding
       set current_certificate_version_id=certificate.certificate_version_id,
           observed_fingerprint_sha256=certificate.fingerprint_sha256,
           desired_fingerprint_sha256=(select desired.fingerprint_sha256 from pg_certificate_versions desired where desired.id=binding.desired_certificate_version_id),
           drift_state=case
             when certificate.fingerprint_sha256 is null and certificate.certificate_version_id is null then 'INCOMPLETE'
             when certificate.certificate_version_id is null then 'UNMANAGED'
             when binding.desired_certificate_version_id is null then 'UNKNOWN'
             when certificate.fingerprint_sha256 is null then 'UNKNOWN'
             when upper(certificate.fingerprint_sha256)=upper((select desired.fingerprint_sha256 from pg_certificate_versions desired where desired.id=binding.desired_certificate_version_id)) then 'SYNCED'
             else 'DRIFTED'
           end,
           updated_at=now()
       from plugin_discovered_certificates certificate
       where binding.tenant_id=$1 and binding.device_asset_id=$2
         and certificate.id=binding.discovered_certificate_id`,
      [tenantId, deviceAssetId],
    );
    const drifted = Number((await this.db.query<{ count: string }>(
      "select count(*)::text as count from plugin_discovered_certificate_bindings where tenant_id=$1 and device_asset_id=$2 and drift_state='DRIFTED'",
      [tenantId, deviceAssetId],
    )).rows[0]?.count ?? 0);
    return { linked, incomplete, drifted };
  }

  async setDesiredVersion(tenantId: string, deviceAssetId: string, bindingStableKey: string, certificateVersionId: string): Promise<void> {
    const result = await this.db.query<{ id: string }>(
      `update plugin_discovered_certificate_bindings set desired_certificate_version_id=$1, updated_at=now()
       where tenant_id=$2 and device_asset_id=$3 and stable_key=$4 returning id`,
      [certificateVersionId, tenantId, deviceAssetId, bindingStableKey],
    );
    if (result.rows.length === 0) throw new AppError('RESOURCE_NOT_FOUND', '插件证书绑定不存在', { bindingStableKey });
    await this.reconcileDiscovery(tenantId, deviceAssetId);
  }

  async applyDeploymentResult(tenantId: string, deviceAssetId: string, result: PluginCertificateDeploymentResultV1): Promise<void> {
    if (result.apiVersion !== 'gcac.certificate-deploy-result/v1') throw new AppError('VALIDATION_FAILED', '证书部署结果版本不支持');
    if (result.status === 'FAILED') return;
    const fingerprint = normalizeFingerprint(result.observedFingerprintSha256);
    if (!fingerprint) throw new AppError('VALIDATION_FAILED', '最终验证结果缺少 SHA-256 指纹');
    const versionId = result.status === 'ROLLED_BACK' ? result.rollbackCertificateVersionId : result.certificateVersionId;
    if (!versionId) throw new AppError('VALIDATION_FAILED', '最终验证结果缺少证书版本');
    const version = (await this.db.query<{ fingerprint_sha256: string }>(
      'select fingerprint_sha256 from pg_certificate_versions where id=$1', [versionId],
    )).rows[0];
    if (!version || normalizeFingerprint(version.fingerprint_sha256) !== fingerprint) {
      throw new AppError('VALIDATION_FAILED', '最终验证指纹与证书版本不一致');
    }
    const updated = await this.db.query<{ id: string }>(
      `update plugin_discovered_certificate_bindings
       set current_certificate_version_id=$1,
           desired_certificate_version_id=case
             when $7='VERIFIED' then coalesce($6, desired_certificate_version_id)
             else desired_certificate_version_id
           end,
           observed_fingerprint_sha256=$2,
           drift_state=case when coalesce($6, desired_certificate_version_id)=$1 then 'SYNCED' else 'DRIFTED' end,
           last_verified_at=$3, last_deployed_at=$3, updated_at=$3
       where tenant_id=$4 and device_asset_id=$5 and stable_key=$8 returning id`,
      [versionId, fingerprint, result.verifiedAt, tenantId, deviceAssetId, result.desiredCertificateVersionId, result.status, result.bindingStableKey],
    );
    if (updated.rows.length === 0) throw new AppError('RESOURCE_NOT_FOUND', '插件证书绑定不存在', { bindingStableKey: result.bindingStableKey });
  }
}
