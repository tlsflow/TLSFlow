import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import { PluginRunnerClient } from '../../../backend/dist/modules/plugins/runner/plugin-runner-client.js';
import { assertUnifiedPluginResources, validateUnifiedPluginManifest } from '../../../backend/dist/modules/plugins/schema/unified-plugins.schema.js';

const fixtureDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(fixtureDirectory, '../../..');
const backendRoot = join(repositoryRoot, 'backend');
const runnerServer = join(backendRoot, 'dist/modules/plugins/runner/runner-server.js');
const tenantId = 'tenant-ca-fixture';
const workflowVersionId = 'workflow-version-ca-1';
const planDigest = sha256Hex('ca-fixture-plan');
const developmentCertificatePem = `-----BEGIN CERTIFICATE-----
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
const developmentIssuerPrivateKeyPem = `-----BEGIN PRIVATE KEY-----
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
const csrPem = '-----BEGIN CERTIFICATE REQUEST-----\nZml4dHVyZS1jc3I=\n-----END CERTIFICATE REQUEST-----';
let executionSequence = 0;

test('CA Manifest、Workflow 和 Agent-side 资源通过统一合同', async () => {
  const packages = [
    ['backend/src/modules/plugins/builtin-plugins/ca-openssl', 'ca.openssl'],
    ['backend/src/modules/plugins/builtin-plugins/ca-acme', 'ca.acme'],
    ['backend/src/modules/plugins/builtin-plugins/ca-acme-dns', 'ca.acme-dns'],
    ['backend/src/modules/plugins/builtin-plugins/ca-microsoft-adcs', 'ca.microsoft-adcs'],
  ];
  const agentPackage = ['agents/windows-compat-full-agent/agent-side-plugins/ca-microsoft-adcs', 'ca.microsoft-adcs'];
  const manifests = new Map();
  for (const [relativeDirectory, pluginId] of [...packages, agentPackage]) {
    const packageDirectory = join(repositoryRoot, relativeDirectory);
    const rawManifest = readJson(join(packageDirectory, 'manifest.json'));
    const manifest = validateUnifiedPluginManifest(rawManifest);
    const resources = loadManifestResources(packageDirectory, rawManifest);
    assert.doesNotThrow(() => assertUnifiedPluginResources(manifest, resources), pluginId);
    assert.equal(rawManifest.version, '1.0.0');
    assert.equal(rawManifest.apiVersion, 'gcac.plugin-manifest/v1');
    assert.equal(rawManifest.kind, 'GcacPlugin');
    assert.equal(Object.hasOwn(rawManifest, 'pluginVersionBinding'), false);
    for (const capability of rawManifest.capabilities) assert.equal(Object.hasOwn(capability, 'readOnly'), false);
    manifests.set(`${pluginId}:${relativeDirectory}`, rawManifest);
    const runtimePath = resolve(packageDirectory, rawManifest.resources.runtimeEntrypoint);
    const runtimeModule = await import(pathToFileURL(runtimePath).href);
    assert.deepEqual(Object.keys(runtimeModule), ['createPluginRunnerExecutor'], `${pluginId} runtime 导出不符合合同`);
  }

  const acme = manifests.get('ca.acme:backend/src/modules/plugins/builtin-plugins/ca-acme');
  assert.deepEqual([...acme.capabilities.map((item) => item.key)].sort(), ['ca.account.manage', 'ca.challenge.orchestrate', 'ca.order.manage']);
  assert.deepEqual(Object.keys(acme.resources.workflows).sort(), [
    'ca.account.ensure', 'ca.challenge.solve', 'ca.order.issue', 'ca.order.renew', 'ca.order.revoke',
  ]);
  assert.equal(Object.keys(acme.resources.workflows).some((key) => key.includes('certificate')), false);

  const dns = manifests.get('ca.acme-dns:backend/src/modules/plugins/builtin-plugins/ca-acme-dns');
  assert.deepEqual(dns.capabilities.map((item) => item.key), ['ca.challenge.dns-solver']);
  assert.equal(JSON.stringify(dns).includes('ca.account.manage'), false);
  assert.equal(JSON.stringify(dns).includes('ca.order.manage'), false);
  assert.equal(JSON.stringify(dns).includes('ca.challenge.orchestrate'), false);
});

