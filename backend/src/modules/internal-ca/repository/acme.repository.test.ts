import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { runMigrations } from '../../../database/migration-runner.js';
import { AcmeRepository } from './acme.repository.js';
import type { AcmeRenewalJobEntity, AcmeRenewalPolicyEntity } from '../schema/acme.schema.js';

const tenantId = 'tenant-acme-repository';

async function fixture(): Promise<{ db: PgliteDatabase; repository: AcmeRepository }> {
  const db = new PgliteDatabase();
  await runMigrations(db);
  await db.exec(`
    insert into pg_service_assets (id, tenant_id, address, address_type, port, protocol, discovery_source, status, asset_kind)
    values ('application-acme-repository', '${tenantId}', 'app.example.test', 'DNS', 443, 'HTTPS', 'MANUAL', 'ACTIVE', 'APPLICATION');
    insert into pg_application_certificate_policies (id, tenant_id, application_asset_id, created_at, updated_at)
    values ('policy-app-acme-repository', '${tenantId}', 'application-acme-repository', now(), now());
    insert into pg_application_certificate_policy_versions (
      id, policy_id, tenant_id, application_asset_id, version_no, is_active, primary_domain, supply_mode,
      auto_renew, rotate_key_on_renewal, status, policy_snapshot, created_at, updated_at
    ) values (
      'acpv-acme-repository', 'policy-app-acme-repository', '${tenantId}', 'application-acme-repository', 1, true,
      'app.example.test', 'dedicated', true, true, 'provisioning', '{}', now(), now()
    );
    insert into pg_ca_providers (
      id, tenant_id, name, type, deployment_mode, runtime_platform, availability_mode, status, payload, created_at, updated_at
    ) values (
      'provider-acme-repository', '${tenantId}', '企业 ACME', 'acme', 'plugin', 'embedded', 'single', 'active', '{}', now(), now()
    );
    insert into pg_acme_accounts (
      id, tenant_id, provider_id, directory_url_hash, account_key_secret_ref, contact, status, payload, created_at, updated_at
    ) values (
      'account-acme-repository', '${tenantId}', 'provider-acme-repository', repeat('a', 64),
      'secret://acme/account-key#current', '["mailto:ops@example.test"]', 'active', '{}', now(), now()
    );
    insert into pg_certificate_assets (id, tenant_id, name, primary_domain, sans, source_type, status, created_by, created_at, updated_at)
    values ('certasset-acme-repository', '${tenantId}', 'repository test certificate', 'app.example.test', '[]', 'acme', 'active', 'operator', now(), now());
  `);
  return { db, repository: new AcmeRepository(db) };
}

function policy(): AcmeRenewalPolicyEntity {
  const timestamp = '2026-08-28T00:00:00.000Z';
  return {
    id: 'policy-acme-repository',
    tenantId,
    certificateAssetId: 'certasset-acme-repository',
    applicationAssetId: 'application-acme-repository',
    applicationCertificatePolicyVersionId: 'acpv-acme-repository',
    providerId: 'provider-acme-repository',
    accountId: 'account-acme-repository',
    enabled: true,
    renewalWindowDays: 30,
    challengeType: 'dns-01',
    rotateKeyOnRenewal: true,
    deploymentMode: 'manual',
    maxAttempts: 5,
    backoffSeconds: 300,
    maintenanceWindow: {
      dnsProvider: 'cloudflare',
      contactEmail: 'ops@example.test',
      domains: ['app.example.test'],
    },
    dnsCredentialRef: 'secret://dns/cloudflare#current',
    status: 'active',
    version: 1,
    createdBy: 'operator',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

test('ACME Renewal Policy 仓储持久化应用归属和 DNS SecretRef', async () => {
  const { db, repository } = await fixture();
  const input = policy();
  await repository.savePolicy(input);

  const row = await db.query<{ application_asset_id: string; application_certificate_policy_version_id: string; dns_credential_ref: string }>(
    `select application_asset_id, application_certificate_policy_version_id, dns_credential_ref
       from pg_acme_renewal_policies where tenant_id = $1 and id = $2`,
    [tenantId, input.id],
  );
  assert.deepEqual(row.rows[0], {
    application_asset_id: input.applicationAssetId,
    application_certificate_policy_version_id: input.applicationCertificatePolicyVersionId,
    dns_credential_ref: input.dnsCredentialRef,
  });

  const loaded = await repository.getPolicy(tenantId, input.id);
  assert.equal(loaded?.applicationAssetId, input.applicationAssetId);
  assert.equal(loaded?.applicationCertificatePolicyVersionId, input.applicationCertificatePolicyVersionId);
  assert.equal(loaded?.dnsCredentialRef, input.dnsCredentialRef);
  assert.deepEqual(loaded?.maintenanceWindow, input.maintenanceWindow);
  assert.equal(await repository.getPolicy('other-tenant', input.id), undefined);
});

test('ACME Renewal Job 仓储持久化应用归属和策略版本，并保留策略快照', async () => {
  const { db, repository } = await fixture();
  await repository.savePolicy(policy());
  const timestamp = '2026-08-28T00:00:00.000Z';
  const input = {
    id: 'job-acme-repository',
    tenantId,
    certificateVersionId: undefined,
    sourceCertificateVersionId: undefined,
    renewalWindowKey: 'initial:certasset-acme-repository',
    status: 'scheduled',
    certificateRequestId: undefined,
    applicationAssetId: 'application-acme-repository',
    applicationCertificatePolicyVersionId: 'acpv-acme-repository',
    policyId: 'policy-acme-repository',
    promotionStatus: 'not_required',
    attemptCount: 0,
    taskGeneration: 0,
    policySnapshot: {
      applicationAssetId: 'application-acme-repository',
      applicationCertificatePolicyVersionId: 'acpv-acme-repository',
      providerId: 'provider-acme-repository',
    },
    scheduledAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  } satisfies AcmeRenewalJobEntity;

  await repository.saveRenewalJob(input);
  const row = await db.query<{ application_asset_id: string; application_certificate_policy_version_id: string }>(
    `select application_asset_id, application_certificate_policy_version_id
       from pg_certificate_renewal_jobs where tenant_id = $1 and id = $2`,
    [tenantId, input.id],
  );
  assert.deepEqual(row.rows[0], {
    application_asset_id: input.applicationAssetId,
    application_certificate_policy_version_id: input.applicationCertificatePolicyVersionId,
  });

  const loaded = await repository.getRenewalJob(tenantId, input.id);
  assert.equal(loaded?.applicationAssetId, input.applicationAssetId);
  assert.equal(loaded?.applicationCertificatePolicyVersionId, input.applicationCertificatePolicyVersionId);
  assert.deepEqual(loaded?.policySnapshot, input.policySnapshot);
  assert.equal(await repository.getRenewalJob('other-tenant', input.id), undefined);
});
