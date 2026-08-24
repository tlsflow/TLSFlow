import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildDefaultSyncFilter } from './real-ldap.connector.js';
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
});