test('ca.openssl 真实 Runner 子进程完成创建、签发、续期、吊销、UNKNOWN、恢复和审计', async () => {
  const runner = createRunner('ca.openssl', 'backend/src/modules/plugins/builtin-plugins/ca-openssl', [
    'ca.certificate.issue', 'ca.certificate.renew', 'ca.certificate.revoke',
  ], ['secret.resolve', 'audit.append']);
  try {
    const created = await execute(runner, 'ca.certificate.issue', {
      operation: 'create', workflowKey: 'ca.certificate.issue', workflowVersion: '1.0.0',
      authorityId: 'authority-openssl', subjectCommonName: 'GCAC Development CA', profile: 'control-plane.ca', secretRef: 'secret://ca/openssl',
    });
    assert.equal(created.status, 'SUCCESS');
    assert.equal(created.normalizedObjects[0].kind, 'CertificateAuthority');

    const leafKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const leafPublicKeyPem = leafKey.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const issued = await execute(runner, 'ca.certificate.issue', {
      operation: 'issue', workflowKey: 'ca.certificate.issue', workflowVersion: '1.0.0',
      csrPem, publicKeyPem: leafPublicKeyPem, subject: 'CN=issued.example.test', sans: ['issued.example.test'], validityDays: 30,
      secretRef: 'secret://ca/openssl',
    });
    assert.equal(issued.status, 'SUCCESS');
    const issuedObject = issued.normalizedObjects[0];
    assert.equal(issuedObject.kind, 'Certificate');
    assert.match(issuedObject.certificatePem, /BEGIN CERTIFICATE/);
    assert.equal(JSON.stringify(issued).includes(developmentIssuerPrivateKeyPem), false);

    const renewedKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const renewed = await execute(runner, 'ca.certificate.renew', {
      operation: 'renew', workflowKey: 'ca.certificate.renew', workflowVersion: '1.0.0', sourceCertificateId: 'certificate:source-openssl',
      sourceCertificatePem: issuedObject.certificatePem, sourceCsrPem: csrPem, publicKeyPem: renewedKey.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      subject: 'CN=renewed.example.test', sans: ['renewed.example.test'], validityDays: 30, secretRef: 'secret://ca/openssl',
    });
    assert.equal(renewed.status, 'SUCCESS');
    assert.equal(renewed.normalizedObjects[0].renewalOf, 'certificate:source-openssl');

    const serialNumber = issuedObject.serialNumber;
    const revoked = await execute(runner, 'ca.certificate.revoke', {
      operation: 'revoke', workflowKey: 'ca.certificate.revoke', workflowVersion: '1.0.0', serialNumber, reason: 'superseded', secretRef: 'secret://ca/openssl',
    });
    assert.equal(revoked.status, 'SUCCESS');
    assert.equal(revoked.normalizedObjects[0].status, 'revoked');

    const unknownId = 'openssl-unknown-write';
    const unknown = await execute(runner, 'ca.certificate.revoke', {
      operation: 'revoke', workflowKey: 'ca.certificate.revoke', workflowVersion: '1.0.0', serialNumber, reason: 'unspecified', failureMode: 'unknown', secretRef: 'secret://ca/openssl',
    }, { idempotencyKey: unknownId });
    assert.equal(unknown.status, 'UNKNOWN');
    assert.equal(unknown.error?.mayBeUnknown, true);

    const recovered = await execute(runner, 'ca.certificate.issue', {
      operation: 'recover', workflowKey: 'ca.operation.recover', workflowVersion: '1.0.0', operationId: unknownId, secretRef: 'secret://ca/openssl',
    }, { writeEffect: false });
    assert.equal(recovered.status, 'UNKNOWN');
    assert.equal(recovered.warnings[0]?.code, 'CA_RECOVERY_REQUIRES_RECEIPT');

    const missingSecurity = await executeRaw(runner, 'ca.certificate.issue', {
      operation: 'create', workflowKey: 'ca.certificate.issue', workflowVersion: '1.0.0', authorityId: 'authority-missing-security', subjectCommonName: 'CA', profile: 'control-plane.ca',
    }, { writeEffect: false });
    assert.equal(missingSecurity.status, 'FAILED');
    assert.equal(missingSecurity.error?.code, 'PLUGIN_CONTRACT_INVALID');

    const inlineSecret = await execute(runner, 'ca.certificate.issue', {
      operation: 'issue', workflowKey: 'ca.certificate.issue', workflowVersion: '1.0.0', csrPem, publicKeyPem: leafPublicKeyPem,
      subject: 'CN=inline-secret.example.test', sans: ['inline-secret.example.test'], validityDays: 30, secretRef: 'secret://ca/openssl', issuerPrivateKeyPem: developmentIssuerPrivateKeyPem,
    }, { writeEffect: false });
    assert.equal(inlineSecret.status, 'FAILED');
    assert.equal(inlineSecret.error?.code, 'CA_SECRET_INLINE_FORBIDDEN');
    assert.equal(JSON.stringify(inlineSecret).includes(developmentIssuerPrivateKeyPem), false);
    assert.ok(runner.calls.filter((call) => call.method === 'audit.append').length >= 7);
  } finally {
    await closeRunner(runner.client);
  }
});

