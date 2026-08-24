import assert from 'node:assert/strict';
import test from 'node:test';
import { BuiltinUnifiedPluginLoader as BaseBuiltinUnifiedPluginLoader } from './builtin-plugins/builtin-unified-plugin-loader.js';
import { WorkflowTemplatesApplicationService } from '../workflow-templates/application/workflow-templates.application-service.js';
import { DeviceDiscoverySchemaService } from './discovery/device-discovery-schema.service.js';
import type { WorkflowMockStepOutput } from '../workflow-templates/dto/workflow-templates.dto.js';
import type { ResolvedDeploymentInputV1 } from '../deployment-inputs/dto/resolved-deployment-input.dto.js';
import { readFileSync } from 'node:fs';

class F5PluginLoader extends BaseBuiltinUnifiedPluginLoader {
  override async loadPackages() {
    const packages = await super.loadPackages();
    const f5 = packages.find((item) => (item.manifest as { pluginId?: string }).pluginId === 'device.f5.bigip');
    assert.ok(f5, '未找到 F5 BIG-IP 内置插件包');
    return [f5];
  }
}

test('F5 BIG-IP 发现 Workflow 通过 Fixture 生成可校验的 LTM 站点和证书目标', async () => {
  const pluginPackage = (await new F5PluginLoader().loadPackages())[0]!;
  assert.equal((pluginPackage.manifest as { version?: string }).version, '1.0.6');
  const content = JSON.parse(pluginPackage.resources['workflows/discover.json']!);
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });
  const result = await workflows.testRun({
    templateVersionId: version.id,
    mode: 'mock',
    resolvedInput: resolvedWorkflowInput(),
    mockResponses: discoveryResponses(),
  });
  assert.equal(result.status, 'success', JSON.stringify(result));
  const discovery = new DeviceDiscoverySchemaService().validate(result.stepResults.at(-1)?.extracted.discovery);
  assert.equal(discovery.device.productFamily, 'device.f5.bigip');
  assert.deepEqual(discovery.frameworks, [{ stableKey: 'framework:f5.ltm', frameworkType: 'f5.ltm', displayName: 'LTM' }]);
  assert.deepEqual(discovery.sites.map((site) => site.stableKey), ['VS:/Common/vs-app', 'VS:/Common/vs-api']);
  assert.equal(discovery.managedTargets.length, 2);
  assert.ok(discovery.managedTargets.every((target) => target.metadata?.profileReferenceCount === 2));
  assert.equal(discovery.certificates.length, 2);
  assert.equal(discovery.certificateBindings.length, 2);
  assert.equal(discovery.certificates[0]?.subject, 'CN=app.example.invalid');
  assert.equal(discovery.certificates[0]?.issuer, 'CN=Fixture Issuer');
  assert.equal(discovery.certificates[0]?.notAfter, '2027-01-01T00:00:00Z');
  assert.equal(discovery.certificates[0]?.sha256Fingerprint, 'a'.repeat(64));
  assert.ok(discovery.managedTargets.every((target) => target.metadata?.usage !== 'CA'));
  assert.equal(JSON.stringify(result).includes('fixture-password'), false);
});

test('F5 BIG-IP 真实 iControl REST 响应形状不会产生空转换输出', async () => {
  const pluginPackage = (await new F5PluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/discover.json']!);
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });
  const result = await workflows.testRun({
    templateVersionId: version.id,
    mode: 'mock',
    resolvedInput: resolvedWorkflowInput(),
    mockResponses: realDeviceDiscoveryResponses(),
  });
  assert.equal(result.status, 'success', JSON.stringify(result));
  const discovery = new DeviceDiscoverySchemaService().validate(result.stepResults.at(-1)?.extracted.discovery);
  assert.equal(discovery.device.softwareVersion, '21.0.0.3');
  assert.equal(discovery.device.metadata?.haState, 'ACTIVE');
  assert.equal(discovery.sites.length, 0, '实机当前没有 Virtual Server，不应伪造站点');
  assert.equal(discovery.managedTargets.length, 0);
  assert.equal(discovery.certificates.length, 2);
  assert.equal(discovery.certificates[0]?.subject, 'CN=*.jacksonz.cn');
  assert.equal(discovery.certificates[0]?.issuer, "CN=YE2,O=Let's Encrypt,C=US");
  assert.equal(discovery.certificates[0]?.notAfter, '2026-09-30T13:03:02.000Z');
  assert.equal(discovery.certificates[0]?.sha256Fingerprint, 'cea5d6f191d7c4332f6535ec0b3e6c038000f1a57e27b5a177d3143262d4d8bd');
  assert.deepEqual(
    discovery.certificates.map((certificate) => certificate.metadata?.certificatePath).sort(),
    ['/Common/default.crt', '/Common/gcac-jacksonz-20260930.crt'],
  );
  assert.equal(discovery.certificates.every((certificate) => certificate.metadata?.name === certificate.metadata?.certificatePath), true);
});

