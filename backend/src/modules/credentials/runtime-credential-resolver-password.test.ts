import assert from 'node:assert/strict';
import test from 'node:test';
import type { CredentialProfileEntity } from '../../persistence/entities/credential-profile.entity.js';
import type { SecretService } from '../secrets/secret.service.js';
import { RuntimeCredentialResolver } from './application/runtime-credential-resolver.js';
import type { CredentialsRepository } from './repository/credentials.repository.js';

function profile(kind: CredentialProfileEntity['kind']): CredentialProfileEntity {
  return {
    id: 'cred-tomcat-password',
    tenantId: 'tenant-tomcat',
    name: 'Tomcat KeyStore 密码',
    kind,
    scopeType: 'global',
    secretSlots: { password: 'secret://password/tomcat-keystore#current' },
    metadata: {},
    status: 'active',
    version: 1,
    createdBy: 'test',
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
  };
}

test('PASSWORD 明文只在部署前解析调用中短暂返回', async () => {
  const repository = {
    get: async () => profile('PASSWORD'),
  } as unknown as CredentialsRepository;
  const secrets = {
    resolveForService: async () => ({
      secretRef: 'secret://password/tomcat-keystore#current',
      versionId: 'secv-1',
      plainText: 'tomcat-current-password',
      fingerprint: 'fingerprint',
    }),
  } as unknown as SecretService;
  const resolver = new RuntimeCredentialResolver(repository, secrets);

  const runtime = await resolver.resolve('tenant-tomcat', 'cred-tomcat-password');
  assert.equal(runtime.kind, 'PASSWORD');
  assert.equal(JSON.stringify(runtime).includes('tomcat-current-password'), false);
  assert.equal(await resolver.resolveSecretValue('tenant-tomcat', 'cred-tomcat-password'), 'tomcat-current-password');
});

test('显式 Credential 类型错误时失败关闭，不尝试 Agent 自动读取', async () => {
  const repository = {
    get: async () => profile('API_KEY'),
  } as unknown as CredentialsRepository;
  const secrets = {
    resolveForService: async () => {
      throw new Error('不应解析错误类型的 Secret');
    },
  } as unknown as SecretService;
  const resolver = new RuntimeCredentialResolver(repository, secrets);

  await assert.rejects(
    () => resolver.resolveSecretValue('tenant-tomcat', 'cred-tomcat-password'),
    (error: any) => error?.errorCode === 'VALIDATION_FAILED'
      && /Tomcat KeyStore 密码 Credential 类型/.test(error.message),
  );
});
