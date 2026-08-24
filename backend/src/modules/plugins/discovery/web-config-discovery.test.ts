import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverWebConfigs } from './web-config-discovery.js';

test('Web 配置事实解析出 Nginx 全部 server', () => {
  const result = discoverWebConfigs([{ path: '/etc/service/main.conf', content: `server { listen 80; server_name a.example.test b.example.test; }\nserver { listen 443 ssl; server_name secure.example.test; ssl_certificate /etc/cert.pem; }` }]);
  assert.equal(result.frameworks[0]?.frameworkType, 'web.nginx');
  assert.deepEqual(result.sites.map((site) => site.name), ['a.example.test', 'secure.example.test']);
  assert.deepEqual(result.sites[0]?.addresses, ['a.example.test', 'b.example.test']);
  assert.equal(result.sites[1]?.protocol, 'HTTPS');
  assert.deepEqual((result.sites[1]?.metadata as { listeners?: unknown[] }).listeners, [{ port: 443, protocol: 'HTTPS', certificatePath: '/etc/cert.pem' }]);
});

test('Nginx 一个 server 的多个 listen 都保留为监听事实', () => {
  const result = discoverWebConfigs([{ path: 'C:/nginx/conf/nginx.conf', content: `server { listen 80; listen 443 ssl; server_name app.example.test; }` }]);
  assert.deepEqual((result.sites[0]?.metadata as { listeners?: unknown[] }).listeners, [
    { port: 80, protocol: 'HTTP' },
    { port: 443, protocol: 'HTTPS' },
  ]);
});

test('Web 配置事实解析出 Apache VirtualHost 和 Tomcat Connector/Context', () => {
  const apache = discoverWebConfigs([{ path: '/etc/service/httpd.conf', content: `<VirtualHost *:443>\nServerName app.example.test\nServerAlias www.example.test\nSSLEngine on\nSSLCertificateFile /etc/app.pem\n</VirtualHost>` }]);
  assert.deepEqual(apache.sites.map((site) => site.name), ['app.example.test']);
  assert.deepEqual(apache.sites[0]?.addresses, ['app.example.test', 'www.example.test']);
  assert.equal(apache.sites[0]?.protocol, 'HTTPS');

  const tomcat = discoverWebConfigs([{ path: '/opt/runtime/server.xml', content: `<Connector port="8443" protocol="org.apache.coyote.http11.Http11NioProtocol" scheme="https"/><Host name="app.example.test"><Context path="/shop" /></Host>` }]);
  assert.equal(tomcat.frameworks[0]?.frameworkType, 'app.tomcat');
  assert.equal(tomcat.sites.some((site) => site.name === 'app.example.test'), true);
  assert.equal(tomcat.sites.some((site) => site.name === '/shop'), true);
});

test('Apache 无 VirtualHost 时仍识别 Listen 和证书配置', () => {
  const result = discoverWebConfigs([{ path: 'C:/Apache24/conf/httpd.conf', content: `Listen 443\nServerName app.example.test\nSSLEngine on\nSSLCertificateFile conf/app.crt\nSSLCertificateKeyFile conf/app.key` }]);
  assert.equal(result.sites[0]?.name, 'app.example.test');
  assert.equal(result.sites[0]?.protocol, 'HTTPS');
  assert.deepEqual((result.sites[0]?.metadata as { listeners?: unknown[] }).listeners, [{ port: 443, protocol: 'HTTPS', certificatePath: 'conf/app.crt', certificateKeyPath: 'conf/app.key' }]);
});

test('Windows 自定义安装目录按配置文件名和内容识别 Apache', () => {
  const result = discoverWebConfigs([{
    path: 'D:/services/Apache2.4/conf/extra/httpd-vhosts.conf',
    content: `Listen 9443\nServerName custom.example.test\nSSLEngine on\nSSLCertificateFile D:/services/Apache2.4/conf/site.crt`,
  }]);
  assert.equal(result.frameworks[0]?.frameworkType, 'web.apache');
  assert.equal(result.sites[0]?.name, 'custom.example.test');
  assert.equal(result.sites[0]?.port, 9443);
  assert.equal(result.sites[0]?.protocol, 'HTTPS');
});

test('Web 配置事实解析 IIS applicationHost.config 的站点和 HTTPS 绑定', () => {
  const result = discoverWebConfigs([{
    path: 'C:/Windows/System32/inetsrv/config/applicationHost.config',
    content: `<configuration><system.applicationHost><sites><site name="Default Web Site" id="1"><bindings><binding protocol="http" bindingInformation="*:80:" /><binding protocol="https" bindingInformation="*:443:portal.example.test" /></bindings></site><site name="Admin" id="2"><bindings><binding protocol="http" bindingInformation="*:8080:admin.example.test" /></bindings></site></sites></system.applicationHost></configuration>`,
  }]);
  assert.equal(result.frameworks[0]?.frameworkType, 'web.iis');
  assert.deepEqual(result.sites.map((site) => site.name), ['Default Web Site', 'Admin']);
  assert.equal(result.sites[0]?.protocol, 'HTTPS');
  assert.equal(result.sites[0]?.port, 443);
  assert.deepEqual(result.sites[0]?.addresses, ['portal.example.test']);
  assert.deepEqual((result.sites[0]?.metadata as { listeners?: Array<{ port: number; protocol: string }> }).listeners, [
    { port: 80, protocol: 'HTTP', bindingInformation: '*:80:' },
    { port: 443, protocol: 'HTTPS', bindingInformation: '*:443:portal.example.test', host: 'portal.example.test' },
  ]);
});