test('F5 BIG-IP 真实版本、HA 和管理地址响应可完成连接与身份识别', async () => {
  const pluginPackage = (await new F5PluginLoader().loadPackages())[0]!;
  const workflows = new WorkflowTemplatesApplicationService();
  const identityContent = JSON.parse(pluginPackage.resources['workflows/identity-detect.json']!);
  const identityTemplate = await workflows.createTemplate({ content: identityContent });
  const identityResult = await workflows.testRun({
    templateVersionId: identityTemplate.version.id,
    mode: 'mock',
    resolvedInput: resolvedWorkflowInput(),
    mockResponses: realDeviceIdentityResponses(),
  });
  assert.equal(identityResult.status, 'success', JSON.stringify(identityResult));
  assert.deepEqual(identityResult.stepResults.at(-1)?.extracted.identity, {
    productFamily: 'device.f5.bigip',
    softwareVersion: '21.0.0.3',
    managementProtocol: 'iControl REST',
    managementIp: '172.16.0.4/24',
    haState: 'ACTIVE',
  });

  const connectionContent = JSON.parse(pluginPackage.resources['workflows/connection-test.json']!);
  const connectionTemplate = await workflows.createTemplate({ content: connectionContent });
  const connectionResult = await workflows.testRun({
    templateVersionId: connectionTemplate.version.id,
    mode: 'mock',
    resolvedInput: resolvedWorkflowInput(),
    mockResponses: { readVersion: realDeviceIdentityResponses().readVersion },
  });
  assert.equal(connectionResult.status, 'success', JSON.stringify(connectionResult));
  assert.equal(connectionResult.stepResults.at(-1)?.extracted.productVersion, '21.0.0.3');
});

test('F5 BIG-IP 所有 Transform 表达式均可被 JSONata 编译', async () => {
  const pluginPackage = (await new F5PluginLoader().loadPackages())[0]!;
  const workflows = Object.entries(pluginPackage.resources).filter(([path]) => path.startsWith('workflows/'));
  const jsonata = (await import('jsonata')).default;
  for (const [path, source] of workflows) {
    const content = JSON.parse(source) as { steps?: Array<Record<string, any>>; rollback?: Array<Record<string, any>> };
    for (const step of [...(content.steps ?? []), ...(content.rollback ?? [])]) {
      for (const output of Object.values(step.transform?.outputs ?? {}) as Array<{ expression?: string }>) {
        const expression = output.expression;
        if (expression) assert.doesNotThrow(() => jsonata(expression), `${path}:${step.name}`);
      }
    }
  }
});

test('F5 BIG-IP 发现不调用可能阻塞的全量 ssl-cert 集合接口', async () => {
  const pluginPackage = (await new F5PluginLoader().loadPackages())[0]!;
  const workflow = JSON.parse(pluginPackage.resources['workflows/discover.json']!) as { steps: Array<Record<string, any>> };
  const paths: unknown[] = [];
  const visit = (steps: unknown): void => {
    if (!Array.isArray(steps)) return;
    for (const step of steps) {
      if (!step || typeof step !== 'object') continue;
      const item = step as Record<string, any>;
      if (item.type === 'http') paths.push(item.request?.url);
      visit(item.foreach?.steps);
    }
  };
  visit(workflow.steps);
  assert.deepEqual(paths, [
    '/mgmt/tm/sys/version',
    '/mgmt/tm/sys/failover',
    '/mgmt/tm/ltm/virtual',
    '/mgmt/tm/ltm/profile/client-ssl',
    '{{certificateFile.certificateUri}}',
  ]);
  assert.equal(paths.some((path) => String(path).includes('/mgmt/tm/sys/file/ssl-cert?')), false);
});