test('ca.acme 真实 Runner 子进程保持账户、订单、挑战编排边界并完成续期、吊销、恢复和脱敏', async () => {
  const accountKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const runner = createRunner('ca.acme', 'backend/src/modules/plugins/builtin-plugins/ca-acme', ['ca.account.manage', 'ca.order.manage', 'ca.challenge.orchestrate'], ['secret.resolve', 'audit.append'], {
    secretData: { privateKeyPem: accountKey },
  });
  const directoryUrl = 'https://acme.test.invalid/directory';
  try {
    const account = await execute(runner, 'ca.account.manage', {
      operation: 'account.ensure', workflowKey: 'ca.account.ensure', workflowVersion: '1.0.0', directoryUrl, email: 'p2-ca@example.test', secretRef: 'secret://ca/acme/account',
    });
    assert.equal(account.status, 'SUCCESS');
    assert.equal(account.normalizedObjects[0].kind, 'AcmeAccount');

    const order = await execute(runner, 'ca.order.manage', {
      operation: 'order.create', workflowKey: 'ca.order.issue', workflowVersion: '1.0.0', directoryUrl, identifiers: ['example.test'],
      solverPluginId: 'ca.acme-dns', solverPluginVersionId: 'ca.acme-dns:1.0.0', secretRef: 'secret://ca/acme/account',
    });
    assert.equal(order.status, 'SUCCESS');
    assert.equal(order.normalizedObjects[0].challengeSolverPluginVersionId, 'ca.acme-dns:1.0.0');

    const prepared = await execute(runner, 'ca.challenge.orchestrate', {
      operation: 'challenge.prepare', workflowKey: 'ca.challenge.solve', workflowVersion: '1.0.0', challengeType: 'dns-01',
      challengeUrl: 'https://acme.test.invalid/challenge/1', solverPluginId: 'ca.acme-dns', solverPluginVersionId: 'ca.acme-dns:1.0.0', secretRef: 'secret://ca/acme/account',
    });
    assert.equal(prepared.status, 'SUCCESS');
    assert.equal(prepared.normalizedObjects[0].solverPluginVersionId, 'ca.acme-dns:1.0.0');

    const polled = await execute(runner, 'ca.order.manage', {
      operation: 'order.poll', workflowKey: 'ca.order.issue', workflowVersion: '1.0.0', directoryUrl, orderUrl: 'https://acme.test.invalid/order/1',
      sandboxRef: 'sandbox://acme', sandboxResponse: { statusCode: 200, body: { status: 'ready', identifiers: [{ type: 'dns', value: 'example.test' }] } }, secretRef: 'secret://ca/acme/account',
    });
    assert.equal(polled.status, 'SUCCESS');
    assert.equal(polled.normalizedObjects[0].status, 'ready');

    const finalized = await execute(runner, 'ca.order.manage', {
      operation: 'order.finalize', workflowKey: 'ca.order.issue', workflowVersion: '1.0.0', directoryUrl, orderUrl: 'https://acme.test.invalid/order/1', csrPem,
      sandboxRef: 'sandbox://acme', sandboxResponse: { statusCode: 200, body: { status: 'valid', certificate: 'https://acme.test.invalid/cert/1' } }, secretRef: 'secret://ca/acme/account',
    });
    assert.equal(finalized.status, 'SUCCESS');
    assert.equal(finalized.normalizedObjects[0].certificateUrl, 'https://acme.test.invalid/cert/1');

    const renewed = await execute(runner, 'ca.order.manage', {
      operation: 'certificate.renew', workflowKey: 'ca.order.renew', workflowVersion: '1.0.0', sourceCertificateId: 'certificate:acme-source', identifiers: ['example.test'], secretRef: 'secret://ca/acme/account',
    });
    assert.equal(renewed.status, 'SUCCESS');
    assert.equal(renewed.normalizedObjects[0].renewalOf, 'certificate:acme-source');

    const revoked = await execute(runner, 'ca.order.manage', {
      operation: 'certificate.revoke', workflowKey: 'ca.order.revoke', workflowVersion: '1.0.0', certificateUrl: 'https://acme.test.invalid/cert/1', reason: 'keyCompromise',
      sandboxRef: 'sandbox://acme', sandboxResponse: { statusCode: 200, body: {} }, secretRef: 'secret://ca/acme/account',
    });
    assert.equal(revoked.status, 'SUCCESS');
    assert.equal(revoked.normalizedObjects[0].status, 'revoked');

    const unknownId = 'acme-unknown-write';
    const unknown = await execute(runner, 'ca.order.manage', {
      operation: 'certificate.revoke', workflowKey: 'ca.order.revoke', workflowVersion: '1.0.0', certificateUrl: 'https://acme.test.invalid/cert/2', reason: 'unspecified',
      sandboxRef: 'sandbox://acme', sandboxResponse: { statusCode: 503, body: {} }, secretRef: 'secret://ca/acme/account',
    }, { idempotencyKey: unknownId });
    assert.equal(unknown.status, 'UNKNOWN');

    const recovered = await execute(runner, 'ca.order.manage', {
      operation: 'operation.recover', workflowKey: 'ca.operation.recover', workflowVersion: '1.0.0', operationId: unknownId, secretRef: 'secret://ca/acme/account',
    }, { writeEffect: false });
    assert.equal(recovered.status, 'UNKNOWN');
    assert.equal(recovered.warnings[0]?.code, 'ACME_RECOVERY_REQUIRES_RECEIPT');

    const missingToken = signedInput({ operation: 'account.ensure', workflowKey: 'ca.account.ensure', workflowVersion: '1.0.0', directoryUrl, email: 'p2-ca@example.test', secretRef: 'secret://ca/acme/account' }, 'ca.account.manage', runner.digests, 'grant-ca');
    delete missingToken.security.tokenId;
    const denied = await executeRaw(runner, 'ca.account.manage', missingToken, { writeEffect: false });
    assert.equal(denied.status, 'FAILED');
    assert.equal(denied.error?.code, 'PLUGIN_CONTRACT_INVALID');

    const inlineSecret = await execute(runner, 'ca.account.manage', {
      operation: 'account.ensure', workflowKey: 'ca.account.ensure', workflowVersion: '1.0.0', directoryUrl, email: 'p2-ca@example.test', secretRef: 'secret://ca/acme/account', privateKeyPem: accountKey,
    }, { writeEffect: false });
    assert.equal(inlineSecret.status, 'FAILED');
    assert.equal(inlineSecret.error?.code, 'ACME_SECRET_INLINE_FORBIDDEN');
    assert.equal(JSON.stringify(inlineSecret).includes(accountKey), false);
    assert.ok(runner.calls.filter((call) => call.method === 'audit.append').length >= 9);
  } finally {
    await closeRunner(runner.client);
  }
});

