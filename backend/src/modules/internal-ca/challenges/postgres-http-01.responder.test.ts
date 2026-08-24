import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { runMigrations } from '../../../database/migration-runner.js';
import { PostgresHttp01Responder } from './postgres-http-01.responder.js';

test('PostgreSQL HTTP-01 responder 可跨实例读取验证材料', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const first = new PostgresHttp01Responder(db);
  const second = new PostgresHttp01Responder(db);
  const input = {
    tenantId: 'tenant-1',
    identifier: 'example.com',
    token: 'token-1',
    keyAuthorization: 'token-1.thumbprint',
    presentationId: 'presentation-1',
    actorId: 'worker-1',
  };

  await first.present(input);
  assert.equal(await second.read(input.token), input.keyAuthorization);

  await second.cleanup(input);
  assert.equal(await first.read(input.token), undefined);
});

test('PostgreSQL HTTP-01 responder 不允许跨租户清理验证材料', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const responder = new PostgresHttp01Responder(db);
  const input = {
    tenantId: 'tenant-1',
    identifier: 'example.com',
    token: 'token-1',
    keyAuthorization: 'token-1.thumbprint',
    presentationId: 'presentation-1',
    actorId: 'worker-1',
  };

  await responder.present(input);
  await responder.cleanup({ ...input, tenantId: 'tenant-2' });
  assert.equal(await responder.read(input.token), input.keyAuthorization);
});
