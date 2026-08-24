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
