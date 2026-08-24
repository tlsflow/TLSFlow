import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverWebConfigs } from './web-config-discovery.js';

test('Web 配置事实解析出 Nginx 全部 server', () => {
  const result = discoverWebConfigs([{ path: '/etc/service/main.conf', content: `server { listen 80; server_name a.example.test b.example.test; }\nserver { listen 443 ssl; server_name secure.example.test; ssl_certificate /etc/cert.pem; }` }]);
  assert.equal(result.frameworks[0]?.frameworkType, 'web.nginx');
  assert.deepEqual(result.sites.map((site) => site.name), ['a.example.test', 'secure.example.test']);
  assert.deepEqual(result.sites[0]?.addresses, ['a.example.test', 'b.example.test']);
  assert.equal(result.sites[1]?.protocol, 'HTTPS');
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
