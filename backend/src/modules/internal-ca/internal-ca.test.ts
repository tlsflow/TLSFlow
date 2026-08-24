import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { createCertificateServices } from '../certificates/index.js';
import { createSecurityServices } from '../security/security.controller.js';
import { createApp } from '../../app.module.js';
import { InternalCaApplicationService } from './application/internal-ca.application-service.js';
import { getInternalCaRouteContracts } from './controller/internal-ca.controller.js';

const previousSecretKek = process.env.GCAC_SECRET_KEK;
const previousCaConfirmationSecret = process.env.GCAC_CA_CONFIRMATION_SECRET;

before(() => {
  process.env.GCAC_SECRET_KEK = 'test-secret-kek-for-internal-ca';
  process.env.GCAC_CA_CONFIRMATION_SECRET = 'test-ca-confirmation-secret';
});

after(() => {
  if (previousSecretKek === undefined) delete process.env.GCAC_SECRET_KEK;
  else process.env.GCAC_SECRET_KEK = previousSecretKek;
  if (previousCaConfirmationSecret === undefined) delete process.env.GCAC_CA_CONFIRMATION_SECRET;
  else process.env.GCAC_CA_CONFIRMATION_SECRET = previousCaConfirmationSecret;
});

async function createFixture() {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations');
  const security = createSecurityServices();
  const certificates = createCertificateServices(security, { db });
  const service = new InternalCaApplicationService({
    db,
    secrets: security.secrets,
    certificates: certificates.certificates,
    audit: security.audit,
    approvals: security.approvals,
  });
  return { db, service };
}

test('缺少 CA 风险确认密钥时拒绝执行拓扑预览', async () => {
  const current = process.env.GCAC_CA_CONFIRMATION_SECRET;
  delete process.env.GCAC_CA_CONFIRMATION_SECRET;
  const db = new PgliteDatabase();
  const security = createSecurityServices();
  const service = new InternalCaApplicationService({
    db,
    secrets: security.secrets,
    certificates: createCertificateServices(security, { db }).certificates,
  });
  try {
    assert.throws(
      () => service.previewAuthority({
        topologyMode: 'root_only',
        deploymentMode: 'builtin',
        runtimePlatform: 'embedded',
        availabilityMode: 'single',
        keyBackend: 'secret',
      }),
      (error: unknown) => error instanceof Error
        && 'errorCode' in error
        && error.errorCode === 'CA_RISK_CONFIRMATION_REQUIRED',
    );
  } finally {
    await db.close();
    if (current === undefined) delete process.env.GCAC_CA_CONFIRMATION_SECRET;
    else process.env.GCAC_CA_CONFIRMATION_SECRET = current;
  }
});

test('通用 CA 路由同时暴露宿主 ACME 生命周期和运营合同', () => {
  const routes = getInternalCaRouteContracts();
  const paths = routes.map((route) => route.path.toLowerCase());

  assert.ok(paths.every((path) => path.startsWith('/api/v1/ca-')
    || path.startsWith('/api/v1/certificate-')
    || path.startsWith('/api/v1/acme/')
    || path.startsWith('/api/v1/reports/')));
  assert.equal(paths.includes('/api/v1/certificate-authorities'), true);
  assert.equal(paths.includes('/api/v1/certificate-requests'), true);
  assert.equal(paths.includes('/api/v1/ca-operations/records'), true);
  assert.equal(paths.includes('/api/v1/acme/status'), true);
  assert.equal(paths.includes('/api/v1/acme/provider-profiles'), true);
  assert.equal(paths.includes('/api/v1/acme/certificates'), true);
  assert.equal(paths.some((path) => path.includes('certificate-acme')), false);
});

test('ACME 读取接口兼容证书管理的 certificate.read 权限合同', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations');
  const security = createSecurityServices();
  security.rbac.createPolicy({
    subjectType: 'user',
    subjectId: 'user-acme-read',
    effect: 'allow',
    actions: ['certificate.read'],
    resourceTypes: ['certificate_asset'],
    scope: { tenantId: 'tenant-acme-read' },
  });
  const app = createApp({ db, corePersistence: { mode: 'memory' }, security });
  app.setAuthTokenResolver(() => ({ actorId: 'user-acme-read', tenantId: 'tenant-acme-read' }));
  try {
    const status = await app.inject({
      method: 'GET',
      path: '/api/v1/acme/status',
      headers: { authorization: 'Bearer test', 'x-tenant-id': 'tenant-acme-read', 'x-actor-id': 'user-acme-read' },
    });
    const providers = await app.inject({
      method: 'GET',
      path: '/api/v1/acme/providers',
      headers: { authorization: 'Bearer test', 'x-tenant-id': 'tenant-acme-read', 'x-actor-id': 'user-acme-read' },
    });
    assert.equal(status.statusCode, 200, JSON.stringify(status.body));
    assert.equal(providers.statusCode, 200, JSON.stringify(providers.body));
  } finally {
    await db.close();
  }
});

test('通用 CA 对象可以创建并查询，不携带厂商执行语义', async () => {
  const { db, service } = await createFixture();
  try {
    const tenantId = 'tenant-generic-ca-lifecycle';
    const provider = await service.createProvider(tenantId, {
      name: '内置 CA 对象',
      type: 'gcac_builtin',
      deploymentMode: 'builtin',
      runtimePlatform: 'embedded',
      availabilityMode: 'single',
    }, 'user-admin');
    const preview = service.previewAuthority({
      topologyMode: 'root_only',
      deploymentMode: 'builtin',
      runtimePlatform: 'embedded',
      availabilityMode: 'single',
      keyBackend: 'secret',
    });
    const [authority] = await service.createAuthority(tenantId, {
      providerId: provider.id,
      name: '通用根 CA 对象',
      securityDomain: 'production',
      topologyMode: 'root_only',
      deploymentMode: 'builtin',
      runtimePlatform: 'embedded',
      availabilityMode: 'single',
      keyBackend: 'secret',
      confirmationToken: preview.confirmationToken,
      actorId: 'user-admin',
    });

    assert.equal(authority?.providerId, provider.id);
    assert.equal(authority?.role, 'root');
    assert.equal(authority?.subjectCommonName, '通用根 CA 对象');
    assert.equal((await service.listAuthorities(tenantId)).length, 1);
  } finally {
    await db.close();
  }
});

test('未绑定 PluginVersion 的外部 Provider 必须失败关闭', async () => {
  const { db, service } = await createFixture();
  try {
    await assert.rejects(
      () => service.createProvider('tenant-plugin-binding', {
        name: '未绑定版本的外部 Provider',
        type: 'plugin',
        deploymentMode: 'external',
        runtimePlatform: 'external',
        availabilityMode: 'single',
      }, 'user-admin'),
      (error: unknown) => error instanceof Error
        && 'errorCode' in error
        && error.errorCode === 'CA_PROVIDER_UNAVAILABLE',
    );
  } finally {
    await db.close();
  }
});