test('ca.acme-dns 真实 Runner 子进程只执行 DNS Solver 并收敛传播、清理、UNKNOWN 和恢复', async () => {
  const runner = createRunner('ca.acme-dns', 'backend/src/modules/plugins/builtin-plugins/ca-acme-dns', ['ca.challenge.dns-solver'], ['secret.resolve', 'audit.append'], {
    secretData: { apiToken: 'development-dns-token' },
  });
  const base = {
    workflowKey: 'ca.challenge.dns-solver', workflowVersion: '1.0.0', recordName: '_acme-challenge.example.test', recordValue: 'fixture-token',
    provider: 'fixture.dns', zoneId: 'zone-fixture', ttl: 60, secretRef: 'secret://ca/dns/token', sandboxRef: 'sandbox://dns',
  };
  try {
    const present = await execute(runner, 'ca.challenge.dns-solver', { ...base, operation: 'record.present', sandboxResponse: { statusCode: 200, body: {} } });
    assert.equal(present.status, 'SUCCESS');
    assert.equal(present.normalizedObjects[0].recordType, 'TXT');

    const propagated = await execute(runner, 'ca.challenge.dns-solver', { ...base, operation: 'record.propagation-check', sandboxResponse: { statusCode: 200, body: { propagated: true } } });
    assert.equal(propagated.status, 'SUCCESS');
    assert.equal(propagated.normalizedObjects[0].status, 'propagated');

    const cleaned = await execute(runner, 'ca.challenge.dns-solver', { ...base, operation: 'record.cleanup', sandboxResponse: { statusCode: 204, body: {} } });
    assert.equal(cleaned.status, 'SUCCESS');
    assert.equal(cleaned.normalizedObjects[0].status, 'cleaned');

    const ownership = await execute(runner, 'ca.challenge.dns-solver', { ...base, operation: 'record.present', accountId: 'account-forbidden', sandboxResponse: { statusCode: 200, body: {} } }, { writeEffect: false });
    assert.equal(ownership.status, 'FAILED');
    assert.equal(ownership.error?.code, 'DNS_SOLVER_OWNERSHIP_VIOLATION');

    const unknownId = 'dns-unknown-write';
    const unknown = await execute(runner, 'ca.challenge.dns-solver', { ...base, operation: 'record.cleanup', failureMode: 'unknown' }, { idempotencyKey: unknownId });
    assert.equal(unknown.status, 'UNKNOWN');

    const recovered = await execute(runner, 'ca.challenge.dns-solver', { operation: 'operation.recover', workflowKey: 'ca.operation.recover', workflowVersion: '1.0.0', operationId: unknownId }, { writeEffect: false });
    assert.equal(recovered.status, 'UNKNOWN');
    assert.equal(recovered.warnings[0]?.code, 'DNS_RECOVERY_REQUIRES_RECEIPT');

    const missingToken = signedInput({ ...base, operation: 'record.present', sandboxResponse: { statusCode: 200, body: {} } }, 'ca.challenge.dns-solver', runner.digests, 'grant-ca');
    delete missingToken.security.decisionId;
    const denied = await executeRaw(runner, 'ca.challenge.dns-solver', missingToken, { writeEffect: false });
    assert.equal(denied.status, 'FAILED');
    assert.equal(denied.error?.code, 'PLUGIN_CONTRACT_INVALID');
    assert.equal(JSON.stringify(present).includes('development-dns-token'), false);
    assert.ok(runner.calls.filter((call) => call.method === 'audit.append').length >= 5);
  } finally {
    await closeRunner(runner.client);
  }
});

