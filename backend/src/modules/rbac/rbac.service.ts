import { MemoryRepository } from '../../persistence/repositories/memory-repository.js';
import type { RepositoryPort } from '../../persistence/repositories/repository-port.js';
import type { PermissionPolicyEntity, RoleEntity, UserEntity, UserRoleEntity } from '../../persistence/entities/rbac.entity.js';
import type { RequestContext, ResourceDescriptor, ResourceScope, SecuritySubject } from '../../shared/security-types.js';
import { newId } from '../../shared/id.js';
import { securityErrors } from '../../shared/security-error.js';
import { AuditService } from '../audits/audit.service.js';
import { AUDIT_EVENT_TYPES } from '../audits/audit-event-types.js';

export interface RbacDecision {
  allowed: boolean;
  reason: string;
  matchedPolicyIds: string[];
}

export class RBACService {
  constructor(
    private readonly users: RepositoryPort<UserEntity> = new MemoryRepository<UserEntity>(),
    private readonly roles: RepositoryPort<RoleEntity> = new MemoryRepository<RoleEntity>(),
    private readonly userRoles: RepositoryPort<UserRoleEntity & { id: string }> = new MemoryRepository<UserRoleEntity & { id: string }>(),
    private readonly policies: RepositoryPort<PermissionPolicyEntity> = new MemoryRepository<PermissionPolicyEntity>(),
    private readonly audit?: AuditService,
  ) {}

  createUser(input: Omit<UserEntity, 'createdAt' | 'updatedAt'>): UserEntity {
    const now = new Date().toISOString();
    return this.users.create({ ...input, createdAt: now, updatedAt: now });
  }

  createRole(input: RoleEntity): RoleEntity {
    return this.roles.create(input);
  }

  assignRole(userId: string, roleId: string): void {
    this.userRoles.create({ id: `${userId}:${roleId}`, userId, roleId, createdAt: new Date().toISOString() });
  }

  createPolicy(input: Omit<PermissionPolicyEntity, 'id'> & { id?: string }): PermissionPolicyEntity {
    return this.policies.create({ ...input, id: input.id ?? newId('pol') });
  }

  can(subject: SecuritySubject, action: string, resource: ResourceDescriptor, context: RequestContext = {}): RbacDecision {
    const subjectIds = new Set<string>([subject.id, ...(subject.roleIds ?? [])]);
    if (subject.type === 'user') {
      for (const userRole of this.userRoles.list((row) => row.userId === subject.id)) {
        subjectIds.add(userRole.roleId);
      }
    }

    const matched = this.policies.list((policy) => {
      if (!subjectIds.has(policy.subjectId)) {
        return false;
      }
      if (policy.subjectType !== subject.type && policy.subjectType !== 'role') {
        return false;
      }
      return this.matchesAction(policy.actions, action)
        && this.matchesResource(policy.resourceTypes, resource.type)
        && this.matchesScope(policy.scope, resource.scope ?? {});
    });

    const denied = matched.filter((policy) => policy.effect === 'deny');
    if (denied.length > 0) {
      this.auditDeny(subject, action, resource, context, 'explicit deny');
      return { allowed: false, reason: 'explicit deny', matchedPolicyIds: denied.map((policy) => policy.id) };
    }

    const allowed = matched.filter((policy) => policy.effect === 'allow');
    if (allowed.length > 0) {
      return { allowed: true, reason: 'allow', matchedPolicyIds: allowed.map((policy) => policy.id) };
    }

    this.auditDeny(subject, action, resource, context, 'no allow policy');
    return { allowed: false, reason: 'no allow policy', matchedPolicyIds: [] };
  }

  assertCan(subject: SecuritySubject, action: string, resource: ResourceDescriptor, context: RequestContext = {}): void {
    const decision = this.can(subject, action, resource, context);
    if (!decision.allowed) {
      throw securityErrors.permissionDenied({ action, resource, reason: decision.reason });
    }
  }

  private matchesAction(actions: string[], action: string): boolean {
    return actions.includes('*') || actions.includes(action) || actions.some((candidate) => candidate.endsWith('.*') && action.startsWith(candidate.slice(0, -1)));
  }

  private matchesResource(resourceTypes: string[], resourceType: string): boolean {
    return resourceTypes.includes('*') || resourceTypes.includes(resourceType);
  }

  private matchesScope(policyScope: ResourceScope, resourceScope: ResourceScope): boolean {
    for (const [key, policyValue] of Object.entries(policyScope) as Array<[keyof ResourceScope, string | undefined]>) {
      if (policyValue === undefined || policyValue === '*') {
        continue;
      }
      if (resourceScope[key] !== policyValue) {
        return false;
      }
    }
    return true;
  }

  private toAuditActorType(subjectType: SecuritySubject['type']) {
    if (subjectType === 'plugin' || subjectType === 'executor' || subjectType === 'system') {
      return subjectType;
    }
    return 'user';
  }

  private auditDeny(subject: SecuritySubject, action: string, resource: ResourceDescriptor, context: RequestContext, reason: string): void {
    this.audit?.write({
      eventType: AUDIT_EVENT_TYPES.PERMISSION_DENIED,
      actorType: this.toAuditActorType(subject.type),
      actorId: subject.id,
      action,
      resourceType: resource.type,
      resourceId: resource.id,
      result: 'denied',
      riskLevel: 'medium',
      context,
      detail: { reason, resourceScope: resource.scope },
    });
  }
}
