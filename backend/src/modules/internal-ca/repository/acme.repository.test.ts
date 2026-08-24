import assert from 'node:assert/strict';
import test from 'node:test';
import { runMigrations } from '../../../database/migration-runner.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { AcmeRepository } from './acme.repository.js';
import { PgCertificatesRepository } from '../../certificates/repository/certificates.repository.js';
import type { AcmeAccountEntity, AcmeOrderEntity, AcmeRenewalJobEntity, AcmeRenewalPolicyEntity } from '../schema/acme.schema.js';

const tenantId = 'tenant-acme-repository';
const otherTenantId = 'tenant-acme-repository-other';
const now = '2026-08-05T00:00:00.000Z';

test('ACME 迁移创建生命周期表、索引和证书版本 activation_state 默认值', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations');
  await insertFixtureRows(db);

  const tables = await db.query<{ tablename: string }>(`
    select tablename
    from pg_tables
    where schemaname = 'public' and tablename like 'pg_acme_%'
    order by tablename
  `);
  assert.deepEqual(tables.rows.map((row) => row.tablename), [
    'pg_acme_accounts',
    'pg_acme_authorizations',
    'pg_acme_challenges',
    'pg_acme_http01_presentations',
    'pg_acme_orders',
    'pg_acme_renewal_policies',
  ]);

  const indexes = await db.query<{ indexname: string }>(`
    select indexname
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'uq_pg_acme_orders_active_request',
        'idx_pg_acme_challenges_lease',
        'uq_pg_certificate_renewal_jobs_acme_active',
        'idx_pg_certificate_versions_activation'
      )
    order by indexname
  `);
  assert.deepEqual(indexes.rows.map((row) => row.indexname), [
    'idx_pg_acme_challenges_lease',
    'idx_pg_certificate_versions_activation',
    'uq_pg_acme_orders_active_request',
    'uq_pg_certificate_renewal_jobs_acme_active',
  ]);

  const version = await db.query<{ activation_state: string }>('select activation_state from pg_certificate_versions where id = $1', ['certver-acme-old']);
  assert.equal(version.rows[0]?.activation_state, 'promoted');
});

test('ACME Repository 按 tenant 隔离 Account/Order/Policy，并保护活动 Order 唯一性', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations');
  await insertFixtureRows(db);
  const repository = new AcmeRepository(db);

  const account = await repository.saveAccount(accountEntity());
  assert.equal((await repository.getAccount(tenantId, account.id))?.id, account.id);
  assert.equal(await repository.getAccount(otherTenantId, account.id), undefined);
  assert.equal((await repository.getAccountByKey(tenantId, account.providerId, account.directoryUrlHash, account.accountKeySecretRef))?.id, account.id);

  const order = await repository.saveOrder(orderEntity());
  assert.equal((await repository.getOrder(tenantId, order.id))?.externalOrderUrl, order.externalOrderUrl);
  assert.equal(await repository.getOrder(otherTenantId, order.id), undefined);
  assert.equal((await repository.getOrderByRequest(tenantId, 'certreq-acme-1', true))?.id, order.id);

  await assert.rejects(() => repository.saveOrder({
    ...orderEntity(),
    id: 'acme-order-duplicate',
    externalOrderUrl: 'https://acme.example.test/order/duplicate',
  }));

  const policy = await repository.savePolicy(policyEntity());
  assert.equal((await repository.getPolicy(tenantId, policy.id))?.certificateAssetId, 'certasset-acme');
  assert.equal(await repository.getPolicy(otherTenantId, policy.id), undefined);
  assert.equal((await repository.listPolicies(tenantId)).length, 1);
});