test('ca.microsoft-adcs 控制面和独立 Agent-side Runner 完成 Plan、Receipt、UNKNOWN 和失败关闭', async () => {
  const control = createRunner('ca.microsoft-adcs', 'backend/src/modules/plugins/builtin-plugins/ca-microsoft-adcs', ['ca.certificate.issue', 'ca.certificate.renew', 'ca.certificate.revoke'], ['secret.resolve', 'audit.append']);
  const agent = createRunner('ca.microsoft-adcs', 'agents/windows-compat-full-agent/agent-side-plugins/ca-microsoft-adcs', ['ca.certificate.issue', 'ca.certificate.renew', 'ca.certificate.revoke'], [], {
    digestOverride: control.digests,
  });
  const executionId = 'adcs-agent-execution';
  const executionStepId = 'adcs-agent-step';
  try {
    const issued = await execute(control, 'ca.certificate.issue', {
      operation: 'ca.certificate.issue', workflowKey: 'ca.certificate.issue', workflowVersion: '1.0.0', profile: 'windows.agent_plan.adcs',
      templateId: 'WebServer', authorityId: 'authority-adcs', agentId: 'agent-windows-fixture', subject: 'CN=adcs.example.test', sans: ['adcs.example.test'], secretRef: 'secret://ca/adcs/credential',
    }, { executionId, executionStepId, idempotencyKey: 'adcs-plan-issue' });
    assert.equal(issued.status, 'SUCCESS');
    const plan = issued.normalizedObjects[0].agentPlan;
    assert.equal(plan.kind, 'AgentPlanV1');
    assert.equal(plan.actions[0].kind, 'certificate.authority.operation');
    assert.equal(Object.hasOwn(plan.actions[0], 'command'), false);

    const agentCoreResult = coreResult(plan, 'SUCCESS');
    const agentSuccess = await execute(agent, 'ca.certificate.issue', {
      operation: 'ca.certificate.issue', agentPlan: plan, agentCoreResult,
    }, { executionId, executionStepId, idempotencyKey: 'adcs-agent-success' });
    assert.equal(agentSuccess.status, 'SUCCESS');
    assert.equal(agentSuccess.normalizedObjects[0].kind, 'AgentExecutionReceiptV1');
    assert.equal(agentSuccess.normalizedObjects[0].planDigest, plan.planDigest);

    const agentUnknown = await execute(agent, 'ca.certificate.issue', {
      operation: 'ca.certificate.issue', agentPlan: plan, agentCoreResult: coreResult(plan, 'UNKNOWN'),
    }, { executionId, executionStepId, idempotencyKey: 'adcs-agent-unknown' });
    assert.equal(agentUnknown.status, 'UNKNOWN');
    assert.equal(agentUnknown.error?.mayBeUnknown, true);

    const missingCore = await execute(agent, 'ca.certificate.issue', { operation: 'ca.certificate.issue', agentPlan: plan }, { executionId, executionStepId, idempotencyKey: 'adcs-agent-missing-core', writeEffect: false });
    assert.equal(missingCore.status, 'FAILED');
    assert.equal(missingCore.error?.code, 'ADCS_AGENT_CORE_RESULT_MISSING');

    const forbiddenPlan = { ...plan, command: 'powershell' };
    const forbidden = await execute(agent, 'ca.certificate.issue', { operation: 'ca.certificate.issue', agentPlan: forbiddenPlan, agentCoreResult }, { executionId, executionStepId, idempotencyKey: 'adcs-agent-forbidden', writeEffect: false });
    assert.equal(forbidden.status, 'FAILED');
    assert.equal(forbidden.error?.code, 'ADCS_AGENT_PLAN_DIGEST_INVALID');

    const unknownId = 'adcs-control-unknown';
    const unknown = await execute(control, 'ca.certificate.revoke', {
      operation: 'ca.certificate.revoke', workflowKey: 'ca.certificate.revoke', workflowVersion: '1.0.0', templateId: 'WebServer', authorityId: 'authority-adcs', agentId: 'agent-windows-fixture',
      serialNumber: 'AB12', reason: 'unspecified', secretRef: 'secret://ca/adcs/credential', failureMode: 'async-failure',
    }, { idempotencyKey: unknownId });
    assert.equal(unknown.status, 'UNKNOWN');
    const recovered = await execute(control, 'ca.certificate.issue', {
      operation: 'operation.recover', workflowKey: 'ca.operation.recover', workflowVersion: '1.0.0', operationId: unknownId, secretRef: 'secret://ca/adcs/credential',
    }, { writeEffect: false });
    assert.equal(recovered.status, 'UNKNOWN');
    assert.equal(recovered.warnings[0]?.code, 'ADCS_RECOVERY_REQUIRES_RECEIPT');

    const missingDecision = signedInput({
      operation: 'ca.certificate.issue', workflowKey: 'ca.certificate.issue', workflowVersion: '1.0.0', profile: 'windows.agent_plan.adcs', templateId: 'WebServer', authorityId: 'authority-adcs', agentId: 'agent-windows-fixture', subject: 'CN=adcs.example.test', sans: ['adcs.example.test'], secretRef: 'secret://ca/adcs/credential',
    }, 'ca.certificate.issue', control.digests, 'grant-ca');
    delete missingDecision.security.decisionId;
    const denied = await executeRaw(control, 'ca.certificate.issue', missingDecision, { writeEffect: false });
    assert.equal(denied.status, 'FAILED');
    assert.equal(denied.error?.code, 'PLUGIN_CONTRACT_INVALID');
    assert.ok(control.calls.filter((call) => call.method === 'audit.append').length >= 3);
  } finally {
    await closeRunner(agent.client);
    await closeRunner(control.client);
  }
});

