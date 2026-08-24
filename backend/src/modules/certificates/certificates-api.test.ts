import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../../app.module.js';
import type { App } from '../../common/http/app.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { createSecurityServices } from '../security/security.controller.js';
import { CertificatesApplicationService } from './application/certificates.application-service.js';
import { CertificateFormatExporter } from './application/certificate-format-exporter.js';
import { PgCertificateArtifactStore } from './artifacts/certificate-artifact-store.js';
import { createCertificateTestFixture } from './certificate-test-fixtures.js';
import { generateJksKeystore } from './codecs/jks-keystore.js';
import forge from 'node-forge';

const DEFAULT_CERTIFICATE_FIXTURE = createCertificateTestFixture();
const CERT_PEM = DEFAULT_CERTIFICATE_FIXTURE.pem;
const PRIVATE_KEY_PEM = DEFAULT_CERTIFICATE_FIXTURE.privateKeyPem;

describe('证书资产 API', () => {
  it('导入证书成功、重复指纹被拒绝、响应不泄露私钥', async () => {
    const { app } = await createAuthorizedApp('user_cert');
    const imported = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: headers('user_cert'),
      body: { certificatePem: CERT_PEM, privateKeyPem: PRIVATE_KEY_PEM, tags: ['prod'] },
    });

    assert.equal(imported.statusCode, 201, JSON.stringify(imported.body));
    const body = imported.body as any;
    assert.equal(body.version.commonName, 'leaf.example.test');
    assert.deepEqual(body.version.sans, ['leaf.example.test', 'api.example.test']);
    assert.equal(body.version.hasPrivateKey, true);
    assert.equal(body.version.privateKeySecretRef, undefined);
    assert.equal(body.version.chainStatus, 'valid');
    assert.equal(JSON.stringify(body).includes('BEGIN PRIVATE KEY'), false);
    assert.equal(JSON.stringify(body).includes(PRIVATE_KEY_PEM.split('\n')[1]!), false);

    const duplicated = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: headers('user_cert'),
      body: { certificatePem: CERT_PEM, allowCertificateOnly: true },
    });
    assert.equal(duplicated.statusCode, 409);
    assert.equal((duplicated.body as any).errorCode, 'CERT_DUPLICATE_VERSION');
  });

  it('证书资产、版本、格式和材料产物按租户隔离', async () => {
    const { app, artifacts } = await createMultiTenantAuthorizedApp();
    const tenantA = tenantHeaders('user_cert_tenant_a', 'tenant_a');
    const tenantB = tenantHeaders('user_cert_tenant_b', 'tenant_b');

    const importedA = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: tenantA,
      body: { certificatePem: CERT_PEM, allowCertificateOnly: true },
    });
    const importedB = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: tenantB,
      body: { certificatePem: CERT_PEM, allowCertificateOnly: true },
    });

    assert.equal(importedA.statusCode, 201, JSON.stringify(importedA.body));
    assert.equal(importedB.statusCode, 201, JSON.stringify(importedB.body));
    const assetA = (importedA.body as any).asset;
    const versionA = (importedA.body as any).version;

    const listA = await app.inject({ method: 'GET', path: '/api/v1/certificate-assets', headers: tenantA });
    const listB = await app.inject({ method: 'GET', path: '/api/v1/certificate-assets', headers: tenantB });
    assert.equal((listA.body as any).total, 1);
    assert.equal((listB.body as any).total, 1);

    const crossAsset = await app.inject({
      method: 'GET',
      path: `/api/v1/certificate-assets/${assetA.id}`,
      headers: tenantB,
    });
    const crossVersion = await app.inject({
      method: 'GET',
      path: `/api/v1/certificate-versions/detail?id=${versionA.id}`,
      headers: tenantB,
    });
    assert.equal(crossAsset.statusCode, 404);
    assert.equal(crossVersion.statusCode, 404);

    const crossExport = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-version-formats/export',
      headers: tenantB,
      body: { certificateVersionId: versionA.id, format: 'pem', containsPrivateKey: false },
    });
    assert.equal(crossExport.statusCode, 404);

    await artifacts.put({
      tenantId: 'tenant_a',
      artifactRef: 'artifact://certificate-tenant-isolation-test',
      content: Buffer.from('tenant-a'),
      contentType: 'application/octet-stream',
      createdBy: 'user_cert_tenant_a',
    });
    assert.equal(await artifacts.get('artifact://certificate-tenant-isolation-test', 'tenant_b'), undefined);
    await artifacts.put({
      tenantId: 'tenant_b',
      artifactRef: 'artifact://certificate-tenant-isolation-test',
      content: Buffer.from('tenant-b'),
      contentType: 'application/octet-stream',
      createdBy: 'user_cert_tenant_b',
    });
    assert.equal((await artifacts.get('artifact://certificate-tenant-isolation-test', 'tenant_a'))?.content.toString(), 'tenant-a');
    assert.equal((await artifacts.get('artifact://certificate-tenant-isolation-test', 'tenant_b'))?.content.toString(), 'tenant-b');
  });

  it('外部来源证书资产允许手动导入新版本', async () => {
    const manualFixture = createPemChainFixture();
    const db = new PgliteDatabase();
    await runMigrations(db);
    const certificates = new CertificatesApplicationService({
      db,
      secrets: {
        create: async () => ({
          secretRef: 'secret://certificate_private_key/manual#current',
        }),
      } as never,
    });
    const asset = await certificates.createAsset({
      name: 'leaf.example.test',
      primaryDomain: 'leaf.example.test',
      sans: ['api.example.test'],
      sourceType: 'external_api',
      tags: ['external-source'],
      createdBy: 'user_external_manual',
    });
    const imported = await certificates.importVersion({
      certificateAssetId: asset.id,
      certificatePem: manualFixture.pem,
      privateKeyPem: manualFixture.privateKeyPem,
      sourceType: 'manual',
      createdBy: 'user_external_manual',
    });

    assert.equal(imported.asset.id, asset.id);
    assert.equal(imported.asset.sourceType, 'external_api');
    assert.equal(imported.version.sourceType, 'manual');
    assert.equal(imported.asset.currentVersionId, imported.version.id);
  });

  it('多证书 PEM 能识别 leaf、链顺序和链状态', async () => {
    const chain = createPemChainFixture();
    const { app } = await createAuthorizedApp('user_chain');
    const imported = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: headers('user_chain'),
      body: { certificatePem: chain.pem, privateKeyPem: chain.privateKeyPem },
    });

    assert.equal(imported.statusCode, 201);
    const body = imported.body as any;
    assert.equal(body.version.commonName, 'leaf.example.test');
    assert.deepEqual(body.version.sans, ['leaf.example.test', 'api.example.test']);
    assert.equal(body.version.chainStatus, 'valid');
    assert.equal(body.version.chainOrder.length, 3);
    assert.equal(body.version.chainCertificateRefs.length, 2);
    assert.equal(body.diagnostics.chainStatus, 'valid');
    assert.match(body.diagnostics.chainDiagnostics.join('\n'), /自签根证书/);
  });

  it('证书版本列表支持域名、SAN、指纹和到期时间过滤', async () => {
    const { app } = await createAuthorizedApp('user_filter');
    const imported = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: headers('user_filter'),
      body: { certificatePem: CERT_PEM, allowCertificateOnly: true },
    });
    const version = (imported.body as any).version;

    for (const [field, value] of [
      ['primaryDomain', 'leaf.example.test'],
      ['commonName', 'leaf.example.test'],
      ['sans', 'api.example.test'],
      ['fingerprint', version.fingerprintSha256.slice(0, 16)],
      ['notAfter', version.notAfter.slice(0, 10)],
    ]) {
      const response = await app.inject({
        method: 'GET',
        path: `/api/v1/certificate-versions?filter[${field}]=${encodeURIComponent(value)}`,
        headers: headers('user_filter'),
      });
      assert.equal(response.statusCode, 200);
      assert.equal((response.body as any).total, 1, `${field} 应该能过滤到证书版本`);
    }
  });

  it('格式记录隐藏内部产物引用，列表分页和幂等可用', async () => {
    const { app } = await createAuthorizedApp('user_cert2');
    const imported = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: headers('user_cert2'),
      body: { certificatePem: CERT_PEM, privateKeyPem: PRIVATE_KEY_PEM },
    });
    const versionId = (imported.body as any).version.id;

    // 证书导入只保存公钥/私钥材料，不自动生成任何格式产物记录。
    const versionFormats = await app.inject({
      method: 'GET',
      path: `/api/v1/certificate-versions/${versionId}/formats`,
      headers: headers('user_cert2'),
    });
    assert.equal(versionFormats.statusCode, 200);
    assert.equal((versionFormats.body as any).items.length, 0);

    const format = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-version-formats',
      headers: headers('user_cert2'),
      body: {
        certificateVersionId: versionId,
        format: 'pfx',
        artifactRef: 'artifact://certificate-format/pfx_1',
        containsPrivateKey: true,
        passwordSecretRef: 'secret://pfx_password/sec_dummy#current',
        parameters: { alias: 'example' },
      },
    });

    assert.equal(format.statusCode, 201);
    assert.equal((format.body as any).artifactRef, undefined);
    assert.equal((format.body as any).format, 'pfx');
    assert.equal((format.body as any).certificateVersionId, versionId);
    assert.equal(JSON.stringify(format.body).includes('password123'), false);

    const repeatedFormat = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-version-formats',
      headers: headers('user_cert2'),
      body: {
        certificateVersionId: versionId,
        format: 'pfx',
        artifactRef: 'artifact://certificate-format/pfx_1_changed_should_not_win',
        containsPrivateKey: true,
        passwordSecretRef: 'secret://pfx_password/sec_dummy#current',
        parameters: { alias: 'example' },
      },
    });

    assert.equal(repeatedFormat.statusCode, 201);
    assert.equal((repeatedFormat.body as any).id, (format.body as any).id);
    assert.equal((repeatedFormat.body as any).artifactRef, undefined);

    const page = await app.inject({
      method: 'GET',
      path: '/api/v1/certificate-version-formats?page=1&pageSize=1&sort=createdAt:desc&filter[certificateVersionId]=' + versionId,
      headers: headers('user_cert2'),
    });
    assert.equal(page.statusCode, 200);
    assert.equal((page.body as any).page, 1);
    assert.equal((page.body as any).pageSize, 1);
    assert.equal((page.body as any).total, 1);
    assert.equal((page.body as any).items[0].certificateVersionId, versionId);
  });

  it('宿主默认证书产物配置文件不允许删除，用户自定义配置可删除', async () => {
    const { app } = await createAuthorizedApp('user_defaults');

    // 手工创建与宿主默认配置签名一致的配置（无证书版本、标准 PEM 参数）。
    const defaultLike = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-version-formats',
      headers: headers('user_defaults'),
      body: {
        format: 'pem',
        containsPrivateKey: true,
        parameters: { configName: '宿主默认 PEM Bundle', extension: 'pem', includeLeafCertificate: true, includeCertificateChain: true, includePrivateKey: true },
      },
    });
    assert.equal(defaultLike.statusCode, 201);

    const blockedDelete = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-version-formats/delete',
      headers: headers('user_defaults'),
      body: { id: (defaultLike.body as any).id },
    });
    assert.equal(blockedDelete.statusCode, 409);
    assert.equal((blockedDelete.body as any).errorCode, 'DEFAULT_CERTIFICATE_FORMAT_PROTECTED');

    const custom = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-version-formats',
      headers: headers('user_defaults'),
      body: {
        format: 'der',
        containsPrivateKey: false,
        parameters: { configName: '自定义 DER', publicEncoding: 'der' },
      },
    });
    assert.equal(custom.statusCode, 201);

    const allowedDelete = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-version-formats/delete',
      headers: headers('user_defaults'),
      body: { id: (custom.body as any).id },
    });
    assert.equal(allowedDelete.statusCode, 200);
  });

  it('未接入的 PFX 导出和来源同步都必须由 Plugin Runner 失败关闭', async () => {
    const { app } = await createAuthorizedMigratedApp('user_export_plan');
    const chain = createPemChainFixture();
    const imported = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: headers('user_export_plan'),
      body: { certificatePem: chain.pem, privateKeyPem: chain.privateKeyPem },
    });
    assert.equal(imported.statusCode, 201, `导入证书应成功：${JSON.stringify(imported.body)}`);
    const versionId = (imported.body as any).version.id;

    const missingPassword = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-version-formats/export-plan',
      headers: headers('user_export_plan'),
      body: { certificateVersionId: versionId, format: 'pfx', containsPrivateKey: true },
    });
    assert.ok([400, 422].includes(missingPassword.statusCode));
    assert.equal((missingPassword.body as any).errorCode, 'CERT_FORMAT_UNSUPPORTED');

    const unsupported = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-version-formats/export-plan',
      headers: headers('user_export_plan'),
      body: {
        certificateVersionId: versionId,
        format: 'pfx',
        containsPrivateKey: true,
        passwordSecretRef: 'secret://pfx_password/sec_dummy#current',
        parameters: { alias: 'example' },
      },
    });
    assert.equal(unsupported.statusCode, 422, JSON.stringify(unsupported.body));
    assert.equal((unsupported.body as any).errorCode, 'CERT_FORMAT_UNSUPPORTED');

    const source = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-sources/mock-sync',
      headers: headers('user_export_plan'),
      body: { sourceType: 'external_api', externalId: 'ext-cert-001' },
    });
    assert.equal(source.statusCode, 422, JSON.stringify(source.body));
    assert.equal((source.body as any).errorCode, 'CA_CAPABILITY_UNSUPPORTED');
  });



  it('格式能力声明准确区分宿主 PFX 导入和未实现的容器能力', async () => {
    const { app } = await createAuthorizedApp('user_formats');
    const capabilities = await app.inject({ method: 'GET', path: '/api/v1/certificate-formats/capabilities', headers: headers('user_formats') });
    assert.equal(capabilities.statusCode, 200);
    const formats = new Map((capabilities.body as any).formats.map((item: any) => [item.format, item]));
    assert.equal((formats.get('pem') as any).importSupported, true);
    assert.equal((formats.get('pfx') as any).importSupported, true);
    assert.equal((formats.get('pfx') as any).exportSupported, false);
    assert.equal((formats.get('pfx') as any).implementation, 'node_crypto');
    assert.equal((formats.get('jks') as any).importSupported, true);
    assert.equal((formats.get('jks') as any).exportSupported, true);
    assert.equal((formats.get('jks') as any).implementation, 'node_crypto');
    assert.equal((formats.get('p7b') as any).importSupported, false);
    assert.equal((formats.get('p7b') as any).exportSupported, false);
    assert.equal((formats.get('p7b') as any).implementation, 'controlled_error');
    assert.equal((formats.get('p7b') as any).containsPrivateKey, 'never');

    for (const body of [{ p7bBase64: Buffer.from('not-a-p7b').toString('base64') }]) {
      const response = await app.inject({ method: 'POST', path: '/api/v1/certificate-versions/import', headers: headers('user_formats'), body });
      assert.ok([400, 422].includes(response.statusCode));
      assert.equal((response.body as any).errorCode, 'CERT_FORMAT_UNSUPPORTED');
    }
    const invalidJks = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: headers('user_formats'),
      body: { jksBase64: Buffer.from('not-a-jks').toString('base64') },
    });
    assert.ok([400, 422].includes(invalidJks.statusCode));
    assert.notEqual((invalidJks.body as any).errorCode, 'CERT_FORMAT_UNSUPPORTED');
  });

  it('PFX 由宿主解析并保存证书链与私钥，错误密码不会创建半成品', async () => {
    const fixture = createPfxFixture();
    const { app } = await createAuthorizedApp('user_pfx');
    const imported = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: headers('user_pfx'),
      body: { declaredFormat: 'pfx', pfxBase64: fixture.pfxBase64, pfxPassword: fixture.password },
    });
    assert.equal(imported.statusCode, 201, JSON.stringify(imported.body));
    assert.equal((imported.body as any).diagnostics.sourceFormat, 'pfx');
    assert.equal((imported.body as any).version.hasPrivateKey, true);
    assert.equal(JSON.stringify(imported.body).includes(fixture.password), false);
    assert.equal(JSON.stringify(imported.body).includes('BEGIN PRIVATE KEY'), false);

    const { app: failedApp } = await createAuthorizedApp('user_pfx_bad_password');
    const failed = await failedApp.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: headers('user_pfx_bad_password'),
      body: { declaredFormat: 'pfx', pfxBase64: fixture.pfxBase64, pfxPassword: 'wrong-password' },
    });
    assert.equal(failed.statusCode, 422, JSON.stringify(failed.body));
    assert.equal((failed.body as any).errorCode, 'CERT_PARSE_FAILED');
    const assets = await failedApp.inject({ method: 'GET', path: '/api/v1/certificate-assets', headers: headers('user_pfx_bad_password') });
    assert.equal((assets.body as any).total, 0);
  });

  it('JKS 能导入证书和私钥，密码或 alias 错误不会创建半成品', async () => {
    const fixture = createJksFixture();
    const { app } = await createAuthorizedApp('user_jks');
    const imported = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: headers('user_jks'),
      body: { jksBase64: fixture.jksBase64, jksPassword: fixture.password, jksAlias: fixture.alias },
    });
    assert.equal(imported.statusCode, 201);
    const body = imported.body as any;
    assert.equal(body.diagnostics.sourceFormat, 'jks');
    assert.equal(body.version.hasPrivateKey, true);
    assert.equal(body.version.privateKeySecretRef, undefined);
    assert.equal(JSON.stringify(body).includes(fixture.password), false);
    assert.equal(JSON.stringify(body).includes('BEGIN PRIVATE KEY'), false);

    const badAlias = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: headers('user_jks'),
      body: { jksBase64: fixture.jksBase64, jksPassword: fixture.password, jksAlias: 'missing-alias' },
    });
    assert.equal(badAlias.statusCode, 422);
    assert.equal((badAlias.body as any).errorCode, 'CERT_PARSE_FAILED');
  });

  it('详情、usage 和生命周期 API 可用，删除会受使用位置保护', async () => {
    const { app } = await createAuthorizedApp('user_lifecycle');
    const imported = await app.inject({ method: 'POST', path: '/api/v1/certificate-versions/import', headers: headers('user_lifecycle'), body: { certificatePem: CERT_PEM, allowCertificateOnly: true } });
    const assetId = (imported.body as any).asset.id;
    const versionId = (imported.body as any).version.id;

    const detail = await app.inject({ method: 'GET', path: `/api/v1/certificate-assets/detail?id=${assetId}`, headers: headers('user_lifecycle') });
    assert.equal(detail.statusCode, 200);
    assert.equal((detail.body as any).versions.length, 1);

    const versionDetail = await app.inject({ method: 'GET', path: `/api/v1/certificate-versions/detail?id=${versionId}`, headers: headers('user_lifecycle') });
    assert.equal(versionDetail.statusCode, 200);
    assert.equal((versionDetail.body as any).asset.id, assetId);
    assert.ok(Array.isArray((versionDetail.body as any).chainCertificates));
    assert.equal((versionDetail.body as any).chainCertificates[0].role, 'leaf');
    assert.notEqual((versionDetail.body as any).chainCertificates[0].displayName, (versionDetail.body as any).chainCertificates[0].fingerprintSha256);

    const usage = await app.inject({ method: 'GET', path: `/api/v1/certificate-versions/usage?id=${versionId}`, headers: headers('user_lifecycle') });
    assert.equal(usage.statusCode, 200);
    assert.equal((usage.body as any).blockedDeletion, false);

    const revoked = await app.inject({ method: 'POST', path: '/api/v1/certificate-versions/revoke', headers: headers('user_lifecycle'), body: { id: versionId } });
    assert.equal(revoked.statusCode, 200);
    assert.equal((revoked.body as any).status, 'revoked');
    assert.equal((revoked.body as any).deployable, false);

    const deletedVersion = await app.inject({ method: 'DELETE', path: `/api/v1/certificate-versions/delete?id=${versionId}`, headers: headers('user_lifecycle') });
    assert.equal(deletedVersion.statusCode, 200);
    assert.equal((deletedVersion.body as any).status, 'deleted');

    const versionsAfterDelete = await app.inject({
      method: 'GET',
      path: `/api/v1/certificate-versions?filter[certificateAssetId]=${assetId}`,
      headers: headers('user_lifecycle'),
    });
    assert.equal(versionsAfterDelete.statusCode, 200);
    assert.equal((versionsAfterDelete.body as any).total, 0);

    const assetDetailAfterDelete = await app.inject({
      method: 'GET',
      path: `/api/v1/certificate-assets/detail?id=${assetId}`,
      headers: headers('user_lifecycle'),
    });
    assert.equal(assetDetailAfterDelete.statusCode, 200);
    assert.equal((assetDetailAfterDelete.body as any).versions.length, 0);
    assert.equal((assetDetailAfterDelete.body as any).currentVersion, undefined);

    const deletedAsset = await app.inject({ method: 'DELETE', path: '/api/v1/certificate-assets/delete', headers: headers('user_lifecycle'), body: { id: assetId } });
    assert.equal(deletedAsset.statusCode, 200);
    assert.equal((deletedAsset.body as any).status, 'deleted');
  });

  it('单条证书对象授权应放开版本详情和使用位置接口', async () => {
    const security = createSecurityServices();
    await security.rbac.createPolicy({
      subjectType: 'user',
      subjectId: 'user_cert_importer',
      effect: 'allow',
      actions: ['*'],
      resourceTypes: ['*'],
      scope: { tenantId: 'tenant_1' },
    });
    await security.rbac.createRole({ id: 'role_cert_object_reader', code: 'cert_object_reader', name: '证书对象只读', builtin: false });
    await security.objectPermissions.ensureDefaultObjectTypes();

    const db = new PgliteDatabase();
    await runMigrations(db);
    const app = configureTestAuth(createApp({ db, corePersistence: { mode: 'memory' }, security }));

    const imported = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: headers('user_cert_importer'),
      body: { certificatePem: CERT_PEM, allowCertificateOnly: true },
    });
    assert.equal(imported.statusCode, 201, JSON.stringify(imported.body));
    const assetId = (imported.body as any).asset.id;
    const versionId = (imported.body as any).version.id;

    const objectSet = await security.objectPermissions.createObjectSet({
      id: 'oset_single_cert_detail',
      tenantId: 'tenant_1',
      name: '单条证书详情授权',
      kind: 'static',
      objectTypes: ['certificate'],
      status: 'active',
    });
    await security.objectPermissions.addObjectSetMember({
      objectSetId: objectSet.id,
      objectType: 'certificate',
      objectId: assetId,
      addedBy: 'user_cert_importer',
    });
    await security.objectPermissions.createRoleBinding({
      tenantId: 'tenant_1',
      principalType: 'user',
      principalId: 'user_cert_object_reader',
      roleId: 'role_cert_object_reader',
      objectSetId: objectSet.id,
      effect: 'allow',
      enabled: true,
    });
    await security.objectPermissions.createAccessGrant({
      tenantId: 'tenant_1',
      roleId: 'role_cert_object_reader',
      objectSetId: objectSet.id,
      accessLevel: 'read',
      effect: 'allow',
    });

    const assetDetail = await app.inject({
      method: 'GET',
      path: `/api/v1/certificate-assets/detail?id=${assetId}`,
      headers: headers('user_cert_object_reader'),
    });
    assert.equal(assetDetail.statusCode, 200, JSON.stringify(assetDetail.body));

    const versionDetail = await app.inject({
      method: 'GET',
      path: `/api/v1/certificate-versions/detail?id=${versionId}`,
      headers: headers('user_cert_object_reader'),
    });
    assert.equal(versionDetail.statusCode, 200, JSON.stringify(versionDetail.body));
    assert.equal((versionDetail.body as any).asset.id, assetId);

    const versionUsage = await app.inject({
      method: 'GET',
      path: `/api/v1/certificate-versions/usage?id=${versionId}`,
      headers: headers('user_cert_object_reader'),
    });
    assert.equal(versionUsage.statusCode, 200, JSON.stringify(versionUsage.body));
    assert.equal((versionUsage.body as any).blockedDeletion, false);
  });

  it('证书版本 usage 支持按域名匹配真实绑定，即使绑定未直接挂到 certificateVersionId', async () => {
    const app = await createMigratedApp('user_usage_domain_match', 'tenant_usage_domain_match');
    const tenantHeaders = headersForTenant('user_usage_domain_match', 'tenant_usage_domain_match');
    const certificateFixture = createCertificateTestFixture();

    const imported = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: tenantHeaders,
      body: {
        certificatePem: certificateFixture.pem,
        privateKeyPem: certificateFixture.privateKeyPem,
      },
    });
    assert.equal(imported.statusCode, 201, JSON.stringify(imported.body));
    const versionId = (imported.body as any).version.id as string;

    const host = (await app.inject({
      method: 'POST',
      path: '/api/v1/hosts',
      headers: tenantHeaders,
      body: { hostname: 'win-jacksonz-01', primaryIp: '10.0.0.20', osType: 'WINDOWS', agentId: 'agent-jacksonz-01' },
    })).body as { id: string };

    const service = (await app.inject({
      method: 'POST',
      path: '/api/v1/framework-instances',
      headers: tenantHeaders,
      body: { deviceId: host.id, displayName: 'IIS on jacksonz', frameworkType: 'web.iis', rawFacts: { configPath: 'IIS:\\Sites'  }, frameworkKey: 'iis', discoveryProviderKey: 'manual:test' },
    })).body as { id: string };

    const siteAsset = (await app.inject({
      method: 'POST',
      path: '/api/v1/site-assets',
      headers: tenantHeaders,
      body: {
        serviceInstanceId: service.id,
        hostId: host.id,
        agentId: 'agent-jacksonz-01',
        providerType: 'IIS',
        siteType: 'WEB_SITE',
        siteName: 'Default Web Site',
        siteKey: 'agent-jacksonz-01:iis:default web site:https/*:443:test.jacksonz.cn',
        bindingInformation: 'https/*:443:test.jacksonz.cn',
        hostHeader: 'test.jacksonz.cn',
        port: 443,
        protocol: 'HTTPS',
        status: 'ACTIVE',
      },
    })).body as { id: string };

    const binding = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-bindings',
      headers: tenantHeaders,
      body: {
        serviceInstanceId: service.id,
        siteAssetId: siteAsset.id,
        domainName: 'leaf.example.test',
        port: 443,
        protocol: 'HTTPS',
        bindingType: 'WINDOWS_CERT_STORE',
        storeLocation: 'LocalMachine',
        storeName: 'My',
        storeThumbprint: '95D9A57D301B626A02B7BEF5E5218D6EAE3A55CA',
        verifyMethod: 'TLS_CONNECT',
        status: 'DISCOVERED',
      },
    });
    assert.equal(binding.statusCode, 201);

    const usage = await app.inject({
      method: 'GET',
      path: `/api/v1/certificate-versions/usage?id=${versionId}`,
      headers: tenantHeaders,
    });
    assert.equal(usage.statusCode, 200);
    const body = usage.body as {
      usages: Array<{
        binding?: { domainName?: string };
        serviceAsset?: { address?: string };
        service?: { displayName?: string };
        host?: { hostname?: string; agentId?: string };
      }>;
      blockedDeletion: boolean;
    };
    assert.equal(body.blockedDeletion, true);
    assert.ok(body.usages.some((item) => item.binding?.domainName === 'leaf.example.test'));
    assert.ok(body.usages.some((item) => item.serviceAsset?.address === 'leaf.example.test'));
    assert.ok(body.usages.some((item) => item.service?.displayName === 'IIS on jacksonz'));
    assert.ok(body.usages.some((item) => item.host?.agentId === 'agent-jacksonz-01'));
  });

  it('OpenAPI 包含新增证书 API', async () => {
    const { app } = await createAuthorizedApp('user_openapi');
    const response = await app.inject({ method: 'GET', path: '/api/v1/openapi.json', headers: headers('user_openapi') });
    assert.equal(response.statusCode, 200);
    const paths = (response.body as any).paths;
    assert.ok(paths['/api/v1/certificate-assets']);
    assert.ok(paths['/api/v1/certificate-formats/capabilities']);
    assert.ok(paths['/api/v1/certificate-assets/detail']);
    assert.ok(paths['/api/v1/certificate-versions/detail']);
    assert.ok(paths['/api/v1/certificate-versions/usage']);
    assert.ok(paths['/api/v1/certificate-versions/import']);
    assert.ok(paths['/api/v1/certificate-version-formats']);
    assert.ok(paths['/api/v1/certificate-version-formats/export-plan']);
    assert.ok(paths['/api/v1/certificate-version-formats/export']);
    assert.ok(paths['/api/v1/certificate-sources/mock-sync']);
  });

  it('契约必须提供证书详情、usage 和 formats 子资源路由', async () => {
    const { app } = await createAuthorizedApp('user_cert_detail');
    const imported = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: headers('user_cert_detail'),
      body: { certificatePem: CERT_PEM, privateKeyPem: PRIVATE_KEY_PEM },
    });
    assert.equal(imported.statusCode, 201);
    const assetId = (imported.body as any).asset.id;
    const versionId = (imported.body as any).version.id;

    const detail = await app.inject({
      method: 'GET',
      path: `/api/v1/certificate-assets/${assetId}`,
      headers: headers('user_cert_detail'),
    });
    assert.equal(detail.statusCode, 200);
    assert.equal((detail.body as any).id, assetId);
    assert.equal(JSON.stringify(detail.body).includes('BEGIN PRIVATE KEY'), false);
    assert.equal(JSON.stringify(detail.body).includes('privateKeySecretRef'), false);

    const usage = await app.inject({
      method: 'GET',
      path: `/api/v1/certificate-assets/${assetId}/usage`,
      headers: headers('user_cert_detail'),
    });
    assert.equal(usage.statusCode, 200);
    assert.ok(Array.isArray((usage.body as any).items));

    const formats = await app.inject({
      method: 'GET',
      path: `/api/v1/certificate-versions/${versionId}/formats`,
      headers: headers('user_cert_detail'),
    });
    assert.equal(formats.statusCode, 200);
    assert.ok(Array.isArray((formats.body as any).items));
  });

  it('导入、格式声明和读取权限必须与前端 permission key 一致', async () => {
    const security = createSecurityServices();
    security.rbac.createPolicy({
      subjectType: 'user',
      subjectId: 'user_permission_contract',
      effect: 'allow',
      actions: ['certificate.asset.read', 'certificate.import', 'certificate.format.create'],
      resourceTypes: ['certificate_asset', 'certificate_version', 'certificate_version_format'],
      scope: { tenantId: 'tenant_1' },
    });
    const db = new PgliteDatabase();
    await runMigrations(db);
    const app = configureTestAuth(createApp({ db, corePersistence: { mode: 'memory' }, security }));

    const imported = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: headers('user_permission_contract'),
      body: { certificatePem: CERT_PEM, privateKeyPem: PRIVATE_KEY_PEM },
    });
    assert.equal(imported.statusCode, 201);
    const versionId = (imported.body as any).version.id;

    const listed = await app.inject({
      method: 'GET',
      path: '/api/v1/certificate-assets',
      headers: headers('user_permission_contract'),
    });
    assert.equal(listed.statusCode, 200);

    const format = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-version-formats/export-plan',
      headers: headers('user_permission_contract'),
      body: {
        certificateVersionId: versionId,
        format: 'pem',
        containsPrivateKey: false,
      },
    });
    assert.equal(format.statusCode, 201);
  });

  it('已接入格式导出会生成 PEM/DER/JKS 产物 bytes，并且不泄露密码和私钥', async () => {
    const { app, security, artifacts } = await createAuthorizedMigratedApp('user_export_real');
    const chain = createPemChainFixture();
    const imported = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: headers('user_export_real'),
      body: { certificatePem: chain.pem, privateKeyPem: chain.privateKeyPem },
    });
    assert.equal(imported.statusCode, 201);
    const versionId = (imported.body as any).version.id;
    const password = (await security.secrets.create({
      tenantId: 'tenant_1',
      name: '导出密码',
      type: 'pfx_password',
      scopeType: 'global',
      plainText: 'export-password-123',
      createdBy: 'user_export_real',
    })).secretRef;

    const exportCases = [
      { format: 'pem', containsPrivateKey: true, passwordSecretRef: undefined },
      { format: 'der', containsPrivateKey: false, passwordSecretRef: undefined },
      { format: 'jks', containsPrivateKey: true, passwordSecretRef: password },
    ];
    for (const item of exportCases) {
      const response = await app.inject({
        method: 'POST',
        path: '/api/v1/certificate-version-formats/export',
        headers: headers('user_export_real'),
        body: { certificateVersionId: versionId, ...item, parameters: { alias: 'gcac-test' } },
      });
      assert.equal(response.statusCode, 201, `${item.format} 应导出成功：${JSON.stringify(response.body)}`);
      const body = response.body as any;
      assert.equal(body.exportMode, 'generated');
      const artifact = await artifacts.get(body.artifactRef);
      assert.ok(artifact, `${item.format} 必须写入真实 artifact`);
      assert.ok(artifact!.content.length > 0, `${item.format} artifact 不能是空文件`);
      assert.equal(JSON.stringify(body).includes('export-password-123'), false);
      assert.equal(JSON.stringify(body).includes('BEGIN PRIVATE KEY'), false);
    }
  });

  it('PEM 格式部署产物提供不含私钥的 fullchain 输出项', () => {
    const generated = new CertificateFormatExporter().generate('pem', {
      version: {} as any,
      leafDer: Buffer.from('leaf-certificate-der'),
      chainDer: [Buffer.from('intermediate-certificate-der'), Buffer.from('root-certificate-der')],
      privateKeyPem: '-----BEGIN PRIVATE KEY-----\nmock\n-----END PRIVATE KEY-----',
      parameters: {
        includeLeafCertificate: true,
        includeCertificateChain: true,
        includePrivateKey: true,
      },
    });

    const files = new Map(generated.files.map((file) => [file.key, file]));
    assert.deepEqual([...files.keys()].sort(), ['bundle', 'chain', 'fullchain', 'private', 'public']);
    assert.equal(files.get('fullchain')?.role, 'public_certificate');
    assert.match(files.get('fullchain')?.content ?? '', /BEGIN CERTIFICATE/);
    assert.equal((files.get('fullchain')?.content ?? '').includes('BEGIN PRIVATE KEY'), false);
  });

  it('OpenAPI 导入请求体不得把 privateKeyPem 声明成响应或可日志化字段', async () => {
    const { app } = await createAuthorizedApp('user_openapi_redaction');
    const response = await app.inject({ method: 'GET', path: '/api/v1/openapi.json', headers: headers('user_openapi_redaction') });
    assert.equal(response.statusCode, 200);
    const importOperation = (response.body as any).paths['/api/v1/certificate-versions/import'].post;
    assert.ok(importOperation.requestBody, '导入接口必须声明 requestBody，不能用 additionalProperties 糊弄');
    const operationJson = JSON.stringify(importOperation);
    assert.equal(operationJson.includes('"privateKeyPem"'), true);
    assert.equal(operationJson.includes('"writeOnly":true'), true);
    assert.equal(operationJson.includes('"x-sensitive":true'), true);
    assert.equal(JSON.stringify(importOperation.responses ?? {}).includes('privateKeyPem'), false);
    assert.equal(JSON.stringify(importOperation.responses ?? {}).includes('privateKeySecretRef'), false);
  });
});

