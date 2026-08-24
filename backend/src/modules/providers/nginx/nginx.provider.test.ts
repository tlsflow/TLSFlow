import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ProviderSdk } from '../application/provider-sdk.js';
import { NginxProvider, buildNginxCommandStrategy, parseNginxServerBlocks } from './nginx.provider.js';

const NGINX_CONF = `
http {
  include /etc/nginx/conf.d/*.conf;
  server {
    listen 443 ssl;
    server_name example.com www.example.com;
    ssl_certificate /etc/nginx/certs/example.pem;
    ssl_certificate_key /etc/nginx/certs/example.key;
    include /etc/nginx/snippets/ssl.conf;
  }
  server {
    listen 8443 ssl;
    server_name api.example.com;
    ssl_certificate /etc/nginx/certs/api.pem;
  }
}`;

describe('spec020 NGINX Provider', () => {
  it('解析 server block、include、多域名和缺 key 诊断', () => {
    const blocks = parseNginxServerBlocks(NGINX_CONF);
    assert.equal(blocks.length, 2);
    assert.deepEqual(blocks[0]?.serverNames, ['example.com', 'www.example.com']);
    assert.equal(blocks[0]?.listens[0]?.port, 443);
    assert.equal(blocks[0]?.includes[0], '/etc/nginx/snippets/ssl.conf');
    assert.deepEqual(blocks[1]?.diagnostics, ['缺少 ssl_certificate_key']);
  });

  it('输出标准 DiscoveryResult 和部署步骤 DAG', async () => {
    const provider = new NginxProvider();
    const result = await provider.discover({ tenantId: 'tenant_nginx' }, {
      source: 'SSH',
      scope: { hostname: 'web-nginx-01' },
      payload: { configText: NGINX_CONF, configPath: '/etc/nginx/nginx.conf', binaryPath: '/usr/sbin/nginx' },
    });
    assert.equal(result.providerId, 'nginx-provider');
    assert.equal(result.hosts.length, 1);
    assert.equal(result.services[0]?.providerType, 'NGINX');
    assert.equal(result.endpoints.length, 2);
    assert.equal(result.serviceAssets?.length, 2);
    assert.equal(result.serviceAssets?.[0]?.address, 'example.com');
    assert.equal(result.bindings[0]?.domainName, 'example.com');

    const bundle = provider.toDeploymentDraft(result);
    assert.equal(bundle.steps.length, 12);
    assert.equal(bundle.steps.every((step) => step.requiredCapabilities?.length), true);
    assert.equal(bundle.steps.some((step) => step.requiredCapabilities?.includes('nginx.reload')), true);
    assert.equal(bundle.steps.some((step) => step.inputs.command === '/usr/sbin/nginx -t'), true);
    assert.equal(bundle.steps.every((step) => step.idempotencyKey && step.rollbackHint), true);
    new ProviderSdk().assertDraftBundle(bundle);

    const rollback = provider.toRollbackDraft(result);
    assert.equal(rollback.steps.length, 8);
    assert.equal(rollback.steps.some((step) => step.action === 'ROLLBACK'), true);
    assert.equal(rollback.steps.every((step) => step.dependsOn.length <= 1), true);
  });

  it('支持 Windows 命令策略、手工 reload 降级和变量路径诊断', async () => {
    assert.deepEqual(buildNginxCommandStrategy({ osType: 'WINDOWS', binaryPath: 'C:/nginx/nginx.exe' }), {
      testCommand: 'C:/nginx/nginx.exe -t',
      reloadCommand: 'C:/nginx/nginx.exe -s reload',
      manualReload: false,
    });
    const provider = new NginxProvider();
    const result = await provider.discover({ tenantId: 'tenant_nginx' }, {
      source: 'MANUAL',
      scope: { hostname: 'win-nginx', osType: 'WINDOWS' },
      payload: {
        osType: 'WINDOWS',
        binaryPath: 'C:/Program Files/nginx/nginx.exe',
        manualReload: true,
        configText: 'server { listen 443 ssl; server_name win.example.com; ssl_certificate $cert_path; ssl_certificate_key C:\\\\nginx\\\\key.pem; }',
      },
    });
    assert.equal(result.hosts[0]?.osType, 'WINDOWS');
    assert.match(String(result.rawPayload?.diagnostics), /变量/);
    const bundle = provider.toDeploymentDraft(result);
    assert.equal(bundle.steps.some((step) => step.requiredCapabilities?.includes('manual.reload')), true);
    assert.equal(bundle.steps.some((step) => step.inputs.command === '"C:/Program Files/nginx/nginx.exe" -t'), true);
  });

  it('Provider SDK fixture 校验 NGINX provider，敏感字段仍被拒绝', async () => {
    const provider = new NginxProvider();
    const sdk = new ProviderSdk();
    const report = await sdk.runFixture(provider, {
      name: 'nginx-basic',
      context: { tenantId: 'tenant_nginx_fixture', requestId: 'req_nginx_fixture' },
      input: { providerId: 'nginx-provider', source: 'SSH', scope: { hostname: 'fixture-nginx' }, payload: { configText: NGINX_CONF } },
      expected: { hostCount: 1, serviceCount: 1, endpointCount: 2, bindingCount: 2, minStepCount: 12 },
    });
    assert.equal(report.passed, true);

    assert.throws(() => sdk.assertDraftBundle({
      steps: [{
        id: 'bad',
        title: 'bad',
        action: 'INSTALL_PRIVATE_KEY',
        providerType: 'NGINX',
        target: {},
        inputs: { privateKey: '-----BEGIN PRIVATE KEY-----demo' },
        dependsOn: [],
        requiredCapabilities: ['file.write'],
        idempotencyKey: 'bad',
      }],
    }), /敏感/);
  });
});
