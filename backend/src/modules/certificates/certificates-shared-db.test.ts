import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../../app.module.js';
import { AppError } from '../../common/errors/app-error.js';
import type { App } from '../../common/http/app.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { createSecurityServices } from '../security/security.controller.js';
import { createCertificateTestFixture, type CertificateTestFixture } from './certificate-test-fixtures.js';
import { CertificatesApplicationService } from './application/certificates.application-service.js';
import { PgCertificateArtifactStore } from './artifacts/certificate-artifact-store.js';

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

    const app = configureTestAuth(createApp({
      db,
      corePersistence: { mode: 'memory' },
      security,
    }));

    const imported = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: headers('user_shared_db'),
      body: { certificatePem: chain.pem, privateKeyPem: chain.privateKeyPem },
    });
    assert.equal(imported.statusCode, 201);

    const listed = await app.inject({
      method: 'GET',
      path: '/api/v1/certificate-assets',
      headers: headers('user_shared_db'),
    });
    assert.equal(listed.statusCode, 200);
    assert.equal((listed.body as any).total, 1);
    assert.equal((listed.body as any).items[0].primaryDomain, 'leaf.example.test');
  });

  it('默认证书产物配置文件启动补全幂等：按扩展名覆盖 10 种标准配置，容器格式携带密码，且不允许删除', async () => {
    const db = new PgliteDatabase();
    await runMigrations(db);
    const security = createSecurityServices();
    const artifacts = new PgCertificateArtifactStore(db);
    const certificates = new CertificatesApplicationService({ db, secrets: security.secrets, audit: security.audit, artifacts });

    const first = await certificates.ensureDefaultFormatConfigs('system');
    assert.equal(first.ensured, 10);

    // 幂等：再次补全不会重复创建或重复更新。
    const again = await certificates.ensureDefaultFormatConfigs('system');
    assert.equal(again.ensured, 0);

    const page = await certificates.listFormats({ page: 1, pageSize: 100, filter: {} });
    assert.equal(page.total, 10);
    const byExtension = new Map(page.items.map((item) => [String((item.parameters as Record<string, unknown>)?.extension), item]));
    assert.equal(byExtension.size, 10);
    // 无密钥格式
    for (const ext of ['der', 'cer']) assert.equal(byExtension.get(ext)?.containsPrivateKey, false, `${ext} 不应含私钥`);
    // 有密钥格式：PEM Bundle / PFX / P12 / JKS
    assert.equal(byExtension.get('pem')?.containsPrivateKey, true);
    assert.equal((byExtension.get('pem')?.parameters as Record<string, unknown>)?.includePrivateKey, true);
    for (const ext of ['pfx', 'p12', 'jks']) {
      assert.equal(byExtension.get(ext)?.containsPrivateKey, true, `${ext} 应含私钥`);
      assert.ok(byExtension.get(ext)?.passwordSecretRef, `${ext} 应携带密码 Secret`);
    }
    // CRT 为 PEM 证书文件（无密钥），P7B 系列为证书链（无密钥）
    assert.equal(byExtension.get('crt')?.containsPrivateKey, false);
    for (const ext of ['p7b', 'p7c', 'spc']) {
      assert.equal(byExtension.get(ext)?.containsPrivateKey, false, `${ext} 不应含私钥`);
      assert.equal((byExtension.get(ext)?.parameters as Record<string, unknown>)?.includeCertificateChain, true);
    }

    await assert.rejects(
      certificates.deleteFormat({ id: byExtension.get('pem')!.id, deletedBy: 'system' }),
      (error: unknown) => error instanceof AppError && error.errorCode === 'DEFAULT_CERTIFICATE_FORMAT_PROTECTED',
    );
  });

  it('过期证书 Artifact 读取失败并清理残留记录', async () => {
    const db = new PgliteDatabase();
    await runMigrations(db);
    const artifacts = new PgCertificateArtifactStore(db);
    await artifacts.put({
      tenantId: 'tenant-artifact-expiry', artifactRef: 'artifact://certificate-format/expired/test',
      content: Buffer.from('expired'), contentType: 'application/octet-stream', createdBy: 'test',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    assert.equal(await artifacts.get('artifact://certificate-format/expired/test', 'tenant-artifact-expiry'), undefined);
    assert.equal(Number((await db.query<{ count: string }>('select count(*)::text as count from pg_certificate_artifacts where tenant_id = $1', ['tenant-artifact-expiry'])).rows[0]?.count), 0);
    await db.close();
  });

  it('不同证书域名导入后应保留为独立资产和版本', async () => {
    const db = new PgliteDatabase();
    await runMigrations(db);
    const firstChain = createPemChainFixture();
    const secondChain = createPemChainFixture('alternate');
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

    const app = configureTestAuth(createApp({ db, corePersistence: { mode: 'memory' }, security }));
    const headers = testHeaders('user_same_domain');

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
    assert.notEqual((secondImport.body as any).asset.id, (firstImport.body as any).asset.id);
    assert.equal((secondImport.body as any).version.versionNo, 1);

    const listedAssets = await app.inject({ method: 'GET', path: '/api/v1/certificate-assets', headers });
    assert.equal(listedAssets.statusCode, 200);
    assert.equal((listedAssets.body as any).total, 2);

    const listedVersions = await app.inject({
      method: 'GET',
      path: `/api/v1/certificate-versions?filter[certificateAssetId]=${(firstImport.body as any).asset.id}`,
      headers,
    });
    assert.equal(listedVersions.statusCode, 200);
    assert.equal((listedVersions.body as any).total, 1);
  });

  it('已删除的证书版本不再出现在活动列表中，重复指纹仍受唯一性保护', async () => {
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

    const app = configureTestAuth(createApp({
      db,
      corePersistence: { mode: 'memory' },
      security,
    }));

    const firstImport = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: headers('user_reimport_deleted'),
      body: { certificatePem: chain.pem, privateKeyPem: chain.privateKeyPem },
    });
    assert.equal(firstImport.statusCode, 201);
    const firstVersionId = (firstImport.body as any).version.id;

    const deleted = await app.inject({
      method: 'DELETE',
      path: `/api/v1/certificate-versions/delete?id=${firstVersionId}`,
      headers: headers('user_reimport_deleted'),
    });
    assert.equal(deleted.statusCode, 200);
    assert.equal((deleted.body as any).status, 'deleted');

    const reimported = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: headers('user_reimport_deleted'),
      body: { certificatePem: chain.pem, privateKeyPem: chain.privateKeyPem },
    });
    assert.equal(reimported.statusCode, 409);
    assert.equal((reimported.body as any).errorCode, 'CERT_DUPLICATE_VERSION');

    const listed = await app.inject({
      method: 'GET',
      path: '/api/v1/certificate-versions',
      headers: headers('user_reimport_deleted'),
    });
    assert.equal(listed.statusCode, 200);
    assert.equal((listed.body as any).total, 0);
  });
});

function configureTestAuth(app: App): App {
  app.setAuthTokenResolver((authorization) => {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined;
    const [actorId, tenantId] = token?.split('|') ?? [];
    return actorId && tenantId ? { actorId, tenantId } : undefined;
  });
  return app;
}

function headers(actorId: string) {
  return testHeaders(actorId);
}

function testHeaders(actorId: string) {
  return { authorization: `Bearer ${actorId}|tenant_1`, 'x-tenant-id': 'tenant_1', 'x-actor-id': actorId };
}

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

function createPemChainFixture(kind: 'default' | 'alternate' = 'default'): CertificateTestFixture {
  return createCertificateTestFixture(kind);
}