async function createAuthorizedApp(actorId: string, exposeArtifacts = false) {
  const security = createSecurityServices();
  security.rbac.createPolicy({
    subjectType: 'user',
    subjectId: actorId,
    effect: 'allow',
    actions: ['*'],
    resourceTypes: ['*'],
    scope: { tenantId: 'tenant_1' },
  });
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
  const db = new PgliteDatabase();
  await runMigrations(db);
  if (!exposeArtifacts) return { app: configureTestAuth(createApp({ db, corePersistence: { mode: 'memory' }, security })), security, artifacts: undefined as unknown as PgCertificateArtifactStore };
  const artifacts = new PgCertificateArtifactStore(db);
  const certificates = new CertificatesApplicationService({ db, secrets: security.secrets, audit: security.audit, artifacts });
  return { app: configureTestAuth(createApp({ db, corePersistence: { mode: 'memory' }, security, certificates: { certificates } })), security, artifacts };
}

async function createAuthorizedMigratedApp(actorId: string) {
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
  const db = new PgliteDatabase();
  await runMigrations(db);
  const artifacts = new PgCertificateArtifactStore(db);
  const certificates = new CertificatesApplicationService({ db, secrets: security.secrets, audit: security.audit, artifacts });
  return { app: configureTestAuth(createApp({ db, corePersistence: { mode: 'memory' }, security, certificates: { certificates } })), security, artifacts };
}

