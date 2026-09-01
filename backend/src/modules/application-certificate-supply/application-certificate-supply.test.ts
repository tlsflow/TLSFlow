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

  it('手动候选按证书域名和颁发者仅返回到期时间最新的版本', async () => {
    const { db, service } = await fixture();
    await db.exec(`
      insert into pg_certificate_versions (id, tenant_id, certificate_asset_id, version_no, common_name, sans, issuer, subject, serial_number, not_before, not_after, fingerprint_sha256, public_key_algorithm, signature_algorithm, leaf_storage_ref, chain_status, deployable, source_type, status, created_by)
      values ('version-supply-a-2', '${tenantA}', 'cert-supply-a', 2, 'other.example.test', '["app.example.test"]', '{}', '{}', '02', now(), now() + interval '730 days', repeat('b', 64), 'rsa', 'sha256', 'artifact://cert-supply-a-2', 'valid', true, 'manual', 'active', 'test');
    `);
    const response = await service.get(tenantA, 'app-supply-a');
    assert.deepEqual(new Set(response.certificateCandidates.map((item) => item.certificateVersionId)), new Set(['version-supply-a-2']));
  });

  it('应用主域名变化时创建新策略版本并清除失配手动证书引用', async () => {
    const saved: any[] = [];
    const repository = {
      getApplication: async () => ({ id: 'app-domain-change', primaryDomain: 'new.example.test' }),
      getPolicy: async () => saved.length === 0
        ? {
            policy: { id: 'policy-domain-change', tenantId: tenantA, applicationAssetId: 'app-domain-change', createdAt: 'now', updatedAt: 'now' },
            currentVersion: {
              id: 'version-domain-change', policyId: 'policy-domain-change', tenantId: tenantA, applicationAssetId: 'app-domain-change',
              versionNo: 1, isActive: true, primaryDomain: 'old.example.test', supplyMode: 'manual',
              certificateAssetId: 'old-cert', certificateVersionId: 'old-version', autoRenew: false,
              rotateKeyOnRenewal: false, status: 'deployed', policySnapshot: {}, createdAt: 'now', updatedAt: 'now',
            },
          }
        : { policy: { id: 'policy-domain-change', tenantId: tenantA, applicationAssetId: 'app-domain-change', createdAt: 'now', updatedAt: 'now' }, currentVersion: saved.at(-1) },
      listCertificateCandidates: async () => [],
      resolveCustodyCapability: async () => ({ mode: 'managed_secret', evidence: {} }),
      saveVersion: async (_tenantId: string, applicationAssetId: string, primaryDomain: string, input: any) => {
        const version = {
          ...input, id: 'version-domain-change-2', policyId: 'policy-domain-change', tenantId: tenantA,
          applicationAssetId, versionNo: 2, isActive: true, primaryDomain, createdAt: 'now', updatedAt: 'now',
        };
        saved.push(version);
        return {
          policy: { id: 'policy-domain-change', tenantId: tenantA, applicationAssetId, createdAt: 'now', updatedAt: 'now' },
          currentVersion: version,
        };
      },
    };
    const service = new ApplicationCertificateSupplyApplicationService(repository as never);
    const response = await service.onApplicationDomainChanged(tenantA, 'app-domain-change', 'new.example.test', 'operator');
    assert.equal(response?.currentVersion?.versionNo, 2);
    assert.equal(response?.currentVersion?.primaryDomain, 'new.example.test');
    assert.equal(response?.currentVersion?.certificateAssetId, undefined);
    assert.equal(response?.currentVersion?.certificateVersionId, undefined);
    assert.equal(response?.currentVersion?.status, 'draft');
  });

  it('手动候选不包含其他应用的专属证书资产', async () => {
    const { db, service } = await fixture();
    await db.exec(`
      insert into pg_certificate_assets (id, tenant_id, application_asset_id, name, primary_domain, sans, source_type, status, created_by)
      values ('dedicated-hidden', '${tenantA}', 'other-app', 'dedicated-hidden', 'app.example.test', '[]', 'internal_ca', 'active', 'test');
      insert into pg_certificate_versions (id, tenant_id, certificate_asset_id, version_no, common_name, sans, issuer, subject, serial_number, not_before, not_after, fingerprint_sha256, public_key_algorithm, signature_algorithm, leaf_storage_ref, chain_status, deployable, source_type, status, created_by)
      values ('version-hidden', '${tenantA}', 'dedicated-hidden', 1, 'app.example.test', '[]', '{}', '{}', '03', now(), now() + interval '365 days', repeat('c', 64), 'rsa', 'sha256', 'artifact://hidden', 'valid', true, 'internal_ca', 'active', 'test');
    `);
    const response = await service.get(tenantA, 'app-supply-a');
    assert.equal(response.certificateCandidates.some((item) => item.certificateAssetId === 'dedicated-hidden'), false);
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
      insert into pg_managed_targets (id, tenant_id, service_asset_id, target_type, target_key, discovery_provider_key, supported_capabilities, execution_locations, created_at, updated_at)
      values ('target-dedicated-a', '${tenantA}', 'app-dedicated-a', 'server.test', 'dedicated.example.test', 'test', '[\"key.generate_csr\",\"certificate.install_issued\"]', '[\"agent\"]', now(), now());
      insert into pg_application_asset_targets (id, tenant_id, application_asset_id, managed_target_id, status, created_at, updated_at)
      values ('link-dedicated-a', '${tenantA}', 'app-dedicated-a', 'target-dedicated-a', 'ACTIVE', now(), now());
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
    const enqueued: any[] = [];
    const service = new ApplicationCertificateSupplyApplicationService(
      new ApplicationCertificateSupplyRepository(db), internalCa, certificates, internalCa, undefined,
      { enqueue: async (input: any) => { enqueued.push(input); return { id: 'task-cert-issue', ...input }; } },
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
    assert.notEqual(requests[0]?.status, 'pending_approval');
    assert.equal(requests[0]?.approvalId, undefined);
    const row = await db.query<{ certificate_asset_id: string; application_certificate_policy_version_id: string }>(
      'select certificate_asset_id, application_certificate_policy_version_id from pg_certificate_requests where id = $1',
      [requests[0]!.id],
    );
    assert.equal(row.rows[0]?.certificate_asset_id, certificateAssetId);
    assert.equal(row.rows[0]?.application_certificate_policy_version_id, saved.currentVersion?.id);
    assert.equal(enqueued.length, 1);
    assert.equal(enqueued[0]?.taskType, 'CERTIFICATE_ISSUE');
    assert.equal(enqueued[0]?.payload?.certificateRequestId, requests[0]?.id);
  });

  it('完整专属配置默认只保存 draft，不创建证书资产或申请', async () => {
    let createAssetCalls = 0;
    let createRequestCalls = 0;
    let savedVersion: any;
    const repository = {
      getApplication: async () => ({ id: 'app-draft', primaryDomain: 'draft.example.test' }),
      listCertificateCandidates: async () => [],
      resolveCustodyCapability: async () => ({ mode: 'agent_local', evidence: { targetId: 'agent-1' } }),
      getPolicy: async () => undefined,
      saveVersion: async (_tenantId: string, applicationAssetId: string, primaryDomain: string, input: any) => {
        savedVersion = { ...input, id: 'policy-version-draft', policyId: 'policy-draft', tenantId: 'tenant-draft', applicationAssetId, versionNo: 1, isActive: true, primaryDomain, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        return { policy: { id: 'policy-draft', tenantId: 'tenant-draft', applicationAssetId, createdAt: savedVersion.createdAt, updatedAt: savedVersion.updatedAt }, currentVersion: savedVersion };
      },
    };
    const service = new ApplicationCertificateSupplyApplicationService(repository as never, {
      listProviders: async () => [{ id: 'provider-1', name: 'Internal CA', type: 'gcac_builtin', status: 'active' }],
      listAuthorities: async () => [{ id: 'ca-1', name: 'CA', providerId: 'provider-1', status: 'active' }],
      listProfiles: async () => [{ profile: { id: 'profile-1', name: 'Profile', currentVersion: 1 }, versions: [{ id: 'profile-version-1', versionNo: 1 }] }],
      listAcmeProviderProfiles: () => [],
    } as never, { createAsset: async () => { createAssetCalls += 1; throw new Error('不应创建证书资产'); } } as never, {
      createCertificateRequest: async () => { createRequestCalls += 1; throw new Error('不应创建证书申请'); },
      ensureAcmeIssuanceContext: async () => { throw new Error('不应创建 ACME 上下文'); },
    } as never);

    const response = await service.update('tenant-draft', 'app-draft', { supplyMode: 'dedicated', providerType: 'internal_ca', providerId: 'provider-1', certificateAuthorityId: 'ca-1', certificateProfileVersionId: 'profile-version-1' }, 'operator');
    assert.equal(savedVersion.status, 'draft');
    assert.equal(response.currentVersion?.status, 'draft');
    assert.equal(response.currentVersion?.certificateAssetId, undefined);
    assert.equal(createAssetCalls, 0);
    assert.equal(createRequestCalls, 0);
  });

  it('专属 ACME provisioning 固定应用/证书资产/策略版本归属并保存 DNS SecretRef', async () => {
    const savedVersions: any[] = [];
    const requests: any[] = [];
    const policies: any[] = [];
    const scheduled: any[] = [];
    const repository = {
      getApplication: async () => ({ id: 'app-acme', primaryDomain: 'acme.example.test' }),
      listCertificateCandidates: async () => [],
      resolveCustodyCapability: async () => ({ mode: 'agent_local', evidence: { targetId: 'agent-acme', capability: 'key.generate_csr' } }),
      getPolicy: async () => savedVersions.length > 0
        ? {
            policy: { id: 'app-policy', tenantId: tenantA, applicationAssetId: 'app-acme', createdAt: '2026-08-28T00:00:00.000Z', updatedAt: '2026-08-28T00:00:00.000Z' },
            currentVersion: savedVersions.at(-1),
          }
        : undefined,
      saveVersion: async (_tenantId: string, applicationAssetId: string, primaryDomain: string, input: any) => {
        const version = {
          ...input, id: 'policy-version-acme', policyId: 'app-policy', tenantId: tenantA, applicationAssetId,
          versionNo: 1, isActive: true, primaryDomain, createdAt: '2026-08-28T00:00:00.000Z', updatedAt: '2026-08-28T00:00:00.000Z',
        };
        savedVersions.push(version);
        return { policy: { id: 'app-policy', tenantId: tenantA, applicationAssetId, createdAt: version.createdAt, updatedAt: version.updatedAt }, currentVersion: version };
      },
      bindVersionCertificate: async (_tenantId: string, _applicationAssetId: string, policyVersionId: string, certificateAssetId: string) => {
        const version = { ...savedVersions.at(-1), id: policyVersionId, certificateAssetId };
        savedVersions[savedVersions.length - 1] = version;
        return version;
      },
    };
    const service = new ApplicationCertificateSupplyApplicationService(repository as never, {
      listProviders: async () => [
        { id: 'acme-provider', name: 'ACME', type: 'acme', status: 'active' },
      ],
      listAuthorities: async () => [],
      listProfiles: async () => [],
      listAcmeProviderProfiles: () => [{ key: 'profile', displayName: 'Profile', version: '1' }],
    } as never, {
      createAsset: async (input: any) => ({
        id: 'dedicated-cert-acme', tenantId: input.tenantId, applicationAssetId: input.applicationAssetId, name: input.name,
        primaryDomain: input.primaryDomain, sans: input.sans ?? [], sourceType: 'acme', status: 'active', tags: input.tags ?? [],
        createdBy: input.createdBy, createdAt: '2026-08-28T00:00:00.000Z', updatedAt: '2026-08-28T00:00:00.000Z',
      }),
    } as never, {
      ensureAcmeIssuanceContext: async () => ({ caId: 'ca-acme', profileVersionId: 'profile-acme', trustDomainId: 'trust-acme' }),
      createCertificateRequest: async (_tenantId: string, input: any) => { requests.push(input); return { id: 'request-acme', ...input }; },
    } as never);
    service.setAcmeRenewalIntegration({
      list: async () => policies,
      create: async (input: any) => { policies.push({ id: 'renewal-policy-acme', status: 'active', ...input }); return policies.at(-1); },
      update: async () => policies.at(-1),
    } as never, {
      listAccounts: async () => [{ id: 'account-acme', status: 'active', contact: ['mailto:ops@example.test'] }],
    } as never, {
      scheduleInitialIssuance: async (tenantId: string, certificateAssetId: string) => {
        scheduled.push({ tenantId, certificateAssetId });
        return { id: 'renewal-job-acme' };
      },
    } as never);

    const response = await service.update(tenantA, 'app-acme', {
      supplyMode: 'dedicated', providerType: 'acme', providerId: 'acme-provider',
      acmeProviderProfileId: 'profile', dnsProviderId: 'alidns', credentialRef: 'secret://password/dns-acme#current',
      status: 'provisioning',
    }, 'operator');

    assert.equal(requests.length, 1);
    assert.equal(requests[0].applicationAssetId, 'app-acme');
    assert.equal(requests[0].certificateAssetId, 'dedicated-cert-acme');
    assert.equal(requests[0].applicationCertificatePolicyVersionId, 'policy-version-acme');
    assert.equal(requests[0].idempotencyKey, 'acme-initial-request:dedicated-cert-acme');
    assert.equal(policies.length, 1);
    assert.equal(policies[0].applicationAssetId, 'app-acme');
    assert.equal(policies[0].applicationCertificatePolicyVersionId, 'policy-version-acme');
    assert.equal(policies[0].certificateAssetId, 'dedicated-cert-acme');
    assert.equal(policies[0].dnsCredentialRef, 'secret://password/dns-acme#current');
    assert.deepEqual(scheduled, [{ tenantId: tenantA, certificateAssetId: 'dedicated-cert-acme' }]);
    assert.equal(response.currentVersion?.certificateAssetId, 'dedicated-cert-acme');
  });

  it('专属 ACME provisioning 重试复用已有申请，不重复解析签发上下文', async () => {
    const savedVersions: any[] = [];
    let ensureContextCalls = 0;
    let createRequestCalls = 0;
    const repository = {
      getApplication: async () => ({ id: 'app-acme-retry', primaryDomain: 'retry.example.test' }),
      listCertificateCandidates: async () => [],
      resolveCustodyCapability: async () => ({ mode: 'agent_local', evidence: { targetId: 'agent-retry', capability: 'key.generate_csr' } }),
      getPolicy: async () => savedVersions.length ? { policy: { id: 'policy-retry', tenantId: tenantA, applicationAssetId: 'app-acme-retry', createdAt: 'now', updatedAt: 'now' }, currentVersion: savedVersions.at(-1) } : undefined,
      saveVersion: async (_tenantId: string, applicationAssetId: string, primaryDomain: string, input: any) => {
        const version = { ...input, id: 'policy-version-retry', policyId: 'policy-retry', tenantId: tenantA, applicationAssetId, versionNo: 1, isActive: true, primaryDomain, createdAt: 'now', updatedAt: 'now' };
        savedVersions.push(version);
        return { policy: { id: 'policy-retry', tenantId: tenantA, applicationAssetId, createdAt: 'now', updatedAt: 'now' }, currentVersion: version };
      },
      bindVersionCertificate: async (_tenantId: string, _applicationAssetId: string, id: string, certificateAssetId: string) => {
        const version = { ...savedVersions.at(-1), id, certificateAssetId };
        savedVersions[savedVersions.length - 1] = version;
        return version;
      },
    };
    const service = new ApplicationCertificateSupplyApplicationService(repository as never, {
      listProviders: async () => [{ id: 'acme-provider', name: 'ACME', type: 'acme', status: 'active' }],
      listAuthorities: async () => [], listProfiles: async () => [], listAcmeProviderProfiles: () => [{ key: 'profile', displayName: 'Profile', version: '1' }],
    } as never, { createAsset: async (input: any) => ({ id: 'dedicated-cert-retry', ...input, sans: [], sourceType: 'acme', status: 'active', tags: [], createdAt: 'now', updatedAt: 'now' }) } as never, {
      ensureAcmeIssuanceContext: async () => { ensureContextCalls += 1; return { caId: 'ca', profileVersionId: 'profile', trustDomainId: undefined }; },
      getRequestByIdempotencyKey: async () => ({ id: 'request-existing', applicationAssetId: 'app-acme-retry', certificateAssetId: 'dedicated-cert-retry', applicationCertificatePolicyVersionId: 'policy-version-retry' }),
      createCertificateRequest: async () => { createRequestCalls += 1; throw new Error('不应重复创建申请'); },
    } as never);
    service.setAcmeRenewalIntegration({ list: async () => [], create: async (input: any) => input, update: async (input: any) => input }, { listAccounts: async () => [{ id: 'account', status: 'active', contact: ['mailto:ops@example.test'] }] } as never, { scheduleInitialIssuance: async () => ({ id: 'job' }) } as never);

    await service.update(tenantA, 'app-acme-retry', { supplyMode: 'dedicated', providerType: 'acme', providerId: 'acme-provider', acmeProviderProfileId: 'profile', dnsProviderId: 'cloudflare', credentialRef: 'secret://dns/cloudflare#current', status: 'provisioning' }, 'operator');
    assert.equal(ensureContextCalls, 0);
    assert.equal(createRequestCalls, 0);
  });

  it('相同专属 provisioning 配置重复保存不会新增策略版本', async () => {
    const savedVersions: any[] = [];
    let saveVersionCalls = 0;
    let createAssetCalls = 0;
    const certificateAsset = { id: 'dedicated-cert-idempotent', applicationAssetId: 'app-idempotent' };
    const repository = {
      getApplication: async () => ({ id: 'app-idempotent', primaryDomain: 'idempotent.example.test' }),
      listCertificateCandidates: async () => [],
      resolveCustodyCapability: async () => ({ mode: 'agent_local', evidence: { targetId: 'agent-idempotent', capability: 'key.generate_csr' } }),
      getPolicy: async () => savedVersions.length
        ? { policy: { id: 'policy-idempotent', tenantId: tenantA, applicationAssetId: 'app-idempotent', createdAt: 'now', updatedAt: 'now' }, currentVersion: savedVersions.at(-1) }
        : undefined,
      saveVersion: async (_tenantId: string, applicationAssetId: string, primaryDomain: string, input: any) => {
        saveVersionCalls += 1;
        const version = { ...input, id: `version-idempotent-${saveVersionCalls}`, policyId: 'policy-idempotent', tenantId: tenantA, applicationAssetId, versionNo: saveVersionCalls, isActive: true, primaryDomain, createdAt: 'now', updatedAt: 'now' };
        savedVersions.push(version);
        return { policy: { id: 'policy-idempotent', tenantId: tenantA, applicationAssetId, createdAt: 'now', updatedAt: 'now' }, currentVersion: version };
      },
      bindVersionCertificate: async (_tenantId: string, _applicationAssetId: string, _policyVersionId: string, certificateAssetId: string) => {
        const next = { ...savedVersions.at(-1), certificateAssetId };
        savedVersions[savedVersions.length - 1] = next;
        return next;
      },
    };
    const requests: any[] = [];
    const service = new ApplicationCertificateSupplyApplicationService(repository as never, {
      listProviders: async () => [{ id: 'acme-provider-idempotent', name: 'ACME', type: 'acme', status: 'active' }],
      listAuthorities: async () => [],
      listProfiles: async () => [],
      listAcmeProviderProfiles: () => [{ key: 'profile', displayName: 'Profile', version: '1' }],
    } as never, {
      createAsset: async () => { createAssetCalls += 1; return certificateAsset; },
    } as never, {
      ensureAcmeIssuanceContext: async () => ({ caId: 'ca-idempotent', profileVersionId: 'profile-idempotent' }),
      getRequestByIdempotencyKey: async () => {
        return requests[0];
      },
      createCertificateRequest: async (_tenantId: string, input: any) => {
        const request = { id: 'request-idempotent', ...input };
        requests.push(request);
        return request;
      },
    } as never);
    const policies: any[] = [];
    service.setAcmeRenewalIntegration({
      list: async () => policies,
      create: async (input: any) => { const policy = { id: 'renewal-idempotent', status: 'active', ...input }; policies.push(policy); return policy; },
      update: async (input: any) => input,
    } as never, {
      listAccounts: async () => [{ id: 'account-idempotent', status: 'active', contact: ['mailto:ops@example.test'] }],
    } as never, { scheduleInitialIssuance: async () => ({ id: 'job-idempotent' }) } as never);

    const input = {
      supplyMode: 'dedicated' as const, providerType: 'acme' as const, providerId: 'acme-provider-idempotent',
      acmeProviderProfileId: 'profile', dnsProviderId: 'cloudflare', credentialRef: 'secret://dns/cloudflare#current', status: 'provisioning' as const,
    };
    await service.update(tenantA, 'app-idempotent', input, 'operator');
    await service.update(tenantA, 'app-idempotent', input, 'operator');
    assert.equal(saveVersionCalls, 1);
    assert.equal(createAssetCalls, 1);
    assert.equal(requests.length, 1);
  });

  it('draft 首次进入 provisioning 必须创建新的不可变策略版本', async () => {
    const versions: any[] = [{
      id: 'draft-version', policyId: 'draft-policy', tenantId: tenantA, applicationAssetId: 'app-draft-transition',
      versionNo: 1, isActive: true, primaryDomain: 'transition.example.test', supplyMode: 'dedicated',
      providerType: 'internal_ca', providerId: 'provider-transition', certificateAuthorityId: 'ca-transition',
      certificateProfileVersionId: 'profile-transition', custodyMode: 'managed_secret',
      deploymentArtifactMode: 'certificate_with_private_key', autoRenew: false, rotateKeyOnRenewal: false,
      status: 'draft', policySnapshot: {}, createdAt: 'now', updatedAt: 'now',
    }];
    let saveCalls = 0;
    const repository = {
      getApplication: async () => ({ id: 'app-draft-transition', primaryDomain: 'transition.example.test' }),
      listCertificateCandidates: async () => [],
      resolveCustodyCapability: async () => ({ mode: 'managed_secret' as const, evidence: { reason: 'target_missing' } }),
      getPolicy: async () => ({
        policy: { id: 'draft-policy', tenantId: tenantA, applicationAssetId: 'app-draft-transition', createdAt: 'now', updatedAt: 'now' },
        currentVersion: versions.at(-1),
      }),
      saveVersion: async (_tenantId: string, applicationAssetId: string, primaryDomain: string, input: any) => {
        saveCalls += 1;
        const version = { ...input, id: `provisioning-version-${saveCalls}`, policyId: 'draft-policy', tenantId: tenantA, applicationAssetId, versionNo: 2, isActive: true, primaryDomain, createdAt: 'now', updatedAt: 'now' };
        versions.push(version);
        return { policy: { id: 'draft-policy', tenantId: tenantA, applicationAssetId, createdAt: 'now', updatedAt: 'now' }, currentVersion: version };
      },
    };
    const service = new ApplicationCertificateSupplyApplicationService(repository as never, {
      listProviders: async () => [{ id: 'provider-transition', name: 'Internal CA', type: 'gcac_builtin', status: 'active' }],
      listAuthorities: async () => [{ id: 'ca-transition', name: 'CA', providerId: 'provider-transition', status: 'active' }],
      listProfiles: async () => [{ profile: { id: 'profile-transition', name: 'Profile', currentVersion: 1 }, versions: [{ id: 'profile-transition', versionNo: 1 }] }],
      listAcmeProviderProfiles: () => [],
    } as never);
    const response = await service.update('tenant-transition', 'app-draft-transition', {
      supplyMode: 'dedicated', providerType: 'internal_ca', providerId: 'provider-transition',
      certificateAuthorityId: 'ca-transition', certificateProfileVersionId: 'profile-transition', status: 'provisioning',
    }, 'operator');
    assert.equal(saveCalls, 1);
    assert.equal(response.currentVersion?.status, 'provisioning');
    assert.equal(response.currentVersion?.id, 'provisioning-version-1');
  });

  it('仅有域名的托管密钥策略允许签发，但明确禁止部署', async () => {
    const repository = {
      getApplication: async () => ({ id: 'app-domain-only', primaryDomain: 'domain-only.example.test' }),
      listCertificateCandidates: async () => [],
      resolveCustodyCapability: async () => ({ mode: 'managed_secret' as const, evidence: { reason: 'target_missing' } }),
      getPolicy: async () => undefined,
      saveVersion: async (_tenantId: string, applicationAssetId: string, primaryDomain: string, input: any) => ({
        policy: { id: 'domain-policy', tenantId: tenantA, applicationAssetId, createdAt: 'now', updatedAt: 'now' },
        currentVersion: { ...input, id: 'domain-version', policyId: 'domain-policy', tenantId: tenantA, applicationAssetId, versionNo: 1, isActive: true, primaryDomain, createdAt: 'now', updatedAt: 'now' },
      }),
    };
    const service = new ApplicationCertificateSupplyApplicationService(repository as never, {
      listProviders: async () => [{ id: 'provider-domain', name: 'Internal CA', type: 'gcac_builtin', status: 'active' }],
      listAuthorities: async () => [{ id: 'ca-domain', name: 'CA', providerId: 'provider-domain', status: 'active' }],
      listProfiles: async () => [{ profile: { id: 'profile-domain', name: 'Profile', currentVersion: 1 }, versions: [{ id: 'profile-domain', versionNo: 1 }] }],
      listAcmeProviderProfiles: () => [],
    } as never);
    const response = await service.preview('tenant-domain-only', 'app-domain-only', {
      supplyMode: 'dedicated', providerType: 'internal_ca', providerId: 'provider-domain',
      certificateAuthorityId: 'ca-domain', certificateProfileVersionId: 'profile-domain',
    });
    assert.equal(response.readiness.canIssue, true);
    assert.equal(response.readiness.canDeploy, false);
    assert.equal(response.readiness.reasons.includes('UNMANAGED_DEPLOYMENT_CONTEXT_REQUIRED'), true);
  });

  it('专属策略不允许未显式停用时在 Internal CA 与 ACME 间静默切换', async () => {
    const repository = {
      getApplication: async () => ({ id: 'app-switch', primaryDomain: 'switch.example.test' }),
      getPolicy: async () => ({
        policy: { id: 'policy-switch', tenantId: tenantA, applicationAssetId: 'app-switch', createdAt: 'now', updatedAt: 'now' },
        currentVersion: { id: 'version-switch', policyId: 'policy-switch', tenantId: tenantA, applicationAssetId: 'app-switch', versionNo: 1, isActive: true, primaryDomain: 'switch.example.test', supplyMode: 'dedicated', providerType: 'internal_ca', autoRenew: true, rotateKeyOnRenewal: true, status: 'draft', policySnapshot: {}, createdAt: 'now', updatedAt: 'now' },
      }),
    };
    const service = new ApplicationCertificateSupplyApplicationService(repository as never);
    await assert.rejects(
      () => service.update(tenantA, 'app-switch', { supplyMode: 'dedicated', providerType: 'acme' }, 'operator'),
      (error: any) => error?.errorCode === 'APPLICATION_CERTIFICATE_POLICY_INVALID',
    );
  });

  it('专属策略显式停用后允许重新选择 Provider', async () => {
    const repository = {
      getApplication: async () => ({ id: 'app-switch-disabled', primaryDomain: 'switch-disabled.example.test' }),
      getPolicy: async () => ({
        policy: { id: 'policy-switch-disabled', tenantId: tenantA, applicationAssetId: 'app-switch-disabled', createdAt: 'now', updatedAt: 'now' },
        currentVersion: { id: 'version-switch-disabled', policyId: 'policy-switch-disabled', tenantId: tenantA, applicationAssetId: 'app-switch-disabled', versionNo: 1, isActive: true, primaryDomain: 'switch-disabled.example.test', supplyMode: 'dedicated', providerType: 'internal_ca', autoRenew: false, rotateKeyOnRenewal: false, status: 'disabled', policySnapshot: {}, createdAt: 'now', updatedAt: 'now' },
      }),
      listCertificateCandidates: async () => [],
      resolveCustodyCapability: async () => ({ mode: 'managed_secret' as const, evidence: { reason: 'target_missing' } }),
      saveVersion: async (_tenantId: string, applicationAssetId: string, primaryDomain: string, input: any) => ({
        policy: { id: 'policy-switch-disabled', tenantId: tenantA, applicationAssetId, createdAt: 'now', updatedAt: 'now' },
        currentVersion: { ...input, id: 'version-switch-disabled-next', policyId: 'policy-switch-disabled', tenantId: tenantA, applicationAssetId, versionNo: 2, isActive: true, primaryDomain, createdAt: 'now', updatedAt: 'now' },
      }),
    };
    const service = new ApplicationCertificateSupplyApplicationService(repository as never, {
      listProviders: async () => [{ id: 'acme-provider-disabled', name: 'ACME', type: 'acme', status: 'active' }],
      listAuthorities: async () => [], listProfiles: async () => [], listAcmeProviderProfiles: () => [{ key: 'profile', displayName: 'Profile', version: '1' }],
    } as never);
    const response = await service.update('tenant-switch-disabled', 'app-switch-disabled', {
      supplyMode: 'dedicated', providerType: 'acme', providerId: 'acme-provider-disabled',
      acmeProviderProfileId: 'profile', dnsProviderId: 'cloudflare', credentialRef: 'secret://dns/cloudflare#current',
    }, 'operator');
    assert.equal(response.currentVersion?.providerType, 'acme');
  });

  it('已有申请归属不匹配时拒绝按幂等键复用', async () => {
    const repository = {
      getApplication: async () => ({ id: 'app-mismatch', primaryDomain: 'mismatch.example.test' }),
      listCertificateCandidates: async () => [],
      resolveCustodyCapability: async () => ({ mode: 'agent_local', evidence: { targetId: 'agent-1', capability: 'key.generate_csr' } }),
      getPolicy: async () => undefined,
      saveVersion: async (_tenantId: string, applicationAssetId: string, primaryDomain: string, input: any) => ({ policy: { id: 'policy', tenantId: tenantA, applicationAssetId, createdAt: 'now', updatedAt: 'now' }, currentVersion: { ...input, id: 'version', policyId: 'policy', tenantId: tenantA, applicationAssetId, versionNo: 1, isActive: true, primaryDomain, createdAt: 'now', updatedAt: 'now' } }),
      bindVersionCertificate: async (_tenantId: string, _applicationAssetId: string, id: string, certificateAssetId: string) => ({ id, policyId: 'policy', tenantId: tenantA, applicationAssetId: 'app-mismatch', versionNo: 1, isActive: true, primaryDomain: 'mismatch.example.test', supplyMode: 'dedicated', providerType: 'acme', certificateAssetId, autoRenew: true, rotateKeyOnRenewal: true, status: 'provisioning', policySnapshot: {}, createdAt: 'now', updatedAt: 'now' }),
    };
    const service = new ApplicationCertificateSupplyApplicationService(repository as never, { listProviders: async () => [{ id: 'provider', name: 'ACME', type: 'acme', status: 'active' }], listAuthorities: async () => [], listProfiles: async () => [], listAcmeProviderProfiles: () => [{ key: 'profile', displayName: 'Profile', version: '1' }] } as never, { createAsset: async () => ({ id: 'certasset', applicationAssetId: 'app-mismatch' }) } as never, { getRequestByIdempotencyKey: async () => ({ id: 'request-old', applicationAssetId: 'other-app', certificateAssetId: 'certasset', applicationCertificatePolicyVersionId: 'other-version' }), ensureAcmeIssuanceContext: async () => ({ caId: 'ca', profileVersionId: 'profile' }), createCertificateRequest: async () => ({}) } as never);
    service.setAcmeRenewalIntegration({ list: async () => [], create: async (input: any) => input, update: async (input: any) => input }, { listAccounts: async () => [{ id: 'account', status: 'active', contact: ['mailto:ops@example.test'] }] } as never, { scheduleInitialIssuance: async () => ({ id: 'job' }) } as never);

    await assert.rejects(() => service.update(tenantA, 'app-mismatch', { supplyMode: 'dedicated', providerType: 'acme', providerId: 'provider', acmeProviderProfileId: 'profile', dnsProviderId: 'cloudflare', credentialRef: 'secret://dns/cloudflare#current', status: 'provisioning' }, 'operator'), (error: any) => error?.errorCode === 'APPLICATION_CERTIFICATE_POLICY_INVALID');
  });

  it('ACME DNS SecretRef 无法解析时仅允许预览草稿，不创建策略或申请', async () => {
    let saveVersionCalls = 0;
    const repository = {
      getApplication: async () => ({ id: 'app-dns-denied', primaryDomain: 'dns-denied.example.test' }),
      getPolicy: async () => undefined,
      listCertificateCandidates: async () => [],
      resolveCustodyCapability: async () => ({ mode: 'managed_secret' as const, evidence: { reason: 'target_missing' } }),
      saveVersion: async () => { saveVersionCalls += 1; throw new Error('不应保存'); },
    };
    const service = new ApplicationCertificateSupplyApplicationService(repository as never, {
      listProviders: async () => [{ id: 'acme-dns-denied', name: 'ACME', type: 'acme', status: 'active' }],
      listAuthorities: async () => [],
      listProfiles: async () => [],
      listAcmeProviderProfiles: () => [{ key: 'profile', displayName: 'Profile', version: '1' }],
    } as never, undefined, undefined, {
      resolveForService: async () => { throw new Error('secret not found'); },
    } as never);
    const preview = await service.preview(tenantA, 'app-dns-denied', {
      supplyMode: 'dedicated', providerType: 'acme', providerId: 'acme-dns-denied',
      acmeProviderProfileId: 'profile', dnsProviderId: 'cloudflare', credentialRef: 'secret://password/dns-denied#current',
    });
    assert.equal(preview.readiness.canIssue, false);
    assert.equal(preview.readiness.canDeploy, false);
    assert.equal(preview.readiness.reasons.includes('ACME_DNS_AUTHORIZATION_REQUIRED'), true);
    await assert.rejects(
      () => service.update(tenantA, 'app-dns-denied', {
        supplyMode: 'dedicated', providerType: 'acme', providerId: 'acme-dns-denied',
        acmeProviderProfileId: 'profile', dnsProviderId: 'cloudflare', credentialRef: 'secret://password/dns-denied#current',
        status: 'provisioning',
      }, 'operator'),
      (error: any) => error?.errorCode === 'APPLICATION_CERTIFICATE_POLICY_INVALID',
    );
    assert.equal(saveVersionCalls, 0);
  });

  it('应用域名变化后停用旧专属 ACME 续期策略', async () => {
    const disabled: any[] = [];
    const repository = {
      getApplication: async () => ({ id: 'app-acme-domain-change', primaryDomain: 'new.example.test' }),
      getPolicy: async () => ({
        policy: { id: 'policy-domain-acme', tenantId: tenantA, applicationAssetId: 'app-acme-domain-change', createdAt: 'now', updatedAt: 'now' },
        currentVersion: {
          id: 'version-domain-acme', policyId: 'policy-domain-acme', tenantId: tenantA, applicationAssetId: 'app-acme-domain-change',
          versionNo: 1, isActive: true, primaryDomain: 'old.example.test', supplyMode: 'dedicated',
          providerType: 'acme', providerId: 'acme-provider-domain', acmeProviderProfileId: 'profile',
          dnsProviderId: 'cloudflare', credentialRef: 'secret://password/dns-domain#current',
          custodyMode: 'agent_local', deploymentArtifactMode: 'certificate_only', autoRenew: true,
          rotateKeyOnRenewal: true, status: 'deployed', certificateAssetId: 'old-dedicated-cert',
          policySnapshot: {}, createdAt: 'now', updatedAt: 'now',
        },
      }),
      listCertificateCandidates: async () => [],
      resolveCustodyCapability: async () => ({ mode: 'agent_local' as const, evidence: { targetId: 'agent-domain' } }),
      saveVersion: async (_tenantId: string, applicationAssetId: string, primaryDomain: string, input: any) => ({
        policy: { id: 'policy-domain-acme', tenantId: tenantA, applicationAssetId, createdAt: 'now', updatedAt: 'now' },
        currentVersion: { ...input, id: 'version-domain-acme-next', policyId: 'policy-domain-acme', tenantId: tenantA, applicationAssetId, versionNo: 2, isActive: true, primaryDomain, createdAt: 'now', updatedAt: 'now' },
      }),
    };
    const service = new ApplicationCertificateSupplyApplicationService(repository as never, {
      listProviders: async () => [{ id: 'acme-provider-domain', name: 'ACME', type: 'acme', status: 'active' }],
      listAuthorities: async () => [], listProfiles: async () => [],
      listAcmeProviderProfiles: () => [{ key: 'profile', displayName: 'Profile', version: '1' }],
    } as never);
    service.setAcmeRenewalIntegration({
      list: async () => [{ id: 'old-renewal-policy', certificateAssetId: 'old-dedicated-cert', status: 'active' } as never],
      create: async (input: any) => input,
      update: async (_tenantId: string, _id: string, patch: any) => { disabled.push(patch); return patch; },
    } as never);
    const response = await service.onApplicationDomainChanged(tenantA, 'app-acme-domain-change', 'new.example.test', 'operator');
    assert.equal(response?.currentVersion?.primaryDomain, 'new.example.test');
    assert.deepEqual(disabled, [{ enabled: false, actorId: 'operator' }]);
  });

  it('域名变化时 DNS 控制权不可证明则落新 draft，不覆盖旧证书事实', async () => {
    let savedInput: any;
    const repository = {
      getApplication: async () => ({ id: 'app-acme-domain-draft', primaryDomain: 'new.example.test' }),
      getPolicy: async () => ({
        policy: { id: 'policy-domain-draft', tenantId: tenantA, applicationAssetId: 'app-acme-domain-draft', createdAt: 'now', updatedAt: 'now' },
        currentVersion: {
          id: 'version-domain-draft', policyId: 'policy-domain-draft', tenantId: tenantA, applicationAssetId: 'app-acme-domain-draft',
          versionNo: 1, isActive: true, primaryDomain: 'old.example.test', supplyMode: 'dedicated',
          providerType: 'acme', providerId: 'acme-provider-draft', acmeProviderProfileId: 'profile',
          dnsProviderId: 'cloudflare', credentialRef: 'secret://password/dns-invalid#current',
          custodyMode: 'agent_local', deploymentArtifactMode: 'certificate_only', autoRenew: true,
          rotateKeyOnRenewal: true, status: 'deployed', certificateAssetId: 'old-dedicated-cert-draft',
          policySnapshot: {}, createdAt: 'now', updatedAt: 'now',
        },
      }),
      listCertificateCandidates: async () => [],
      resolveCustodyCapability: async () => ({ mode: 'agent_local' as const, evidence: { targetId: 'agent-domain-draft' } }),
      saveVersion: async (_tenantId: string, applicationAssetId: string, primaryDomain: string, input: any) => {
        savedInput = input;
        return {
          policy: { id: 'policy-domain-draft', tenantId: tenantA, applicationAssetId, createdAt: 'now', updatedAt: 'now' },
          currentVersion: { ...input, id: 'version-domain-draft-next', policyId: 'policy-domain-draft', tenantId: tenantA, applicationAssetId, versionNo: 2, isActive: true, primaryDomain, createdAt: 'now', updatedAt: 'now' },
        };
      },
    };
    const service = new ApplicationCertificateSupplyApplicationService(repository as never, {
      listProviders: async () => [{ id: 'acme-provider-draft', name: 'ACME', type: 'acme', status: 'active' }],
      listAuthorities: async () => [], listProfiles: async () => [],
      listAcmeProviderProfiles: () => [{ key: 'profile', displayName: 'Profile', version: '1' }],
    } as never, undefined, undefined, {
      resolveForService: async () => { throw new Error('dns secret unavailable'); },
    } as never);
    const response = await service.onApplicationDomainChanged(tenantA, 'app-acme-domain-draft', 'new.example.test', 'operator');
    assert.equal(savedInput.status, 'draft');
    assert.equal(response?.currentVersion?.certificateAssetId, undefined);
    assert.equal(response?.currentVersion?.status, 'draft');
  });
});
