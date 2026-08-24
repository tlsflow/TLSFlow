import type { DatabasePort } from '../../../database/database-port.js';
import type { DeploymentInputRuntimeSnapshotV1, DeploymentInputSnapshotEntity } from '../dto/deployment-input-snapshot.dto.js';
import { readDeploymentInputSnapshotV1 } from '../schema/deployment-input-snapshot.schema.js';
import { CryptoService, type EnvelopeEncryptedPayload } from '../../secrets/crypto.service.js';
import { KeyManager } from '../../secrets/key-manager.service.js';

interface DeploymentInputSnapshotRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  deployment_plan_id: string;
  deployment_plan_target_id: string;
  revision: number;
  snapshot: unknown;
  sealed_runtime_payload?: unknown;
  created_at: string | Date;
  created_by: string;
}

export class DeploymentInputSnapshotsRepository {
  constructor(
    private readonly db: DatabasePort,
    private readonly crypto = new CryptoService(new KeyManager()),
  ) {}

  async create(
    entity: DeploymentInputSnapshotEntity,
    runtimeSnapshot: DeploymentInputRuntimeSnapshotV1,
  ): Promise<DeploymentInputSnapshotEntity> {
    assertRuntimeSnapshotMatchesAudit(entity, runtimeSnapshot);
    const sealedRuntimePayload = this.crypto.encryptSecret(JSON.stringify(runtimeSnapshot));
    const result = await this.db.query<DeploymentInputSnapshotRow>(
      `insert into deployment_input_snapshots
        (id, tenant_id, deployment_plan_id, deployment_plan_target_id, revision, snapshot, sealed_runtime_payload, created_at, created_by)
       values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)
       returning id, tenant_id, deployment_plan_id, deployment_plan_target_id, revision, snapshot, created_at, created_by`,
      [
        entity.id,
        entity.tenantId,
        entity.deploymentPlanId,
        entity.deploymentPlanTargetId,
        entity.revision,
        JSON.stringify(entity.snapshot),
        JSON.stringify(sealedRuntimePayload),
        entity.createdAt,
        entity.createdBy,
      ],
    );
    return toEntity(result.rows[0]!);
  }

  async getRuntimeSnapshot(tenantId: string, id: string): Promise<DeploymentInputRuntimeSnapshotV1 | undefined> {
    const result = await this.db.query<DeploymentInputSnapshotRow>(
      `select id, tenant_id, sealed_runtime_payload
         from deployment_input_snapshots
        where tenant_id=$1 and id=$2`,
      [tenantId, id],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const sealed = readEnvelopeEncryptedPayload(row.sealed_runtime_payload);
    if (!sealed) throw new Error(`部署输入运行材料缺失或格式无效: ${id}`);
    const value = JSON.parse(this.crypto.decryptSecret(sealed)) as unknown;
    return readDeploymentInputRuntimeSnapshotV1(value, id);
  }

  async get(tenantId: string, id: string): Promise<DeploymentInputSnapshotEntity | undefined> {
    const result = await this.db.query<DeploymentInputSnapshotRow>(
      `select id, tenant_id, deployment_plan_id, deployment_plan_target_id, revision, snapshot, created_at, created_by
         from deployment_input_snapshots
        where tenant_id=$1 and id=$2`,
      [tenantId, id],
    );
    return result.rows[0] ? toEntity(result.rows[0]) : undefined;
  }

  async listByPlan(tenantId: string, deploymentPlanId: string): Promise<DeploymentInputSnapshotEntity[]> {
    const result = await this.db.query<DeploymentInputSnapshotRow>(
      `select id, tenant_id, deployment_plan_id, deployment_plan_target_id, revision, snapshot, created_at, created_by
         from deployment_input_snapshots
        where tenant_id=$1 and deployment_plan_id=$2
        order by revision asc, created_at asc, id asc`,
      [tenantId, deploymentPlanId],
    );
    return result.rows.map(toEntity);
  }

  async deleteByPlan(tenantId: string, deploymentPlanId: string): Promise<number> {
    const result = await this.db.query(
      `delete from deployment_input_snapshots
        where tenant_id=$1 and deployment_plan_id=$2
        returning id`,
      [tenantId, deploymentPlanId],
    );
    return result.rows.length;
  }
}

function assertRuntimeSnapshotMatchesAudit(
  entity: DeploymentInputSnapshotEntity,
  runtimeSnapshot: DeploymentInputRuntimeSnapshotV1,
): void {
  if (runtimeSnapshot.apiVersion !== 'gcac.deployment-input-runtime-snapshot/v1'
    || runtimeSnapshot.resolvedDeploymentInput.resolvedSha256 !== entity.snapshot.resolvedSha256) {
    throw new Error(`部署输入运行材料与审计快照摘要不一致: ${entity.id}`);
  }
}

function readDeploymentInputRuntimeSnapshotV1(value: unknown, id: string): DeploymentInputRuntimeSnapshotV1 {
  if (!isRecord(value)
    || value.apiVersion !== 'gcac.deployment-input-runtime-snapshot/v1'
    || !isRecord(value.contract)
    || value.contract.apiVersion !== 'gcac.deployment-input/v1'
    || !isRecord(value.effectiveBinding)
    || !isRecord(value.resolvedDeploymentInput)
    || value.resolvedDeploymentInput.apiVersion !== 'gcac.resolved-deployment-input/v1'
    || !isRecord(value.deploymentArtifact)) {
    throw new Error(`部署输入运行材料协议无效: ${id}`);
  }
  return value as unknown as DeploymentInputRuntimeSnapshotV1;
}

function readEnvelopeEncryptedPayload(value: unknown): EnvelopeEncryptedPayload | undefined {
  if (!isRecord(value)) return undefined;
  const stringFields = ['encryptedData', 'encryptedDek', 'kekVersion', 'algorithm', 'iv', 'authTag', 'dekIv', 'dekAuthTag', 'fingerprint'];
  if (!stringFields.every((field) => typeof value[field] === 'string')) return undefined;
  if (value.algorithm !== 'aes-256-gcm') return undefined;
  return value as unknown as EnvelopeEncryptedPayload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toEntity(row: DeploymentInputSnapshotRow): DeploymentInputSnapshotEntity {
  const snapshot = readDeploymentInputSnapshotV1(row.snapshot);
  if (!snapshot) throw new Error(`部署输入快照协议无效: ${row.id}`);
  return {
    id: row.id,
    tenantId: row.tenant_id,
    deploymentPlanId: row.deployment_plan_id,
    deploymentPlanTargetId: row.deployment_plan_target_id,
    revision: Number(row.revision),
    snapshot,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    createdBy: row.created_by,
  };
}
