import { PgliteDatabase } from '../../database/pglite-database.js';
import type { AsyncRepositoryPort } from '../../persistence/repositories/async-repository-port.js';
import { PgDocumentRepository } from '../../persistence/repositories/pg-document-repository.js';
import type { PermissionPolicyEntity, RoleEntity, UserEntity, UserPreferences, UserRoleEntity } from '../../persistence/entities/rbac.entity.js';
import type { RequestContext, ResourceDescriptor, ResourceScope, SecuritySubject } from '../../shared/security-types.js';
import { newId } from '../../shared/id.js';
import { securityErrors } from '../../shared/security-error.js';
import type { AuditService } from '../audits/audit.service.js';
import { AUDIT_EVENT_TYPES } from '../audits/audit-event-types.js';

export interface RbacDecision {
  allowed: boolean;
  reason: string;
  matchedPolicyIds: string[];
}

export class RBACService {
  private static readonly defaultDb = new PgliteDatabase();

  private static createDefaultUsersRepository(): AsyncRepositoryPort<UserEntity> {
    return new PgDocumentRepository<UserEntity>(RBACService.defaultDb, 'security.users');
  }

  private static createDefaultRolesRepository(): AsyncRepositoryPort<RoleEntity> {
    return new PgDocumentRepository<RoleEntity>(RBACService.defaultDb, 'security.roles');
  }

  private static createDefaultUserRolesRepository(): AsyncRepositoryPort<UserRoleEntity & { id: string }> {
    return new PgDocumentRepository<UserRoleEntity & { id: string }>(RBACService.defaultDb, 'security.user_roles');
  }

  private static createDefaultPoliciesRepository(): AsyncRepositoryPort<PermissionPolicyEntity> {
    return new PgDocumentRepository<PermissionPolicyEntity>(RBACService.defaultDb, 'security.permission_policies');
  }

  constructor(
    private readonly users: AsyncRepositoryPort<UserEntity> = RBACService.createDefaultUsersRepository(),
    private readonly roles: AsyncRepositoryPort<RoleEntity> = RBACService.createDefaultRolesRepository(),
    private readonly userRoles: AsyncRepositoryPort<UserRoleEntity & { id: string }> = RBACService.createDefaultUserRolesRepository(),
    private readonly policies: AsyncRepositoryPort<PermissionPolicyEntity> = RBACService.createDefaultPoliciesRepository(),
    private readonly audit?: AuditService,
  ) {}

  async createUser(input: Omit<UserEntity, 'createdAt' | 'updatedAt'>): Promise<UserEntity> {
    const now = new Date().toISOString();
    return this.users.create({ ...input, createdAt: now, updatedAt: now });
  }

  async createUserIfAbsent(input: Omit<UserEntity, 'createdAt' | 'updatedAt'>): Promise<UserEntity> {
    const existing = await this.users.get(input.id);
    if (existing) return existing;
    try {
      return await this.createUser(input);
    } catch (error) {
      const created = await this.users.get(input.id);
      if (created && isEntityExistsError(error)) return created;
      throw error;
    }
  }

  async updateUser(userId: string, patch: Partial<Omit<UserEntity, 'id' | 'createdAt'>>): Promise<UserEntity> {
    return this.users.update(userId, { ...patch, updatedAt: new Date().toISOString() });
  }

  async deleteUser(userId: string): Promise<void> {
    const links = await this.userRoles.list((row) => row.userId === userId);
    for (const link of links) {
      await this.userRoles.delete(link.id);
    }
    await this.users.delete(userId);
  }

  async getUser(id: string): Promise<UserEntity | undefined> {
    return this.users.get(id);
  }

  async findUserByUsername(username: string): Promise<UserEntity | undefined> {
    const normalized = username.trim().toLowerCase();
    return (await this.users.list((user) => user.username.toLowerCase() === normalized))[0];
  }

  async findUserByExternalIdentity(sourceId: string, externalId: string): Promise<UserEntity | undefined> {
    return (await this.users.list((user) => user.externalSourceId === sourceId && user.externalId === externalId))[0];
  }

  async listUsers(): Promise<UserEntity[]> {
    return this.users.list();
  }

  async updateUserStatus(userId: string, status: UserEntity['status']): Promise<UserEntity> {
    return this.users.update(userId, { status, updatedAt: new Date().toISOString() });
  }

  async updateUserPreferences(userId: string, preferences: UserPreferences): Promise<UserEntity> {
    return this.users.update(userId, { preferences, updatedAt: new Date().toISOString() });
  }

  async createRole(input: RoleEntity): Promise<RoleEntity> {
    return this.roles.create(input);
  }

  async createRoleIfAbsent(input: RoleEntity): Promise<RoleEntity> {
    const existing = await this.roles.get(input.id);
    if (existing) return existing;
    try {
      return await this.roles.create(input);
    } catch (error) {
      const created = await this.roles.get(input.id);
      if (created && isEntityExistsError(error)) return created;
      throw error;
    }
  }