async function createMigratedApp(actorId?: string, tenantId = 'tenant_1') {
  const db = new PgliteDatabase();
  await runMigrations(db);
  if (!actorId) return createApp({ db, corePersistence: { mode: 'memory' } });
  const security = createSecurityServices();
  security.rbac.createPolicy({
    subjectType: 'user',
    subjectId: actorId,
    effect: 'allow',
    actions: ['certificate.read', 'certificate.import', 'host.create', 'service_instance.manage', 'site_asset.manage', 'managed_target.manage', 'binding.manage'],
    resourceTypes: ['certificate_asset', 'certificate_version', 'host', 'service_instance', 'site_asset', 'managed_target', 'certificate_binding'],
    scope: { tenantId },
  });
  return configureTestAuth(createApp({ db, corePersistence: { mode: 'memory' }, security }));
}

function headers(actorId: string) {
  return { authorization: `Bearer ${actorId}|tenant_1`, 'x-tenant-id': 'tenant_1', 'x-actor-id': actorId };
}

function tenantHeaders(actorId: string, tenantId: string) {
  return headersForTenant(actorId, tenantId);
}

function headersForTenant(actorId: string, tenantId: string) {
  return { authorization: `Bearer ${actorId}|${tenantId}`, 'x-tenant-id': tenantId, 'x-actor-id': actorId };
}

