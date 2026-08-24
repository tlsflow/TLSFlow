import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash, X509Certificate } from 'node:crypto';
import test from 'node:test';
import { buildNetscalerCertKeyUsage } from './netscaler-nitro.bindings.js';
import { discoverNetscaler } from './netscaler-nitro.discovery.js';
import type { NetscalerNitroClient, NetscalerNitroRequest } from './netscaler-nitro.client.js';

const CERTIFICATE_PEM = `-----BEGIN CERTIFICATE-----
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

test('发现设备、应用、证书、绑定并生成确定性共享使用图', async () => {
  const responses: Record<string, Record<string, unknown>> = {
    nsversion: { nsversion: [{ version: 'NetScaler NS14.1: Build 21.57.nc', productname: 'NetScaler ADC' }] },
    lbvserver: { lbvserver: [{ name: 'lb-b', ipv46: '10.0.0.2', port: 443 }, { name: 'lb-a', ipv46: '10.0.0.1', port: 443 }] },
    csvserver: { csvserver: [] }, vpnvserver: { vpnvserver: [] }, gslbvserver: { gslbvserver: [] },
    sslcertkey: { sslcertkey: [{ certkey: 'shared-cert', cert: '/nsconfig/ssl/shared.pem' }] },
    systemfile: { systemfile: [{ filecontent: Buffer.from(CERTIFICATE_PEM, 'utf8').toString('base64') }] },
    sslvserver_sslcertkey_binding: { sslvserver_sslcertkey_binding: [
      { vservername: 'lb-b', certkeyname: 'shared-cert', vservertype: 'LB' },
      { vservername: 'lb-a', certkeyname: 'shared-cert', vservertype: 'LB' },
      { broken: true },
    ] },
  };
  const calls: NetscalerNitroRequest[] = [];
  const client = fakeClient(responses, calls);
  const result = await discoverNetscaler(client);
  assert.equal(result.version.normalized, '14.1');
  assert.equal(result.device.softwareVersion, '14.1');
  assert.equal(result.device.rawSummary.version, 'NetScaler NS14.1: Build 21.57.nc');
  assert.equal(result.virtualServers.length, 2);
  assert.equal(result.certificates[0].certKeyName, 'shared-cert');
  assert.equal(
    result.certificates[0].fingerprintSha256,
    createHash('sha256').update(new X509Certificate(CERTIFICATE_PEM).raw).digest('hex'),
  );
  assert.deepEqual(calls.find((item) => item.path.endsWith('/systemfile'))?.nitroArgs, {
    filename: 'shared.pem',
    filelocation: '/nsconfig/ssl',
  });
  assert.deepEqual(result.certKeyUsage['shared-cert'].map((item) => item.virtualServerName), ['lb-a', 'lb-b']);
});

test('证书文件读取失败仅记录 warning，不中断 ADC 发现', async () => {
  const responses: Record<string, Record<string, unknown>> = {
    nsversion: { nsversion: [{ version: 'NetScaler NS14.1: Build 21.57.nc' }] },
    lbvserver: { lbvserver: [] }, csvserver: { csvserver: [] }, vpnvserver: { vpnvserver: [] }, gslbvserver: { gslbvserver: [] },
    sslcertkey: { sslcertkey: [{ certkey: 'unreadable-cert', cert: 'unreadable.pem' }] },
    sslvserver_sslcertkey_binding: { sslvserver_sslcertkey_binding: [] },
  };
  const client = fakeClient(responses, [], new Set(['systemfile']));

  const result = await discoverNetscaler(client);

  assert.equal(result.certificates[0].fingerprintSha256, undefined);
  assert.deepEqual(result.warnings, ['sslcertkey:unreadable-cert:CERTIFICATE_FILE_READ_FAILED']);
});

test('兼容版本跳过不支持资源，单资源失败只产生 warning', async () => {
  const calls: string[] = [];
  const client = {
    async request(input: { path: string }) {
      calls.push(input.path);
      if (input.path.endsWith('/nsversion')) return { nsversion: [{ version: 'NS11.1: Build 65.25.nc' }] };
      if (input.path.endsWith('/csvserver')) throw new Error('fixture missing');
      const resource = input.path.split('/').pop() ?? '';
      return { [resource]: [] };
    },
  } as NetscalerNitroClient;
  const result = await discoverNetscaler(client);
  assert.equal(calls.some((path) => path.endsWith('/vpnvserver')), false);
  assert.equal(calls.some((path) => path.endsWith('/gslbvserver')), false);
  assert.deepEqual(result.warnings, ['csvserver:Error']);
});

test('绑定缺少类型时按 Virtual Server 清单识别 VPN，而不是错误默认成 LB', async () => {
  const responses: Record<string, Record<string, unknown>> = {
    nsversion: { nsversion: [{ version: 'NetScaler NS13.1: Build 55.29.nc' }] },
    lbvserver: { lbvserver: [{ name: 'lb-app', ipv46: '10.0.0.1', port: 443 }] },
    csvserver: { csvserver: [] },
    vpnvserver: { vpnvserver: [{ name: '_XD_10.0.0.2_443', ipv46: '10.0.0.2', port: 443 }] },
    gslbvserver: { gslbvserver: [] },
    sslcertkey: { sslcertkey: [{ certkey: 'shared-cert' }] },
    sslvserver_sslcertkey_binding: { sslvserver_sslcertkey_binding: [
      { vservername: 'lb-app', certkeyname: 'shared-cert' },
      { vservername: '_XD_10.0.0.2_443', certkeyname: 'shared-cert' },
    ] },
  };

  const result = await discoverNetscaler(fakeClient(responses));

  assert.deepEqual(result.bindings.map((item) => [item.virtualServerName, item.virtualServerType]), [
    ['lb-app', 'LB'],
    ['_XD_10.0.0.2_443', 'VPN'],
  ]);
});

test('共享使用图不依赖输入顺序', () => {
  const bindings = [
    { virtualServerType: 'LB', virtualServerName: 'z', certKeyName: 'cert', sniCertificate: false, sourceVersion: '14.1', rawSummary: {} },
    { virtualServerType: 'CS', virtualServerName: 'a', certKeyName: 'cert', sniCertificate: false, sourceVersion: '14.1', rawSummary: {} },
  ] as const;
  assert.deepEqual(buildNetscalerCertKeyUsage([...bindings]), buildNetscalerCertKeyUsage([...bindings].reverse()));
});

function fakeClient(
  responses: Record<string, Record<string, unknown>>,
  calls: NetscalerNitroRequest[] = [],
  failures: ReadonlySet<string> = new Set(),
): NetscalerNitroClient {
  return {
    async request(input: NetscalerNitroRequest) {
      calls.push(input);
      const resource = input.path.split('/').pop() ?? '';
      if (failures.has(resource)) throw new Error('fixture missing');
      return responses[resource] ?? {};
    },
  } as NetscalerNitroClient;
}