test('ACME Repository 持久化 Authorization/Challenge 并用租约阻止并发呈现', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations');
  await insertFixtureRows(db);
  const repository = new AcmeRepository(db);
  await repository.saveAccount(accountEntity());
  await repository.saveOrder(orderEntity());
  const authorization = await repository.saveAuthorization({
    id: 'acme-authz-1',
    tenantId,
    orderId: 'acme-order-1',
    externalAuthorizationUrl: 'https://acme.example.test/authz/1',
    identifier: { type: 'dns', value: 'app.example.com' },
    status: 'pending',
    wildcard: false,
    createdAt: now,
    updatedAt: now,
  });
  const challenge = await repository.saveChallenge({
    id: 'acme-challenge-1',
    tenantId,
    orderId: 'acme-order-1',
    authorizationId: authorization.id,
    externalChallengeUrl: 'https://acme.example.test/challenge/1',
    type: 'http-01',
    identifier: 'app.example.com',
    tokenSha256: 'a'.repeat(64),
    keyAuthorizationSha256: 'b'.repeat(64),
    status: 'pending',
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
  });

  const leased = await repository.claimChallenge(tenantId, challenge.id, 'worker-a', '2026-08-05T00:05:00.000Z', now);
  assert.equal(leased?.leaseOwner, 'worker-a');
  assert.equal(await repository.claimChallenge(tenantId, challenge.id, 'worker-b', '2026-08-05T00:05:00.000Z', '2026-08-05T00:01:00.000Z'), undefined);
  assert.equal((await repository.claimChallenge(tenantId, challenge.id, 'worker-b', '2026-08-05T00:10:00.000Z', '2026-08-05T00:06:00.000Z'))?.leaseOwner, 'worker-b');

  const challenges = await repository.listChallenges(tenantId, 'acme-order-1');
  assert.equal(challenges.length, 1);
  assert.equal(challenges[0]?.tokenSha256, 'a'.repeat(64));
});

test('ACME RenewalJob 原子 claim 遵守 nextAttemptAt、lease 和状态边界', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations');
  await insertFixtureRows(db);
  const repository = new AcmeRepository(db);
  await repository.saveAccount(accountEntity());
  await repository.savePolicy(policyEntity());
  const job = await repository.saveRenewalJob(renewalJobEntity());

  assert.equal(await repository.claimRenewalJob(tenantId, job.id, 'worker-a', '2026-08-05T00:05:00.000Z', '2026-08-04T23:59:00.000Z'), undefined);
  assert.equal((await repository.claimRenewalJob(tenantId, job.id, 'worker-a', '2026-08-05T00:05:00.000Z', now))?.leaseOwner, 'worker-a');
  assert.equal(await repository.claimRenewalJob(tenantId, job.id, 'worker-b', '2026-08-05T00:05:00.000Z', '2026-08-05T00:01:00.000Z'), undefined);
  assert.equal((await repository.claimRenewalJob(tenantId, job.id, 'worker-b', '2026-08-05T00:10:00.000Z', '2026-08-05T00:06:00.000Z'))?.leaseOwner, 'worker-b');

  await repository.saveRenewalJob({ ...job, status: 'completed', leaseOwner: undefined, leaseExpiresAt: undefined, updatedAt: '2026-08-05T00:07:00.000Z' });
  assert.equal(await repository.claimRenewalJob(tenantId, job.id, 'worker-c', '2026-08-05T00:15:00.000Z', '2026-08-05T00:08:00.000Z'), undefined);
});

test('ACME RenewalJob 失败重试会清除旧租约并恢复为 scheduled', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations');
  await insertFixtureRows(db);
  const repository = new AcmeRepository(db);
  await repository.saveAccount(accountEntity());
  await repository.savePolicy(policyEntity());
  const job = await repository.saveRenewalJob({
    ...renewalJobEntity(),
    status: 'failed',
    attemptCount: 5,
    nextAttemptAt: '2026-08-05T01:00:00.000Z',
    leaseOwner: 'worker-old',
    leaseExpiresAt: '2026-08-05T01:05:00.000Z',
    failureCode: 'ACME_RENEWAL_FAILED',
    failureMessage: 'temporary failure',
  });

  const retried = await repository.retryRenewalJob(tenantId, job.id, now);

  assert.equal(retried.status, 'scheduled');
  assert.equal(retried.attemptCount, 0);
  assert.equal(retried.nextAttemptAt, now);
  assert.equal(retried.leaseOwner, undefined);
  assert.equal(retried.failureCode, undefined);
  assert.equal(retried.failureMessage, undefined);
});

