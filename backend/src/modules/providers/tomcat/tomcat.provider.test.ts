import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../../../common/errors/app-error.js';
import { ProviderSdk } from '../application/provider-sdk.js';
import { buildTomcatServiceStrategy, parseTomcatServerXml, TomcatProvider } from './tomcat.provider.js';

const LEGACY_SERVER_XML = `
<Server>
  <Service name="Catalina">
    <Connector port="8080" protocol="HTTP/1.1" />
    <Connector port="8443" protocol="org.apache.coyote.http11.Http11NioProtocol"
      SSLEnabled="true" scheme="https" secure="true"
      keystoreFile="/opt/tomcat/conf/legacy.jks"
      keystoreType="JKS"
      keyAlias="legacy-cert"
      truststoreFile="/opt/tomcat/conf/trust.jks" />
  </Service>
</Server>`;

const MODERN_SERVER_XML = `
<Server>
  <Service name="Catalina">
    <Connector port="8443" protocol="org.apache.coyote.http11.Http11NioProtocol"
      SSLEnabled="true" defaultSSLHostConfigName="app.example.com">
      <SSLHostConfig hostName="app.example.com">
        <Certificate certificateKeystoreFile="/opt/tomcat/conf/app.p12"
          certificateKeystoreType="PKCS12"
          certificateKeyAlias="app-2026" />
      </SSLHostConfig>
      <SSLHostConfig hostName="api.example.com">
        <Certificate certificateKeystoreFile="/opt/tomcat/conf/api.pfx"
          certificateKeystoreType="PKCS12"
          certificateKeyAlias="api-2026" />
      </SSLHostConfig>
    </Connector>
  </Service>
</Server>`;

const REVERSE_PROXY_SERVER_XML = `
<Server>
  <Service name="Catalina">
    <Connector port="8080" protocol="HTTP/1.1" />
    <Connector port="8009" protocol="AJP/1.3" />
  </Service>
</Server>`;

