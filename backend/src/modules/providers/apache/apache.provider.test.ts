import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ProviderSdk } from '../application/provider-sdk.js';
import { ApacheProvider, buildApacheCommandStrategy, parseApacheVirtualHosts, requiredApacheCapabilities } from './apache.provider.js';

const DEBIAN_CONF = `
Listen 80
Listen 443
Include /etc/apache2/ports.conf

<VirtualHost *:443>
  ServerName example.com
  ServerAlias www.example.com api.example.com
  SSLCertificateFile /etc/ssl/certs/example-fullchain.pem
  SSLCertificateKeyFile /etc/ssl/private/example.key
  Include /etc/apache2/snippets/ssl-params.conf
</VirtualHost>

<VirtualHost 10.0.0.2:8443>
  ServerName missing-key.example.com
  SSLCertificateFile /etc/ssl/certs/missing-key.pem
</VirtualHost>
`;

const RHEL_CONF = `
Listen 443 https
Include conf.modules.d/*.conf

<VirtualHost _default_:443>
  ServerName legacy.example.com
  ServerAlias legacy-alt.example.com
  SSLCertificateFile /etc/pki/tls/certs/legacy.crt
  SSLCertificateKeyFile /etc/pki/tls/private/legacy.key
  SSLCertificateChainFile /etc/pki/tls/certs/legacy-chain.crt
</VirtualHost>
`;

