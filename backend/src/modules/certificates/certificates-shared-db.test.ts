import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createApp } from '../../app.module.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { createSecurityServices } from '../security/security.controller.js';

describe('证书模块共享数据库回归', () => {
  it('导入后读取证书资产列表应命中同一份数据库', async () => {
    const db = new PgliteDatabase();
    await runMigrations(db);
    const chain = createPemChainFixture();
    const security = createSecurityServices();
    grantUnrestrictedObjectVisibility(security, 'user_shared_db');
    for (const action of ['certificate.read', 'certificate.create', 'certificate.import', 'certificate.format.create', 'certificate.lifecycle']) {
      security.rbac.createPolicy({
        subjectType: 'user',
        subjectId: 'user_shared_db',
        effect: 'allow',
        actions: [action],
        resourceTypes: ['certificate_asset', 'certificate_version', 'certificate_version_format'],
        scope: { tenantId: 'tenant_1' },
      });
    }

    const app = createApp({
      db,
      corePersistence: { mode: 'memory' },
      security,
    });

    const imported = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: { 'x-tenant-id': 'tenant_1', 'x-actor-id': 'user_shared_db' },
      body: { certificatePem: chain.pem, privateKeyPem: chain.privateKeyPem },
    });
    assert.equal(imported.statusCode, 201);

    const listed = await app.inject({
      method: 'GET',
      path: '/api/v1/certificate-assets',
      headers: { 'x-tenant-id': 'tenant_1', 'x-actor-id': 'user_shared_db' },
    });
    assert.equal(listed.statusCode, 200);
    assert.equal((listed.body as any).total, 1);
    assert.equal((listed.body as any).items[0].primaryDomain, 'leaf.example.test');
  });

  it('同一证书域名重复导入不同证书时应归并为同一资产的多个版本', async () => {
    const db = new PgliteDatabase();
    await runMigrations(db);
    const firstChain = createPemChainFixture('same-domain.example.test');
    const secondChain = createPemChainFixture('same-domain.example.test');
    const security = createSecurityServices();
    grantUnrestrictedObjectVisibility(security, 'user_same_domain');
    for (const action of ['certificate.read', 'certificate.create', 'certificate.import', 'certificate.format.create', 'certificate.lifecycle']) {
      security.rbac.createPolicy({
        subjectType: 'user',
        subjectId: 'user_same_domain',
        effect: 'allow',
        actions: [action],
        resourceTypes: ['certificate_asset', 'certificate_version', 'certificate_version_format'],
        scope: { tenantId: 'tenant_1' },
      });
    }

    const app = createApp({ db, corePersistence: { mode: 'memory' }, security });
    const headers = { 'x-tenant-id': 'tenant_1', 'x-actor-id': 'user_same_domain' };

    const firstImport = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers,
      body: { certificatePem: firstChain.pem, privateKeyPem: firstChain.privateKeyPem },
    });
    assert.equal(firstImport.statusCode, 201, JSON.stringify(firstImport.body));

    const secondImport = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers,
      body: { certificatePem: secondChain.pem, privateKeyPem: secondChain.privateKeyPem },
    });
    assert.equal(secondImport.statusCode, 201, JSON.stringify(secondImport.body));
    assert.equal((secondImport.body as any).asset.id, (firstImport.body as any).asset.id);
    assert.equal((secondImport.body as any).version.versionNo, 2);

    const listedAssets = await app.inject({ method: 'GET', path: '/api/v1/certificate-assets', headers });
    assert.equal(listedAssets.statusCode, 200);
    assert.equal((listedAssets.body as any).total, 1);

    const listedVersions = await app.inject({
      method: 'GET',
      path: `/api/v1/certificate-versions?filter[certificateAssetId]=${(firstImport.body as any).asset.id}`,
      headers,
    });
    assert.equal(listedVersions.statusCode, 200);
    assert.equal((listedVersions.body as any).total, 2);
  });

  it('已删除的证书版本不应继续占用 fingerprint，应允许重新导入', async () => {
    const db = new PgliteDatabase();
    await runMigrations(db);
    const chain = createPemChainFixture();
    const security = createSecurityServices();
    grantUnrestrictedObjectVisibility(security, 'user_reimport_deleted');
    for (const action of ['certificate.read', 'certificate.create', 'certificate.import', 'certificate.format.create', 'certificate.lifecycle']) {
      security.rbac.createPolicy({
        subjectType: 'user',
        subjectId: 'user_reimport_deleted',
        effect: 'allow',
        actions: [action],
        resourceTypes: ['certificate_asset', 'certificate_version', 'certificate_version_format'],
        scope: { tenantId: 'tenant_1' },
      });
    }

    const app = createApp({
      db,
      corePersistence: { mode: 'memory' },
      security,
    });

    const firstImport = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: { 'x-tenant-id': 'tenant_1', 'x-actor-id': 'user_reimport_deleted' },
      body: { certificatePem: chain.pem, privateKeyPem: chain.privateKeyPem },
    });
    assert.equal(firstImport.statusCode, 201);
    const firstVersionId = (firstImport.body as any).version.id;

    const deleted = await app.inject({
      method: 'DELETE',
      path: `/api/v1/certificate-versions/delete?id=${firstVersionId}`,
      headers: { 'x-tenant-id': 'tenant_1', 'x-actor-id': 'user_reimport_deleted' },
    });
    assert.equal(deleted.statusCode, 200);
    assert.equal((deleted.body as any).status, 'deleted');

    const reimported = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: { 'x-tenant-id': 'tenant_1', 'x-actor-id': 'user_reimport_deleted' },
      body: { certificatePem: chain.pem, privateKeyPem: chain.privateKeyPem },
    });
    assert.equal(reimported.statusCode, 201);
    assert.notEqual((reimported.body as any).version.id, firstVersionId);
    assert.equal((reimported.body as any).version.fingerprintSha256, (firstImport.body as any).version.fingerprintSha256);

    const listed = await app.inject({
      method: 'GET',
      path: '/api/v1/certificate-versions',
      headers: { 'x-tenant-id': 'tenant_1', 'x-actor-id': 'user_reimport_deleted' },
    });
    assert.equal(listed.statusCode, 200);
    assert.equal((listed.body as any).total, 1);
  });
});

