import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createPluginRunnerExecutor as createNginx } from './web-nginx/runtime/index.js';
import { createPluginRunnerExecutor as createApache } from './web-apache/runtime/index.js';
import { createPluginRunnerExecutor as createTomcat } from './app-tomcat/runtime/index.js';

const hash = `sha256:${'a'.repeat(64)}`;

test('Nginx、Apache 和 Tomcat Full Agent 识别共同消费 Windows 原始证书事实', async () => {
  const cases = [
    {
      pluginId: 'web.nginx', frameworkType: 'web.nginx', create: createNginx,
      path: 'C:/nginx/conf/nginx.conf', certificatePath: 'C:/nginx/conf/certs/site.crt',
      config: 'server { listen 443 ssl; server_name nginx.example.test; ssl_certificate C:/nginx/conf/certs/site.crt; }',
    },
    {
      pluginId: 'web.apache', frameworkType: 'web.apache', create: createApache,
      path: 'C:/Apache24/conf/httpd.conf', certificatePath: 'C:/Apache24/conf/site.crt',
      config: '<VirtualHost *:443>\nServerName apache.example.test\nSSLEngine on\nSSLCertificateFile C:/Apache24/conf/site.crt\n</VirtualHost>',
    },
    {
      pluginId: 'app.tomcat', frameworkType: 'app.tomcat', create: createTomcat,
      path: 'C:/Tomcat/conf/server.xml', certificatePath: 'C:/Tomcat/conf/site.crt',
      config: '<Server><Service><Connector port="8443" protocol="org.apache.coyote.http11.Http11NioProtocol"><SSLHostConfig><Certificate certificateFile="C:/Tomcat/conf/site.crt" /></SSLHostConfig></Connector></Service><Host name="tomcat.example.test" /></Server>',
    },
  ];
  for (const item of cases) {
    const result = await withPluginEnvironment(item.pluginId, async (pluginVersionId) => {
      const executor = item.create();
      return executor.execute({
        pluginVersionId,
        pluginId: item.pluginId,
        pluginVersion: '1.0.2',
        tenantId: 'tenant-web-fact',
        executionId: `run:${item.pluginId}`,
        executionStepId: `step:${item.pluginId}`,
        capability: 'application.discover',
        grantRefs: ['grant-web-fact'],
        idempotencyKey: `fact:${item.pluginId}`,
        deadlineAt: new Date(Date.now() + 10_000).toISOString(),
        writeEffect: false,
        signal: new AbortController().signal,
        input: { discoveryMode: 'full-agent', factEnvelope: factEnvelope(item.path, item.config, item.certificatePath) },
      }, {});
    });
    assert.equal(result.status, 'SUCCESS', item.pluginId);
    const discovery = result.normalizedObjects[0];
    assert.equal(discovery.frameworks[0].frameworkType, item.frameworkType, item.pluginId);
    assert.equal(discovery.sites.length > 0, true, item.pluginId);
    assert.equal(discovery.certificates.length, 1, item.pluginId);
    assert.equal(discovery.certificateBindings.length, 1, item.pluginId);
    assert.equal(discovery.certificateBindings[0].certificateStableKey, discovery.certificates[0].stableKey, item.pluginId);
  }
});

function factEnvelope(path, config, certificatePath) {
  const fact = {
    contractVersion: 'gcac.agent-security/v1', factId: 'fact-web-full-agent', agentId: 'agent-web-01', tenantId: 'tenant-web-fact', collectedAt: '2026-08-14T00:00:00.000Z', ttlSeconds: 300, source: 'windows',
    facts: [
      { kind: 'process', pid: 1, executablePath: 'C:/Program Files/GCAC/gcac-agent.exe' },
      { kind: 'file_content', path, contentBase64: Buffer.from(config, 'utf8').toString('base64'), bytesRead: Buffer.byteLength(config), truncated: false, sha256: 'b'.repeat(64) },
      { kind: 'certificate_file', path: certificatePath, configuredPaths: [certificatePath.split('/').at(-1)], sha256Fingerprint: 'c'.repeat(64), thumbprint: '00112233445566778899AABBCCDDEEFF00112233', subject: 'CN=web.example.test', issuer: 'CN=GCAC Test CA', notBefore: '2026-01-01T00:00:00.000Z', notAfter: '2027-01-01T00:00:00.000Z' },
    ],
    warnings: [],
  };
  return { ...fact, digest: createHash('sha256').update(canonicalJson(fact), 'utf8').digest('hex') };
}

async function withPluginEnvironment(pluginId, callback) {
  const previous = { ...process.env };
  const pluginVersionId = `${pluginId.replace('.', '-')}-full-agent-test`;
  Object.assign(process.env, {
    GCAC_PLUGIN_VERSION_ID: pluginVersionId,
    GCAC_PLUGIN_PACKAGE_HASH: hash,
    GCAC_PLUGIN_MANIFEST_HASH: hash,
    GCAC_PLUGIN_RESOURCE_HASH: hash,
  });
  try { return await callback(pluginVersionId); }
  finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
}

function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}
