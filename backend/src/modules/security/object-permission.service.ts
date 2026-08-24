import { PgliteDatabase } from '../../database/pglite-database.js';
import type { AsyncRepositoryPort } from '../../persistence/repositories/async-repository-port.js';
import { PgDocumentRepository } from '../../persistence/repositories/pg-document-repository.js';
import type { PermissionPolicyEntity, RoleEntity, UserRoleEntity } from '../../persistence/entities/rbac.entity.js';
import type {
  AccessEffect,
  AccessGrantEntity,
  AccessLevel,
  GroupEntity,
  GroupMemberEntity,
  ObjectSetEntity,
  ObjectSetMemberEntity,
  ObjectTypeEntity,
  PrincipalType,
  RoleBindingEntity,
} from '../../persistence/entities/object-permission.entity.js';
import type { RequestContext, ResourceOwnerType, SecuritySubject, TenantScope } from '../../shared/security-types.js';
import type { PageAuthorizationFilter } from '../../common/pagination/pagination.js';
import { newId } from '../../shared/id.js';
import { securityErrors } from '../../shared/security-error.js';
import type { AuditService } from '../audits/audit.service.js';
import { AUDIT_EVENT_TYPES } from '../audits/audit-event-types.js';
import { TenantScopeService } from './tenant-scope.service.js';

export interface ObjectRef {
  objectType: string;
  objectId?: string;
  tenantId?: string;
  ownerType?: ResourceOwnerType;
  attributes?: Record<string, unknown>;
}

export interface PrincipalRef {
  type: PrincipalType;
  id: string;
  tenantId?: string;
  source?: string;
}

export interface PermissionDecision {
  allowed: boolean;
  accessLevel: AccessLevel;
  action: string;
  reason: string;
  matchedBindings: Array<Pick<RoleBindingEntity, 'id' | 'principalType' | 'principalId' | 'roleId' | 'objectSetId' | 'effect'>>;
  matchedObjectSets: Array<Pick<ObjectSetEntity, 'id' | 'name' | 'kind'>>;
  matchedActions: string[];
  requiresApproval: boolean;
}

export interface AuthorizedQuery extends PageAuthorizationFilter {}

const accessOrder: Record<AccessLevel, number> = { read: 1, edit: 2, control: 3 };

interface AuthorizationState {
  principals: PrincipalRef[];
  principalKeys: Set<string>;
  bindings: RoleBindingEntity[];
  activeSets: Map<string, ObjectSetEntity>;
  grants: AccessGrantEntity[];
  members: ObjectSetMemberEntity[];
  adminWildcard: boolean;
}

export class ObjectPermissionService {
  private static readonly defaultDb = new PgliteDatabase();

  private static repo<T extends { id: string }>(namespace: string): AsyncRepositoryPort<T> {
    return new PgDocumentRepository<T>(ObjectPermissionService.defaultDb, namespace);
  }

  private readonly tenantScope = new TenantScopeService();
  // 中文说明：同一个 HTTP 请求会复用同一个 SecuritySubject。只在该对象生命周期内缓存，
  // 避免跨请求持有旧权限，既减少重复扫描，又不延迟权限回收。
  private authorizationStateCache = new WeakMap<SecuritySubject, Promise<AuthorizationState>>();

  constructor(
    private readonly groups: AsyncRepositoryPort<GroupEntity> = ObjectPermissionService.repo<GroupEntity>('security.groups'),
    private readonly groupMembers: AsyncRepositoryPort<GroupMemberEntity> = ObjectPermissionService.repo<GroupMemberEntity>('security.group_members'),
    private readonly roleBindings: AsyncRepositoryPort<RoleBindingEntity> = ObjectPermissionService.repo<RoleBindingEntity>('security.role_bindings'),
    private readonly objectTypes: AsyncRepositoryPort<ObjectTypeEntity> = ObjectPermissionService.repo<ObjectTypeEntity>('security.object_types'),
    private readonly objectSets: AsyncRepositoryPort<ObjectSetEntity> = ObjectPermissionService.repo<ObjectSetEntity>('security.object_sets'),
    private readonly objectSetMembers: AsyncRepositoryPort<ObjectSetMemberEntity> = ObjectPermissionService.repo<ObjectSetMemberEntity>('security.object_set_members'),
    private readonly accessGrants: AsyncRepositoryPort<AccessGrantEntity> = ObjectPermissionService.repo<AccessGrantEntity>('security.access_grants'),
    private readonly userRoles?: AsyncRepositoryPort<UserRoleEntity & { id: string }>,
    private readonly policies?: AsyncRepositoryPort<PermissionPolicyEntity>,
    private readonly roles?: AsyncRepositoryPort<RoleEntity>,
    private readonly audit?: AuditService,
  ) {}

  private defaultObjectTypesPromise?: Promise<void>;

  async ensureDefaultObjectTypes(): Promise<void> {
    if (!this.defaultObjectTypesPromise) {
      this.defaultObjectTypesPromise = (async () => {
        for (const item of defaultObjectTypes()) {
          const existing = await this.objectTypes.get(item.id);
          if (!existing) await this.objectTypes.create(item);
        }
      })().catch((error) => {
        this.defaultObjectTypesPromise = undefined;
        throw error;
      });
    }
    await this.defaultObjectTypesPromise;
  }