function grantUnrestrictedObjectVisibility(security: ReturnType<typeof createSecurityServices>, actorId: string): void {
  security.rbac.createPolicy({
    subjectType: 'user',
    subjectId: actorId,
    effect: 'allow',
    actions: ['*'],
    resourceTypes: ['*'],
    scope: { tenantId: 'tenant_1' },
  });
}

function createPemChainFixture(commonName = 'leaf.example.test'): { pem: string; privateKeyPem: string } {
  const dir = mkdtempSync(join(tmpdir(), 'gcac-cert-chain-regression-'));
  try {
    runOpenSsl(dir, 'genrsa', '-out', 'root.key', '2048');
    runOpenSsl(dir, 'req', '-x509', '-new', '-nodes', '-key', 'root.key', '-sha256', '-days', '3650', '-subj', '/CN=Root CA/O=GCAC', '-out', 'root.pem');

    runOpenSsl(dir, 'genrsa', '-out', 'intermediate.key', '2048');
    runOpenSsl(dir, 'req', '-new', '-key', 'intermediate.key', '-subj', '/CN=Intermediate CA/O=GCAC', '-out', 'intermediate.csr');
    writeFileSync(join(dir, 'intermediate.ext'), 'basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n');
    runOpenSsl(dir, 'x509', '-req', '-in', 'intermediate.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-CAcreateserial', '-out', 'intermediate.pem', '-days', '1000', '-sha256', '-extfile', 'intermediate.ext');

    runOpenSsl(dir, 'genrsa', '-out', 'leaf.key', '2048');
    runOpenSsl(dir, 'req', '-new', '-key', 'leaf.key', '-subj', `/CN=${commonName}/O=GCAC`, '-out', 'leaf.csr');
    writeFileSync(join(dir, 'leaf.ext'), `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:${commonName},DNS:api.${commonName}\n`);
    runOpenSsl(dir, 'x509', '-req', '-in', 'leaf.csr', '-CA', 'intermediate.pem', '-CAkey', 'intermediate.key', '-CAcreateserial', '-out', 'leaf.pem', '-days', '365', '-sha256', '-extfile', 'leaf.ext');

    return {
      pem: [readFileSync(join(dir, 'leaf.pem'), 'utf8'), readFileSync(join(dir, 'intermediate.pem'), 'utf8'), readFileSync(join(dir, 'root.pem'), 'utf8')].join('\n'),
      privateKeyPem: readFileSync(join(dir, 'leaf.key'), 'utf8'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runOpenSsl(cwd: string, ...args: string[]): void {
  execFileSync('openssl', args, { cwd, stdio: 'ignore' });
}