describe('spec021 Apache Provider', () => {
  it('解析 Debian VirtualHost、Listen、Include、多域名和缺 key 诊断', () => {
    const hosts = parseApacheVirtualHosts(DEBIAN_CONF, { apacheVersion: '2.4.58' });
    assert.equal(hosts.length, 2);
    assert.deepEqual(hosts[0]?.addresses, [{ listenIp: undefined, port: 443 }]);
    assert.equal(hosts[0]?.serverName, 'example.com');
    assert.deepEqual(hosts[0]?.serverAliases, ['www.example.com', 'api.example.com']);
    assert.equal(hosts[0]?.sslCertificate, '/etc/ssl/certs/example-fullchain.pem');
    assert.equal(hosts[0]?.sslCertificateKey, '/etc/ssl/private/example.key');
    assert.equal(hosts[0]?.includes[0], '/etc/apache2/snippets/ssl-params.conf');
    assert.deepEqual(hosts[0]?.listens, [{ listenIp: undefined, port: 80 }, { listenIp: undefined, port: 443 }]);
    assert.deepEqual(hosts[1]?.diagnostics, ['缺少 SSLCertificateKeyFile']);
  });

  it('识别 RHEL/Apache 2.2 独立 chain 策略', () => {
    const hosts = parseApacheVirtualHosts(RHEL_CONF, { apacheVersion: '2.2.34' });
    assert.equal(hosts[0]?.sslCertificateChain, '/etc/pki/tls/certs/legacy-chain.crt');
    assert.equal(hosts[0]?.chainStrategy, 'SEPARATE_CHAIN_FILE');
    assert.match(hosts[0]?.diagnostics.join(','), /独立 SSLCertificateChainFile/);
  });

  it('输出标准 DiscoveryResult 和 Apache 部署草案 DAG', async () => {
    const provider = new ApacheProvider();
    const result = await provider.discover({ tenantId: 'tenant_apache' }, {
      source: 'SSH',
      scope: { hostname: 'web-apache-01' },
      payload: { configText: RHEL_CONF, distribution: 'rhel', apacheVersion: '2.2.34' },
    });
    assert.equal(result.providerId, 'apache-provider');
    assert.equal(result.providerType, 'APACHE');
    assert.equal(result.hosts.length, 1);
    assert.equal(result.services[0]?.installPath, 'httpd');
    assert.equal(result.services[0]?.configPath, '/etc/httpd/conf/httpd.conf');
    assert.equal(result.endpoints.length, 1);
    assert.equal(result.bindings[0]?.domainName, 'legacy.example.com');
    assert.equal(result.bindings[0]?.rawFacts?.sslCertificateChain, '/etc/pki/tls/certs/legacy-chain.crt');
    assert.deepEqual(result.services[0]?.rawFacts?.requiredCapabilities, requiredApacheCapabilities());

    const bundle = provider.toDeploymentDraft(result);
    assert.equal(bundle.steps.length, 9);
    assert.equal(bundle.steps.some((step) => step.action === 'INSTALL_CERTIFICATE_CHAIN'), true);
    assert.equal(bundle.steps.some((step) => step.requiredCapabilities?.includes('apache.configtest')), true);
    assert.equal(bundle.steps.some((step) => step.requiredCapabilities?.includes('apache.reload')), true);
    assert.equal(bundle.steps.some((step) => step.requiredCapabilities?.includes('tls.remote_probe')), true);
    assert.equal(bundle.steps.some((step) => step.inputs.command === 'httpd -t'), true);
    assert.equal(bundle.steps.every((step) => step.idempotencyKey && step.rollbackHint), true);
    new ProviderSdk().assertDraftBundle(bundle);

    const rollback = provider.toRollbackDraft(result);
    assert.equal(rollback.steps.length, 4);
    assert.equal(rollback.steps.some((step) => step.action === 'ROLLBACK'), true);
    assert.equal(rollback.steps.every((step) => step.dependsOn.length <= 1), true);
  });

  it('支持 apachectl/apache2ctl/httpd 命令策略、手工路径兜底和 manual reload', async () => {
    assert.deepEqual(buildApacheCommandStrategy({ binaryPath: 'apache2ctl' }), {
      binaryPath: 'apache2ctl',
      testCommand: 'apache2ctl configtest',
      reloadCommand: 'apache2ctl graceful',
      reloadMode: 'graceful',
      manualReload: false,
    });
    assert.deepEqual(buildApacheCommandStrategy({ binaryPath: '/usr/sbin/httpd', reloadMode: 'reload' }), {
      binaryPath: '/usr/sbin/httpd',
      testCommand: '/usr/sbin/httpd -t',
      reloadCommand: '/usr/sbin/httpd reload',
      reloadMode: 'reload',
      manualReload: false,
    });

    const provider = new ApacheProvider();
    const result = await provider.discover({ tenantId: 'tenant_apache' }, {
      source: 'MANUAL',
      scope: { hostname: 'custom-apache', osType: 'LINUX' },
      payload: {
        binaryPath: '/opt/Apache Httpd/bin/apachectl',
        configPath: '/opt/Apache Httpd/conf/httpd.conf',
        manualReload: true,
        configText: '<VirtualHost *:443> ServerName manual.example.com\nSSLCertificateFile ${CERT_PATH}\nSSLCertificateKeyFile /opt/apache/key.pem\n</VirtualHost>',
      },
    });
    assert.match(String(result.rawPayload?.diagnostics), /变量/);
    const bundle = provider.toDeploymentDraft(result);
    assert.equal(bundle.steps.some((step) => step.requiredCapabilities?.includes('manual.reload')), true);
    assert.equal(bundle.steps.some((step) => step.inputs.command === '"/opt/Apache Httpd/bin/apachectl" configtest'), true);
  });

  it('Provider SDK fixture 校验 Apache provider，敏感字段仍被拒绝', async () => {
    const provider = new ApacheProvider();
    const sdk = new ProviderSdk();
    const report = await sdk.runFixture(provider, {
      name: 'apache-basic',
      context: { tenantId: 'tenant_apache_fixture', requestId: 'req_apache_fixture' },
      input: { providerId: 'apache-provider', source: 'SSH', scope: { hostname: 'fixture-apache' }, payload: { configText: DEBIAN_CONF, distribution: 'debian', apacheVersion: '2.4.58' } },
      expected: { hostCount: 1, serviceCount: 1, endpointCount: 2, bindingCount: 2, minStepCount: 12 },
    });
    assert.equal(report.passed, true);

    assert.throws(() => sdk.assertDraftBundle({
      steps: [{
        id: 'bad',
        title: 'bad',
        action: 'INSTALL_PRIVATE_KEY',
        providerType: 'APACHE',
        target: {},
        inputs: { privateKey: '-----BEGIN PRIVATE KEY-----demo' },
        dependsOn: [],
        requiredCapabilities: ['file.write'],
        idempotencyKey: 'bad',
      }],
    }), /敏感/);
  });
});
