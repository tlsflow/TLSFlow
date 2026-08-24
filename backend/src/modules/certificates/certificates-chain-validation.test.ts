import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createApp } from '../../app.module.js';
import { createSecurityServices } from '../security/security.controller.js';

describe('证书链导入校验', () => {
  it('缺失根证书时拒绝导入', async () => {
    const chain = createPemChainFixture();
    const pemBlocks = chain.pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
    const incompletePem = pemBlocks.slice(0, 2).join('\n');
    const { app } = createAuthorizedApp('user_chain_incomplete');
    const response = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: headers('user_chain_incomplete'),
      body: { certificatePem: incompletePem, privateKeyPem: chain.privateKeyPem },
    });

    assert.equal(response.statusCode, 400);
    assert.equal((response.body as any).errorCode, 'VALIDATION_FAILED');
    assert.equal((response.body as any).details.chainStatus, 'incomplete');
    assert.match(JSON.stringify((response.body as any).details.chainDiagnostics), /缺少签发者证书/);
  });

  it('leaf 直接挂到错误根证书时拒绝导入', async () => {
    const validChain = createPemChainFixture();
    const wrongRootChain = createPemChainFixture();
    const validBlocks = validChain.pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
    const wrongRootBlocks = wrongRootChain.pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
    const invalidPem = [validBlocks[0], wrongRootBlocks[2]].filter(Boolean).join('\n');
    const { app } = createAuthorizedApp('user_chain_invalid');
    const response = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-versions/import',
      headers: headers('user_chain_invalid'),
      body: { certificatePem: invalidPem, privateKeyPem: validChain.privateKeyPem },
    });

    assert.equal(response.statusCode, 400);
    assert.equal((response.body as any).errorCode, 'VALIDATION_FAILED');
    assert.ok(['invalid', 'incomplete'].includes((response.body as any).details.chainStatus));
    assert.match(JSON.stringify((response.body as any).details.chainDiagnostics), /缺少签发者证书|证书签名校验失败/);
  });
});

function createAuthorizedApp(actorId: string) {
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
  return { app: createApp({ security }) };
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
