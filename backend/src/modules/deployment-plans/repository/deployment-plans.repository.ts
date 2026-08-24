import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { PgDocumentRepository } from '../../../persistence/repositories/pg-document-repository.js';
import type { DeploymentPlanEntity, DeploymentPlanTargetEntity, StateTransitionEventEntity } from '../schema/deployment-plans.schema.js';

function sameTenant(left?: string, right?: string): boolean {
  return (left ?? '') === (right ?? '');
}

function sameTenantOrLegacyMissing(left?: string, right?: string): boolean {
  return left === undefined ? true : sameTenant(left, right);
}

export class DeploymentPlansRepository {
  readonly moduleName = 'deployment-plans' as const;

  private readonly db: DatabasePort;
  private readonly plans: PgDocumentRepository<DeploymentPlanEntity>;
  private readonly targets: PgDocumentRepository<DeploymentPlanTargetEntity>;
  private readonly transitions: PgDocumentRepository<StateTransitionEventEntity>;
  private storageReady?: Promise<void>;

  constructor(db: DatabasePort = new PgliteDatabase()) {
    this.db = db;
    this.plans = new PgDocumentRepository(db, 'deployment-plans:plans');
    this.targets = new PgDocumentRepository(db, 'deployment-plans:targets');
    this.transitions = new PgDocumentRepository(db, 'deployment-plans:transitions');
  }

  async createPlan(plan: DeploymentPlanEntity): Promise<DeploymentPlanEntity> {
    return this.plans.create(plan);
  }

  async updatePlan(id: string, patch: Partial<DeploymentPlanEntity>): Promise<DeploymentPlanEntity> {
    const current = await this.plans.getOrThrow(id);
    return this.plans.update(id, { ...patch, version: (current.version ?? 1) + 1 });
  }

  async deletePlan(id: string): Promise<void> {
    await this.plans.delete(id);
  }

  async getPlan(id: string, tenantId?: string): Promise<DeploymentPlanEntity | undefined> {
    const plan = await this.plans.get(id);
    return plan && sameTenant(plan.tenantId, tenantId) ? plan : undefined;
  }

  async getPlanOrThrow(id: string, tenantId?: string): Promise<DeploymentPlanEntity> {
    const plan = await this.getPlan(id, tenantId);
    if (!plan) throw new AppError('RESOURCE_NOT_FOUND', '部署计划不存在', { id });
    return plan;
  }

  async listPlans(tenantId?: string): Promise<DeploymentPlanEntity[]> {
    await this.ensureStorage();
    const params: unknown[] = [];
    return listDeploymentDocuments(this.db, 'deployment-plans:plans', [tenantCondition('payload', tenantId, params)], params);
  }

  /**
   * 资产详情只读取与该应用资产有关的计划，避免调用方先拉取全量计划再过滤。
   */
  async listPlansByApplicationAsset(tenantId: string | undefined, applicationAssetId: string): Promise<DeploymentPlanEntity[]> {
    await this.ensureStorage();
    const params: unknown[] = [];
    const applicationAssetParameter = addParameter(params, applicationAssetId);
    const targetTenantCondition = tenantCondition('target.payload', tenantId, params, true);
    const planTenantCondition = tenantCondition('plan.payload', tenantId, params);
    return queryDeploymentDocuments<DeploymentPlanEntity>(this.db, `
      select plan.document_id, plan.payload
        from pg_documents plan
       where plan.namespace = 'deployment-plans:plans'
         and ${planTenantCondition}
         and exists (
           select 1
             from pg_documents target
            where target.namespace = 'deployment-plans:targets'
              and target.payload->>'applicationAssetId' = ${applicationAssetParameter}
              and ${targetTenantCondition}
              and target.payload->>'deploymentPlanId' = plan.document_id
         )
       order by plan.updated_at asc`, params);
  }