async function createMultiTenantAuthorizedApp() {
  const security = createSecurityServices();
  for (const [subjectId, tenantId] of [
    ['user_cert_tenant_a', 'tenant_a'],
    ['user_cert_tenant_b', 'tenant_b'],
  ] as const) {
    security.rbac.createPolicy({
      subjectType: 'user',
      subjectId,
      effect: 'allow',
      actions: ['*'],
      resourceTypes: ['*'],
      scope: { tenantId },
    });
  }
  const db = new PgliteDatabase();
  await runMigrations(db);
  const artifacts = new PgCertificateArtifactStore(db);
  const certificates = new CertificatesApplicationService({ db, secrets: security.secrets, audit: security.audit, artifacts });
  return {
    app: configureTestAuth(createApp({
      db,
      corePersistence: { mode: 'memory' },
      security,
      certificates: { certificates },
    })),
    artifacts,
  };
}

function configureTestAuth(app: App): App {
  app.setAuthTokenResolver((authorization) => {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined;
    const [actorId, tenantId] = token?.split('|') ?? [];
    return actorId && tenantId ? { actorId, tenantId } : undefined;
  });
  return app;
}

function createPemChainFixture(): { pem: string; privateKeyPem: string } {
  return createCertificateTestFixture();
}

function createJksFixture(): { jksBase64: string; password: string; alias: string } {
  const chain = createPemChainFixture();
  const password = 'jks-test-password';
  const alias = 'gcac-jks';
  const certificateDers = [...chain.pem.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)]
    .map((match) => Buffer.from(match[0].replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s/g, ''), 'base64'));
  const jks = generateJksKeystore({ alias, password, privateKeyPem: chain.privateKeyPem, certificateDers });
  return { jksBase64: jks.toString('base64'), password, alias };
}

function createPfxFixture(): { pfxBase64: string; password: string } {
  const chain = createPemChainFixture();
  const password = 'pfx-test-password';
  const privateKey = forge.pki.privateKeyFromPem(chain.privateKeyPem);
  const certificates = [...chain.pem.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)]
    .map((match) => forge.pki.certificateFromPem(match[0]));
  const pfx = forge.pkcs12.toPkcs12Asn1(privateKey, certificates, password, { algorithm: 'aes256' });
  return { pfxBase64: Buffer.from(forge.asn1.toDer(pfx).getBytes(), 'binary').toString('base64'), password };
}
