import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNetscalerCertKeyUsage } from './netscaler-nitro.bindings.js';
import { discoverNetscaler } from './netscaler-nitro.discovery.js';
import type { NetscalerNitroClient } from './netscaler-nitro.client.js';

test('发现设备、应用、证书、绑定并生成确定性共享使用图', async () => {
  const responses: Record<string, Record<string, unknown>> = {
    nsversion: { nsversion: [{ version: 'NetScaler NS14.1: Build 21.57.nc', productname: 'NetScaler ADC' }] },
    lbvserver: { lbvserver: [{ name: 'lb-b', ipv46: '10.0.0.2', port: 443 }, { name: 'lb-a', ipv46: '10.0.0.1', port: 443 }] },
    csvserver: { csvserver: [] }, vpnvserver: { vpnvserver: [] }, gslbvserver: { gslbvserver: [] },
    sslcertkey: { sslcertkey: [{ certkey: 'shared-cert', cert: '/nsconfig/ssl/shared.pem' }] },
    sslvserver_sslcertkey_binding: { sslvserver_sslcertkey_binding: [
      { vservername: 'lb-b', certkeyname: 'shared-cert', vservertype: 'LB' },
      { vservername: 'lb-a', certkeyname: 'shared-cert', vservertype: 'LB' },
      { broken: true },
    ] },
  };
  const client = fakeClient(responses);
  const result = await discoverNetscaler(client);
  assert.equal(result.version.normalized, '14.1');
  assert.equal(result.device.softwareVersion, '14.1');
  assert.equal(result.device.rawSummary.version, 'NetScaler NS14.1: Build 21.57.nc');
  assert.equal(result.virtualServers.length, 2);
  assert.equal(result.certificates[0].certKeyName, 'shared-cert');
  assert.deepEqual(result.certKeyUsage['shared-cert'].map((item) => item.virtualServerName), ['lb-a', 'lb-b']);
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

function fakeClient(responses: Record<string, Record<string, unknown>>): NetscalerNitroClient {
  return { async request(input: { path: string }) { return responses[input.path.split('/').pop() ?? ''] ?? {}; } } as NetscalerNitroClient;
}