  async listGroups(): Promise<GroupEntity[]> {
    return this.groups.list();
  }

  async createGroup(input: Omit<GroupEntity, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<GroupEntity> {
    const now = new Date().toISOString();
    const result = await this.groups.create({ ...input, id: input.id ?? newId('grp'), createdAt: now, updatedAt: now });
    this.invalidateAuthorizationStateCache();
    return result;
  }

  async addGroupMember(input: Omit<GroupMemberEntity, 'id' | 'createdAt'> & { id?: string }): Promise<GroupMemberEntity> {
    const id = input.id ?? `${input.groupId}:${input.userId}`;
    const existing = await this.groupMembers.get(id);
    if (existing) return existing;
    const result = await this.groupMembers.create({ ...input, id, createdAt: new Date().toISOString() });
    this.invalidateAuthorizationStateCache();
    return result;
  }

  async listObjectTypes(): Promise<ObjectTypeEntity[]> {
    await this.ensureDefaultObjectTypes();
    return this.objectTypes.list();
  }

  async upsertObjectType(input: Omit<ObjectTypeEntity, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<ObjectTypeEntity> {
    const now = new Date().toISOString();
    const id = input.id ?? input.code;
    const result = await this.objectTypes.upsert({ ...input, id, createdAt: now, updatedAt: now });
    this.invalidateAuthorizationStateCache();
    return result;
  }

  async listObjectSets(): Promise<ObjectSetEntity[]> {
    return this.objectSets.list();
  }

  async createObjectSet(input: Omit<ObjectSetEntity, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<ObjectSetEntity> {
    await this.ensureDefaultObjectTypes();
    const validTypes = new Set((await this.objectTypes.list()).map((item) => item.code));
    const objectTypes = [...new Set(input.objectTypes.map((item) => item.trim()).filter(Boolean))];
    if (objectTypes.length === 0 || objectTypes.some((item) => !validTypes.has(item))) {
      throw securityErrors.permissionDenied({ reason: 'object type not registered', objectTypes });
    }
    if (input.kind === 'dynamic') validateDynamicConditions(input.conditions ?? {});
    const now = new Date().toISOString();
    const result = await this.objectSets.create({
      ...input,
      id: input.id ?? newId('oset'),
      objectTypes,
      status: input.status ?? 'active',
      createdAt: now,
      updatedAt: now,
    });
    this.invalidateAuthorizationStateCache();
    return result;
  }

  async syncObjectSetObjectTypes(objectSetId: string, objectTypes: string[]): Promise<ObjectSetEntity | undefined> {
    const objectSet = await this.objectSets.get(objectSetId);
    if (!objectSet) return undefined;
    await this.ensureDefaultObjectTypes();
    const validTypes = new Set((await this.objectTypes.list()).map((item) => item.code));
    const normalized = [...new Set(objectTypes.map((item) => item.trim()).filter(Boolean))];
    if (normalized.length === 0 || normalized.some((item) => !validTypes.has(item))) {
      throw securityErrors.permissionDenied({ reason: 'object type not registered', objectTypes: normalized });
    }
    const mergedTypes = [...new Set([...objectSet.objectTypes, ...normalized])];
    if (mergedTypes.length === objectSet.objectTypes.length) return objectSet;
    const updated = await this.objectSets.update(objectSetId, {
      objectTypes: mergedTypes,
      updatedAt: new Date().toISOString(),
    });
    this.invalidateAuthorizationStateCache();
    return updated;
  }

  async addObjectSetMember(input: Omit<ObjectSetMemberEntity, 'id' | 'createdAt'> & { id?: string }): Promise<ObjectSetMemberEntity> {
    const objectSet = await this.objectSets.get(input.objectSetId);
    if (!objectSet || objectSet.status !== 'active') {
      throw securityErrors.permissionDenied({ reason: 'object set unavailable', objectSetId: input.objectSetId });
    }
    if (!objectSet.objectTypes.some((type) => objectTypesMatch(type, input.objectType))) {
      throw securityErrors.permissionDenied({ reason: 'object type not allowed in object set', objectType: input.objectType });
    }
    const memberTenantId = resolveObjectSetMemberTenantId(objectSet, input.tenantId);
    const id = input.id ?? `${input.objectSetId}:${input.objectType}:${input.objectId}`;
    const existing = await this.objectSetMembers.get(id);
    if (existing) return existing;
    const result = await this.objectSetMembers.create({ ...input, tenantId: memberTenantId, id, createdAt: new Date().toISOString() });
    this.invalidateAuthorizationStateCache();
    return result;
  }

  async listObjectSetMembers(objectSetId?: string): Promise<ObjectSetMemberEntity[]> {
    return this.objectSetMembers.list((item) => !objectSetId || item.objectSetId === objectSetId);
  }

  async listRoleBindings(): Promise<RoleBindingEntity[]> {
    return this.roleBindings.list();
  }

  async createRoleBinding(input: Omit<RoleBindingEntity, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<RoleBindingEntity> {
    const objectSet = await this.objectSets.get(input.objectSetId);
    if (!objectSet) {
      throw securityErrors.permissionDenied({ reason: 'object set not found', objectSetId: input.objectSetId });
    }
    if (objectSet.tenantId === '*' && input.tenantId !== '*') {
      throw securityErrors.permissionDenied({
        reason: 'historical global object set requires system tenant binding',
        roleBindingTenantId: input.tenantId,
        objectSetTenantId: objectSet.tenantId,
        objectSetId: input.objectSetId,
      });
    }
    if (objectSet.tenantId !== '*' && input.tenantId === '*') {
      throw securityErrors.permissionDenied({
        reason: 'tenant wildcard only allowed for historical global object sets',
        objectSetId: input.objectSetId,
      });
    }
    if (objectSet.tenantId !== '*' && input.tenantId !== objectSet.tenantId) {
      throw securityErrors.permissionDenied({
        reason: 'role binding tenant must match object set tenant',
        roleBindingTenantId: input.tenantId,
        objectSetTenantId: objectSet.tenantId,
        objectSetId: input.objectSetId,
      });
    }
    if (this.roles && !await this.roles.get(input.roleId)) {
      throw securityErrors.permissionDenied({ reason: 'role not found', roleId: input.roleId });
    }
    const now = new Date().toISOString();
    const result = await this.roleBindings.create({
      ...input,
      id: input.id ?? newId('rbnd'),
      effect: input.effect ?? 'allow',
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    });
    this.invalidateAuthorizationStateCache();
    return result;
  }

  async listAccessGrants(): Promise<AccessGrantEntity[]> {
    return this.accessGrants.list();
  }

  async createAccessGrant(input: Omit<AccessGrantEntity, 'id' | 'createdAt' | 'updatedAt'> & { id?: string; tenantId: string }): Promise<AccessGrantEntity> {
    const objectSet = await this.objectSets.get(input.objectSetId);
    if (!objectSet) {
      throw securityErrors.permissionDenied({ reason: 'object set not found', objectSetId: input.objectSetId });
    }
    if (objectSet.tenantId === '*' && input.tenantId !== '*') {
      throw securityErrors.permissionDenied({
        reason: 'historical global object set requires system tenant grant',
        accessGrantTenantId: input.tenantId,
        objectSetTenantId: objectSet.tenantId,
        objectSetId: input.objectSetId,
      });
    }
    if (objectSet.tenantId !== '*' && input.tenantId === '*') {
      throw securityErrors.permissionDenied({
        reason: 'tenant wildcard only allowed for historical global object sets',
        objectSetId: input.objectSetId,
      });
    }
    if (objectSet.tenantId !== '*' && input.tenantId !== objectSet.tenantId) {
      throw securityErrors.permissionDenied({
        reason: 'access grant tenant must match object set tenant',
        accessGrantTenantId: input.tenantId,
        objectSetTenantId: objectSet.tenantId,
        objectSetId: input.objectSetId,
      });
    }
    if (this.roles && !await this.roles.get(input.roleId)) {
      throw securityErrors.permissionDenied({ reason: 'role not found', roleId: input.roleId });
    }
    const now = new Date().toISOString();
    const { tenantId: _tenantId, ...entity } = input;
    const result = await this.accessGrants.create({
      ...entity,
      id: input.id ?? newId('agrant'),
      effect: input.effect ?? 'allow',
      createdAt: now,
      updatedAt: now,
    });
    this.invalidateAuthorizationStateCache();
    return result;
  }

  async deleteRoleReferences(roleId: string): Promise<{ roleBindings: number; accessGrants: number }> {
    const roleBindings = await this.roleBindings.list((item) => item.roleId === roleId);
    const accessGrants = await this.accessGrants.list((item) => item.roleId === roleId);
    for (const binding of roleBindings) {
      await this.roleBindings.delete(binding.id);
    }
    for (const grant of accessGrants) {
      await this.accessGrants.delete(grant.id);
    }
    this.invalidateAuthorizationStateCache();
    return { roleBindings: roleBindings.length, accessGrants: accessGrants.length };
  }

  async permissionContext(subject: SecuritySubject): Promise<{
    objectSets: Array<Pick<ObjectSetEntity, 'id' | 'name' | 'kind' | 'objectTypes' | 'status'>>;
    roleBindings: Array<Pick<RoleBindingEntity, 'id' | 'roleId' | 'objectSetId' | 'effect'>>;
    version: string;
  }> {
    const authorizationState = await this.getAuthorizationState(subject);
    const bindings = authorizationState.bindings
      .filter((item) =>
        item.enabled
        && authorizationState.principalKeys.has(principalKey(item))
        && isBindingCurrentlyActive(item),
      )
      .map(({ id, roleId, objectSetId, effect }) => ({ id, roleId, objectSetId, effect }));
    const objectSetIds = new Set(bindings.map((item) => item.objectSetId));
    const objectSets = [...authorizationState.activeSets.values()]
      .filter((item) => objectSetIds.has(item.id))
      .map(({ id, name, kind, objectTypes, status }) => ({ id, name, kind, objectTypes, status }));
    return { objectSets, roleBindings: bindings, version: this.contextVersion(bindings, objectSets) };
  }

  async can(subject: SecuritySubject, accessLevel: AccessLevel, object: ObjectRef, context: RequestContext = {}): Promise<PermissionDecision> {
    await this.ensureDefaultObjectTypes();
    const authorizationState = await this.getAuthorizationState(subject);
    const action = actionFor(object.objectType, accessLevel);
    if (authorizationState.adminWildcard) {
      return {
        allowed: true,
        accessLevel,
        action,
        reason: 'admin wildcard',
        matchedBindings: [],
        matchedObjectSets: [],
        matchedActions: [action, '*'],
        requiresApproval: isHighRiskAction(action),
      };
    }
    if (subject.scope?.tenantScope && !allowsObjectPermissionScope(this.tenantScope, subject.scope.tenantScope, object)) {
      await this.auditDeny(subject, action, object, context, 'tenant scope denied');
      return decision(false, accessLevel, action, 'tenant scope denied', [], []);
    }

    const bindings = authorizationState.bindings.filter((item) =>
      item.enabled
      && authorizationState.principalKeys.has(principalKey(item))
      && tenantBindingMatches(item.tenantId, object.tenantId, subject.scope?.tenantId, subject.scope?.tenantScope)
      && isBindingCurrentlyActive(item),
    );
    const grants = authorizationState.grants.filter((item) => accessOrder[item.accessLevel] >= accessOrder[accessLevel]);
    const grantsByRoleAndSet = groupGrantsByRoleAndSet(grants);
    const matchedBindings: RoleBindingEntity[] = [];
    const matchedObjectSets: ObjectSetEntity[] = [];
    const matchedGrants: AccessGrantEntity[] = [];
    for (const binding of bindings) {
      const objectSet = authorizationState.activeSets.get(binding.objectSetId);
      if (!objectSet || !objectSet.objectTypes.some((item) => objectTypesMatch(item, object.objectType))) continue;
      if (!matchesObjectSet(objectSet, object, authorizationState.members)) continue;
      const grantsForBinding = grantsByRoleAndSet.get(`${binding.roleId}:${binding.objectSetId}`) ?? [];
      if (grantsForBinding.length === 0) continue;
      matchedBindings.push(binding);
      matchedObjectSets.push(objectSet);
      matchedGrants.push(...grantsForBinding);
    }

    const denied = matchedGrants.filter((item) => item.effect === 'deny');
    if (denied.length > 0 || matchedBindings.some((item) => item.effect === 'deny')) {
      await this.auditDeny(subject, action, object, context, 'explicit deny');
      return decision(false, accessLevel, action, 'explicit deny', matchedBindings, matchedObjectSets);
    }
    if (matchedGrants.some((item) => item.effect === 'allow')) {
      return decision(true, accessLevel, action, 'allow', matchedBindings, matchedObjectSets);
    }
    await this.auditDeny(subject, action, object, context, 'no object grant');
    return decision(false, accessLevel, action, 'no object grant', matchedBindings, matchedObjectSets);
  }

  // 中文说明：列表裁剪和审计展示只需要判断结果，不应为每条被过滤记录写一条拒绝审计。
  // 正式的单对象访问仍然使用 can()，保留原有拒绝审计语义。
  async isAllowed(subject: SecuritySubject, accessLevel: AccessLevel, object: ObjectRef): Promise<boolean> {
    await this.ensureDefaultObjectTypes();
    const authorizationState = await this.getAuthorizationState(subject);
    if (authorizationState.adminWildcard) return true;
    if (subject.scope?.tenantScope && !allowsObjectPermissionScope(this.tenantScope, subject.scope.tenantScope, object)) return false;

    const bindings = authorizationState.bindings.filter((item) =>
      item.enabled
      && authorizationState.principalKeys.has(principalKey(item))
      && tenantBindingMatches(item.tenantId, object.tenantId, subject.scope?.tenantId, subject.scope?.tenantScope)
      && isBindingCurrentlyActive(item),
    );
    const grantsByRoleAndSet = groupGrantsByRoleAndSet(
      authorizationState.grants.filter((item) => accessOrder[item.accessLevel] >= accessOrder[accessLevel]),
    );
    const matchedBindings: RoleBindingEntity[] = [];
    const matchedGrants: AccessGrantEntity[] = [];
    for (const binding of bindings) {
      const objectSet = authorizationState.activeSets.get(binding.objectSetId);
      if (!objectSet || !objectSet.objectTypes.some((item) => objectTypesMatch(item, object.objectType))) continue;
      if (!matchesObjectSet(objectSet, object, authorizationState.members)) continue;
      const grantsForBinding = grantsByRoleAndSet.get(`${binding.roleId}:${binding.objectSetId}`) ?? [];
      if (grantsForBinding.length === 0) continue;
      matchedBindings.push(binding);
      matchedGrants.push(...grantsForBinding);
    }

    if (matchedBindings.some((item) => item.effect === 'deny')) return false;
    if (matchedGrants.some((item) => item.effect === 'deny')) return false;
    return matchedGrants.some((item) => item.effect === 'allow');
  }

  async assertCan(subject: SecuritySubject, accessLevel: AccessLevel, object: ObjectRef, context: RequestContext = {}): Promise<void> {
    const result = await this.can(subject, accessLevel, object, context);
    if (!result.allowed) {
      throw securityErrors.permissionDenied({ action: result.action, object, reason: result.reason });
    }
  }

  async buildAuthorizedQuery(subject: SecuritySubject, objectType: string, accessLevel: AccessLevel): Promise<AuthorizedQuery> {
    const tenantFilter = subject.scope?.tenantScope ? this.tenantScope.toFilter(subject.scope.tenantScope) : {};
    const authorizationState = await this.getAuthorizationState(subject);
    if (authorizationState.adminWildcard) {
      return { empty: false, unrestricted: true, dynamicConditions: [] };
    }
    const tenantId = subject.scope?.tenantId;
    const bindings = authorizationState.bindings.filter((item) =>
      item.enabled
      && authorizationState.principalKeys.has(principalKey(item))
      && tenantBindingMatches(item.tenantId, undefined, tenantId, subject.scope?.tenantScope)
      && isBindingCurrentlyActive(item),
    );
    const grantsByPair = groupGrantsByRoleAndSet(
      authorizationState.grants.filter((item) => accessOrder[item.accessLevel] >= accessOrder[accessLevel]),
    );

    const allowSetIds = new Set<string>();
    const denySetIds = new Set<string>();
    for (const binding of bindings) {
      const pairGrants = grantsByPair.get(`${binding.roleId}:${binding.objectSetId}`) ?? [];
      if (pairGrants.length === 0) continue;
      if (binding.effect === 'deny' || pairGrants.some((item) => item.effect === 'deny')) {
        denySetIds.add(binding.objectSetId);
      }
      if (binding.effect === 'allow' && pairGrants.some((item) => item.effect === 'allow')) {
        allowSetIds.add(binding.objectSetId);
      }
    }

    const allowSets = [...authorizationState.activeSets.values()].filter((item) => allowSetIds.has(item.id) && item.objectTypes.some((type) => objectTypesMatch(type, objectType)));
    const denySets = [...authorizationState.activeSets.values()].filter((item) => denySetIds.has(item.id) && item.objectTypes.some((type) => objectTypesMatch(type, objectType)));
    const allowStaticSetIds = new Set(allowSets.filter((item) => item.kind === 'static').map((item) => item.id));
    const denyStaticSetIds = new Set(denySets.filter((item) => item.kind === 'static').map((item) => item.id));
    const staticIds = authorizationState.members
      .filter((item) => allowStaticSetIds.has(item.objectSetId) && objectTypesMatch(item.objectType, objectType))
      .map((item) => item.objectId);
    const deniedStaticIds = authorizationState.members
      .filter((item) => denyStaticSetIds.has(item.objectSetId) && objectTypesMatch(item.objectType, objectType))
      .map((item) => item.objectId);
    const dynamicConditions = allowSets.filter((item) => item.kind === 'dynamic').map((item) => item.conditions ?? {});
    const deniedDynamicConditions = denySets.filter((item) => item.kind === 'dynamic').map((item) => item.conditions ?? {});
    const hasSystemOwnedAllowSet = allowSets.some((item) => item.tenantId === '*')
      && (
        authorizationState.members.some((item) => allowStaticSetIds.has(item.objectSetId) && item.tenantId === undefined)
        || allowSets.some((item) => item.kind === 'dynamic')
      );
    const ownerTypes = hasSystemOwnedAllowSet
      ? [...new Set([...(tenantFilter.ownerTypes ?? []), 'SYSTEM' as const])]
      : tenantFilter.ownerTypes;
    return {
      ...tenantFilter,
      ...(ownerTypes ? { ownerTypes } : {}),
      empty: staticIds.length === 0 && dynamicConditions.length === 0,
      objectIds: [...new Set(staticIds)],
      dynamicConditions,
      deniedObjectIds: [...new Set(deniedStaticIds)],
      deniedDynamicConditions,
    };
  }

  async resolvePrincipals(subject: SecuritySubject): Promise<PrincipalRef[]> {
    const tenantId = subject.scope?.tenantId;
    const principals: PrincipalRef[] = [{ type: subject.type as PrincipalType, id: subject.id, tenantId, source: 'subject' }];
    for (const roleId of subject.roleIds ?? []) {
      principals.push({ type: 'group', id: roleId, tenantId, source: 'legacy-role-context' });
    }
    if (subject.type === 'user') {
      const memberships = await this.groupMembers.list((item) => item.userId === subject.id);
      const groups = await Promise.all(memberships.map((membership) => this.groups.get(membership.groupId)));
      for (const group of groups) {
        if (group?.enabled) principals.push({ type: group.source === 'local' ? 'group' : 'external_group', id: group.id, tenantId: group.tenantId, source: group.source });
      }
      for (const userRole of await this.userRoles?.list((item) => item.userId === subject.id) ?? []) {
        principals.push({ type: 'group', id: userRole.roleId, tenantId, source: 'legacy-user-role' });
      }
    }
    return dedupePrincipals(principals);
  }

  private async getAuthorizationState(subject: SecuritySubject): Promise<AuthorizationState> {
    const cached = this.authorizationStateCache.get(subject);
    if (cached) return cached;

    const state = this.loadAuthorizationState(subject).catch((error) => {
      this.authorizationStateCache.delete(subject);
      throw error;
    });
    this.authorizationStateCache.set(subject, state);
    return state;
  }

  private invalidateAuthorizationStateCache(): void {
    this.authorizationStateCache = new WeakMap<SecuritySubject, Promise<AuthorizationState>>();
  }

  private async loadAuthorizationState(subject: SecuritySubject): Promise<AuthorizationState> {
    const principals = await this.resolvePrincipals(subject);
    const principalKeys = new Set(principals.map(principalKey));
    const legacyRoleIds = principals
      .filter((principal) => principal.source === 'legacy-user-role')
      .map((principal) => principal.id);
    const contextRoleIds = principals
      .filter((principal) => principal.source === 'legacy-role-context')
      .map((principal) => principal.id);
    const effectiveRoleIds = [...new Set([...legacyRoleIds, ...contextRoleIds])];
    const subjectIds = new Set<string>([subject.id, ...(subject.roleIds ?? []), ...effectiveRoleIds]);
    const [bindings, activeSets, grants, members, policies] = await Promise.all([
      this.roleBindings.list((item) =>
        item.enabled
        && principalKeys.has(principalKey(item))
        && isBindingCurrentlyActive(item),
      ),
      this.objectSets.list((item) => item.status === 'active'),
      this.accessGrants.list(),
      this.objectSetMembers.list(),
      this.policies?.list((item) => subjectIds.has(item.subjectId) && item.effect === 'allow') ?? Promise.resolve([]),
    ]);
    const activeSetsById = new Map(activeSets.map((item) => [item.id, item]));
    const existingBindingKeys = new Set(bindings.map((item) => [item.principalType, item.principalId, item.roleId, item.objectSetId].join(':')));
    const syntheticBindings = effectiveRoleIds.flatMap((roleId) => grants
      .filter((grant) => grant.roleId === roleId)
      .map((grant): RoleBindingEntity | null => {
        const objectSet = activeSetsById.get(grant.objectSetId);
        if (!objectSet) return null;
        const key = ['group', roleId, roleId, grant.objectSetId].join(':');
        if (existingBindingKeys.has(key)) return null;
        existingBindingKeys.add(key);
        return {
          id: `implicit:${roleId}:${grant.objectSetId}`,
          tenantId: objectSet.tenantId,
          principalType: 'group' as const,
          principalId: roleId,
          roleId,
          objectSetId: grant.objectSetId,
          effect: 'allow' as const,
          enabled: true,
          createdAt: objectSet.createdAt,
          updatedAt: objectSet.updatedAt,
        };
      })
      .filter((item): item is RoleBindingEntity => item !== null));
    return {
      principals,
      principalKeys,
      bindings: [...bindings, ...syntheticBindings],
      activeSets: activeSetsById,
      grants,
      members,
      adminWildcard: policies.some((item) => item.actions.includes('*') && item.resourceTypes.includes('*')),
    };
  }

  private contextVersion(bindings: unknown[], objectSets: unknown[]): string {
    return `opctx_${Buffer.from(JSON.stringify({ bindings, objectSets })).toString('base64url').slice(0, 24)}`;
  }

  private async auditDeny(subject: SecuritySubject, action: string, object: ObjectRef, context: RequestContext, reason: string): Promise<void> {
    await this.audit?.write({
      eventType: AUDIT_EVENT_TYPES.PERMISSION_DENIED,
      actorType: subject.type === 'system' ? 'system' : 'user',
      actorId: subject.id,
      action,
      resourceType: object.objectType,
      resourceId: object.objectId,
      result: 'denied',
      riskLevel: 'medium',
      context,
      detail: { reason, object },
    }).catch(() => undefined);
  }
}

function defaultObjectTypes(): ObjectTypeEntity[] {
  const now = new Date().toISOString();
  return [
    rootObjectType('certificate', '证书', 'certificate_assets', now),
    rootObjectType('certificate_asset', '证书资产', 'certificate_assets', now),
    derivedObjectType('certificate_version', '证书版本', 'certificate_versions', ['certificate', 'certificate_asset'], now),
    derivedObjectType('certificate_version_format', '证书版本格式', 'certificate_version_formats', ['certificate_version', 'certificate_asset'], now),
    rootObjectType('certificate_authority', '证书颁发机构', 'certificate_authorities', now),
    rootObjectType('trust_domain', '信任域', 'trust_domains', now),
    rootObjectType('acme_account', 'ACME 账户', 'acme_accounts', now),
    rootObjectType('ca_provider', 'CA Provider', 'ca_providers', now),
    rootObjectType('ca_node', 'CA Node', 'ca_nodes', now),
    derivedObjectType('certificate_request', '证书申请', 'certificate_requests', ['certificate_authority', 'acme_account'], now),
    derivedObjectType('certificate_renewal', '证书续签', 'certificate_renewals', ['certificate_asset', 'certificate_authority', 'acme_account'], now),
    derivedObjectType('trust_distribution', '信任分发', 'trust_distributions', ['trust_domain', 'certificate_authority'], now),
    derivedObjectType('certificate_reuse_risk', '证书复用风险', 'certificate_reuse_risks', ['certificate_asset', 'service_asset'], now),
    rootObjectType('gateway', '网关', 'gateways', now),
    rootObjectType('agent', 'Agent', 'agents', now),
    rootObjectType('device_asset', '设备资产', 'device_assets', now),
    rootObjectType('host', '主机资产', 'hosts', now),
    rootObjectType('application_asset', '应用资产', 'service_assets', now),
    rootObjectType('service_asset', '应用资产', 'service_assets', now),
    rootObjectType('site_asset', '站点资产', 'site_assets', now),
    derivedObjectType('service_instance', '服务实例', 'service_instances', ['service_asset', 'site_asset'], now),
    derivedObjectType('service_endpoint', '服务端点', 'service_endpoints', ['service_asset', 'site_asset'], now),
    rootObjectType('managed_target', '托管目标', 'managed_targets', now),
    derivedObjectType('managed_target_snapshot', '托管目标快照', 'managed_target_snapshots', ['managed_target'], now),
    derivedObjectType('discovery_snapshot', '发现快照', 'discovery_snapshots', ['managed_target', 'service_asset', 'site_asset'], now),
    derivedObjectType('asset_conflict', '资产冲突', 'asset_conflicts', ['device_asset', 'service_asset', 'site_asset'], now),
    rootObjectType('certificate_binding', '证书绑定', 'certificate_bindings', now),
    rootObjectType('deployment_plan', '更新计划', 'deployment_plans', now),
    derivedObjectType('execution_run', '执行记录', 'execution_runs', ['deployment_plan', 'automation'], now),
    derivedObjectType('execution_step', '执行步骤', 'execution_steps', ['execution_run'], now),
    rootObjectType('workflow', '工作流', 'workflow_templates', now),
    rootObjectType('workflow_template', '工作流模板', 'workflow_templates', now),
    rootObjectType('automation', '自动化', 'automations', now),
    rootObjectType('credential', '凭据', 'credential_profiles', now),
    rootObjectType('secret', '密钥', 'secrets', now),
    rootObjectType('cloud_account_asset', '云账号资产', 'pg_cloud_account_assets', now),
    derivedObjectType('provider_operation', 'Provider 操作账本', 'pg_provider_operation_ledger', ['cloud_account_asset'], now),
    rootObjectType('plugin_version', '插件版本', 'unified_plugin_versions', now),
    rootObjectType('plugin_binding', '插件绑定', 'unified_plugin_bindings', now),
    rootObjectType('plugin_capability_assignment', '插件能力指派', 'plugin_capability_assignments', now),
    rootObjectType('notification_channel', '通知通道', 'notification_channels', now),
    rootObjectType('notification_route', '通知路由', 'notification_routes', now),
    rootObjectType('notification_template', '通知模板', 'notification_templates', now),
    rootObjectType('notification_silence', '通知静默', 'notification_silences', now),
    rootObjectType('notification_request', '通知请求', 'notification_requests', now),
    derivedObjectType('notification_delivery', '通知投递', 'notification_deliveries', ['notification_request', 'notification_channel'], now),
    rootObjectType('monitor_target', '监控目标', 'monitor_targets', now),
    rootObjectType('monitor_risk', '监控风险', 'pg_monitor_risk_events', now),
    rootObjectType('monitor_alert_rule', '监控告警规则', 'pg_monitor_alert_rules', now),
    rootObjectType('workflow_execution_binding', '工作流执行绑定', 'workflow_execution_bindings', now),
    rootObjectType('approval', '审批单', 'security.approval_requests', now),
    derivedObjectType('audit_log', '审计日志', 'audit_logs', [], now),
    rootObjectType('system_setting', '系统设置', 'settings', now, { tenantField: 'owner_tenant_id' }),
    rootObjectType('identity_source', '身份源', 'identity_sources', now),
  ];
}

function validateDynamicConditions(conditions: Record<string, unknown>): void {
  const allowed = new Set(['tenantId', 'teamId', 'environment', 'zoneId', 'assetTag', 'ownerId', 'tag', 'createdBy']);
  for (const key of Object.keys(conditions)) {
    if (!allowed.has(key)) {
      throw securityErrors.permissionDenied({ reason: 'dynamic condition field not allowed', field: key });
    }
  }
}

function principalKey(principal: { principalType?: PrincipalType; principalId?: string; type?: PrincipalType; id?: string }): string {
  return `${principal.principalType ?? principal.type}:${principal.principalId ?? principal.id}`;
}

function tenantMatches(bindingTenantId: string, tenantId?: string): boolean {
  if (!tenantId) return false;
  return bindingTenantId === '*' || bindingTenantId === tenantId;
}

function tenantBindingMatches(
  bindingTenantId: string,
  objectTenantId: string | undefined,
  subjectTenantId: string | undefined,
  tenantScope: TenantScope | undefined,
): boolean {
  if (tenantScope?.type === 'SYSTEM' && !objectTenantId) {
    return bindingTenantId === '*' || bindingTenantId === 'SYSTEM';
  }
  return tenantMatches(bindingTenantId, objectTenantId ?? subjectTenantId);
}

function isBindingCurrentlyActive(binding: RoleBindingEntity): boolean {
  const now = Date.now();
  if (binding.validFrom && Date.parse(binding.validFrom) > now) return false;
  if (binding.validTo && Date.parse(binding.validTo) <= now) return false;
  return true;
}

function matchesObjectSet(objectSet: ObjectSetEntity, object: ObjectRef, members: ObjectSetMemberEntity[]): boolean {
  if (objectSet.kind === 'static') {
    if (!object.objectId) return true;
    return members.some((item) =>
      item.objectSetId === objectSet.id
        && objectTypesMatch(item.objectType, object.objectType)
        && item.objectId === object.objectId
        && objectSetMemberTenantMatches(item.tenantId, object.tenantId),
    );
  }
  const conditions = objectSet.conditions ?? {};
  for (const [key, expected] of Object.entries(conditions)) {
    if (expected === undefined || expected === null || expected === '*') continue;
    const actual = key === 'tenantId' ? object.tenantId : object.attributes?.[key];
    if (Array.isArray(expected)) {
      if (!expected.includes(actual)) return false;
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

function rootObjectType(
  code: string,
  name: string,
  tableName: string,
  now: string,
  overrides: Partial<Pick<ObjectTypeEntity, 'tenantField' | 'ownerFields' | 'parentTypes'>> = {},
): ObjectTypeEntity {
  return {
    id: code,
    code,
    name,
    tableName,
    tenantField: overrides.tenantField ?? 'tenant_id',
    ownerFields: overrides.ownerFields,
    parentTypes: overrides.parentTypes,
    supportedActions: [`${code}.read`, `${code}.update`, `${code}.create`, `${code}.delete`],
    createdAt: now,
    updatedAt: now,
  };
}

function derivedObjectType(
  code: string,
  name: string,
  tableName: string,
  parentTypes: string[],
  now: string,
): ObjectTypeEntity {
  return rootObjectType(code, name, tableName, now, { parentTypes });
}

function resolveObjectSetMemberTenantId(objectSet: ObjectSetEntity, requestedTenantId?: string): string | undefined {
  if (requestedTenantId === '*') {
    throw securityErrors.permissionDenied({ reason: 'object set member tenant cannot use wildcard', objectSetId: objectSet.id });
  }
  if (objectSet.tenantId === '*') return requestedTenantId;
  if (requestedTenantId && requestedTenantId !== objectSet.tenantId) {
    throw securityErrors.permissionDenied({
      reason: 'object set member tenant must match object set tenant',
      memberTenantId: requestedTenantId,
      objectSetTenantId: objectSet.tenantId,
      objectSetId: objectSet.id,
    });
  }
  return objectSet.tenantId;
}

function objectSetMemberTenantMatches(memberTenantId: string | undefined, objectTenantId: string | undefined): boolean {
  if (!memberTenantId && !objectTenantId) return true;
  return Boolean(memberTenantId) && memberTenantId === objectTenantId;
}

function objectTypesMatch(left: string, right: string): boolean {
  return left === right || (
    (left === 'certificate' || left === 'certificate_asset')
    && (right === 'certificate' || right === 'certificate_asset')
  );
}

function groupGrantsByRoleAndSet(grants: AccessGrantEntity[]): Map<string, AccessGrantEntity[]> {
  const result = new Map<string, AccessGrantEntity[]>();
  for (const grant of grants) {
    const key = `${grant.roleId}:${grant.objectSetId}`;
    result.set(key, [...(result.get(key) ?? []), grant]);
  }
  return result;
}

function actionFor(objectType: string, level: AccessLevel): string {
  if (level === 'read') return `${objectType}.read`;
  if (level === 'edit') return `${objectType}.update`;
  return `${objectType}.control`;
}

function allowsObjectPermissionScope(
  tenantScope: TenantScopeService,
  scope: TenantScope,
  object: ObjectRef,
): boolean {
  if (tenantScope.allowsResource(scope, object)) return true;
  return object.ownerType === 'SYSTEM' && scope.type !== 'SYSTEM';
}

function isHighRiskAction(action: string): boolean {
  return action.endsWith('.control') || action.includes('delete') || action.includes('execute') || action.includes('export');
}

function decision(
  allowed: boolean,
  accessLevel: AccessLevel,
  action: string,
  reason: string,
  bindings: RoleBindingEntity[],
  objectSets: ObjectSetEntity[],
): PermissionDecision {
  return {
    allowed,
    accessLevel,
    action,
    reason,
    matchedBindings: bindings.map(({ id, principalType, principalId, roleId, objectSetId, effect }) => ({ id, principalType, principalId, roleId, objectSetId, effect })),
    matchedObjectSets: objectSets.map(({ id, name, kind }) => ({ id, name, kind })),
    matchedActions: [action],
    requiresApproval: isHighRiskAction(action),
  };
}

function dedupePrincipals(principals: PrincipalRef[]): PrincipalRef[] {
  const seen = new Set<string>();
  return principals.filter((item) => {
    const key = principalKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