test('F5 接入表单固定使用 HTTPS 和证书错误例外，不再暴露校验证书或 SNI 字段', async () => {
  const pluginPackage = (await new F5PluginLoader().loadPackages())[0]!;
  const form = JSON.parse(readFileSync(`${pluginPackage.packageDirectory}/forms/device.json`, 'utf8')) as { sections: Array<{ fields: Array<Record<string, any>> }> };
  const fields = form.sections.flatMap((section) => section.fields);
  const https = fields.find((field) => field.key === 'httpsEnabled');
  const ignore = fields.find((field) => field.key === 'ignoreCertificateErrors');
  assert.equal(https?.standardField, 'tls.enabled');
  assert.equal(https?.defaultValue, true);
  assert.equal(ignore?.standardField, 'tls.ignoreCertificateErrors');
  assert.equal(ignore?.defaultValue, true);
  assert.equal(fields.some((field) => field.key === 'tlsVerify' || field.key === 'serverName'), false);

  const onboarding = JSON.parse(pluginPackage.resources['onboarding/application-asset.json']!) as { deploymentDefaults?: { variables?: Record<string, unknown> } };
  assert.equal(onboarding.deploymentDefaults?.variables?.allowInsecureTls, true, '应用资产默认值必须沿用 F5 模态框的证书错误例外设置');

  for (const [path, source] of Object.entries(pluginPackage.resources).filter(([resourcePath]) => resourcePath.startsWith('workflows/'))) {
    const workflow = JSON.parse(source) as { inputContract?: any; steps?: Array<Record<string, any>>; rollback?: Array<Record<string, any>> };
    assert.equal(workflow.inputContract?.connections?.management?.allowedProtocols?.join(','), 'https', path);
    assert.equal(workflow.inputContract?.connections?.management?.tls?.verifyPeer?.default, false, path);
    assert.equal(workflow.inputContract?.connections?.management?.tls?.serverName, undefined, path);
    assert.equal(workflow.inputContract?.variables?.allowInsecureTls?.bindingPolicy, 'required_binding', path);
    const requests: Array<Record<string, any>> = [];
    const visit = (steps: unknown): void => {
      if (!Array.isArray(steps)) return;
      for (const step of steps) {
        if (!step || typeof step !== 'object') continue;
        const item = step as Record<string, any>;
        if (item.request?.connectionRef === 'management') requests.push(item.request);
        visit(item.foreach?.steps);
      }
    };
    visit(workflow.steps);
    visit(workflow.rollback);
    assert.ok(requests.length > 0, `${path} 至少应包含一个管理请求`);
    assert.ok(requests.every((request) => request.tls?.sni === undefined), `${path} 不得传递 SNI`);
  }
});

function resolvedWorkflowInput(): ResolvedDeploymentInputV1 {
  return {
    apiVersion: 'gcac.resolved-deployment-input/v1',
    contractVersion: 'gcac.deployment-input/v1',
    assetContext: {
      apiVersion: 'gcac.deployment-asset-context/v1',
      application: { id: 'asset_f5_test', address: '192.0.2.44', serverName: 'f5.example.invalid', port: 443, protocol: 'https' },
      deployment: { targets: [], certificateResourceName: 'certificate-f5-fixture' },
    },
    variables: { allowInsecureTls: true },
    connections: { management: { transport: 'http', host: '192.0.2.44', port: 443, credentialSlot: 'credential', tls: { enabled: true, verifyPeer: false } } },
    credentials: { credential: { credentialId: 'cred-f5', kind: 'USERNAME_PASSWORD', username: 'admin', secretRefs: { password: 'secret://f5/password' } } },
    artifacts: {},
    provenance: {},
    sensitivePaths: [],
    issues: [],
    executable: true,
    resolvedSha256: 'f5-test-resolved-input',
  };
}