test('Certificate Promotion 原子切换当前版本并将旧版本标记为 superseded', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations');
  await insertFixtureRows(db);
  const repository = new PgCertificatesRepository(db);

  await db.query(
    `insert into pg_certificate_versions (
       id, certificate_asset_id, version_no, common_name, sans, issuer, subject, serial_number,
       not_before, not_after, fingerprint_sha256, public_key_algorithm, signature_algorithm,
       leaf_storage_ref, private_key_secret_ref, chain_certificate_refs, chain_order, chain_diagnostics,
       chain_status, deployable, source_type, status, created_by, created_at, updated_at, activation_state
     ) values (
       $1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18::jsonb,$19,$20,$21,$22,$23,$24,$25,$26
     )`,
    [
      'certver-acme-new', 'certasset-acme', 2, 'app.example.com', '["app.example.com"]',
      '{"raw":"CN=Issuer"}', '{"raw":"CN=app.example.com"}', '02', '2026-08-05T00:00:00.000Z', '2026-11-20T00:00:00.000Z',
      '2'.repeat(64), 'rsa', 'sha256WithRSAEncryption', 'artifact://leaf/new', 'secret://certificate_private_key/new#current',
      '[]', '[]', '[]', 'valid', true, 'acme', 'active', 'user-admin', now, now, 'staged',
    ],
  );

  const promoted = await repository.promoteVersionAtomic('certver-acme-new');
  const asset = await repository.getAsset('certasset-acme');
  const oldVersion = await repository.getVersion('certver-acme-old');

  assert.equal(promoted.activationState, 'promoted');
  assert.equal(asset?.currentVersionId, 'certver-acme-new');
  assert.equal(oldVersion?.activationState, 'superseded');
});

