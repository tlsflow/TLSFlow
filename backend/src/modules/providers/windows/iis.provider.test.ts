import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ProviderSdk } from '../application/provider-sdk.js';
import { IISProvider, parseIisBindings, parseWindowsCertificates, resolveWindowsCompatibility } from './iis.provider.js';

const POWERSHELL_CERTS = JSON.stringify([
  {
    StoreLocation: 'LocalMachine',
    StoreName: 'My',
    Thumbprint: '‎ab cd 12 34 ef 56 78 90 ab cd 12 34 ef 56 78 90 ab cd 12 34',
    Subject: 'CN=www.example.com',
    NotAfter: '2030-01-02T03:04:05.000Z',
    HasPrivateKey: true,
  },
]);

const CERTUTIL_TEXT = `
================ Certificate 0 ================
Serial Number: 010203
Subject: CN=legacy.example.com
NotAfter: 12/31/2029 23:59
Cert Hash(sha1): 11 22 33 44 55 66 77 88 99 00 AA BB CC DD EE FF 00 11 22 33
  Key Container = legacy-key
`;

const IIS_JSON = JSON.stringify([
  {
    siteName: 'Default Web Site',
    protocol: 'https',
    bindingInformation: '*:443:www.example.com',
    certificateHash: 'ABCD1234EF567890ABCD1234EF567890ABCD1234',
    appPool: 'DefaultAppPool',
  },
]);

const APPCMD_TEXT = 'SITE "Legacy Site" (id:2,bindings:https/*:8443:legacy.example.com,applicationPool:LegacyPool,certificateHash:11223344556677889900AABBCCDDEEFF00112233)';

