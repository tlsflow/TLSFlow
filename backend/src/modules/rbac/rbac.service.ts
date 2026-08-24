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

  createUserIfAbsent(input: Omit<UserEntity, 'createdAt' | 'updatedAt'>): UserEntity {
    return this.users.get(input.id) ?? this.createUser(input);
  }

  getUser(id: string): UserEntity | undefined {
    return this.users.get(id);
  }

  findUserByUsername(username: string): UserEntity | undefined {
    const normalized = username.trim().toLowerCase();
    return this.users.list((user) => user.username.toLowerCase() === normalized)[0];
  }

  listUsers(): UserEntity[] {
    return this.users.list();
  }

  updateUserStatus(userId: string, status: UserEntity['status']): UserEntity {
    return this.users.update(userId, { status, updatedAt: new Date().toISOString() });
  }

  createRole(input: RoleEntity): RoleEntity {
    return this.roles.create(input);
  }

  createRoleIfAbsent(input: RoleEntity): RoleEntity {
    return this.roles.get(input.id) ?? this.roles.create(input);
  }

  listRoles(): RoleEntity[] {
    return this.roles.list();
  }

  getRole(id: string): RoleEntity | undefined {
    return this.roles.get(id);
  }

  assignRole(userId: string, roleId: string): void {
    const id = `${userId}:${roleId}`;
    if (this.userRoles.get(id)) return;
    this.userRoles.create({ id, userId, roleId, createdAt: new Date().toISOString() });
  }

  userHasRole(userId: string, roleId: string): boolean {
    return Boolean(this.userRoles.get(`${userId}:${roleId}`));
  }

  rolesForUser(userId: string): RoleEntity[] {
    const roleIds = new Set(this.userRoles.list((row) => row.userId === userId).map((row) => row.roleId));
    return this.roles.list((role) => roleIds.has(role.id));
  }

  listUserRoles(): Array<UserRoleEntity & { id: string }> {
    return this.userRoles.list();
  }

  createPolicy(input: Omit<PermissionPolicyEntity, 'id'> & { id?: string }): PermissionPolicyEntity {
    return this.policies.create({ ...input, id: input.id ?? newId('pol') });
  }

  createPolicyIfAbsent(input: Omit<PermissionPolicyEntity, 'id'> & { id: string }): PermissionPolicyEntity {
    return this.policies.get(input.id) ?? this.policies.create(input);
  }

  listPolicies(): PermissionPolicyEntity[] {
    return this.policies.list();
  }

  permissionsForSubject(subject: SecuritySubject): string[] {
    const subjectIds = new Set<string>([subject.id, ...(subject.roleIds ?? [])]);
    if (subject.type === 'user') {
      for (const userRole of this.userRoles.list((row) => row.userId === subject.id)) {
        subjectIds.add(userRole.roleId);
      }
    }
    const denied = new Set<string>();
    const allowed = new Set<string>();
    for (const policy of this.policies.list((item) => subjectIds.has(item.subjectId))) {
      for (const action of policy.actions) {
        if (policy.effect === 'deny') denied.add(action);
        else allowed.add(action);
      }
    }
    return [...allowed].filter((action) => !denied.has(action)).sort();
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
