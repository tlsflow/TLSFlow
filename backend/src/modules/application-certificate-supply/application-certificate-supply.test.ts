import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { ApplicationCertificateSupplyApplicationService } from './application/application-certificate-supply.application-service.js';
import { ApplicationCertificateSupplyRepository } from './repository/application-certificate-supply.repository.js';
import { CertificatesApplicationService } from '../certificates/application/certificates.application-service.js';
import { InternalCaApplicationService } from '../internal-ca/application/internal-ca.application-service.js';
import { createPersistedSecurityServices } from '../security/security-services.persistence.js';

const tenantA = 'tenant-supply-a';
const tenantB = 'tenant-supply-b';

async function fixture() {
  const db = new PgliteDatabase();
  await runMigrations(db);
  await db.exec(`
    insert into pg_service_assets (id, tenant_id, address, address_type, port, protocol, discovery_source, status, asset_kind)
    values ('app-supply-a', '${tenantA}', 'app.example.test', 'DNS', 443, 'HTTPS', 'MANUAL', 'ACTIVE', 'APPLICATION'),
           ('app-supply-b', '${tenantB}', 'app.example.test', 'DNS', 443, 'HTTPS', 'MANUAL', 'ACTIVE', 'APPLICATION');
    insert into pg_certificate_assets (id, tenant_id, name, primary_domain, sans, source_type, current_version_id, status, created_by)
    values ('cert-supply-a', '${tenantA}', 'app certificate', 'other.example.test', '["app.example.test"]', 'manual', 'version-supply-a', 'active', 'test');
    insert into pg_certificate_versions (id, tenant_id, certificate_asset_id, version_no, common_name, sans, issuer, subject, serial_number, not_before, not_after, fingerprint_sha256, public_key_algorithm, signature_algorithm, leaf_storage_ref, chain_status, deployable, source_type, status, created_by)
    values ('version-supply-a', '${tenantA}', 'cert-supply-a', 1, 'other.example.test', '["app.example.test"]', '{}', '{}', '01', now(), now() + interval '365 days', repeat('a', 64), 'rsa', 'sha256', 'artifact://cert-supply-a', 'valid', true, 'manual', 'active', 'test');
  `);
  const service = new ApplicationCertificateSupplyApplicationService(new ApplicationCertificateSupplyRepository(db), {
    listProviders: async () => [],
    listAuthorities: async () => [],
    listProfiles: async () => [],
    listAcmeProviderProfiles: () => [],
  });
  return { db, service };
}

