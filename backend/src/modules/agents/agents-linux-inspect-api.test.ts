import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../../app.module.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgliteDatabase } from '../../database/pglite-database.js';

describe('linux inspect capability api', () => {
  it('accepts detailed Linux inspect payloads and returns them from detail endpoints', async () => {
    const database = new PgliteDatabase();
    await runMigrations(database, 'src/database/migrations');
    const app = createApp({ db: database });
    const headers = { 'x-tenant-id': 'tenant_agent_linux', 'x-request-id': 'req_agent_linux_1' };
    const registered = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers,
      body: {
        agentKey: 'linuxgo.mid.12345678',
        hostname: 'linux-prod-01',
        version: '0.1.0',
        osType: 'linux',
        arch: 'amd64',
        ipAddress: '10.255.0.85',
        linuxDistribution: 'Ubuntu 24.04.2 LTS',
        osVersion: '24.04',
        role: 'full_agent',
        zone: 'default',
      },
    });
    assert.equal(registered.statusCode, 201);
    const agent = registered.body as { id: string };

    const capabilities = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/capabilities',
      headers,
      body: {
        agentId: agent.id,
        compatibilityLevel: 'L1',
        capabilities: [
          {
            capabilityKey: 'linux.nginx.detail',
            value: {
              installed: true,
              running: true,
              version: '1.24.0',
              binaryPath: '/usr/sbin/nginx',
              configPath: '/etc/nginx/nginx.conf',
              prefix: '/etc/nginx',
              serviceName: 'nginx',
              sites: [
                {
                  name: 'portal.example.com',
                  siteMode: 'static_root',
                  serverNames: ['portal.example.com', 'www.portal.example.com'],
                  sitePath: '/srv/www/portal',
                  proxyTargets: [],
                  configFiles: ['/etc/nginx/nginx.conf', '/etc/nginx/conf.d/portal.conf'],
                  listen: [
                    {
                      address: '0.0.0.0',
                      port: 443,
                      protocol: 'https',
                      certificateName: 'CN=portal.example.com',
                      certificatePath: '/etc/nginx/certs/portal.pem',
                      certificateKeyPath: '/etc/nginx/certs/portal.key',
                    },
                  ],
                },
              ],
            },
            confidence: 1,
            evidence: { source: 'runtime-inspection' },
          },
          {
            capabilityKey: 'linux.apache.detail',
            value: {
              installed: true,
              running: false,
              version: '2.4.58',
              binaryPath: '/usr/sbin/apache2ctl',
              serverRoot: '/etc/apache2',
              configPath: '/etc/apache2/apache2.conf',
              serviceName: 'apache2',
              sites: [
                {
                  name: 'app.example.com',
                  siteMode: 'reverse_proxy',
                  serverNames: ['app.example.com'],
                  sitePath: '/var/www/html',
                  proxyTargets: ['http://127.0.0.1:8080'],
                  configFiles: ['/etc/apache2/sites-enabled/app.conf'],
                  listen: [
                    {
                      address: '*',
                      port: 443,
                      protocol: 'https',
                      certificateName: 'CN=app.example.com',
                      certificatePath: '/etc/ssl/certs/app.pem',
                      certificateKeyPath: '/etc/ssl/private/app.key',
                    },
                  ],
                },
              ],
            },
            confidence: 1,
            evidence: { source: 'runtime-inspection' },
          },
          {
            capabilityKey: 'linux.tomcat.detail',
            value: {
              installed: true,
              running: true,
              version: '10.1.28',
              catalinaHome: '/opt/tomcat',
              catalinaBase: '/opt/tomcat',
              configPath: '/opt/tomcat/conf/server.xml',
              serviceName: 'tomcat',
              connectors: [
                {
                  address: '0.0.0.0',
                  port: 8443,
                  protocol: 'HTTP/1.1',
                  tls: true,
                  certificateName: 'CN=tomcat.example.com',
                  certificatePath: '/opt/tomcat/conf/tls/server.pem',
                  certificateKeyPath: '/opt/tomcat/conf/tls/server.key',
                },
              ],
              apps: [
                {
                  contextPath: '/manager',
                  docBase: '/opt/tomcat/webapps/manager',
                  appBase: '/opt/tomcat/webapps',
                },
              ],
            },
            confidence: 1,
            evidence: { source: 'runtime-inspection' },
          },
        ],
      },
    });
    assert.equal(capabilities.statusCode, 201);

    const detail = await app.inject({
      method: 'GET',
      path: `/api/v1/agents/detail?agentId=${agent.id}`,
      headers,
    });
    assert.equal(detail.statusCode, 200);
    const detailBody = detail.body as {
      capabilitySnapshot: {
        compatibilityLevel: string;
        capabilities: Array<{ capabilityKey: string; value: unknown }>;
      };
      capabilities: {
        declarations: Array<{ capabilityKey: string; value: unknown }>;
      };
    };

    assert.equal(detailBody.capabilitySnapshot.compatibilityLevel, 'L1');

    const nginxCapability = detailBody.capabilitySnapshot.capabilities.find((item) => item.capabilityKey === 'linux.nginx.detail');
    assert.ok(nginxCapability);
    const firstNginxSite = (nginxCapability?.value as {
      sites: Array<{
        name: string;
        serverNames: string[];
        listen: Array<{ port: number; certificateName: string }>;
      }>;
    }).sites[0];
    assert.equal(firstNginxSite.name, 'portal.example.com');
    assert.deepEqual(firstNginxSite.serverNames, ['portal.example.com', 'www.portal.example.com']);
    assert.equal(firstNginxSite.listen[0]?.port, 443);
    assert.equal(firstNginxSite.listen[0]?.certificateName, 'CN=portal.example.com');

    const apacheCapability = detailBody.capabilitySnapshot.capabilities.find((item) => item.capabilityKey === 'linux.apache.detail');
    assert.ok(apacheCapability);
    const firstApacheSite = (apacheCapability?.value as {
      sites: Array<{
        proxyTargets: string[];
        configFiles: string[];
        listen: Array<{ certificatePath: string; certificateKeyPath: string }>;
      }>;
    }).sites[0];
    assert.deepEqual(firstApacheSite.proxyTargets, ['http://127.0.0.1:8080']);
    assert.deepEqual(firstApacheSite.configFiles, ['/etc/apache2/sites-enabled/app.conf']);
    assert.equal(firstApacheSite.listen[0]?.certificatePath, '/etc/ssl/certs/app.pem');
    assert.equal(firstApacheSite.listen[0]?.certificateKeyPath, '/etc/ssl/private/app.key');

    const tomcatCapability = detailBody.capabilitySnapshot.capabilities.find((item) => item.capabilityKey === 'linux.tomcat.detail');
    assert.ok(tomcatCapability);
    const tomcatDetail = tomcatCapability?.value as {
      connectors: Array<{ tls: boolean; keystorePath?: string; certificateName: string }>;
      apps: Array<{ contextPath: string; docBase: string }>;
    };
    assert.equal(tomcatDetail.connectors[0]?.tls, true);
    assert.equal(tomcatDetail.connectors[0]?.certificateName, 'CN=tomcat.example.com');
    assert.equal(tomcatDetail.apps[0]?.contextPath, '/manager');
    assert.equal(tomcatDetail.apps[0]?.docBase, '/opt/tomcat/webapps/manager');

    const declarationKeys = detailBody.capabilities.declarations.map((item) => item.capabilityKey).sort();
    assert.deepEqual(declarationKeys, ['linux.apache.detail', 'linux.nginx.detail', 'linux.tomcat.detail']);
  });
});
