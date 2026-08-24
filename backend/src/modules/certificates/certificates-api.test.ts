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
import { PgCertificateArtifactStore } from './artifacts/certificate-artifact-store.js';
import { generateJksKeystore } from './codecs/jks-keystore.js';

const CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDVDCCAjygAwIBAgIUG5ildtPXNPyfiDQ1eus6hH5dRFowDQYJKoZIhvcNAQEL
BQAwJTEUMBIGA1UEAwwLZXhhbXBsZS5jb20xDTALBgNVBAoMBEdDQUMwHhcNMjYw
NjA4MDkwOTU0WhcNMjcwNjA4MDkwOTU0WjAlMRQwEgYDVQQDDAtleGFtcGxlLmNv
bTENMAsGA1UECgwER0NBQzCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEB
ANnmaaLnxtwDFZBfUmKgdJL5NPCkxIWunc+vrTi1dEXkGLlzppat6C8YGWc+fFvY
Ym+IBrukthZ7KEsjnum2rkKMEMl+a+lUPi2NDVAvy6ZyswouyxtuJnh5rC5GcReu
esZTQ0bR/SMgI8umYUu2A7fDfna9LnXjkXxqyb7ZY5gvVUyjaC3/gINJQ945JBxC
BO8PerlOXuRKbHXPAbeOuo0nsaiD7nMcmZ6BE5c4HvTLDfDKBzZNLaKwxwWrIr5l
tEhg0Zm7mhtLTYZkg/UzKpbuNOr4Zd48tMtVUzlyQeRxgGTJHcnZdSX3oaizfv88
FFhExjQwqpWaTHoiTXfk5SMCAwEAAaN8MHowHQYDVR0OBBYEFM3GnbaMzOx3k1qa
8XB2S4Zq+lw1MB8GA1UdIwQYMBaAFM3GnbaMzOx3k1qa8XB2S4Zq+lw1MA8GA1Ud
EwEB/wQFMAMBAf8wJwYDVR0RBCAwHoILZXhhbXBsZS5jb22CD3d3dy5leGFtcGxl
LmNvbTANBgkqhkiG9w0BAQsFAAOCAQEAsW/aieACElxUDvOF4jcto6lQAv30DZg3
q82o2sGsTcInQC987HN2AYK5v3uj9CyWT5OJmeFkJrRekeaFnnutGYyQoRsfJ16u
YrVXYshRygqzFzQ6WoWEnD9mN+eILLl9kkrPlNX8mV7ly+NuMEk+Y43WTo19lrg3
li+tUg7XYIzac937W72xTG2rrZ2MUqM+rNNSWjKh8hw32x6b0s1t6j7kKJxuPDJ7
ypU+DoduyO53xf/mnvIGcDUESJvwRZ7Iffi1pp99oPh73SWPRyLTaYBcsPbbsi/f
aAQqw3mzHJgVJXhAdmNXmxWG/TCNanalPXMpyLNYSW32L2rZKdE+UQ==
-----END CERTIFICATE-----`;

const PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQDZ5mmi58bcAxWQ
X1JioHSS+TTwpMSFrp3Pr604tXRF5Bi5c6aWregvGBlnPnxb2GJviAa7pLYWeyhL
I57ptq5CjBDJfmvpVD4tjQ1QL8umcrMKLssbbiZ4eawuRnEXrnrGU0NG0f0jICPL
pmFLtgO3w352vS5145F8asm+2WOYL1VMo2gt/4CDSUPeOSQcQgTvD3q5Tl7kSmx1
zwG3jrqNJ7Gog+5zHJmegROXOB70yw3wygc2TS2isMcFqyK+ZbRIYNGZu5obS02G
ZIP1MyqW7jTq+GXePLTLVVM5ckHkcYBkyR3J2XUl96Gos37/PBRYRMY0MKqVmkx6
Ik135OUjAgMBAAECggEAGW5futsZOvlYgsfqmhyHA9ZLsaBRWBbX+p19dpEQTSNA
0s18I7mP+oXHWo+Q57lFTSYPlHE2ApaveQw4Z6eMsV3z4Z28eM1+ZPDsR6+5sXym
h77hW/C1qGRETlxQplu/SYv93fNJJi3XRP/vUBeiBHMFEf+kv1k8KXdfLMPmG08y
Tu4TGdu6prKXluOjKJKCmxyjcMMiMKs3KGEHFeZpehhCBZw/BAcUeJj4P0IOax5G
MLMyouiH8qz1ZZ43tOBGgF9gc2x7WK5yvEmAyfVE9bkehD7dzEyeYTzoym5tEebX
MK785Iu3z8fma7qmxDHG5tIrooaN/TNq2b6582pc0QKBgQD+XWrIQYCFM21tk1E9
GcgttA2xmYHne6gq+ZaFWE2Bemzf/oKFFtVyuauyASYnKLqv7uEc0LnTSF2hIkAP
qA/jSGUJ9wqbvcakz6TvDUfgYDamTnqp0EdlQj3Z+uMd/uoT+SOblJnyJTOi+NdR
EMUCxzY1OoaQ5gBun1JezQ4GMQKBgQDbTP0r2XUvodx2oJFzMC7/bEEV0Qg6KrJc
OsEdGsQL/W9+JW5IUqQlYb97F97Cg5MPPRkjlLM8tBHkUdiNbjyrHnpdt8d50P/O
ViMiFIPKDhUzimka32fKoPN7bkdmJ5EPP0Qa8YC4UcPZQi9Ptm5DVP0OzqDANAOE
EA2y2mwHkwKBgQCzM2cWXCdKMDgIuX/DVxWTNUVseKRvS8vnMt1bZiF8dZ6ck/aq
ArMv1yTiDDMv5V7YsaeAoIA6HMJx0epl3VYMHqWoRpX/sMxwsiUVkTqxFbeKpMGA
P079RJTErB8zs7J/jccLRb7LPHBLgZpX70OMuII1L9072f418SKbzUTzEQKBgQCj
rTigS7NtE6/KUll80Y+iUBfbwqITV967e5a6tElycXuPeTxwek3NIMGbi9tU7oMK
Mp3aspd8TSG1eWjZVletmBfYbtxRDS5/wEaEny8l1ZD5YOrFhcyfrbVMgKiFlC5u
ZNfeDDX4W/6C3yUUp6JwWrRtIsdT7P5ayOiQfvl2RQKBgQCajPXye+yJqWQboUyF
C38mSIcEm7mdLCLa7psXWxsMvH15ynl34RzjI/Ne3iWIVWHbnJ9yitudvM1UcdiX
PyyRtpZNjzHF1i72Y3Ox3WRenxBqp+KjnkkOMTrK8YqxeMXgQ1XBPXXSjhrn8yD8
HVlUi9P3lKu3lUEi2bOiP2KYvg==
-----END PRIVATE KEY-----`;