describe('应用证书供应策略', () => {
  it('按应用域名匹配 CN/SAN，并且 Preview 不产生策略写入', async () => {
    const { db, service } = await fixture();
    const preview = await service.preview(tenantA, 'app-supply-a', { supplyMode: 'manual', certificateVersionId: 'version-supply-a' });
    assert.equal(preview.certificateCandidates.length, 1);
    assert.equal(preview.certificateCandidates[0]?.matchesPrimaryDomain, true);
    assert.equal(preview.readiness.canDeploy, true);
    const policies = await db.query<{ count: string }>('select count(*)::text as count from pg_application_certificate_policies');
    assert.equal(policies.rows[0]?.count, '0');
  });

  it('保存版本后固定应用、证书资产和证书版本的不同 ID 语义，并隔离租户', async () => {
    const { service } = await fixture();
    const saved = await service.update(tenantA, 'app-supply-a', { supplyMode: 'manual', certificateAssetId: 'cert-supply-a', certificateVersionId: 'version-supply-a' }, 'operator');
    assert.equal(saved.policy?.applicationAssetId, 'app-supply-a');
    assert.equal(saved.currentVersion?.certificateAssetId, 'cert-supply-a');
    assert.equal(saved.currentVersion?.certificateVersionId, 'version-supply-a');
    assert.notEqual(saved.policy?.applicationAssetId, saved.currentVersion?.certificateAssetId);
    await assert.rejects(() => service.get(tenantB, 'app-supply-a'), /Application 不存在/);
  });

  it('手动候选返回同一证书资产的全部可部署版本', async () => {
    const { db, service } = await fixture();
    await db.exec(`
      insert into pg_certificate_versions (id, tenant_id, certificate_asset_id, version_no, common_name, sans, issuer, subject, serial_number, not_before, not_after, fingerprint_sha256, public_key_algorithm, signature_algorithm, leaf_storage_ref, chain_status, deployable, source_type, status, created_by)
      values ('version-supply-a-2', '${tenantA}', 'cert-supply-a', 2, 'other.example.test', '["app.example.test"]', '{}', '{}', '02', now(), now() + interval '730 days', repeat('b', 64), 'rsa', 'sha256', 'artifact://cert-supply-a-2', 'valid', true, 'manual', 'active', 'test');
    `);
    const response = await service.get(tenantA, 'app-supply-a');
    assert.deepEqual(new Set(response.certificateCandidates.map((item) => item.certificateVersionId)), new Set(['version-supply-a-2', 'version-supply-a']));
  });

  it('保留手动证书的租户域名唯一性，同时允许不同应用拥有同域名专属资产', async () => {
    const { db } = await fixture();
    await db.exec(`
      insert into pg_certificate_assets (id, tenant_id, application_asset_id, name, primary_domain, source_type, status, created_by)
      values ('dedicated-a', '${tenantA}', 'app-supply-a', 'dedicated-a', 'app.example.test', 'internal_ca', 'active', 'test'),
             ('dedicated-b', '${tenantA}', 'app-supply-b', 'dedicated-b', 'app.example.test', 'acme', 'active', 'test');
    `);
    const rows = await db.query<{ count: string }>(`select count(*)::text as count from pg_certificate_assets where tenant_id = '${tenantA}' and application_asset_id is not null`);
    assert.equal(rows.rows[0]?.count, '2');
  });

  it('专属策略创建独立证书资产和固定申请归属，且不把应用 ID 当作证书资产 ID', async () => {
    const db = new PgliteDatabase();
    await runMigrations(db);
    await db.exec(`
      insert into pg_service_assets (id, tenant_id, address, address_type, port, protocol, discovery_source, status, asset_kind)
      values ('app-dedicated-a', '${tenantA}', 'dedicated.example.test', 'DNS', 443, 'HTTPS', 'MANUAL', 'ACTIVE', 'APPLICATION');
    `);
    const security = createPersistedSecurityServices(db).services;
    const certificates = new CertificatesApplicationService({ db, secrets: security.secrets });
    const internalCa = new InternalCaApplicationService({ db, secrets: security.secrets, certificates });
    const provider = await internalCa.createProvider(tenantA, {
      name: 'builtin', type: 'gcac_builtin', deploymentMode: 'builtin', runtimePlatform: 'embedded',
      availabilityMode: 'single',
    }, 'operator');
    const authorityInput = {
      providerId: provider.id, name: 'dedicated-ca', securityDomain: 'dedicated', topologyMode: 'root_only',
      deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single', keyBackend: 'secret',
      confirmationToken: '', actorId: 'operator',
    } as const;
    const authorityList = await internalCa.createAuthority(tenantA, {
      ...authorityInput,
      confirmationToken: internalCa.previewAuthority(authorityInput).confirmationToken,
    });
    const authority = authorityList[0]!;
    const profile = await internalCa.createProfile(tenantA, { name: 'dedicated-profile', securityDomain: 'dedicated', actorId: 'operator' });
    const profileVersion = (await internalCa.listProfiles(tenantA)).find((item) => item.profile.id === profile.profile.id)?.versions[0];
    assert.ok(profileVersion);
    const service = new ApplicationCertificateSupplyApplicationService(
      new ApplicationCertificateSupplyRepository(db), internalCa, certificates, internalCa,
    );
    const saved = await service.update(tenantA, 'app-dedicated-a', {
      supplyMode: 'dedicated', providerType: 'internal_ca', providerId: provider.id,
      certificateAuthorityId: authority.id, certificateProfileVersionId: profileVersion!.id,
      status: 'provisioning',
    }, 'operator');
    const certificateAssetId = saved.currentVersion?.certificateAssetId;
    assert.ok(certificateAssetId);
    assert.notEqual(certificateAssetId, 'app-dedicated-a');
    const asset = await certificates.getRepository().getAsset(certificateAssetId!, tenantA);
    assert.equal(asset?.applicationAssetId, 'app-dedicated-a');
    const requests = await internalCa.listRequests(tenantA);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.applicationAssetId, 'app-dedicated-a');
    assert.equal(requests[0]?.certificateAssetId, certificateAssetId);
    assert.equal(requests[0]?.applicationCertificatePolicyVersionId, saved.currentVersion?.id);
    const row = await db.query<{ certificate_asset_id: string; application_certificate_policy_version_id: string }>(
      'select certificate_asset_id, application_certificate_policy_version_id from pg_certificate_requests where id = $1',
      [requests[0]!.id],
    );
    assert.equal(row.rows[0]?.certificate_asset_id, certificateAssetId);
    assert.equal(row.rows[0]?.application_certificate_policy_version_id, saved.currentVersion?.id);
  });
});
