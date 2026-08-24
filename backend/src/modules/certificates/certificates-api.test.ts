import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createApp } from '../../app.module.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { createSecurityServices } from '../security/security.controller.js';
import { CertificatesApplicationService } from './application/certificates.application-service.js';
import { CertificateFormatExporter } from './application/certificate-format-exporter.js';
import { PgCertificateArtifactStore } from './artifacts/certificate-artifact-store.js';
import { generateJksKeystore } from './codecs/jks-keystore.js';

const DEFAULT_CERTIFICATE_FIXTURE = createPemChainFixture();
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

  it('ACME 管理的证书资产允许手动导入新版本', async () => {
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
      sourceType: 'acme',
      tags: ['acme'],
      createdBy: 'user_acme_manual',
    });
    const imported = await certificates.importVersion({
      certificateAssetId: asset.id,
      certificatePem: manualFixture.pem,
      privateKeyPem: manualFixture.privateKeyPem,
      sourceType: 'manual',
      createdBy: 'user_acme_manual',
    });

    assert.equal(imported.asset.id, asset.id);
    assert.equal(imported.asset.sourceType, 'acme');
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

  it('格式导出规划要求 SecretRef，不导出明文，并能由来源同步复用导入管道', async () => {
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
    assert.equal(missingPassword.statusCode, 400);
    assert.equal((missingPassword.body as any).errorCode, 'VALIDATION_FAILED');

    const planned = await app.inject({
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
    assert.equal(planned.statusCode, 201, `导出规划应成功：${JSON.stringify(planned.body)}`);
    assert.equal((planned.body as any).exportMode, 'planned');
    assert.match((planned.body as any).artifactRef, /^artifact:\/\/certificate-format\//);
    assert.equal(JSON.stringify(planned.body).includes('BEGIN PRIVATE KEY'), false);

    const sourceChain = createPemChainFixture();
    const source = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-sources/mock-sync',
      headers: headers('user_export_plan'),
      body: { sourceType: 'external_api', externalId: 'ext-cert-001', certificatePem: sourceChain.pem, privateKeyPem: sourceChain.privateKeyPem },
    });
    assert.equal(source.statusCode, 201, `来源同步应成功：${JSON.stringify(source.body)}`);
    assert.equal((source.body as any).sourceType, 'external_api');
    assert.equal((source.body as any).imported, true);
    assert.equal((source.body as any).version.sourceType, 'external_api');
  });



  it('格式能力声明五种格式真实接入，不再用受控错误冒充能力', async () => {
    const { app } = await createAuthorizedApp('user_formats');
    const capabilities = await app.inject({ method: 'GET', path: '/api/v1/certificate-formats/capabilities', headers: headers('user_formats') });
    assert.equal(capabilities.statusCode, 200);
    const formats = new Map((capabilities.body as any).formats.map((item: any) => [item.format, item]));
    assert.equal((formats.get('pem') as any).importSupported, true);
    assert.equal((formats.get('pfx') as any).implementation, 'openssl');
    assert.equal((formats.get('jks') as any).importSupported, true);
    assert.equal((formats.get('jks') as any).exportSupported, true);
    assert.equal((formats.get('jks') as any).implementation, 'keytool');
    assert.equal((formats.get('p7b') as any).importSupported, true);
    assert.equal((formats.get('p7b') as any).implementation, 'openssl');
    assert.equal((formats.get('p7b') as any).containsPrivateKey, 'never');

    for (const body of [{ jksBase64: Buffer.from('not-a-jks').toString('base64') }, { p7bBase64: Buffer.from('not-a-p7b').toString('base64') }]) {
      const response = await app.inject({ method: 'POST', path: '/api/v1/certificate-versions/import', headers: headers('user_formats'), body });
      assert.ok([400, 422].includes(response.statusCode));
      assert.notEqual((response.body as any).errorCode, 'CERT_FORMAT_UNSUPPORTED');
    }
  });

  it('P7B 能通过 openssl 导入证书链且不包含私钥', async () => {
    const fixture = createP7bFixture();
    const { app } = await createAuthorizedApp('user_p7b');
    const imported = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: headers('user_p7b'),
      body: { p7bBase64: fixture.p7bBase64 },
    });
    assert.equal(imported.statusCode, 201);
    const body = imported.body as any;
    assert.equal(body.diagnostics.sourceFormat, 'p7b');
    assert.equal(body.version.hasPrivateKey, false);
    assert.equal(body.version.deployable, false);
    assert.equal(JSON.stringify(body).includes('BEGIN PRIVATE KEY'), false);
  });

  it('JKS 能通过 keytool 导入证书和私钥，密码或 alias 错误不会创建半成品', async () => {
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

  it('PFX 能通过 openssl 导入证书和私钥，响应仍不泄露私钥', async () => {
    const pfx = createPfxFixture();
    const { app } = await createAuthorizedApp('user_pfx');
    const imported = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: headers('user_pfx'),
      body: { pfxBase64: pfx.pfxBase64, pfxPassword: pfx.password },
    });
    assert.equal(imported.statusCode, 201);
    const body = imported.body as any;
    assert.equal(body.diagnostics.sourceFormat, 'pfx');
    assert.equal(body.version.hasPrivateKey, true);
    assert.equal(body.version.privateKeySecretRef, undefined);
    assert.equal(JSON.stringify(body).includes('BEGIN PRIVATE KEY'), false);
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

  it('证书版本 usage 支持按域名匹配真实绑定，即使绑定未直接挂到 certificateVersionId', async () => {
    const app = await createMigratedApp('user_usage_domain_match', 'tenant_usage_domain_match');
    const tenantHeaders = { 'x-tenant-id': 'tenant_usage_domain_match', 'x-actor-id': 'user_usage_domain_match' };
    const certificateFixture = createWildcardJacksonzPemFixture();

    const imported = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: tenantHeaders,
      body: {
        certificatePem: certificateFixture.certificatePem,
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
        domainName: 'test.jacksonz.cn',
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
    assert.ok(body.usages.some((item) => item.binding?.domainName === 'test.jacksonz.cn'));
    assert.ok(body.usages.some((item) => item.serviceAsset?.address === 'test.jacksonz.cn'));
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
    const app = createApp({ db, corePersistence: { mode: 'memory' }, security, allowLegacyHeaderContext: true });

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

  it('真实格式导出会生成 PEM/DER/P7B/PFX/JKS 产物 bytes，并且不泄露密码和私钥', async () => {
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
      { format: 'p7b', containsPrivateKey: false, passwordSecretRef: undefined },
      { format: 'pfx', containsPrivateKey: true, passwordSecretRef: password },
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
  if (!exposeArtifacts) return { app: createApp({ db, corePersistence: { mode: 'memory' }, security, allowLegacyHeaderContext: true }), security, artifacts: undefined as unknown as PgCertificateArtifactStore };
  const artifacts = new PgCertificateArtifactStore(db);
  const certificates = new CertificatesApplicationService({ db, secrets: security.secrets, audit: security.audit, artifacts });
  return { app: createApp({ db, corePersistence: { mode: 'memory' }, security, certificates: { certificates }, allowLegacyHeaderContext: true }), security, artifacts };
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
  return { app: createApp({ db, corePersistence: { mode: 'memory' }, security, certificates: { certificates }, allowLegacyHeaderContext: true }), security, artifacts };
}

async function createMigratedApp(actorId?: string, tenantId = 'tenant_1') {
  const db = new PgliteDatabase();
  await runMigrations(db);
  if (!actorId) return createApp({ db, corePersistence: { mode: 'memory' }, allowLegacyHeaderContext: true });
  const security = createSecurityServices();
  security.rbac.createPolicy({
    subjectType: 'user',
    subjectId: actorId,
    effect: 'allow',
    actions: ['certificate.read', 'certificate.import', 'host.create', 'service_instance.manage', 'site_asset.manage', 'managed_target.manage', 'binding.manage'],
    resourceTypes: ['certificate_asset', 'certificate_version', 'host', 'service_instance', 'site_asset', 'managed_target', 'certificate_binding'],
    scope: { tenantId },
  });
  return createApp({ db, corePersistence: { mode: 'memory' }, security, allowLegacyHeaderContext: true });
}

function headers(actorId: string) {
  return { 'x-tenant-id': 'tenant_1', 'x-actor-id': actorId };
}

function tenantHeaders(actorId: string, tenantId: string) {
  return { 'x-tenant-id': tenantId, 'x-actor-id': actorId };
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
    app: createApp({
      db,
      corePersistence: { mode: 'memory' },
      security,
      certificates: { certificates },
      allowLegacyHeaderContext: true,
    }),
    artifacts,
  };
}

function createPemChainFixture(): { pem: string; privateKeyPem: string } {
  const dir = mkdtempSync(join(tmpdir(), 'gcac-cert-chain-'));
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

function createPfxFixture(): { pfxBase64: string; password: string } {
  const dir = mkdtempSync(join(tmpdir(), 'gcac-cert-pfx-'));
  try {
    const chain = createPemChainFixture();
    writeFileSync(join(dir, 'cert.pem'), chain.pem);
    writeFileSync(join(dir, 'key.pem'), chain.privateKeyPem);
    const password = 'pfx-test-password';
    runOpenSsl(dir, 'pkcs12', '-export', '-inkey', 'key.pem', '-in', 'cert.pem', '-out', 'bundle.p12', '-passout', `pass:${password}`);
    return { pfxBase64: readFileSync(join(dir, 'bundle.p12')).toString('base64'), password };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function createP7bFixture(): { p7bBase64: string } {
  const dir = mkdtempSync(join(tmpdir(), 'gcac-cert-p7b-'));
  try {
    const chain = createPemChainFixture();
    writeFileSync(join(dir, 'certs.pem'), chain.pem);
    runOpenSsl(dir, 'crl2pkcs7', '-nocrl', '-certfile', 'certs.pem', '-out', 'bundle.p7b', '-outform', 'DER');
    return { p7bBase64: readFileSync(join(dir, 'bundle.p7b')).toString('base64') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

function createWildcardJacksonzPemFixture(): { certificatePem: string; privateKeyPem: string } {
  const dir = mkdtempSync(join(tmpdir(), 'gcac-cert-jacksonz-'));
  try {
    runOpenSsl(dir, 'genrsa', '-out', 'root.key', '2048');
    runOpenSsl(dir, 'req', '-x509', '-new', '-nodes', '-key', 'root.key', '-sha256', '-days', '3650', '-subj', '/CN=Jacksonz Root CA/O=GCAC', '-out', 'root.pem');

    runOpenSsl(dir, 'genrsa', '-out', 'intermediate.key', '2048');
    runOpenSsl(dir, 'req', '-new', '-key', 'intermediate.key', '-subj', '/CN=Jacksonz Intermediate CA/O=GCAC', '-out', 'intermediate.csr');
    writeFileSync(join(dir, 'intermediate.ext'), 'basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n');
    runOpenSsl(dir, 'x509', '-req', '-in', 'intermediate.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-CAcreateserial', '-out', 'intermediate.pem', '-days', '1000', '-sha256', '-extfile', 'intermediate.ext');

    runOpenSsl(dir, 'genrsa', '-out', 'leaf.key', '2048');
    runOpenSsl(dir, 'req', '-new', '-key', 'leaf.key', '-subj', '/CN=*.jacksonz.cn/O=GCAC', '-out', 'leaf.csr');
    writeFileSync(join(dir, 'leaf.ext'), 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:*.jacksonz.cn,DNS:jacksonz.cn\n');
    runOpenSsl(dir, 'x509', '-req', '-in', 'leaf.csr', '-CA', 'intermediate.pem', '-CAkey', 'intermediate.key', '-CAcreateserial', '-out', 'leaf.pem', '-days', '365', '-sha256', '-extfile', 'leaf.ext');
    return {
      certificatePem: [readFileSync(join(dir, 'leaf.pem'), 'utf8'), readFileSync(join(dir, 'intermediate.pem'), 'utf8'), readFileSync(join(dir, 'root.pem'), 'utf8')].join('\n'),
      privateKeyPem: readFileSync(join(dir, 'leaf.key'), 'utf8'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
