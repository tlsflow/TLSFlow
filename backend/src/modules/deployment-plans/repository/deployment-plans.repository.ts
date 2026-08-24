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

  private readonly plans: PgDocumentRepository<DeploymentPlanEntity>;
  private readonly targets: PgDocumentRepository<DeploymentPlanTargetEntity>;
  private readonly transitions: PgDocumentRepository<StateTransitionEventEntity>;

  constructor(db: DatabasePort = new PgliteDatabase()) {
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
    return this.plans.list((plan) => sameTenant(plan.tenantId, tenantId));
  }

  async findPlanByIdempotencyKey(tenantId: string | undefined, actorId: string, idempotencyKey: string): Promise<DeploymentPlanEntity | undefined> {
    return (await this.plans.list((plan) => sameTenant(plan.tenantId, tenantId) && plan.createdBy === actorId && plan.idempotencyKey === idempotencyKey))[0];
  }

  async createTarget(target: DeploymentPlanTargetEntity): Promise<DeploymentPlanTargetEntity> {
    const duplicated = (await this.targets.list((item) => sameTenant(item.tenantId, target.tenantId)
      && item.deploymentPlanId === target.deploymentPlanId
      && item.certificateBindingId === target.certificateBindingId))[0];
    if (duplicated) {
      throw new AppError('RESOURCE_ALREADY_EXISTS', '同一计划不能重复引用同一证书绑定', { certificateBindingId: target.certificateBindingId });
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
    return this.targets.list((target) => target.deploymentPlanId === planId && sameTenantOrLegacyMissing(target.tenantId, tenantId));
  }

  async createTransition(event: StateTransitionEventEntity): Promise<StateTransitionEventEntity> {
    return this.transitions.create(event);
  }

  async listTransitions(entityId?: string): Promise<StateTransitionEventEntity[]> {
    return this.transitions.list((event) => !entityId || event.entityId === entityId);
  }

  async deleteTransitionsByEntityIds(entityIds: string[], tenantId?: string): Promise<number> {
    const ids = new Set(entityIds);
    if (ids.size === 0) return 0;
    const matched = await this.transitions.list((event) => ids.has(event.entityId) && sameTenant(event.tenantId, tenantId));
    await Promise.all(matched.map((event) => this.transitions.delete(event.id)));
    return matched.length;
  }

  async clear(): Promise<void> {
    await this.plans.clear();
    await this.targets.clear();
    await this.transitions.clear();
  }
}
