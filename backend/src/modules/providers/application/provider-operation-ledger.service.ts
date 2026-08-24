import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { newId } from '../../../shared/id.js';
import type { CloudAccountAsset, ProviderOperationResult, ProviderTargetRef } from '../dto/providers.dto.js';
import { ProviderCatalogApplicationService } from './provider-catalog.application-service.js';
import type { ProviderCertificateMaterialResolver } from '../runtime/provider-runtime.js';

export class ProviderOperationLedgerService {
  constructor(
    private readonly db: DatabasePort,
    private readonly catalog: ProviderCatalogApplicationService,
    private readonly materials?: ProviderCertificateMaterialResolver,
  ) {}

  async execute(input: {
    tenantId: string;
    asset: CloudAccountAsset;
    frameworkType: string;
    operationKey: string;
    target: ProviderTargetRef;
    requestId?: string;
    input?: Record<string, unknown>;
  }): Promise<ProviderOperationResult & { checkpointId?: string }> {
    const operationInput = await this.resolveOperationInput(input.tenantId, input.input ?? {});
    const checkpointId = typeof operationInput.checkpointId === 'string' ? operationInput.checkpointId : undefined;
    if (input.operationKey === 'certificate.rollback' && checkpointId) {
      const checkpoint = await this.readCheckpoint(input.tenantId, input.asset.id, checkpointId);
      operationInput.checkpoint = checkpoint;
    }
    const result = await this.catalog.execute({ ...input, input: operationInput });
    const checkpoint = result.resultSummary?.checkpoint;
    if (input.operationKey === 'certificate.deploy' && checkpoint && typeof checkpoint === 'object') {
      const id = newId('pol');
      await this.db.query(
        `insert into pg_provider_operation_ledger
         (id, tenant_id, cloud_account_asset_id, provider_key, framework_type, operation_key, target_ref, checkpoint, metadata)
         values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb)`,
        [
          id, input.tenantId, input.asset.id, input.asset.providerKey, input.frameworkType, input.operationKey,
          JSON.stringify(input.target), JSON.stringify(checkpoint), JSON.stringify({ requestId: input.requestId }),
        ],
      );
      return { ...result, checkpointId: id };
    }
    if (input.operationKey === 'certificate.rollback' && checkpointId) {
      await this.db.query(
        `update pg_provider_operation_ledger set status='USED', used_at=now()
         where tenant_id=$1 and cloud_account_asset_id=$2 and id=$3 and status='AVAILABLE'`,
        [input.tenantId, input.asset.id, checkpointId],
      );
    }
    return result;
  }

  private async resolveOperationInput(tenantId: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const certificateRef = typeof input.certificateRef === 'string' ? input.certificateRef.trim() : '';
    if (!certificateRef) return { ...input };
    if (!this.materials) {
      throw new AppError('SECRET_REF_INVALID', 'Provider 证书材料解析器未配置');
    }
    const material = await this.materials.resolve(certificateRef, tenantId);
    const { certificateRef: _certificateRef, ...rest } = input;
    return { ...rest, ...material };
  }

  private async readCheckpoint(tenantId: string, assetId: string, id: string): Promise<Record<string, unknown>> {
    const result = await this.db.query<{ checkpoint: Record<string, unknown>; target_ref: ProviderTargetRef }>(
      `select checkpoint, target_ref from pg_provider_operation_ledger
       where tenant_id=$1 and cloud_account_asset_id=$2 and id=$3 and status='AVAILABLE'`,
      [tenantId, assetId, id],
    );
    const row = result.rows[0];
    if (!row) throw new AppError('PROVIDER_ROLLBACK_UNAVAILABLE', 'Provider 回滚点不存在或已经使用', { checkpointId: id });
    return { target: row.target_ref, ...(row.checkpoint ?? {}) };
  }
}
