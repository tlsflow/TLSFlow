import assert from 'node:assert/strict';
import test from 'node:test';
import { runMigrations } from '../../../database/migration-runner.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { CertificatesApplicationService } from '../application/certificates.application-service.js';
import { createCertificateTestFixture } from '../certificate-test-fixtures.js';

test('TrustRootsApplicationService 能从已纳管证书回填根库和版本关联', async () => {
  const db = new PgliteDatabase();
  try {
    await runMigrations(db);
    const certificates = createCertificatesApplicationService(db);
    const chain = createPemChainFixture();

    const imported = await certificates.importVersion({
      tenantId: 'tenant_1',
      certificatePem: chain.pem,
      privateKeyPem: chain.privateKeyPem,
      createdBy: 'user_root_backfill',
    });

    await db.query('delete from pg_certificate_version_trust_roots');
    await db.query('delete from pg_root_certificate_source_observations');
    await db.query('delete from pg_root_certificate_records');

    const page = await certificates.getTrustRoots().listRoots({
      page: 1,
      pageSize: 20,
      filter: {},
    });

    assert.equal(page.total, 1);
    assert.equal(page.items.length, 1);
    assert.equal(page.managedSummary.totalVersions, 1);
    assert.equal(page.managedSummary.resolvedVersions, 1);
    assert.equal(page.managedSummary.missingVersions, 0);
    const root = page.items[0]!;
    const detail = await certificates.getTrustRoots().getRootDetail(root.id, 'tenant_1');
    assert.equal(detail.versionRelations.length, 1);
    assert.equal(detail.versionRelations[0]?.certificateVersionId, imported.version.id);
    assert.equal(detail.versionRelations[0]?.resolutionStatus, 'resolved');
    assert.equal(detail.observations.length, 1);
    assert.equal(detail.observations[0]?.sourceRef, `certificate_version:${imported.version.id}`);
  } finally {
    await db.close();
  }
});

test('TrustRootsApplicationService 会为历史证书自动补回缺失的根关联', async () => {
  const db = new PgliteDatabase();
  try {
    await runMigrations(db);
    const certificates = createCertificatesApplicationService(db);
    const chain = createPemChainFixture();

    const imported = await certificates.importVersion({
      tenantId: 'tenant_1',
      certificatePem: chain.pem,
      privateKeyPem: chain.privateKeyPem,
      createdBy: 'user_root_relation_backfill',
    });

    await db.query('delete from pg_certificate_version_trust_roots');

    const detail = await certificates.getVersionDetail(imported.version.id, 'tenant_1');
    assert.ok(detail.trustRoots);

    assert.equal(detail.trustRoots.length, 1);
    assert.equal(detail.trustRoots[0]?.relation, 'selected_root');
    assert.equal(detail.trustRoots[0]?.resolutionStatus, 'resolved');
  } finally {
    await db.close();
  }
});

test('TrustRootsApplicationService 在控制面宿主也找不到根时不会伪造根记录', async () => {
  const db = new PgliteDatabase();
  try {
    await runMigrations(db);
    const certificates = createCertificatesApplicationService(db);
    const chain = createPemChainFixture();
    const pemBlocks = chain.pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
    const incompletePem = pemBlocks.slice(0, 2).join('\n');

    await certificates.importVersion({
      tenantId: 'tenant_1',
      certificatePem: incompletePem,
      privateKeyPem: chain.privateKeyPem,
      createdBy: 'user_root_missing',
    });

    const page = await certificates.getTrustRoots().listRoots({
      page: 1,
      pageSize: 20,
      filter: {},
    });

    assert.equal(page.total, 0);
    assert.equal(page.managedSummary.totalVersions, 1);
    assert.equal(page.managedSummary.resolvedVersions, 0);
    assert.equal(page.managedSummary.missingVersions, 1);
  } finally {
    await db.close();
  }
});

test('TrustRootsApplicationService 会用项目根库补齐不完整链的根关联', async () => {
  const db = new PgliteDatabase();
  try {
    await runMigrations(db);
    const certificates = createCertificatesApplicationService(db);
    const chain = createPemChainFixture();
    const pemBlocks = chain.pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
    await certificates.getTrustRoots().importRoot({
      tenantId: 'tenant_1',
      certificatePem: pemBlocks[2],
      createdBy: 'user_root_library',
    });

    const imported = await certificates.importVersion({
      tenantId: 'tenant_1',
      certificatePem: pemBlocks.slice(0, 2).join('\n'),
      privateKeyPem: chain.privateKeyPem,
      createdBy: 'user_root_library_version',
    });

    const storedRelations = await db.query<{ resolution_status: string }>(
      'select resolution_status from pg_certificate_version_trust_roots where certificate_version_id = $1',
      [imported.version.id],
    );
    assert.equal(storedRelations.rows[0]?.resolution_status, 'resolved');

    const detail = await certificates.getVersionDetail(imported.version.id, 'tenant_1');
    assert.equal(detail.trustRoots?.length, 1);
    assert.equal(detail.trustRoots?.[0]?.resolutionStatus, 'resolved');
  } finally {
    await db.close();
  }
});