  async findPlanByIdempotencyKey(tenantId: string | undefined, actorId: string, idempotencyKey: string): Promise<DeploymentPlanEntity | undefined> {
    await this.ensureStorage();
    const params: unknown[] = [];
    const planTenantCondition = tenantCondition('payload', tenantId, params);
    const actorParameter = addParameter(params, actorId);
    const idempotencyParameter = addParameter(params, idempotencyKey);
    return (await listDeploymentDocuments<DeploymentPlanEntity>(this.db, 'deployment-plans:plans', [
      planTenantCondition,
      `payload->>'createdBy' = ${actorParameter}`,
      `payload->>'idempotencyKey' = ${idempotencyParameter}`,
    ], params, 'order by updated_at asc limit 1'))[0];
  }

  async findLatestManualDraftByApplicationAsset(
    tenantId: string | undefined,
    applicationAssetId: string,
  ): Promise<DeploymentPlanEntity | undefined> {
    await this.ensureStorage();
    const params: unknown[] = [];
    const applicationAssetParameter = addParameter(params, applicationAssetId);
    const targetTenantCondition = tenantCondition('target.payload', tenantId, params, true);
    const planTenantCondition = tenantCondition('plan.payload', tenantId, params);
    return (await queryDeploymentDocuments<DeploymentPlanEntity>(this.db, `
      select plan.document_id, plan.payload
        from pg_documents plan
       where plan.namespace = 'deployment-plans:plans'
         and ${planTenantCondition}
         and plan.payload->>'status' = 'DRAFT'
         and plan.payload->>'createdReason' = 'MANUAL'
         and coalesce((plan.payload->>'temporary')::boolean, false) = false
         and exists (
           select 1
             from pg_documents target
            where target.namespace = 'deployment-plans:targets'
              and target.payload->>'applicationAssetId' = ${applicationAssetParameter}
              and ${targetTenantCondition}
              and target.payload->>'deploymentPlanId' = plan.document_id
         )
       order by plan.payload->>'createdAt' desc
       limit 1`, params))[0];
  }

  async createTarget(target: DeploymentPlanTargetEntity): Promise<DeploymentPlanTargetEntity> {
    if (target.certificateBindingId) {
      await this.ensureStorage();
      const params: unknown[] = [];
      const targetTenantCondition = tenantCondition('payload', target.tenantId, params);
      const planParameter = addParameter(params, target.deploymentPlanId);
      const bindingParameter = addParameter(params, target.certificateBindingId);
      const duplicated = (await listDeploymentDocuments(this.db, 'deployment-plans:targets', [
        targetTenantCondition,
        `payload->>'deploymentPlanId' = ${planParameter}`,
        `payload->>'certificateBindingId' = ${bindingParameter}`,
      ], params, 'order by updated_at asc limit 1'))[0];
      if (duplicated) {
        throw new AppError('RESOURCE_ALREADY_EXISTS', '同一计划不能重复引用同一证书绑定', { certificateBindingId: target.certificateBindingId });
      }
    }
    return this.targets.create(target);
  }

  async updateTarget(id: string, patch: Partial<DeploymentPlanTargetEntity>): Promise<DeploymentPlanTargetEntity> {
    const current = await this.targets.getOrThrow(id);
    return this.targets.update(id, { ...patch, version: (current.version ?? 1) + 1 });
  }

  async deleteTargetsByPlan(planId: string, tenantId?: string): Promise<void> {
    const targets = await this.listTargetsByPlan(planId, tenantId);
    await Promise.all(targets.map((target) => this.targets.delete(target.id)));
  }

  async getTarget(id: string, tenantId?: string): Promise<DeploymentPlanTargetEntity | undefined> {
    const target = await this.targets.get(id);
    return target && sameTenantOrLegacyMissing(target.tenantId, tenantId) ? target : undefined;
  }