async function insertFixtureRows(db: PgliteDatabase): Promise<void> {
  await db.query(
    `insert into pg_certificate_assets (
       id, name, primary_domain, sans, source_type, current_version_id, status, tags, created_by, created_at, updated_at
     ) values ($1,$2,$3,$4::jsonb,$5,$6,$7,$8::jsonb,$9,$10,$11)`,
    ['certasset-acme', 'app.example.com', 'app.example.com', '["app.example.com"]', 'acme', 'certver-acme-old', 'active', '[]', 'user-admin', now, now],
  );
  await db.query(
    `insert into pg_certificate_versions (
       id, certificate_asset_id, version_no, common_name, sans, issuer, subject, serial_number,
       not_before, not_after, fingerprint_sha256, public_key_algorithm, signature_algorithm,
       leaf_storage_ref, private_key_secret_ref, chain_certificate_refs, chain_order, chain_diagnostics,
       chain_status, deployable, source_type, status, created_by, created_at, updated_at
     ) values (
       $1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18::jsonb,$19,$20,$21,$22,$23,$24,$25
     )`,
    [
      'certver-acme-old', 'certasset-acme', 1, 'app.example.com', '["app.example.com"]',
      '{"raw":"CN=Issuer"}', '{"raw":"CN=app.example.com"}', '01', '2026-01-01T00:00:00.000Z', '2026-08-20T00:00:00.000Z',
      '1'.repeat(64), 'rsa', 'sha256WithRSAEncryption', 'artifact://leaf/old', 'secret://certificate_private_key/old#current',
      '[]', '[]', '[]', 'valid', true, 'acme', 'active', 'user-admin', now, now,
    ],
  );
  await db.query(
    `insert into pg_ca_providers (
       id, tenant_id, name, type, deployment_mode, runtime_platform, availability_mode,
       endpoint, credential_secret_ref, capabilities, status, payload, created_at, updated_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb,$13,$14)`,
    ['caprov-acme', tenantId, 'ACME Provider', 'acme', 'external', 'external', 'active_active', null, null, '{}', 'active', '{}', now, now],
  );
  await db.query(
    `insert into pg_certificate_authorities (
       id, tenant_id, name, role, parent_ca_id, topology_mode, provider_id, key_reference_id,
       security_domain, status, path_length_constraint, payload, created_at, updated_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)`,
    ['ca-acme', tenantId, 'ACME CA', 'intermediate', 'ca-acme-root', 'external_managed', 'caprov-acme', null, 'production', 'active', null, '{}', now, now],
  ).catch(async () => {
    await db.query(
      `insert into pg_certificate_authorities (
         id, tenant_id, name, role, parent_ca_id, topology_mode, provider_id, key_reference_id,
         security_domain, status, path_length_constraint, payload, created_at, updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)`,
      ['ca-acme-root', tenantId, 'ACME Root Placeholder', 'root', null, 'root_only', 'caprov-acme', null, 'production', 'active', null, '{}', now, now],
    );
    await db.query(
      `insert into pg_certificate_authorities (
         id, tenant_id, name, role, parent_ca_id, topology_mode, provider_id, key_reference_id,
         security_domain, status, path_length_constraint, payload, created_at, updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)`,
      ['ca-acme', tenantId, 'ACME CA', 'intermediate', 'ca-acme-root', 'external_managed', 'caprov-acme', null, 'production', 'active', null, '{}', now, now],
    );
  });
  await db.query(
    `insert into pg_certificate_profiles (
       id, tenant_id, name, security_domain, status, current_version, payload, created_at, updated_at
     ) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
    ['profile-acme', tenantId, 'Web TLS', 'production', 'active', 1, '{}', now, now],
  );
  await db.query(
    `insert into pg_certificate_profile_versions (
       id, profile_id, version_no, rules, created_by, payload, created_at, updated_at
     ) values ($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7,$8)`,
    ['profilever-acme', 'profile-acme', 1, '{}', 'user-admin', '{}', now, now],
  );
  await db.query(
    `insert into pg_key_references (
       id, tenant_id, owner_type, owner_id, custody_mode, backend_type, opaque_reference, secret_ref,
       public_key_fingerprint_sha256, exportability, protection_level, status, payload, created_at, updated_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15)`,
    ['keyref-acme', tenantId, 'application_certificate', 'certasset-acme', 'managed_secret', 'secret', null, 'secret://certificate_private_key/key#current', '2'.repeat(64), 'exportable', 'software_controlled', 'active', '{}', now, now],
  );
  await db.query(
    `insert into pg_certificate_requests (
       id, tenant_id, application_asset_id, ca_id, profile_version_id, key_reference_id,
       csr_pem, csr_sha256, public_key_fingerprint_sha256, idempotency_key, status,
       requested_by, payload, created_at, updated_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15)`,
    ['certreq-acme-1', tenantId, 'app-asset-acme', 'ca-acme', 'profilever-acme', 'keyref-acme', '-----BEGIN CERTIFICATE REQUEST-----\nMIIB\n-----END CERTIFICATE REQUEST-----', '3'.repeat(64), '2'.repeat(64), 'idem-acme', 'issuing', 'user-admin', '{}', now, now],
  );
}

function accountEntity(): AcmeAccountEntity {
  return {
    id: 'acme-account-1',
    tenantId,
    providerId: 'caprov-acme',
    directoryUrlHash: '4'.repeat(64),
    accountUrl: 'https://acme.example.test/account/1',
    accountKeySecretRef: 'secret://certificate_private_key/account#current',
    contact: ['mailto:pki@example.com'],
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
}

function orderEntity(): AcmeOrderEntity {
  return {
    id: 'acme-order-1',
    tenantId,
    providerId: 'caprov-acme',
    accountId: 'acme-account-1',
    certificateRequestId: 'certreq-acme-1',
    externalOrderUrl: 'https://acme.example.test/order/1',
    status: 'pending',
    identifiers: [{ type: 'dns', value: 'app.example.com' }],
    authorizationUrls: ['https://acme.example.test/authz/1'],
    finalizeUrl: 'https://acme.example.test/order/1/finalize',
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function policyEntity(): AcmeRenewalPolicyEntity {
  return {
    id: 'acme-policy-1',
    tenantId,
    certificateAssetId: 'certasset-acme',
    providerId: 'caprov-acme',
    accountId: 'acme-account-1',
    enabled: true,
    renewalWindowDays: 30,
    challengeType: 'http-01',
    rotateKeyOnRenewal: true,
    deploymentMode: 'automatic',
    maxAttempts: 5,
    backoffSeconds: 300,
    status: 'active',
    version: 1,
    createdBy: 'user-admin',
    createdAt: now,
    updatedAt: now,
  };
}

function renewalJobEntity(): AcmeRenewalJobEntity {
  return {
    id: 'renew-acme-1',
    tenantId,
    certificateVersionId: 'certver-acme-old',
    sourceCertificateVersionId: 'certver-acme-old',
    renewalWindowKey: '2026-08-20:acme-policy-1',
    status: 'scheduled',
    policyId: 'acme-policy-1',
    promotionStatus: 'pending',
    attemptCount: 0,
    nextAttemptAt: now,
    policySnapshot: { policyId: 'acme-policy-1', version: 1 },
    scheduledAt: now,
    createdAt: now,
    updatedAt: now,
  };
}
