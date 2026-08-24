import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../../app.module.js';
import type { App } from '../../common/http/app.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { createSecurityServices } from '../security/security.controller.js';
import { createCertificateTestFixture } from './certificate-test-fixtures.js';

describe('证书链导入校验', () => {
  it('缺失根证书时允许导入并返回警告', async () => {
    const chain = createPemChainFixture();
    const pemBlocks = chain.pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
    const incompletePem = pemBlocks.slice(0, 2).join('\n');
    const { app } = await createAuthorizedApp('user_chain_missing_root');
    const response = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: headers('user_chain_missing_root'),
      body: { certificatePem: incompletePem, privateKeyPem: chain.privateKeyPem },
    });

    assert.equal(response.statusCode, 201);
    assert.equal((response.body as any).diagnostics.chainStatus, 'incomplete');
    assert.match(JSON.stringify((response.body as any).diagnostics.chainDiagnostics), /缺少签发者证书/);
  });

  it('缺失中间证书时仍然拒绝导入', async () => {
    const chain = createPemChainFixture();
    const pemBlocks = chain.pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
    const invalidPem = [pemBlocks[0], pemBlocks[2]].filter(Boolean).join('\n');
    const { app } = await createAuthorizedApp('user_chain_missing_intermediate');
    const response = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: headers('user_chain_missing_intermediate'),
      body: { certificatePem: invalidPem, privateKeyPem: chain.privateKeyPem },
    });

    assert.equal(response.statusCode, 422);
    assert.equal((response.body as any).errorCode, 'CERT_PARSE_FAILED');
    assert.match(JSON.stringify((response.body as any).details.blockers), /缺少签发者证书/);
  });

  it('leaf 直接挂到错误根证书时拒绝导入', async () => {
    const validChain = createPemChainFixture();
    const validBlocks = validChain.pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
    const wrongRootChain = createCertificateTestFixture('alternate');
    const wrongRootBlocks = wrongRootChain.pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
    const invalidPem = [validBlocks[0], wrongRootBlocks[0]].filter(Boolean).join('\n');
    const { app } = await createAuthorizedApp('user_chain_invalid');
    const response = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: headers('user_chain_invalid'),
      body: { certificatePem: invalidPem, privateKeyPem: validChain.privateKeyPem },
    });

    assert.equal(response.statusCode, 422);
    assert.equal((response.body as any).errorCode, 'CERT_PARSE_FAILED');
    assert.match(JSON.stringify((response.body as any).details.blockers), /缺少签发者证书|证书签名校验失败/);
  });
});

async function createAuthorizedApp(actorId: string) {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const security = createSecurityServices();
  for (const action of ['certificate.read', 'certificate.create', 'certificate.import', 'certificate.format.create', 'certificate.lifecycle']) {
    security.rbac.createPolicy({
      subjectType: 'user',
      subjectId: actorId,
      effect: 'allow',
      actions: [action],
      resourceTypes: ['certificate_asset', 'certificate_version', 'certificate_version_format'],
      scope: { tenantId: 'tenant_1' },
    });
  }
  return { app: configureTestAuth(createApp({ db, corePersistence: { mode: 'memory' }, security })) };
}

function headers(actorId: string) {
  return { authorization: `Bearer ${actorId}|tenant_1`, 'x-tenant-id': 'tenant_1', 'x-actor-id': actorId };
}

function createPemChainFixture(): { pem: string; privateKeyPem: string } {
  return createCertificateTestFixture();
}

function configureTestAuth(app: App): App {
  app.setAuthTokenResolver((authorization) => {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined;
    const [actorId, tenantId] = token?.split('|') ?? [];
    return actorId && tenantId ? { actorId, tenantId } : undefined;
  });
  return app;
}