function createRunner(pluginId, packageDirectory, capabilities, permissions, options = {}) {
  const packageRoot = join(repositoryRoot, packageDirectory);
  const digests = options.digestOverride ?? packageDigests(packageRoot);
  const runtimePath = pluginId === 'ca.microsoft-adcs' && packageDirectory.startsWith('agents/')
    ? join(packageRoot, 'runtime/index.js')
    : join(backendRoot, `dist/modules/plugins/builtin-plugins/${basename(packageRoot)}/runtime/index.js`);
  const calls = [];
  const client = new PluginRunnerClient({
    pluginVersionId: `${pluginId}:1.0.0`, pluginId, pluginVersion: '1.0.0', tenantId,
    executablePath: process.execPath, args: [runnerServer, '--executor-module', runtimePath], workingDirectory: backendRoot,
    environment: {
      NODE_ENV: 'test', GCAC_PLUGIN_VERSION_ID: `${pluginId}:1.0.0`, GCAC_PLUGIN_PACKAGE_HASH: digests.packageHash,
      GCAC_PLUGIN_MANIFEST_HASH: digests.manifestHash, GCAC_PLUGIN_RESOURCE_HASH: digests.resourceHash,
    },
    runnerVersion: '1.0.0', sdkVersion: '1.0.0', capabilities, hostPermissions: permissions,
    packageHash: digests.packageHash, manifestHash: digests.manifestHash, resourceHash: digests.resourceHash,
    startupTimeoutMs: 1000, helloTimeoutMs: 1000, executeTimeoutMs: 10000, hostCallTimeoutMs: 1000, shutdownGraceMs: 1000,
    ...(permissions.length > 0 ? { hostApiHandler: hostApiHandler(calls, options.secretData ?? { privateKeyPem: developmentIssuerPrivateKeyPem, certificatePem: developmentCertificatePem, credentialFingerprint: sha256('adcs-credential'), apiToken: 'development-dns-token' }) } : {}),
  });
  return { client, calls, digests };
}

