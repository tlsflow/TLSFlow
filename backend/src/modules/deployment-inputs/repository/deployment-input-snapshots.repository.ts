import type { DatabasePort } from '../../../database/database-port.js';
import type { DeploymentInputSnapshotEntity } from '../dto/deployment-input-snapshot.dto.js';
import { readDeploymentInputSnapshotV1 } from '../schema/deployment-input-snapshot.schema.js';

interface DeploymentInputSnapshotRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  deployment_plan_id: string;
  deployment_plan_target_id: string;
  revision: number;
  snapshot: unknown;
  created_at: string | Date;
  created_by: string;
}

export class DeploymentInputSnapshotsRepository {
  constructor(private readonly db: DatabasePort) {}

  async create(entity: DeploymentInputSnapshotEntity): Promise<DeploymentInputSnapshotEntity> {
    const result = await this.db.query<DeploymentInputSnapshotRow>(
      `insert into deployment_input_snapshots
        (id, tenant_id, deployment_plan_id, deployment_plan_target_id, revision, snapshot, created_at, created_by)
       values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
       returning id, tenant_id, deployment_plan_id, deployment_plan_target_id, revision, snapshot, created_at, created_by`,
      [
        entity.id,
        entity.tenantId,
        entity.deploymentPlanId,
        entity.deploymentPlanTargetId,
        entity.revision,
        JSON.stringify(entity.snapshot),
        entity.createdAt,
        entity.createdBy,
      ],
    );
    return toEntity(result.rows[0]!);
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
