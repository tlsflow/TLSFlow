import { PgliteDatabase } from '../../database/pglite-database.js';
import type { AsyncRepositoryPort } from '../../persistence/repositories/async-repository-port.js';
import { PgDocumentRepository } from '../../persistence/repositories/pg-document-repository.js';
import type { ExecutionGrantEntity } from '../../persistence/entities/execution-grant.entity.js';
import { newId } from '../../shared/id.js';
import { securityErrors } from '../../shared/security-error.js';

export interface CreateExecutionGrantInput {
  runId: string;
  stepId: string;
  executorType: string;
  allowedSecretRefs: string[];
  allowedArtifactRefs?: string[];
  allowedActions: string[];
  expiresAt: string;
}

export interface ValidateGrantInput {
  grantId: string;
  runId: string;
  stepId: string;
  executorType: string;
  secretRef?: string;
  artifactRef?: string;
  action?: string;
  markUsed?: boolean;
}

export class ExecutionGrantService {
  private static readonly defaultDb = new PgliteDatabase();

  private static createDefaultRepository(): AsyncRepositoryPort<ExecutionGrantEntity> {
    return new PgDocumentRepository<ExecutionGrantEntity>(ExecutionGrantService.defaultDb, 'security.execution_grants');
  }

  constructor(private readonly grants: AsyncRepositoryPort<ExecutionGrantEntity> = ExecutionGrantService.createDefaultRepository()) {}

  async create(input: CreateExecutionGrantInput): Promise<ExecutionGrantEntity> {
    const now = new Date().toISOString();
    return this.grants.create({
      id: newId('grt'),
      runId: input.runId,
      stepId: input.stepId,
      executorType: input.executorType,
      allowedSecretRefs: [...new Set(input.allowedSecretRefs)],
      allowedArtifactRefs: [...new Set(input.allowedArtifactRefs ?? [])],
      allowedActions: [...new Set(input.allowedActions)],
      expiresAt: input.expiresAt,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
  }

  async validate(input: ValidateGrantInput): Promise<ExecutionGrantEntity> {
    const grant = await this.grants.get(input.grantId);
    if (!grant) {
      throw securityErrors.executorGrantDenied({ reason: 'grant not found' });
    }
    if (grant.status !== 'active') {
      throw securityErrors.executorGrantDenied({ reason: 'grant not active', status: grant.status });
    }
    if (new Date(grant.expiresAt).getTime() < Date.now()) {
      await this.grants.update(grant.id, { status: 'expired', updatedAt: new Date().toISOString() });
      throw securityErrors.executorGrantDenied({ reason: 'grant expired' });
    }
    if (grant.runId !== input.runId || grant.stepId !== input.stepId || grant.executorType !== input.executorType) {
      throw securityErrors.executorGrantDenied({ reason: 'grant context mismatch' });
    }
    if (input.secretRef && !grant.allowedSecretRefs.includes(input.secretRef)) {
      throw securityErrors.executorGrantDenied({ reason: 'secretRef not allowed' });
    }
    if (input.artifactRef && !(grant.allowedArtifactRefs ?? []).includes(input.artifactRef)) {
      throw securityErrors.executorGrantDenied({ reason: 'artifactRef not allowed' });
    }
    if (input.action && !grant.allowedActions.includes(input.action)) {
      throw securityErrors.executorGrantDenied({ reason: 'action not allowed' });
    }

    if (input.markUsed) {
      return this.grants.update(grant.id, { status: 'used', updatedAt: new Date().toISOString() });
    }
    return grant;
  }

  async get(id: string): Promise<ExecutionGrantEntity | undefined> {
    return this.grants.get(id);
  }

  async revoke(id: string): Promise<ExecutionGrantEntity> {
    const grant = await this.grants.get(id);
    if (!grant) {
      throw securityErrors.executorGrantDenied({ reason: 'grant not found' });
    }
    if (grant.status !== 'active') {
      return grant;
    }
    return this.grants.update(id, { status: 'revoked', updatedAt: new Date().toISOString() });
  }
}
