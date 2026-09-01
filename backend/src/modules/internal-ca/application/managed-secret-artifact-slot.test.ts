import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { runMigrations } from '../../../database/migration-runner.js';
import { PgCertificateArtifactStore } from '../../certificates/artifacts/certificate-artifact-store.js';
import { ManagedSecretArtifactSlotService } from './managed-secret-artifact-slot.js';

test('托管密钥 Artifact Slot 使用 SecretRef 和 TTL，过期读取失败并清理', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations');
  try {
    const service = new ManagedSecretArtifactSlotService(new PgCertificateArtifactStore(db));
    const slot = await service.put({ tenantId: 'tenant-slot', certificateVersionId: 'version-slot', secretRef: 'secret://certificate_private_key/sec/current', content: Buffer.from('ephemeral-private-material'), createdBy: 'test', ttlSeconds: 1 });
    assert.equal(slot.containsPrivateKey, true);
    assert.match(slot.artifactRef, /^artifact:\/\/managed-secret\//);
    assert.equal((await service.get('tenant-slot', slot)).content.toString(), 'ephemeral-private-material');
    await db.query('update pg_certificate_artifacts set expires_at = now() - interval \'1 second\' where tenant_id = $1 and artifact_ref = $2', ['tenant-slot', slot.artifactRef]);
    await assert.rejects(() => service.get('tenant-slot', slot), (error: unknown) => (error as { errorCode?: string }).errorCode === 'RESOURCE_NOT_FOUND');
    assert.equal(await service.cleanupExpired('tenant-slot'), 0);
  } finally {
    await db.close();
  }
});