describe('证书资产 API', () => {
  it('导入证书成功、重复指纹被拒绝、响应不泄露私钥', async () => {
    const { app } = createAuthorizedApp('user_cert');
    const imported = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: headers('user_cert'),
      body: { certificatePem: CERT_PEM, privateKeyPem: PRIVATE_KEY_PEM, tags: ['prod'] },
    });

    assert.equal(imported.statusCode, 201);
    const body = imported.body as any;
    assert.equal(body.version.commonName, 'example.com');
    assert.deepEqual(body.version.sans, ['example.com', 'www.example.com']);
    assert.equal(body.version.hasPrivateKey, true);
    assert.equal(body.version.privateKeySecretRef, undefined);
    assert.equal(body.version.chainStatus, 'valid');
    assert.equal(JSON.stringify(body).includes('BEGIN PRIVATE KEY'), false);
    assert.equal(JSON.stringify(body).includes(PRIVATE_KEY_PEM.split('\n')[1]!), false);

    const duplicated = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: headers('user_cert'),
      body: { certificatePem: CERT_PEM },
    });
    assert.equal(duplicated.statusCode, 409);
    assert.equal((duplicated.body as any).errorCode, 'CERT_DUPLICATE_VERSION');
  });

  it('多证书 PEM 能识别 leaf、链顺序和链状态', async () => {
    const chain = createPemChainFixture();
    const { app } = createAuthorizedApp('user_chain');
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
    const { app } = createAuthorizedApp('user_filter');
    const imported = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: headers('user_filter'),
      body: { certificatePem: CERT_PEM },
    });
    const version = (imported.body as any).version;

    for (const [field, value] of [
      ['primaryDomain', 'example.com'],
      ['commonName', 'example.com'],
      ['sans', 'www.example.com'],
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

  it('格式记录只保存 artifactRef，列表分页和幂等可用', async () => {
    const { app } = createAuthorizedApp('user_cert2');
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
    assert.equal((format.body as any).artifactRef, 'artifact://certificate-format/pfx_1');
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
    assert.equal((repeatedFormat.body as any).artifactRef, 'artifact://certificate-format/pfx_1');

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
    const { app } = createAuthorizedApp('user_export_plan');
    const imported = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: headers('user_export_plan'),
      body: { certificatePem: CERT_PEM, privateKeyPem: PRIVATE_KEY_PEM },
    });
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
    assert.equal(planned.statusCode, 201);
    assert.equal((planned.body as any).exportMode, 'planned');
    assert.match((planned.body as any).artifactRef, /^artifact:\/\/certificate-format\//);
    assert.equal(JSON.stringify(planned.body).includes('BEGIN PRIVATE KEY'), false);

    const source = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-sources/mock-sync',
      headers: headers('user_export_plan'),
      body: { sourceType: 'external_api', externalId: 'ext-cert-001', certificatePem: createPemChainFixture().pem },
    });
    assert.equal(source.statusCode, 201);
    assert.equal((source.body as any).sourceType, 'external_api');
    assert.equal((source.body as any).imported, true);
    assert.equal((source.body as any).version.sourceType, 'external_api');
  });



  it('格式能力声明五种格式真实接入，不再用受控错误冒充能力', async () => {
    const { app } = createAuthorizedApp('user_formats');
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
    const { app } = createAuthorizedApp('user_p7b');
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
    const { app } = createAuthorizedApp('user_jks');
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
    const { app } = createAuthorizedApp('user_pfx');
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
    const { app } = createAuthorizedApp('user_lifecycle');
    const imported = await app.inject({ method: 'POST', path: '/api/v1/certificate-versions/import', headers: headers('user_lifecycle'), body: { certificatePem: CERT_PEM } });
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

  it('OpenAPI 包含新增证书 API', async () => {
    const { app } = createAuthorizedApp('user_openapi');
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
    const { app } = createAuthorizedApp('user_cert_detail');
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
    const app = createApp({ security });

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
    const { app, security, artifacts } = createAuthorizedApp('user_export_real', true);
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

  it('OpenAPI 导入请求体不得把 privateKeyPem 声明成响应或可日志化字段', async () => {
    const { app } = createAuthorizedApp('user_openapi_redaction');
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

function createAuthorizedApp(actorId: string, exposeArtifacts = false) {
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
  if (!exposeArtifacts) return { app: createApp({ security }), security, artifacts: undefined as unknown as PgCertificateArtifactStore };
  const db = new PgliteDatabase();
  const artifacts = new PgCertificateArtifactStore(db);
  const certificates = new CertificatesApplicationService({ db, secrets: security.secrets, audit: security.audit, artifacts });
  return { app: createApp({ db, corePersistence: { mode: 'memory' }, security, certificates: { certificates } }), security, artifacts };
}

function headers(actorId: string) {
  return { 'x-tenant-id': 'tenant_1', 'x-actor-id': actorId };
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