describe('spec022 Tomcat Provider', () => {
  it('解析旧式 Connector keystore、alias、truststore 和 HTTPS 标记', () => {
    const connectors = parseTomcatServerXml(LEGACY_SERVER_XML);
    assert.equal(connectors.length, 2);
    assert.equal(connectors[0]?.sslEnabled, false);
    assert.equal(connectors[1]?.port, 8443);
    assert.equal(connectors[1]?.sslEnabled, true);
    assert.equal(connectors[1]?.scheme, 'https');
    assert.equal(connectors[1]?.keystoreFile, '/opt/tomcat/conf/legacy.jks');
    assert.equal(connectors[1]?.keystoreType, 'JKS');
    assert.equal(connectors[1]?.bindingType, 'JKS');
    assert.equal(connectors[1]?.keyAlias, 'legacy-cert');
    assert.equal(connectors[1]?.truststoreFile, '/opt/tomcat/conf/trust.jks');
  });

  it('解析多 SSLHostConfig/Certificate 为多 Connector 绑定模型', () => {
    const connectors = parseTomcatServerXml(MODERN_SERVER_XML);
    assert.equal(connectors.length, 2);
    assert.deepEqual(connectors.map((item) => item.hostName), ['app.example.com', 'api.example.com']);
    assert.deepEqual(connectors.map((item) => item.certificateKeyAlias), ['app-2026', 'api-2026']);
    assert.deepEqual(connectors.map((item) => item.bindingType), ['PFX', 'PFX']);
  });

  it('输出 DiscoveryResult host/service/endpoint/binding 和 keystore/alias 计划模型', async () => {
    const provider = new TomcatProvider();
    const result = await provider.discover({ tenantId: 'tenant_tomcat' }, {
      source: 'MANUAL',
      scope: { hostname: 'tomcat-01' },
      payload: { serverXml: MODERN_SERVER_XML, catalinaBase: '/srv/tomcat-a', tomcatVersion: '10.1.24', serviceName: 'tomcat-a' },
    });
    assert.equal(result.providerId, 'tomcat-provider');
    assert.equal(result.providerType, 'TOMCAT');
    assert.equal(result.hosts.length, 1);
    assert.equal(result.services[0]?.configPath, '/srv/tomcat-a/conf/server.xml');
    assert.equal(result.endpoints.length, 2);
    assert.equal(result.serviceAssets?.length, 2);
    assert.equal(result.serviceAssets?.[0]?.address, 'app.example.com');
    assert.equal(result.bindings.length, 2);
    assert.equal(result.bindings[0]?.bindingType, 'PFX');
    assert.equal(result.bindings[0]?.certificateRef, 'keystore:///opt/tomcat/conf/app.p12');
    assert.equal(result.bindings[0]?.rawFacts?.alias, 'app-2026');
    assert.equal((result.bindings[0]?.rawFacts?.keystoreInspectionPlan as Record<string, unknown>).mode, 'plan_only');
    assert.equal((result.bindings[0]?.rawFacts?.aliasPlan as Record<string, unknown>).preserveOtherAliases, true);
  });

  it('生成部署 DAG：备份、上传/导入、更新配置、重启、验证，并带 rollback hint', async () => {
    const provider = new TomcatProvider();
    const result = await provider.discover({ tenantId: 'tenant_tomcat' }, {
      source: 'SSH',
      scope: { hostname: 'tomcat-dag' },
      payload: { serverXml: LEGACY_SERVER_XML, serviceName: 'tomcat-prod' },
    });
    const bundle = provider.toDeploymentDraft(result);
    assert.deepEqual(bundle.steps.map((item) => item.action), ['BACKUP', 'INSTALL_CERTIFICATE', 'UPDATE_CONFIG', 'RELOAD_SERVICE', 'VERIFY_BINDING']);
    assert.equal(bundle.steps[1]?.inputs.targetFormat, 'JKS');
    assert.equal(bundle.steps[2]?.inputs.preserveUnrelatedAttributes, true);
    assert.equal(bundle.steps[3]?.inputs.reason, 'Tomcat keystore 通常不能可靠热加载，默认重启而不是假装 reload。');
    assert.equal(bundle.steps.every((step) => step.rollbackHint), true);
    new ProviderSdk().assertDraftBundle(bundle);

    const rollback = provider.toRollbackDraft(result);
    assert.deepEqual(rollback.steps.map((item) => item.action), ['ROLLBACK', 'RELOAD_SERVICE', 'VERIFY_BINDING']);
    new ProviderSdk().assertDraftBundle(rollback);
  });

  it('识别反向代理/无 HTTPS Connector，降级为 proxy-managed 且不生成部署计划', async () => {
    const provider = new TomcatProvider();
    const result = await provider.discover({ tenantId: 'tenant_tomcat' }, {
      source: 'MANUAL',
      scope: { hostname: 'tomcat-behind-proxy' },
      payload: { serverXml: REVERSE_PROXY_SERVER_XML },
    });
    assert.equal(result.bindings.length, 0);
    assert.equal(result.rawPayload?.reverseProxyHint && (result.rawPayload.reverseProxyHint as { mode: string }).mode, 'proxy-managed');
    assert.match(String(result.rawPayload?.diagnostics), /前置代理/);
    assert.equal(provider.toDeploymentDraft(result).steps.length, 0);
  });

  it('支持服务策略 fixture，不执行真实重启', () => {
    assert.deepEqual(buildTomcatServiceStrategy({ osType: 'LINUX', serviceName: 'tomcat-a' }), {
      serviceName: 'tomcat-a',
      restartCommand: undefined,
      reloadCommand: undefined,
      manualRestart: true,
      mode: 'manual',
    });
    assert.deepEqual(buildTomcatServiceStrategy({ osType: 'WINDOWS', serviceName: 'Tomcat10', restartCommand: 'sc.exe stop Tomcat10 && sc.exe start Tomcat10' }).mode, 'custom');
  });

  it('Provider SDK fixture 校验 Tomcat provider，敏感字段仍被拒绝', async () => {
    const provider = new TomcatProvider();
    const sdk = new ProviderSdk();
    const report = await sdk.runFixture(provider, {
      name: 'tomcat-modern',
      context: { tenantId: 'tenant_tomcat_fixture', requestId: 'req_tomcat_fixture' },
      input: { providerId: 'tomcat-provider', source: 'MANUAL', scope: { hostname: 'fixture-tomcat' }, payload: { serverXml: MODERN_SERVER_XML, catalinaBase: '/opt/tomcat' } },
      expected: { hostCount: 1, serviceCount: 1, endpointCount: 2, bindingCount: 2, minStepCount: 10 },
    });
    assert.equal(report.passed, true);

    assert.throws(() => provider.discover({ tenantId: 'tenant_tomcat_fixture' }, {
      source: 'MANUAL',
      scope: { hostname: 'bad-tomcat' },
      payload: { serverXml: LEGACY_SERVER_XML, keystorePassword: 'plain-text-password' },
    }), AppError);
  });

  it('server.xml 内密码类属性不进入 rawFacts/rawAttributes', () => {
    const connectors = parseTomcatServerXml('<Connector port="8443" SSLEnabled="true" keystoreFile="/x/a.jks" keystorePass="secret" keyPass="secret" />');
    assert.equal(connectors[0]?.rawAttributes.keystorePass, undefined);
    assert.equal(connectors[0]?.rawAttributes.keyPass, undefined);
    assert.match(connectors[0]?.diagnostics.join(','), /密码类属性/);
  });
});
