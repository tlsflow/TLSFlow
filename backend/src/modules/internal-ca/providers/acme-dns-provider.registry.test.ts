import assert from 'node:assert/strict';
import test from 'node:test';
import { acmeDnsProviderDefinitions, findAcmeDnsProvider, listAcmeDnsProviders } from './acme-dns-provider.registry.js';

test('ACME DNS 注册表使用 lego 原生 Provider 目录', () => {
  const providers = listAcmeDnsProviders();
  const ids = providers.map((provider) => provider.id);

  assert.ok(providers.length >= 50);
  assert.equal(new Set(ids).size, providers.length);
  assert.equal(providers.length, acmeDnsProviderDefinitions.length);
});

test('ACME DNS 注册表提供 Cloudflare 的 lego code 和环境文件模板', () => {
  const provider = findAcmeDnsProvider('cloudflare');

  assert.ok(provider);
  assert.equal(provider.name, 'Cloudflare');
  assert.equal(provider.id, 'cloudflare');
  assert.match(provider.credentialTemplate, /CLOUDFLARE_DNS_API_TOKEN/);
  assert.equal('fullPluginName' in provider, false);
  assert.equal('packageName' in provider, false);
});

test('ACME DNS 注册表直接使用阿里云 lego code 和环境变量', () => {
  const provider = findAcmeDnsProvider('alidns');

  assert.ok(provider);
  assert.equal(provider.id, 'alidns');
  assert.match(provider.credentialTemplate, /ALICLOUD_ACCESS_KEY/);
  assert.match(provider.credentialTemplate, /ALICLOUD_SECRET_KEY/);
});
