import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runMigrations } from '../../../database/migration-runner.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { CertificatesApplicationService } from '../application/certificates.application-service.js';

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

test('TrustRootsApplicationService 能从控制面宿主根库推断缺失的历史根证书', async () => {
  const db = new PgliteDatabase();
  try {
    await runMigrations(db);
    const certificates = createCertificatesApplicationService(db);
    const chain = createPemChainFixture();
    const pemBlocks = chain.pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
    const incompletePem = pemBlocks.slice(0, 2).join('\n');
    const rootPem = pemBlocks[2]!;

    await withSslCertFile(rootPem, async () => {
      const imported = await certificates.importVersion({
        tenantId: 'tenant_1',
        certificatePem: incompletePem,
        privateKeyPem: chain.privateKeyPem,
        createdBy: 'user_root_incomplete',
      });

      const page = await certificates.getTrustRoots().listRoots({
        page: 1,
        pageSize: 20,
        filter: {},
      });

      assert.equal(page.total, 1);
      assert.equal(page.managedSummary.totalVersions, 1);
      assert.equal(page.managedSummary.resolvedVersions, 1);
      assert.equal(page.managedSummary.missingVersions, 0);
      const detail = await certificates.getTrustRoots().getRootDetail(page.items[0]!.id, 'tenant_1');
      assert.equal(detail.versionRelations[0]?.certificateVersionId, imported.version.id);
      assert.equal(detail.observations[0]?.sourceType, 'openssl');
    });
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
  const dir = mkdtempSync(join(tmpdir(), 'gcac-root-backfill-'));
  try {
    runOpenSsl(dir, 'genrsa', '-out', 'root.key', '2048');
    runOpenSsl(dir, 'req', '-x509', '-new', '-nodes', '-key', 'root.key', '-sha256', '-days', '3650', '-subj', '/CN=Root CA/O=GCAC', '-out', 'root.pem');

    runOpenSsl(dir, 'genrsa', '-out', 'intermediate.key', '2048');
    runOpenSsl(dir, 'req', '-new', '-key', 'intermediate.key', '-subj', '/CN=Intermediate CA/O=GCAC', '-out', 'intermediate.csr');
    writeFileSync(join(dir, 'intermediate.ext'), 'basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n');
    runOpenSsl(dir, 'x509', '-req', '-in', 'intermediate.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-CAcreateserial', '-out', 'intermediate.pem', '-days', '1000', '-sha256', '-extfile', 'intermediate.ext');

    runOpenSsl(dir, 'genrsa', '-out', 'leaf.key', '2048');
    runOpenSsl(dir, 'req', '-new', '-key', 'leaf.key', '-subj', '/CN=leaf.example.test/O=GCAC', '-out', 'leaf.csr');
    writeFileSync(join(dir, 'leaf.ext'), 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:leaf.example.test,DNS:api.example.test\n');
    runOpenSsl(dir, 'x509', '-req', '-in', 'leaf.csr', '-CA', 'intermediate.pem', '-CAkey', 'intermediate.key', '-CAcreateserial', '-out', 'leaf.pem', '-days', '365', '-sha256', '-extfile', 'leaf.ext');

    return {
      pem: [
        readFileSync(join(dir, 'leaf.pem'), 'utf8'),
        readFileSync(join(dir, 'intermediate.pem'), 'utf8'),
        readFileSync(join(dir, 'root.pem'), 'utf8'),
      ].join('\n'),
      privateKeyPem: readFileSync(join(dir, 'leaf.key'), 'utf8'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runOpenSsl(cwd: string, ...args: string[]): void {
  execFileSync('openssl', args, { cwd, stdio: 'ignore' });
}

async function withSslCertFile<T>(pem: string, action: () => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'gcac-root-source-'));
  const file = join(dir, 'ca-bundle.pem');
  const previous = process.env.SSL_CERT_FILE;
  try {
    writeFileSync(file, pem);
    process.env.SSL_CERT_FILE = file;
    return await action();
  } finally {
    if (previous) process.env.SSL_CERT_FILE = previous;
    else delete process.env.SSL_CERT_FILE;
    rmSync(dir, { recursive: true, force: true });
  }
}
