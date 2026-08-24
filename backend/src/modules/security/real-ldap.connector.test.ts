import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { describe, it } from 'node:test';
import {
  buildAdLookupFilter,
  buildDefaultSyncFilter,
  parseLdapEndpoint,
  probeLdapPort,
  resolveLdapHost,
} from './real-ldap.connector.js';
import type { IdentitySource } from './external-identity.service.js';

describe('RealLdapConnector', () => {
  it('AD 默认同步过滤器只同步真实用户并排除机器账号', async () => {
    const source: IdentitySource = {
      id: 'ids_ad',
      name: '企业 AD',
      type: 'active_directory',
      enabled: true,
      url: 'ldaps://ad.example.test:636',
      baseDn: 'DC=example,DC=test',
      requireGroupMapping: false,
      tlsMode: 'ldaps',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const filter = buildDefaultSyncFilter(source);

    assert.equal(filter.includes('!(sAMAccountName=*$)'), true);
    assert.equal(filter.includes('(objectCategory=person)'), true);
    assert.equal(filter.includes('(!(objectClass=computer))'), true);
  });

  it('AD 默认同步过滤器在传入前缀时使用 sAMAccountName 前缀匹配', async () => {
    const source: IdentitySource = {
      id: 'ids_ad',
      name: '企业 AD',
      type: 'active_directory',
      enabled: true,
      url: 'ldaps://ad.example.test:636',
      baseDn: 'DC=example,DC=test',
      requireGroupMapping: false,
      tlsMode: 'ldaps',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const filter = buildDefaultSyncFilter(source, 'jack');
    assert.equal(filter.includes('(sAMAccountName=jack\\\\2a)'.replace('\\\\', '\\')), true);
  });

  it('AD 按需检索同时匹配 sAMAccountName 和 UPN', async () => {
    const filter = buildAdLookupFilter('test01', 'test01@jacksonz.cn');

    assert.equal(filter.includes('(sAMAccountName=test01)'), true);
    assert.equal(filter.includes('(userPrincipalName=test01@jacksonz.cn)'), true);
    assert.equal(filter.includes('(!(objectClass=computer))'), true);
    assert.equal(filter.includes('userDnTemplate'), false);
  });

  it('LDAP 地址未显式指定端口时使用协议默认端口', () => {
    assert.deepEqual(parseLdapEndpoint('ldap://ad.example.test'), {
      protocol: 'ldap',
      hostname: 'ad.example.test',
      port: 389,
    });
    assert.deepEqual(parseLdapEndpoint('ldaps://ad.example.test'), {
      protocol: 'ldaps',
      hostname: 'ad.example.test',
      port: 636,
    });
  });

  it('IP 地址直接作为 DNS 检测结果，并可探测本地 LDAP 端口', async () => {
    assert.deepEqual(await resolveLdapHost('127.0.0.1'), ['127.0.0.1']);
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      assert.equal(typeof address === 'object' && address !== null, true);
      const result = await probeLdapPort('127.0.0.1', (address as { port: number }).port, 1000);
      assert.equal(result.success, true);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