test('TrustRootsApplicationService 拒绝把非自签名 CA 当作根证书导入', async () => {
  const db = new PgliteDatabase();
  try {
    await runMigrations(db);
    const certificates = createCertificatesApplicationService(db);
    const chain = createPemChainFixture();
    const intermediatePem = chain.pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)?.[1];
    assert.ok(intermediatePem);
    await assert.rejects(
      () => certificates.getTrustRoots().importRoot({
        tenantId: 'tenant_1',
        certificatePem: intermediatePem,
        createdBy: 'user_root_reject_intermediate',
      }),
      (error: unknown) => error instanceof Error && error.message.includes('不是有效的 CA 根证书'),
    );
  } finally {
    await db.close();
  }
});

test('TrustRootsApplicationService 只统计资产当前版本，不显示旧版本根视图', async () => {
  const db = new PgliteDatabase();
  try {
    await runMigrations(db);
    const certificates = createCertificatesApplicationService(db);
    const chain = createPemChainFixture();
    const imported = await certificates.importVersion({
      tenantId: 'tenant_1',
      certificatePem: chain.pem,
      privateKeyPem: chain.privateKeyPem,
      createdBy: 'user_root_current_version',
    });

    await certificates.getRepository().createVersion({
      ...imported.version,
      id: 'certver_historical_root_view',
      versionNo: imported.version.versionNo + 1,
      fingerprintSha256: 'a'.repeat(64),
      publicKeyFingerprintSha256: 'b'.repeat(64),
      chainStatus: 'incomplete',
      chainDiagnostics: ['历史版本链不完整'],
      activationState: 'staged',
      status: 'active',
      createdAt: '2026-08-01T00:00:00.000Z',
    });

    const page = await certificates.getTrustRoots().listRoots({
      page: 1,
      pageSize: 20,
      filter: {},
    });

    assert.equal(page.managedSummary.totalVersions, 1);
    assert.equal(page.managedSummary.resolvedVersions, 1);
    assert.equal(page.managedSummary.missingVersions, 0);

    await certificates.getRepository().updateVersion(imported.version.id, {
      notAfter: '2020-01-01T00:00:00.000Z',
    });
    await db.query('delete from pg_certificate_version_trust_roots where certificate_version_id = $1', [imported.version.id]);
    const expiredPage = await certificates.getTrustRoots().listRoots({
      page: 1,
      pageSize: 20,
      filter: {},
    });
    // 过期的当前版本仍代表资产当前事实，根关联不能因过期而丢失；历史版本才不进入根视图。
    assert.equal(expiredPage.managedSummary.totalVersions, 1);
    assert.equal(expiredPage.managedSummary.resolvedVersions, 1);
    assert.equal(expiredPage.managedSummary.missingVersions, 0);
  } finally {
    await db.close();
  }
});

test('TrustRootsApplicationService 会纠正当前版本指向的错误根关系', async () => {
  const db = new PgliteDatabase();
  try {
    await runMigrations(db);
    const certificates = createCertificatesApplicationService(db);
    const chain = createPemChainFixture();
    const imported = await certificates.importVersion({
      tenantId: 'tenant_1',
      certificatePem: chain.pem,
      privateKeyPem: chain.privateKeyPem,
      createdBy: 'user_root_stale_relation',
    });
    const staleRootId = 'trustroot_stale_relation';
    await db.query(
      `insert into pg_root_certificate_records (
         id, fingerprint_sha256, certificate_artifact_ref, subject, issuer, serial_number,
         not_before, not_after, basic_constraints, validation_status, created_at, updated_at
       ) values ($1, $2, $3, $4::jsonb, $4::jsonb, $5, $6::timestamptz, $7::timestamptz, $8::jsonb, 'verified', $9::timestamptz, $9::timestamptz)`,
      [
        staleRootId,
        'a'.repeat(64),
        'artifact://trust-root/stale-relation',
        JSON.stringify({ raw: 'CN=Stale Root', commonName: 'Stale Root' }),
        'stale-serial',
        '2020-01-01T00:00:00.000Z',
        '2040-01-01T00:00:00.000Z',
        JSON.stringify({ ca: true }),
        new Date().toISOString(),
      ],
    );
    await db.query(
      `update pg_certificate_version_trust_roots
          set root_certificate_id = $1
        where certificate_version_id = $2
          and relation = 'selected_root'`,
      [staleRootId, imported.version.id],
    );

    const page = await certificates.getTrustRoots().listRoots({ page: 1, pageSize: 20, filter: {} });
    const corrected = page.managedSummary.items.find((item) => item.certificateVersionId === imported.version.id);
    assert.equal(corrected?.rootFingerprintSha256, imported.version.chainOrder.at(-1));
    assert.equal(corrected?.rootStatus, 'resolved');
  } finally {
    await db.close();
  }
});

function createCertificatesApplicationService(db: PgliteDatabase): CertificatesApplicationService {
  return new CertificatesApplicationService({
    db,
    secrets: {
      create: async () => ({
        secretRef: 'secret://certificate_private_key/test#current',
      }),
    } as never,
  });
}

function createPemChainFixture(): { pem: string; privateKeyPem: string } {
  return createCertificateTestFixture();
}