  async listRoles(): Promise<RoleEntity[]> {
    return this.roles.list();
  }

  async getRole(id: string): Promise<RoleEntity | undefined> {
    return this.roles.get(id);
  }

  async deleteRole(roleId: string): Promise<void> {
    const links = await this.userRoles.list((row) => row.roleId === roleId);
    for (const link of links) {
      await this.userRoles.delete(link.id);
    }
    const policies = await this.policies.list((policy) => policy.subjectType === 'role' && policy.subjectId === roleId);
    for (const policy of policies) {
      await this.policies.delete(policy.id);
    }
    await this.roles.delete(roleId);
  }

  async assignRole(userId: string, roleId: string): Promise<void> {
    const id = `${userId}:${roleId}`;
    if (await this.userRoles.get(id)) return;
    try {
      await this.userRoles.create({ id, userId, roleId, createdAt: new Date().toISOString() });
    } catch (error) {
      if (isEntityExistsError(error) && await this.userRoles.get(id)) return;
      throw error;
    }
  }

  async userHasRole(userId: string, roleId: string): Promise<boolean> {
    return Boolean(await this.userRoles.get(`${userId}:${roleId}`));
  }

  async rolesForUser(userId: string): Promise<RoleEntity[]> {
    const roleIds = new Set((await this.userRoles.list((row) => row.userId === userId)).map((row) => row.roleId));
    return this.roles.list((role) => roleIds.has(role.id));
  }

  async listUserRoles(): Promise<Array<UserRoleEntity & { id: string }>> {
    return this.userRoles.list();
  }

  async createPolicy(input: Omit<PermissionPolicyEntity, 'id'> & { id?: string }): Promise<PermissionPolicyEntity> {
    return this.policies.create({ ...input, id: input.id ?? newId('pol') });
  }

  async createPolicyIfAbsent(input: Omit<PermissionPolicyEntity, 'id'> & { id: string }): Promise<PermissionPolicyEntity> {
    const existing = await this.policies.get(input.id);
    if (existing) return existing;
    try {
      return await this.policies.create(input);
    } catch (error) {
      const created = await this.policies.get(input.id);
      if (created && isEntityExistsError(error)) return created;
      throw error;
    }
  }

  async listPolicies(): Promise<PermissionPolicyEntity[]> {
    return this.policies.list();
  }

  async permissionsForSubject(subject: SecuritySubject): Promise<string[]> {
    const subjectIds = new Set<string>([subject.id, ...(subject.roleIds ?? [])]);
    if (subject.type === 'user') {
      for (const userRole of await this.userRoles.list((row) => row.userId === subject.id)) {
        subjectIds.add(userRole.roleId);
      }
    }
    const denied = new Set<string>();
    const allowed = new Set<string>();
    for (const policy of await this.policies.list((item) => subjectIds.has(item.subjectId))) {
      for (const action of policy.actions) {
        if (policy.effect === 'deny') denied.add(action);
        else allowed.add(action);
      }
    }
    return [...allowed].filter((action) => !denied.has(action)).sort();
  }

  async can(subject: SecuritySubject, action: string, resource: ResourceDescriptor, context: RequestContext = {}): Promise<RbacDecision> {
    const subjectIds = new Set<string>([subject.id, ...(subject.roleIds ?? [])]);
    if (subject.type === 'user') {
      for (const userRole of await this.userRoles.list((row) => row.userId === subject.id)) {
        subjectIds.add(userRole.roleId);
      }
    }

    const matched = await this.policies.list((policy) => {
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
      await this.auditDeny(subject, action, resource, context, 'explicit deny');
      return { allowed: false, reason: 'explicit deny', matchedPolicyIds: denied.map((policy) => policy.id) };
    }

    const allowed = matched.filter((policy) => policy.effect === 'allow');
    if (allowed.length > 0) {
      return { allowed: true, reason: 'allow', matchedPolicyIds: allowed.map((policy) => policy.id) };
    }

    await this.auditDeny(subject, action, resource, context, 'no allow policy');
    return { allowed: false, reason: 'no allow policy', matchedPolicyIds: [] };
  }

  async assertCan(subject: SecuritySubject, action: string, resource: ResourceDescriptor, context: RequestContext = {}): Promise<void> {
    const decision = await this.can(subject, action, resource, context);
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

  private async auditDeny(subject: SecuritySubject, action: string, resource: ResourceDescriptor, context: RequestContext, reason: string): Promise<void> {
    await this.audit?.write({
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
    }).catch(() => undefined);
  }
}

function isEntityExistsError(error: unknown): boolean {
  return error instanceof Error && (
    error.message.startsWith('entity already exists:')
    || (error as { code?: string }).code === '23505'
  );
}