describe('spec019 IIS Provider', () => {
  it('解析 PowerShell/certutil 证书列表 fixture', () => {
    const powershell = parseWindowsCertificates(POWERSHELL_CERTS);
    assert.equal(powershell.length, 1);
    assert.equal(powershell[0]?.storeLocation, 'LocalMachine');
    assert.equal(powershell[0]?.storeName, 'My');
    assert.equal(powershell[0]?.thumbprint, 'ABCD1234EF567890ABCD1234EF567890ABCD1234');
    assert.equal(powershell[0]?.subject, 'CN=www.example.com');
    assert.equal(powershell[0]?.hasPrivateKey, true);

    const certutil = parseWindowsCertificates(CERTUTIL_TEXT);
    assert.equal(certutil.length, 1);
    assert.equal(certutil[0]?.thumbprint, '11223344556677889900AABBCCDDEEFF00112233');
    assert.equal(certutil[0]?.subject, 'CN=legacy.example.com');
    assert.equal(certutil[0]?.hasPrivateKey, true);
  });

  it('解析 IIS JSON 和 appcmd binding fixture', () => {
    const json = parseIisBindings(IIS_JSON);
    assert.equal(json.length, 1);
    assert.equal(json[0]?.siteName, 'Default Web Site');
    assert.equal(json[0]?.protocol, 'https');
    assert.equal(json[0]?.ip, '*');
    assert.equal(json[0]?.port, 443);
    assert.equal(json[0]?.hostHeader, 'www.example.com');
    assert.equal(json[0]?.certificateHash, 'ABCD1234EF567890ABCD1234EF567890ABCD1234');
    assert.equal(json[0]?.appPool, 'DefaultAppPool');

    const appcmd = parseIisBindings(APPCMD_TEXT);
    assert.equal(appcmd.length, 1);
    assert.equal(appcmd[0]?.siteName, 'Legacy Site');
    assert.equal(appcmd[0]?.port, 8443);
    assert.equal(appcmd[0]?.hostHeader, 'legacy.example.com');
    assert.equal(appcmd[0]?.appPool, 'LegacyPool');
  });

  it('输出统一 DiscoveryResult，包含 host/service/endpoint/binding 和能力建议', async () => {
    const provider = new IISProvider();
    const result = await provider.discover({ tenantId: 'tenant_iis' }, {
      source: 'MANUAL',
      scope: { hostname: 'win-web-01' },
      payload: {
        certStoreText: POWERSHELL_CERTS,
        iisBindings: IIS_JSON,
        osVersion: 'Windows Server 2019',
        remoteStrategy: 'full_agent',
      },
    });
    assert.equal(result.providerId, 'iis-provider');
    assert.equal(result.providerType, 'IIS');
    assert.equal(result.hosts[0]?.osType, 'WINDOWS');
    assert.equal(result.services[0]?.providerType, 'IIS');
    assert.equal(result.endpoints[0]?.protocol, 'HTTPS');
    assert.equal(result.endpoints[0]?.port, 443);
    assert.equal(result.serviceAssets?.length, 1);
    assert.equal(result.serviceAssets?.[0]?.address, 'www.example.com');
    assert.equal(result.bindings[0]?.bindingType, 'WINDOWS_CERT_STORE');
    assert.equal(result.bindings[0]?.domainName, 'www.example.com');
    assert.equal(result.bindings[0]?.certificateRef, 'certstore://LocalMachine/My/ABCD1234EF567890ABCD1234EF567890ABCD1234');
    assert.deepEqual(result.rawPayload?.certificates, parseWindowsCertificates(POWERSHELL_CERTS));
    assert.deepEqual((result.services[0]?.rawFacts?.requiredCapabilities as string[]).slice(0, 5), [
      'windows.cert_store',
      'iis.binding',
      'windows.pfx.import',
      'windows.private_key_acl',
      'tls.remote_probe',
    ]);
    assert.equal((result.services[0]?.rawFacts?.requiredCapabilities as string[]).includes('full_agent'), true);
  });

  it('生成 backup/import/ACL/update/verify 部署步骤 DAG，失败回滚 hint 清楚', async () => {
    const provider = new IISProvider();
    const result = await provider.discover({ tenantId: 'tenant_iis' }, {
      source: 'MANUAL',
      scope: { hostname: 'win-web-01' },
      payload: { certStoreText: POWERSHELL_CERTS, iisBindings: IIS_JSON, osVersion: 'Windows Server 2022', resolvedDeploymentMode: 'winrm_smb_wmi' },
    });
    const bundle = provider.toDeploymentDraft(result);
    assert.equal(bundle.steps.length, 5);
    assert.deepEqual(bundle.steps.map((step) => step.action), ['BACKUP', 'INSTALL_CERTIFICATE', 'INSTALL_PRIVATE_KEY', 'RELOAD_SERVICE', 'VERIFY_BINDING']);
    assert.equal(bundle.steps[1]?.dependsOn[0], bundle.steps[0]?.id);
    assert.equal(bundle.steps[4]?.dependsOn[0], bundle.steps[3]?.id);
    assert.equal(bundle.steps.every((step) => step.rollbackHint?.includes('回滚')), true);
    assert.equal(bundle.steps.some((step) => step.requiredCapabilities?.includes('winrm.connect')), true);
    assert.equal(bundle.steps.some((step) => step.requiredCapabilities?.includes('smb.file_transfer')), true);
    assert.equal(bundle.steps.some((step) => step.requiredCapabilities?.includes('wmi.query')), true);
    assert.equal(bundle.steps.some((step) => step.requiredCapabilities?.includes('tls.remote_probe')), true);
    new ProviderSdk().assertDraftBundle(bundle);
  });

  it('IIS Provider 使用 Resolver 结果，不按 Windows 版本猜测部署模式', async () => {
    assert.equal(resolveWindowsCompatibility('Windows Server 2003', { compatibilityLevel: 'obsolete', resolvedDeploymentMode: 'monitor_only' }).deploymentMode, 'monitor_only');
    assert.equal(resolveWindowsCompatibility('Windows Server 2008 R2', { compatibilityLevel: 'legacy', resolvedDeploymentMode: 'manual' }).deploymentMode, 'manual');
    assert.equal(resolveWindowsCompatibility('Windows Server 2008 R2', { compatibilityLevel: 'legacy', resolvedDeploymentMode: 'script_package' }).deploymentMode, 'script_package');

    const provider = new IISProvider();
    const result = await provider.discover({ tenantId: 'tenant_legacy' }, {
      source: 'MANUAL',
      scope: { hostname: 'legacy-iis' },
      payload: { certutilText: CERTUTIL_TEXT, iisBindingText: APPCMD_TEXT, osVersion: 'Windows Server 2003', compatibilityLevel: 'obsolete', resolvedDeploymentMode: 'monitor_only' },
    });
    const bundle = provider.toDeploymentDraft(result);
    assert.equal(result.hosts[0]?.tags.includes('monitor_only'), true);
    assert.equal(bundle.steps.every((step) => step.inputs.executionMode === 'monitor_only'), true);
    assert.equal(bundle.steps.some((step) => step.requiredCapabilities?.includes('manual.confirm')), true);
  });

  it('Provider SDK fixture 校验 IIS provider，并拒绝明文敏感字段', async () => {
    const provider = new IISProvider();
    const sdk = new ProviderSdk();
    const report = await sdk.runFixture(provider, {
      name: 'iis-basic',
      context: { tenantId: 'tenant_iis_fixture', requestId: 'req_iis_fixture' },
      input: { providerId: 'iis-provider', source: 'MANUAL', scope: { hostname: 'fixture-iis' }, payload: { certStoreText: POWERSHELL_CERTS, iisBindings: IIS_JSON } },
      expected: { hostCount: 1, serviceCount: 1, endpointCount: 1, bindingCount: 1, minStepCount: 5 },
    });
    assert.equal(report.passed, true);

    assert.throws(() => provider.discover({ tenantId: 'tenant_iis' }, {
      source: 'MANUAL',
      scope: { hostname: 'bad-iis' },
      payload: { iisBindings: IIS_JSON, pfxPassword: 'clear-text' },
    }), /敏感/);
  });
});
