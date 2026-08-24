import { AppError } from '../../../common/errors/app-error.js';
import { MemoryRepository } from '../../../persistence/repositories/memory-repository.js';
import type { RepositoryPort } from '../../../persistence/repositories/repository-port.js';
import type { DeploymentPlanEntity, DeploymentPlanTargetEntity, StateTransitionEventEntity } from '../schema/deployment-plans.schema.js';

function sameTenant(left?: string, right?: string): boolean {
  return (left ?? '') === (right ?? '');
}

export class DeploymentPlansRepository {
  readonly moduleName = 'deployment-plans' as const;

  constructor(
    private readonly plans: RepositoryPort<DeploymentPlanEntity> = new MemoryRepository<DeploymentPlanEntity>(),
    private readonly targets: RepositoryPort<DeploymentPlanTargetEntity> = new MemoryRepository<DeploymentPlanTargetEntity>(),
    private readonly transitions: RepositoryPort<StateTransitionEventEntity> = new MemoryRepository<StateTransitionEventEntity>(),
  ) {}

  createPlan(plan: DeploymentPlanEntity): DeploymentPlanEntity {
    return this.plans.create(plan);
  }

  updatePlan(id: string, patch: Partial<DeploymentPlanEntity>): DeploymentPlanEntity {
    return this.plans.update(id, { ...patch, version: (this.plans.getOrThrow(id).version ?? 1) + 1 });
  }

  getPlan(id: string, tenantId?: string): DeploymentPlanEntity | undefined {
    const plan = this.plans.get(id);
    return plan && sameTenant(plan.tenantId, tenantId) ? plan : undefined;
  }

  getPlanOrThrow(id: string, tenantId?: string): DeploymentPlanEntity {
    const plan = this.getPlan(id, tenantId);
    if (!plan) throw new AppError('RESOURCE_NOT_FOUND', '部署计划不存在', { id });
    return plan;
  }

  listPlans(tenantId?: string): DeploymentPlanEntity[] {
    return this.plans.list((plan) => sameTenant(plan.tenantId, tenantId));
  }

  findPlanByIdempotencyKey(tenantId: string | undefined, actorId: string, idempotencyKey: string): DeploymentPlanEntity | undefined {
    return this.plans.list((plan) => sameTenant(plan.tenantId, tenantId) && plan.createdBy === actorId && plan.idempotencyKey === idempotencyKey)[0];
  }

  createTarget(target: DeploymentPlanTargetEntity): DeploymentPlanTargetEntity {
    const duplicated = this.targets.list((item) => sameTenant(item.tenantId, target.tenantId)
      && item.deploymentPlanId === target.deploymentPlanId
      && item.certificateBindingId === target.certificateBindingId)[0];
    if (duplicated) {
      throw new AppError('RESOURCE_ALREADY_EXISTS', '同一计划不能重复引用同一证书绑定', { certificateBindingId: target.certificateBindingId });
    }
    return this.targets.create(target);
  }

  updateTarget(id: string, patch: Partial<DeploymentPlanTargetEntity>): DeploymentPlanTargetEntity {
    return this.targets.update(id, { ...patch, version: (this.targets.getOrThrow(id).version ?? 1) + 1 });
  }

  getTarget(id: string, tenantId?: string): DeploymentPlanTargetEntity | undefined {
    const target = this.targets.get(id);
    return target && sameTenant(target.tenantId, tenantId) ? target : undefined;
  }

  listTargetsByPlan(planId: string, tenantId?: string): DeploymentPlanTargetEntity[] {
    return this.targets.list((target) => target.deploymentPlanId === planId && sameTenant(target.tenantId, tenantId));
  }

  createTransition(event: StateTransitionEventEntity): StateTransitionEventEntity {
    return this.transitions.create(event);
  }

  listTransitions(entityId?: string): StateTransitionEventEntity[] {
    return this.transitions.list((event) => !entityId || event.entityId === entityId);
  }

  clear(): void {
    this.plans.clear();
    this.targets.clear();
    this.transitions.clear();
  }
}
