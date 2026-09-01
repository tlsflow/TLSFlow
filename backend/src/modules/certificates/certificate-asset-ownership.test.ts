import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { createPersistedSecurityServices } from '../security/security-services.persistence.js';
import { CertificatesApplicationService } from './application/certificates.application-service.js';

test('专属证书资产按应用幂等复用，域名变更归档历史资产并创建新资产', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const security = createPersistedSecurityServices(db).services;
  const certificates = new CertificatesApplicationService({ db, secrets: security.secrets });

  const first = await certificates.createAsset({
    tenantId: 'tenant-asset-ownership',
    applicationAssetId: 'application-asset-ownership',
    name: 'dedicated app',
    primaryDomain: 'old.example.test',
    sourceType: 'acme',
    createdBy: 'operator',
  });
  const repeated = await certificates.createAsset({
    tenantId: 'tenant-asset-ownership',
    applicationAssetId: 'application-asset-ownership',
    name: 'dedicated app',
    primaryDomain: 'old.example.test',
    sourceType: 'acme',
    createdBy: 'operator',
  });
  assert.equal(repeated.id, first.id);

  const changed = await certificates.createAsset({
    tenantId: 'tenant-asset-ownership',
    applicationAssetId: 'application-asset-ownership',
    name: 'dedicated app new domain',
    primaryDomain: 'new.example.test',
    sourceType: 'acme',
    createdBy: 'operator',
  });
  assert.notEqual(changed.id, first.id);
  assert.equal(changed.applicationAssetId, 'application-asset-ownership');
  assert.equal(changed.primaryDomain, 'new.example.test');

  const rows = await db.query<{ id: string; primary_domain: string; status: string }>(
    `select id, primary_domain, status
       from pg_certificate_assets
      where tenant_id = $1 and application_asset_id = $2
      order by created_at asc`,
    ['tenant-asset-ownership', 'application-asset-ownership'],
  );
  assert.deepEqual(rows.rows.map((row) => [row.id, row.primary_domain, row.status]), [
    [first.id, 'old.example.test', 'archived'],
    [changed.id, 'new.example.test', 'active'],
  ]);
});