test('IIS HTTPS binding 保留 Windows 证书库 Thumbprint 和存储区', () => {
  const result = discoverWebConfigs([{
    path: 'C:/Windows/System32/inetsrv/config/applicationHost.config',
    content: `<configuration><system.applicationHost><sites><site name="Portal"><bindings><binding protocol="https" bindingInformation="*:443:portal.example.test" certificateHash="a1 b2 c3 d4 e5 f6 07 08" certificateStoreName="My" /></bindings></site></sites></system.applicationHost></configuration>`,
  }]);
  const listeners = (result.sites[0]?.metadata as { listeners?: Array<Record<string, unknown>> })?.listeners ?? [];
  assert.deepEqual(listeners[0], {
    port: 443,
    protocol: 'HTTPS',
    bindingInformation: '*:443:portal.example.test',
    host: 'portal.example.test',
    certificateThumbprint: 'A1B2C3D4E5F60708',
    certificateStoreName: 'My',
  });
});

test('IIS applicationHost.config 的 Base64 certificateHash 转为 SHA-1 Thumbprint', () => {
  const hash = Buffer.from('00112233445566778899AABBCCDDEEFF00112233', 'hex').toString('base64');
  const result = discoverWebConfigs([{
    path: 'C:/Windows/System32/inetsrv/config/applicationHost.config',
    content: `<configuration><system.applicationHost><sites><site name="Portal"><bindings><binding protocol="https" bindingInformation="*:443:portal.example.test" certificateHash="${hash}" certificateStoreName="My" /></bindings></site></sites></system.applicationHost></configuration>`,
  }]);
  const listeners = (result.sites[0]?.metadata as { listeners?: Array<Record<string, unknown>> })?.listeners ?? [];
  assert.equal(listeners[0]?.certificateThumbprint, '00112233445566778899AABBCCDDEEFF00112233');
  assert.equal(listeners[0]?.certificateStoreName, 'My');
});

test('Web 配置事实把 Tomcat Connector 和 SSLHostConfig keystore 作为 HTTPS 证书路径', () => {
  const result = discoverWebConfigs([{ path: '/opt/tomcat/conf/server.xml', content: `<Connector port="8445" protocol="org.apache.coyote.http11.Http11NioProtocol"><SSLHostConfig><Certificate certificateKeystoreFile="localhost-rsa.p12" certificateKeystorePassword="changeit" /></SSLHostConfig></Connector><Host name="localhost" />` }]);
  const site = result.sites.find((item) => item.name === 'localhost');
  assert.equal(site?.protocol, 'HTTPS');
  assert.equal((site?.metadata as { keystoreFile?: string } | undefined)?.keystoreFile, 'localhost-rsa.p12');
  assert.deepEqual((site?.metadata as { listeners?: Array<{ certificatePath?: string }> } | undefined)?.listeners, [{ port: 8445, protocol: 'HTTPS', certificatePath: 'localhost-rsa.p12' }]);
});

test('Web 配置事实支持 Tomcat SSLHostConfig 的 PEM certificateFile', () => {
  const result = discoverWebConfigs([{ path: '/opt/tomcat/conf/server.xml', content: `<Connector port="8445" protocol="org.apache.coyote.http11.Http11NioProtocol"><SSLHostConfig><Certificate certificateFile="/opt/tomcat/conf/localhost.pem" /></SSLHostConfig></Connector>` }]);
  const site = result.sites.find((item) => item.name === 'localhost');
  assert.equal((site?.metadata as { keystoreFile?: string } | undefined)?.keystoreFile, '/opt/tomcat/conf/localhost.pem');
  assert.equal((site?.metadata as { listeners?: Array<{ certificatePath?: string }> } | undefined)?.listeners?.[0]?.certificatePath, '/opt/tomcat/conf/localhost.pem');
});

test('Web 配置事实忽略 Tomcat server.xml 注释中的示例 Connector', () => {
  const result = discoverWebConfigs([{ path: '/etc/tomcat9/server.xml', content: `<!-- <Connector port="8443" protocol="org.apache.coyote.http11.Http11NioProtocol"><SSLHostConfig><Certificate certificateKeystoreFile="conf/localhost-rsa.jks" /></SSLHostConfig></Connector> --><Connector port="8445" protocol="org.apache.coyote.http11.Http11NioProtocol" SSLEnabled="true" keystoreFile="/etc/gcac-test/certs/test.p12" />` }]);
  const site = result.sites.find((item) => item.name === 'localhost');
  assert.equal(result.sites.length, 1);
  assert.equal(site?.port, 8445);
  assert.equal(site?.protocol, 'HTTPS');
  assert.equal((site?.metadata as { keystoreFile?: string } | undefined)?.keystoreFile, '/etc/gcac-test/certs/test.p12');
});