function hostApiHandler(calls, secretData) {
  return async ({ method, input }) => {
    calls.push({ method, input });
    if (method === 'secret.grant.resolve') return { ok: true, data: secretData };
    if (method === 'audit.append') return { ok: true, data: {} };
    throw new Error(`CA Fixture 不允许 Host API ${method}`);
  };
}

async function execute(runner, capability, rawInput, options = {}) {
  const executionId = options.executionId ?? `${runner.client.pluginVersionId}-execution-${++executionSequence}`;
  const executionStepId = options.executionStepId ?? `${runner.client.pluginVersionId}-step-${executionSequence}`;
  const input = signedInput(rawInput, capability, runner.digests, options.grantRef ?? 'grant-ca');
  return executeRaw(runner, capability, input, { ...options, executionId, executionStepId });
}

async function executeRaw(runner, capability, input, options = {}) {
  return runner.client.execute({
    tenantId, executionId: options.executionId ?? `${runner.client.pluginVersionId}-raw-${++executionSequence}`,
    executionStepId: options.executionStepId ?? `${runner.client.pluginVersionId}-raw-step-${executionSequence}`,
    workflowVersionId, planDigest, capability, input, grantRefs: [options.grantRef ?? 'grant-ca'],
    idempotencyKey: options.idempotencyKey ?? `${runner.client.pluginVersionId}-idempotency-${++executionSequence}`,
    deadlineAt: new Date(Date.now() + 9000).toISOString(), writeEffect: options.writeEffect ?? true,
  });
}

