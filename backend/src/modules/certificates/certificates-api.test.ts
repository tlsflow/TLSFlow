import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createApp } from '../../app.module.js';
import { createSecurityServices } from '../security/security.controller.js';

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

  it('OpenAPI 包含新增证书 API', async () => {
    const { app } = createAuthorizedApp('user_openapi');
    const response = await app.inject({ method: 'GET', path: '/api/v1/openapi.json', headers: headers('user_openapi') });
    assert.equal(response.statusCode, 200);
    const paths = (response.body as any).paths;
    assert.ok(paths['/api/v1/certificate-assets']);
    assert.ok(paths['/api/v1/certificate-versions/import']);
    assert.ok(paths['/api/v1/certificate-version-formats']);
    assert.ok(paths['/api/v1/certificate-version-formats/export-plan']);
    assert.ok(paths['/api/v1/certificate-sources/mock-sync']);
  });
});

function createAuthorizedApp(actorId: string) {
  const security = createSecurityServices();
  for (const action of ['certificate.read', 'certificate.create', 'certificate.import', 'certificate.format.create']) {
    security.rbac.createPolicy({
      subjectType: 'user',
      subjectId: actorId,
      effect: 'allow',
      actions: [action],
      resourceTypes: ['certificate_asset', 'certificate_version', 'certificate_version_format'],
      scope: { tenantId: 'tenant_1' },
    });
  }
  return { app: createApp({ security }), security };
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
