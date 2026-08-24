import assert from 'node:assert/strict';
import test from 'node:test';
import { runMigrations } from '../../database/migration-runner.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { createPersistedSecurityServices } from '../security/security-services.persistence.js';
import { CredentialsApplicationService } from './application/credentials.application-service.js';
import { RuntimeCredentialResolver } from './application/runtime-credential-resolver.js';
import { CredentialsRepository } from './repository/credentials.repository.js';

test('部署计划凭据快照固定 CredentialProfile 和 Secret 精确版本', async () => {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const security = createPersistedSecurityServices(database).services;
  const repository = new CredentialsRepository(database);
  const application = new CredentialsApplicationService(repository, undefined, database, security.secrets);
  const created = await application.create('tenant-plan', 'user-a', {
    name: '计划凭据',
    kind: 'USERNAME_PASSWORD',
    scopeType: 'global',
    username: 'admin',
    secretValues: { password: { plainText: 'version-one' } },
  });
  const resolver = new RuntimeCredentialResolver(repository, security.secrets);

  const first = await resolver.resolveBindingsForPlan('tenant-plan', { management: { credentialId: created.id } });
  assert.match(first.management!.secretRefs.password!, /#v1$/);
  assert.equal(first.management!.credentialVersionId, '1');

  await application.rotate('tenant-plan', created.id, 'user-a', {
    expectedVersion: 1,
    secretValues: { password: { plainText: 'version-two' } },
  });
  const second = await resolver.resolveBindingsForPlan('tenant-plan', { management: { credentialId: created.id } });
  assert.match(second.management!.secretRefs.password!, /#v2$/);
  assert.equal(second.management!.credentialVersionId, '2');
  assert.notEqual(second.management!.snapshotSha256, first.management!.snapshotSha256);
  assert.match(first.management!.secretRefs.password!, /#v1$/);
});