function signedInput(rawInput, capability, digests, grantRef) {
  const input = {
    ...rawInput,
    security: {
      tokenId: 'token:ca-fixture', decisionId: 'decision:ca-fixture', nonce: `nonce-ca-fixture-${++executionSequence}`,
      receiptRef: 'receipt://ca-fixture', localPolicyRef: 'policy:ca-fixture', grantRef, fixedDigests: digests, operationDigest: '',
    },
  };
  input.security.operationDigest = operationDigest(capability, input);
  return input;
}

function operationDigest(capability, input) {
  const copy = clone(input);
  delete copy.security.operationDigest;
  return sha256(canonicalJson({ capability, input: copy }));
}

function coreResult(plan, status) {
  return {
    apiVersion: 'gcac.agent-core/v1', kind: 'AgentCoreOperationResultV1', agentId: plan.agentId, tenantId: plan.tenantId,
    executionId: plan.executionId, executionStepId: plan.executionStepId, pluginVersionId: plan.pluginVersionId, planDigest: plan.planDigest,
    nonce: plan.nonce, tokenId: plan.tokenId, decisionId: plan.decisionId, receiptRef: plan.receiptRef, localPolicyRef: plan.localPolicyRef,
    status, ...(status === 'SUCCESS' ? { receiptStatus: 'SUCCESS', receiptNonce: plan.nonce, operation: plan.operation, certificatePem: developmentCertificatePem } : {}),
  };
}

async function closeRunner(client) {
  if (client.state === 'READY' || client.state === 'DRAINING') await client.drain();
  else await client.stop(true);
}

function packageDigests(packageDirectory) {
  const manifest = readJson(join(packageDirectory, 'manifest.json'));
  const resources = loadManifestResources(packageDirectory, manifest);
  const resourceSha256 = Object.fromEntries(Object.entries(resources).sort(([left], [right]) => left.localeCompare(right)).map(([path, content]) => [path, sha256(content)]));
  return {
    packageHash: sha256(JSON.stringify({ directory: basename(packageDirectory), manifest, resources })),
    manifestHash: sha256(JSON.stringify(manifest)),
    resourceHash: sha256(JSON.stringify(resourceSha256)),
  };
}

function loadManifestResources(packageDirectory, manifest) {
  const paths = [...new Set(collectStrings(manifest.resources))].sort();
  return Object.fromEntries(paths.map((resourcePath) => [resourcePath, readFileSync(resolve(packageDirectory, resourcePath), 'utf8')]));
}

function collectStrings(value) {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.values(value).flatMap(collectStrings);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function sha256(value) {
  return `sha256:${sha256Hex(value)}`;
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}
