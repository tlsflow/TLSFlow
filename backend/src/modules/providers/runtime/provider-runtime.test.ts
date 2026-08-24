import assert from 'node:assert/strict';
import test from 'node:test';
import type { SecretService } from '../../secrets/secret.service.js';
import { CredentialsRepository } from '../../credentials/repository/credentials.repository.js';
import type { CloudAccountAsset } from '../dto/providers.dto.js';
import { CredentialProfileProviderCredentialResolver } from './provider-runtime.js';

function asset(providerKey: string): CloudAccountAsset {
  return {
    id: 'caa_test',
    tenantId: 'tenant_test',
    assetKind: 'cloud.account',
    providerKey,
    displayName: '测试账号',
    credentialRef: 'credential://cred_test',
    scope: {},
    status: 'ACTIVE',
    metadata: {},
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:00.000Z',
    version: 1,
  };
}

test('CLOUD_PROVIDER 凭据按独立 Secret Slot 解析为阿里云签名字段', async () => {
  const resolver = new CredentialProfileProviderCredentialResolver(
    {
      async get() {
        return {
          id: 'cred_test',
          tenantId: 'tenant_test',
          name: '阿里云生产账号',
          kind: 'CLOUD_PROVIDER' as const,
          scopeType: 'global' as const,
          secretSlots: {
            accessKeyId: 'secret://api_token/sec_ak#current',
            accessKeySecret: 'secret://api_token/sec_sk#current',
          },
          metadata: { providerKey: 'cloud.aliyun' },
          status: 'active' as const,
          version: 1,
          createdBy: 'user_test',
          createdAt: '2026-08-06T00:00:00.000Z',
          updatedAt: '2026-08-06T00:00:00.000Z',
        };
      },
    } as unknown as CredentialsRepository,
    {
      async resolveForService(input: { secretRef: string }) {
        return { plainText: input.secretRef.includes('sec_ak') ? 'ak-value' : 'sk-value' };
      },
    } as unknown as SecretService,
  );

  assert.deepEqual(await resolver.resolve(asset('cloud.aliyun')), {
    accessKeyId: 'ak-value',
    accessKeySecret: 'sk-value',
  });
});

test('云账号拒绝引用非 CLOUD_PROVIDER 类型凭据', async () => {
  const resolver = new CredentialProfileProviderCredentialResolver(
    {
      async get() {
        return {
          id: 'cred_test',
          tenantId: 'tenant_test',
          name: '错误凭据',
          kind: 'API_KEY' as const,
          scopeType: 'global' as const,
          secretSlots: { token: 'secret://api_token/sec_token#current' },
          metadata: { providerKey: 'cloud.tencent' },
          status: 'active' as const,
          version: 1,
          createdBy: 'user_test',
          createdAt: '2026-08-06T00:00:00.000Z',
          updatedAt: '2026-08-06T00:00:00.000Z',
        };
      },
    } as unknown as CredentialsRepository,
    {} as SecretService,
  );

  await assert.rejects(
    () => resolver.resolve(asset('cloud.aliyun')),
    (cause: unknown) => {
      assert.match(String((cause as Error).message), /云账号必须引用 CLOUD_PROVIDER 类型凭据/);
      return true;
    },
  );
});

test('云账号拒绝引用其他 Provider 的 CLOUD_PROVIDER 凭据', async () => {
  const resolver = new CredentialProfileProviderCredentialResolver(
    {
      async get() {
        return {
          id: 'cred_test',
          tenantId: 'tenant_test',
          name: '腾讯云凭据',
          kind: 'CLOUD_PROVIDER' as const,
          scopeType: 'global' as const,
          secretSlots: {
            secretId: 'secret://api_token/sec_id#current',
            secretKey: 'secret://api_token/sec_key#current',
          },
          metadata: { providerKey: 'cloud.tencent' },
          status: 'active' as const,
          version: 1,
          createdBy: 'user_test',
          createdAt: '2026-08-06T00:00:00.000Z',
          updatedAt: '2026-08-06T00:00:00.000Z',
        };
      },
    } as unknown as CredentialsRepository,
    {} as SecretService,
  );

  await assert.rejects(
    () => resolver.resolve(asset('cloud.aliyun')),
    /云账号与凭据的 Provider 不匹配/,
  );
});
