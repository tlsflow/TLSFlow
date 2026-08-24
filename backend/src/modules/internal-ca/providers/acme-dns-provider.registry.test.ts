import assert from 'node:assert/strict';
import test from 'node:test';
import { acmeDnsProviderDefinitions, findAcmeDnsProvider, listAcmeDnsProviders } from './acme-dns-provider.registry.js';

test('ACME DNS 注册表覆盖 Nginx Proxy Manager 上游的 86 个提供商', () => {
  const providers = listAcmeDnsProviders();
  const ids = providers.map((provider) => provider.id);

  assert.equal(providers.length, 86);
  assert.equal(new Set(ids).size, providers.length);
  assert.equal(providers.length, acmeDnsProviderDefinitions.length);
});

test('ACME DNS 注册表提供 Cloudflare 的插件信息和凭据模板', () => {
  const provider = findAcmeDnsProvider('cloudflare');

  assert.ok(provider);
  assert.equal(provider.name, 'Cloudflare');
  assert.equal(provider.fullPluginName, 'dns-cloudflare');
  assert.equal(provider.dependencies, 'acme=={{certbot-version}}');
  assert.match(provider.credentialTemplate, /dns_cloudflare_api_token/);
});