  async listTargetsByPlan(planId: string, tenantId?: string): Promise<DeploymentPlanTargetEntity[]> {
    await this.ensureStorage();
    const params: unknown[] = [];
    const planParameter = addParameter(params, planId);
    return listDeploymentDocuments(this.db, 'deployment-plans:targets', [
      `payload->>'deploymentPlanId' = ${planParameter}`,
      tenantCondition('payload', tenantId, params, true),
    ], params);
  }

  async listTargetsByPlans(planIds: readonly string[], tenantId?: string): Promise<DeploymentPlanTargetEntity[]> {
    const ids = new Set(planIds);
    if (ids.size === 0) return [];
    await this.ensureStorage();
    const params: unknown[] = [];
    const plansParameter = addParameter(params, [...ids]);
    return listDeploymentDocuments(this.db, 'deployment-plans:targets', [
      `payload->>'deploymentPlanId' = any(${plansParameter}::text[])`,
      tenantCondition('payload', tenantId, params, true),
    ], params);
  }

  async createTransition(event: StateTransitionEventEntity): Promise<StateTransitionEventEntity> {
    return this.transitions.create(event);
  }

  async listTransitions(entityId?: string): Promise<StateTransitionEventEntity[]> {
    await this.ensureStorage();
    const params: unknown[] = [];
    const conditions = entityId ? [`payload->>'entityId' = ${addParameter(params, entityId)}`] : [];
    return listDeploymentDocuments(this.db, 'deployment-plans:transitions', conditions, params);
  }

  async deleteTransitionsByEntityIds(entityIds: string[], tenantId?: string): Promise<number> {
    const ids = new Set(entityIds);
    if (ids.size === 0) return 0;
    await this.ensureStorage();
    const params: unknown[] = [[...ids]];
    const result = await this.db.query<{ document_id: string }>(
      `delete from pg_documents
        where namespace = 'deployment-plans:transitions'
          and payload->>'entityId' = any($1::text[])
          and ${tenantCondition('payload', tenantId, params)}
        returning document_id`,
      params,
    );
    return result.rows.length;
  }

  async clear(): Promise<void> {
    await this.plans.clear();
    await this.targets.clear();
    await this.transitions.clear();
  }

  private async ensureStorage(): Promise<void> {
    if (!this.storageReady) {
      this.storageReady = this.plans.initialize();
    }
    await this.storageReady;
  }
}

type DeploymentDocumentNamespace = 'deployment-plans:plans' | 'deployment-plans:targets' | 'deployment-plans:transitions';

interface DocumentRow<T> extends Record<string, unknown> {
  document_id: string;
  payload: T;
}

function addParameter(params: unknown[], value: unknown): string {
  params.push(value);
  return `$${params.length}`;
}

function tenantCondition(payload: string, tenantId: string | undefined, params: unknown[], allowLegacyMissing = false): string {
  const tenant = `${payload}->>'tenantId'`;
  if (tenantId === undefined) return `${tenant} is null`;
  const parameter = addParameter(params, tenantId);
  return allowLegacyMissing
    ? `(${tenant} is null or ${tenant} = ${parameter})`
    : `coalesce(${tenant}, '') = ${parameter}`;
}

async function listDeploymentDocuments<T>(
  db: DatabasePort,
  namespace: DeploymentDocumentNamespace,
  conditions: readonly string[],
  params: readonly unknown[],
  suffix = 'order by updated_at asc',
): Promise<Array<T & { id: string }>> {
  return queryDeploymentDocuments<T>(db, `
    select document_id, payload
      from pg_documents
     where namespace = '${namespace}'
     ${conditions.length > 0 ? `and ${conditions.join('\n and ')}` : ''}
     ${suffix}`, params);
}

async function queryDeploymentDocuments<T>(
  db: DatabasePort,
  sql: string,
  params: readonly unknown[],
): Promise<Array<T & { id: string }>> {
  const result = await db.query<DocumentRow<T>>(sql, [...params]);
  return result.rows.map((row) => structuredClone({ ...row.payload, id: row.document_id }));
}
