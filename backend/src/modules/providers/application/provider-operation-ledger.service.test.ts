import assert from 'node:assert/strict';
import test from 'node:test';
import type { DatabasePort, QueryResult } from '../../../database/database-port.js';
import type { CloudAccountAsset, ProviderOperationResult } from '../dto/providers.dto.js';
import type { ProviderTargetRef } from '../domain/provider-extension.js';
import { ProviderOperationLedgerService } from './provider-operation-ledger.service.js';
import type { ProviderCatalogApplicationService } from './provider-catalog.application-service.js';

test('Provider Operation Ledger 保存部署 checkpoint，并且回滚只消费一次', async () => {
  const database = new LedgerDatabase();
  let rollbackCheckpoint: Record<string, unknown> | undefined;
  const catalog = {
    execute: async (input: {
      operationKey: string;
      input?: Record<string, unknown>;
    }): Promise<ProviderOperationResult> => {
      if (input.operationKey === 'certificate.rollback') {
        const checkpoint = input.input?.checkpoint;
        rollbackCheckpoint = checkpoint && typeof checkpoint === 'object' && !Array.isArray(checkpoint)
          ? checkpoint as Record<string, unknown>
          : undefined;
        return {
          operationId: 'rollback-1',
          providerKey: 'cloud.aliyun',
          operationKey: input.operationKey,
          status: 'SUCCESS',
        };
      }
      return {
        operationId: 'deploy-1',
        providerKey: 'cloud.aliyun',
        operationKey: input.operationKey,
        status: 'SUCCESS',
        resultSummary: {
          checkpoint: {
            target: target(),
            previous: { certificateId: 'old-cert' },
          },
        },
      };
    },
  } as unknown as ProviderCatalogApplicationService;

  const service = new ProviderOperationLedgerService(database, catalog);
  const deployed = await service.execute({
    tenantId: 'tenant-ledger',
    asset: asset(),
    frameworkType: 'cloud.aliyun.cdn',
    operationKey: 'certificate.deploy',
    target: target(),
    requestId: 'request-deploy',
    input: { certificatePem: 'pem' },
  });

  assert.match(deployed.checkpointId ?? '', /^pol_/);
  const rolledBack = await service.execute({
    tenantId: 'tenant-ledger',
    asset: asset(),
    frameworkType: 'cloud.aliyun.cdn',
    operationKey: 'certificate.rollback',
    target: target(),
    requestId: 'request-rollback',
    input: { checkpointId: deployed.checkpointId },
  });

  assert.equal(rolledBack.status, 'SUCCESS');
  assert.equal((rollbackCheckpoint?.previous as { certificateId: string }).certificateId, 'old-cert');
  assert.equal(database.status, 'USED');
  await assert.rejects(
    () => service.execute({
      tenantId: 'tenant-ledger',
      asset: asset(),
      frameworkType: 'cloud.aliyun.cdn',
      operationKey: 'certificate.rollback',
      target: target(),
      input: { checkpointId: deployed.checkpointId },
    }),
    /Provider 回滚点不存在或已经使用/,
  );
});

function asset(): CloudAccountAsset {
  return {
    id: 'caa_ledger',
    tenantId: 'tenant-ledger',
    assetKind: 'cloud.account',
    providerKey: 'cloud.aliyun',
    displayName: '账本测试账号',
    credentialRef: 'credential://cred_ledger',
    scope: {},
    status: 'ACTIVE',
    metadata: {},
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:00.000Z',
    version: 1,
  };
}

function target(): ProviderTargetRef {
  return {
    frameworkType: 'cloud.aliyun.cdn',
    resourceId: 'cdn.example.com',
    domain: 'cdn.example.com',
  };
}

class LedgerDatabase implements DatabasePort {
  status: 'AVAILABLE' | 'USED' = 'AVAILABLE';

  async exec(): Promise<void> {}

  async query<TRow extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<TRow>> {
    if (sql.includes('insert into pg_provider_operation_ledger')) {
      this.status = 'AVAILABLE';
      return { rows: [] as TRow[] };
    }
    if (sql.includes('select checkpoint, target_ref')) {
      if (this.status !== 'AVAILABLE') return { rows: [] as TRow[] };
      return {
        rows: [{
          checkpoint: { previous: { certificateId: 'old-cert' } },
          target_ref: target(),
        }] as unknown as TRow[],
      };
    }
    if (sql.includes('update pg_provider_operation_ledger')) {
      this.status = 'USED';
      return { rows: [] as TRow[] };
    }
    void params;
    return { rows: [] as TRow[] };
  }

  async transaction<T>(work: (tx: DatabasePort) => Promise<T>): Promise<T> {
    return work(this);
  }
}
