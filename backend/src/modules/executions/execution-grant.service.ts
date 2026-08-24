import { MemoryRepository } from '../../persistence/repositories/memory-repository.js';
import type { RepositoryPort } from '../../persistence/repositories/repository-port.js';
import type { ExecutionGrantEntity } from '../../persistence/entities/execution-grant.entity.js';
import { newId } from '../../shared/id.js';
import { securityErrors } from '../../shared/security-error.js';

export interface CreateExecutionGrantInput {
  runId: string;
  stepId: string;
  executorType: string;
  allowedSecretRefs: string[];
  allowedActions: string[];
  expiresAt: string;
}

export interface ValidateGrantInput {
  grantId: string;
  runId: string;
  stepId: string;
  executorType: string;
  secretRef?: string;
  action?: string;
  markUsed?: boolean;
}

export class ExecutionGrantService {
  constructor(private readonly grants: RepositoryPort<ExecutionGrantEntity> = new MemoryRepository<ExecutionGrantEntity>()) {}

  create(input: CreateExecutionGrantInput): ExecutionGrantEntity {
    const now = new Date().toISOString();
    return this.grants.create({
      id: newId('grt'),
      runId: input.runId,
      stepId: input.stepId,
      executorType: input.executorType,
      allowedSecretRefs: [...new Set(input.allowedSecretRefs)],
      allowedActions: [...new Set(input.allowedActions)],
      expiresAt: input.expiresAt,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
  }

  validate(input: ValidateGrantInput): ExecutionGrantEntity {
    const grant = this.grants.get(input.grantId);
    if (!grant) {
      throw securityErrors.executorGrantDenied({ reason: 'grant not found' });
    }
    if (grant.status !== 'active') {
      throw securityErrors.executorGrantDenied({ reason: 'grant not active', status: grant.status });
    }
    if (new Date(grant.expiresAt).getTime() < Date.now()) {
      this.grants.update(grant.id, { status: 'expired', updatedAt: new Date().toISOString() });
      throw securityErrors.executorGrantDenied({ reason: 'grant expired' });
    }
    if (grant.runId !== input.runId || grant.stepId !== input.stepId || grant.executorType !== input.executorType) {
      throw securityErrors.executorGrantDenied({ reason: 'grant context mismatch' });
    }
    if (input.secretRef && !grant.allowedSecretRefs.includes(input.secretRef)) {
      throw securityErrors.executorGrantDenied({ reason: 'secretRef not allowed' });
    }
    if (input.action && !grant.allowedActions.includes(input.action)) {
      throw securityErrors.executorGrantDenied({ reason: 'action not allowed' });
    }

    if (input.markUsed) {
      return this.grants.update(grant.id, { status: 'used', updatedAt: new Date().toISOString() });
    }
    return grant;
  }

  get(id: string): ExecutionGrantEntity | undefined {
    return this.grants.get(id);
  }
}