function discoveryResponses(): Record<string, WorkflowMockStepOutput> {
  const ok = (body: Record<string, unknown>): WorkflowMockStepOutput => ({ statusCode: 200, body });
  return {
    readVersion: ok({ entries: { 'https://localhost/mgmt/tm/sys/version/0': { nestedStats: { entries: { version: { description: 'BIG-IP 17.1.0.2' } } } } } }),
    readFailover: ok({ entries: { 'https://localhost/mgmt/tm/sys/failover/0': { nestedStats: { entries: { status: { description: 'active' } } } } } }),
    readVirtualServers: ok({ items: [
      { fullPath: '/Common/vs-app', destination: '/Common/192.0.2.80:443', profilesReference: { items: [{ fullPath: '/Common/clientssl', context: 'clientside' }] } },
      { fullPath: '/Common/vs-api', destination: '/Common/192.0.2.81:443', profilesReference: { items: [{ fullPath: '/Common/clientssl', context: 'clientside' }] } },
    ] }),
    readClientSslProfiles: ok({ items: [{ fullPath: '/Common/clientssl', generation: 17, serverName: 'app.example.invalid', sniDefault: true, sniRequire: false, certKeyChain: [
      { name: 'default', cert: '/Common/app.crt', usage: 'SERVER' },
      { name: 'ca-chain', cert: '/Common/ca.crt', usage: 'CA' },
    ] }] }),
    readCertificate: ok({ name: 'app.crt', fullPath: '/Common/app.crt', subject: 'CN=app.example.invalid', issuer: 'CN=Fixture Issuer', expirationDate: '2027-01-01T00:00:00Z', fingerprint: `SHA256/${'AA:'.repeat(31)}AA` }),
    readCertificates: ok({ items: [
      { fullPath: '/Common/app.crt', subject: 'CN=app.example.invalid', issuer: 'CN=Fixture Issuer', expirationDate: '2027-01-01T00:00:00Z' },
      { fullPath: '/Common/ca.crt', subject: 'CN=Fixture CA', issuer: 'CN=Fixture Root', expirationDate: '2030-01-01T00:00:00Z' },
    ] }),
  };
}

function realDeviceDiscoveryResponses(): Record<string, WorkflowMockStepOutput> {
  const ok = (body: Record<string, unknown>): WorkflowMockStepOutput => ({ statusCode: 200, body });
  return {
    readVersion: ok({ entries: { 'https://localhost/mgmt/tm/sys/version/0': { nestedStats: { entries: { Build: { description: '0.0.16' }, Version: { description: '21.0.0.3' } } } } } }),
    readFailover: ok({ apiRawValues: { apiAnonymous: 'Failover active for 0d 00:22:20\n' } }),
    readVirtualServers: ok({ items: [] }),
    readClientSslProfiles: ok({ items: [
      { fullPath: '/Common/clientssl', generation: 111, certKeyChain: [{ name: 'default', cert: '/Common/default.crt', usage: 'SERVER' }] },
      { fullPath: '/Common/clientssl-secure', generation: 112, certKeyChain: [{ name: 'default', cert: '/Common/gcac-jacksonz-20260930.crt', usage: 'SERVER' }] },
    ] }),
    readCertificate: ok({ name: 'gcac-jacksonz-20260930.crt', fullPath: '/Common/gcac-jacksonz-20260930.crt', subject: 'CN=*.jacksonz.cn', issuer: "CN=YE2,O=Let's Encrypt,C=US", expirationDate: 1790773382, fingerprint: 'SHA256/CE:A5:D6:F1:91:D7:C4:33:2F:65:35:EC:0B:3E:6C:03:80:00:F1:A5:7E:27:B5:A1:77:D3:14:32:62:D4:D8:BD' }),
    readCertificates: ok({ items: [
      { fullPath: '/Common/default.crt', subject: 'CN=BIG-IP', issuer: 'CN=BIG-IP', expirationDate: '2036-07-13T23:36:00Z' },
      { fullPath: '/Common/default_dh512.crt', subject: 'CN=BIG-IP', issuer: 'CN=BIG-IP', expirationDate: '2036-07-13T23:36:00Z' },
      { fullPath: '/Common/default_dh1024.crt', subject: 'CN=BIG-IP', issuer: 'CN=BIG-IP', expirationDate: '2036-07-13T23:36:00Z' },
      { fullPath: '/Common/default_dh2048.crt', subject: 'CN=BIG-IP', issuer: 'CN=BIG-IP', expirationDate: '2036-07-13T23:36:00Z' },
    ] }),
  };
}

function realDeviceIdentityResponses(): Record<string, WorkflowMockStepOutput> {
  const ok = (body: Record<string, unknown>): WorkflowMockStepOutput => ({ statusCode: 200, body });
  return {
    readVersion: ok({ entries: { 'https://localhost/mgmt/tm/sys/version/0': { nestedStats: { entries: { Version: { description: '21.0.0.3' } } } } } }),
    readManagementIp: ok({ items: [{ name: '172.16.0.4/24', fullPath: '172.16.0.4/24', description: 'configured-by-dhcp' }] }),
    readFailover: ok({ apiRawValues: { apiAnonymous: 'Failover active for 0d 00:22:20\n' } }),
  };
}
