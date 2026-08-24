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
import type { RequestContext, SecuritySubject } from '../../shared/security-types.js';
import type { PageAuthorizationFilter } from '../../common/pagination/pagination.js';
import { newId } from '../../shared/id.js';
import { securityErrors } from '../../shared/security-error.js';
import type { AuditService } from '../audits/audit.service.js';
import { AUDIT_EVENT_TYPES } from '../audits/audit-event-types.js';

export interface ObjectRef {
  objectType: string;
  objectId?: string;
  tenantId?: string;
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

export class ObjectPermissionService {
  private static readonly defaultDb = new PgliteDatabase();

  private static repo<T extends { id: string }>(namespace: string): AsyncRepositoryPort<T> {
    return new PgDocumentRepository<T>(ObjectPermissionService.defaultDb, namespace);
  }

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

  async ensureDefaultObjectTypes(): Promise<void> {
    for (const item of defaultObjectTypes()) {
      const existing = await this.objectTypes.get(item.id);
      if (!existing) await this.objectTypes.create(item);
    }
  }

  async listGroups(): Promise<GroupEntity[]> {
    return this.groups.list();
  }

  async createGroup(input: Omit<GroupEntity, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<GroupEntity> {
    const now = new Date().toISOString();
    return this.groups.create({ ...input, id: input.id ?? newId('grp'), createdAt: now, updatedAt: now });
  }

  async addGroupMember(input: Omit<GroupMemberEntity, 'id' | 'createdAt'> & { id?: string }): Promise<GroupMemberEntity> {
    const id = input.id ?? `${input.groupId}:${input.userId}`;
    const existing = await this.groupMembers.get(id);
    if (existing) return existing;
    return this.groupMembers.create({ ...input, id, createdAt: new Date().toISOString() });
  }

  async listObjectTypes(): Promise<ObjectTypeEntity[]> {
    await this.ensureDefaultObjectTypes();
    return this.objectTypes.list();
  }

  async upsertObjectType(input: Omit<ObjectTypeEntity, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<ObjectTypeEntity> {
    const now = new Date().toISOString();
    const id = input.id ?? input.code;
    return this.objectTypes.upsert({ ...input, id, createdAt: now, updatedAt: now });
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
    return this.objectSets.create({
      ...input,
      id: input.id ?? newId('oset'),
      objectTypes,
      status: input.status ?? 'active',
      createdAt: now,
      updatedAt: now,
    });
  }

  async addObjectSetMember(input: Omit<ObjectSetMemberEntity, 'id' | 'createdAt'> & { id?: string }): Promise<ObjectSetMemberEntity> {
    const objectSet = await this.objectSets.get(input.objectSetId);
    if (!objectSet || objectSet.status !== 'active') {
      throw securityErrors.permissionDenied({ reason: 'object set unavailable', objectSetId: input.objectSetId });
    }
    if (!objectSet.objectTypes.includes(input.objectType)) {
      throw securityErrors.permissionDenied({ reason: 'object type not allowed in object set', objectType: input.objectType });
    }
    const id = input.id ?? `${input.objectSetId}:${input.objectType}:${input.objectId}`;
    const existing = await this.objectSetMembers.get(id);
    if (existing) return existing;
    return this.objectSetMembers.create({ ...input, id, createdAt: new Date().toISOString() });
  }

  async listObjectSetMembers(objectSetId?: string): Promise<ObjectSetMemberEntity[]> {
    return this.objectSetMembers.list((item) => !objectSetId || item.objectSetId === objectSetId);
  }

  async listRoleBindings(): Promise<RoleBindingEntity[]> {
    return this.roleBindings.list();
  }

  async createRoleBinding(input: Omit<RoleBindingEntity, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<RoleBindingEntity> {
    if (!await this.objectSets.get(input.objectSetId)) {
      throw securityErrors.permissionDenied({ reason: 'object set not found', objectSetId: input.objectSetId });
    }
    if (this.roles && !await this.roles.get(input.roleId)) {
      throw securityErrors.permissionDenied({ reason: 'role not found', roleId: input.roleId });
    }
    const now = new Date().toISOString();
    return this.roleBindings.create({
      ...input,
      id: input.id ?? newId('rbnd'),
      effect: input.effect ?? 'allow',
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    });
  }

  async listAccessGrants(): Promise<AccessGrantEntity[]> {
    return this.accessGrants.list();
  }

  async createAccessGrant(input: Omit<AccessGrantEntity, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<AccessGrantEntity> {
    if (!await this.objectSets.get(input.objectSetId)) {
      throw securityErrors.permissionDenied({ reason: 'object set not found', objectSetId: input.objectSetId });
    }
    if (this.roles && !await this.roles.get(input.roleId)) {
      throw securityErrors.permissionDenied({ reason: 'role not found', roleId: input.roleId });
    }
    const now = new Date().toISOString();
    return this.accessGrants.create({
      ...input,
      id: input.id ?? newId('agrant'),
      effect: input.effect ?? 'allow',
      createdAt: now,
      updatedAt: now,
    });
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
    return { roleBindings: roleBindings.length, accessGrants: accessGrants.length };
  }

  async permissionContext(subject: SecuritySubject): Promise<{
    objectSets: Array<Pick<ObjectSetEntity, 'id' | 'name' | 'kind' | 'objectTypes' | 'status'>>;
    roleBindings: Array<Pick<RoleBindingEntity, 'id' | 'roleId' | 'objectSetId' | 'effect'>>;
    version: string;
  }> {
    const principals = await this.resolvePrincipals(subject);
    const principalKeys = new Set(principals.map(principalKey));
    const bindings = (await this.roleBindings.list((item) => item.enabled && principalKeys.has(principalKey(item)) && isBindingCurrentlyActive(item)))
      .map(({ id, roleId, objectSetId, effect }) => ({ id, roleId, objectSetId, effect }));
    const objectSetIds = new Set(bindings.map((item) => item.objectSetId));
    const objectSets = (await this.objectSets.list((item) => objectSetIds.has(item.id)))
      .map(({ id, name, kind, objectTypes, status }) => ({ id, name, kind, objectTypes, status }));
    return { objectSets, roleBindings: bindings, version: this.contextVersion(bindings, objectSets) };
  }

  async can(subject: SecuritySubject, accessLevel: AccessLevel, object: ObjectRef, context: RequestContext = {}): Promise<PermissionDecision> {
    await this.ensureDefaultObjectTypes();
    const action = actionFor(object.objectType, accessLevel);
    if (await this.hasAdminWildcard(subject)) {
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

    const principals = await this.resolvePrincipals(subject);
    const principalKeys = new Set(principals.map(principalKey));
    const bindings = await this.roleBindings.list((item) =>
      item.enabled
      && principalKeys.has(principalKey(item))
      && tenantMatches(item.tenantId, object.tenantId ?? subject.scope?.tenantId)
      && isBindingCurrentlyActive(item),
    );
    const activeSets = new Map((await this.objectSets.list((item) => item.status === 'active')).map((item) => [item.id, item]));
    const grants = await this.accessGrants.list((item) => accessOrder[item.accessLevel] >= accessOrder[accessLevel]);
    const grantsByRoleAndSet = new Map<string, AccessGrantEntity[]>();
    for (const grant of grants) {
      const key = `${grant.roleId}:${grant.objectSetId}`;
      grantsByRoleAndSet.set(key, [...(grantsByRoleAndSet.get(key) ?? []), grant]);
    }

    const matchedBindings: RoleBindingEntity[] = [];
    const matchedObjectSets: ObjectSetEntity[] = [];
    const matchedGrants: AccessGrantEntity[] = [];
    const members = await this.objectSetMembers.list();
    for (const binding of bindings) {
      const objectSet = activeSets.get(binding.objectSetId);
      if (!objectSet || !objectSet.objectTypes.includes(object.objectType)) continue;
      if (!matchesObjectSet(objectSet, object, members)) continue;
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

  async assertCan(subject: SecuritySubject, accessLevel: AccessLevel, object: ObjectRef, context: RequestContext = {}): Promise<void> {
    const result = await this.can(subject, accessLevel, object, context);
    if (!result.allowed) {
      throw securityErrors.permissionDenied({ action: result.action, object, reason: result.reason });
    }
  }

  async buildAuthorizedQuery(subject: SecuritySubject, objectType: string, accessLevel: AccessLevel): Promise<AuthorizedQuery> {
    if (await this.hasAdminWildcard(subject)) return { empty: false, unrestricted: true, dynamicConditions: [] };
    const principals = await this.resolvePrincipals(subject);
    const principalKeys = new Set(principals.map(principalKey));
    const tenantId = subject.scope?.tenantId;
    const bindings = await this.roleBindings.list((item) =>
      item.enabled
      && principalKeys.has(principalKey(item))
      && tenantMatches(item.tenantId, tenantId)
      && isBindingCurrentlyActive(item),
    );
    const grants = await this.accessGrants.list((item) => accessOrder[item.accessLevel] >= accessOrder[accessLevel]);
    const grantsByPair = new Map<string, AccessGrantEntity[]>();
    for (const grant of grants) {
      const key = `${grant.roleId}:${grant.objectSetId}`;
      grantsByPair.set(key, [...(grantsByPair.get(key) ?? []), grant]);
    }

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

    const allowSets = await this.objectSets.list((item) => allowSetIds.has(item.id) && item.status === 'active' && item.objectTypes.includes(objectType));
    const denySets = await this.objectSets.list((item) => denySetIds.has(item.id) && item.status === 'active' && item.objectTypes.includes(objectType));
    const allowStaticSetIds = new Set(allowSets.filter((item) => item.kind === 'static').map((item) => item.id));
    const denyStaticSetIds = new Set(denySets.filter((item) => item.kind === 'static').map((item) => item.id));
    const staticIds = (await this.objectSetMembers.list((item) => allowStaticSetIds.has(item.objectSetId) && item.objectType === objectType)).map((item) => item.objectId);
    const deniedStaticIds = (await this.objectSetMembers.list((item) => denyStaticSetIds.has(item.objectSetId) && item.objectType === objectType)).map((item) => item.objectId);
    const dynamicConditions = allowSets.filter((item) => item.kind === 'dynamic').map((item) => item.conditions ?? {});
    const deniedDynamicConditions = denySets.filter((item) => item.kind === 'dynamic').map((item) => item.conditions ?? {});
    return {
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
      for (const membership of memberships) {
        const group = await this.groups.get(membership.groupId);
        if (group?.enabled) principals.push({ type: group.source === 'local' ? 'group' : 'external_group', id: group.id, tenantId: group.tenantId, source: group.source });
      }
      for (const userRole of await this.userRoles?.list((item) => item.userId === subject.id) ?? []) {
        principals.push({ type: 'group', id: userRole.roleId, tenantId, source: 'legacy-user-role' });
      }
    }
    return dedupePrincipals(principals);
  }

  private async hasAdminWildcard(subject: SecuritySubject): Promise<boolean> {
    const subjectIds = new Set<string>([subject.id, ...(subject.roleIds ?? [])]);
    if (subject.type === 'user') {
      for (const userRole of await this.userRoles?.list((item) => item.userId === subject.id) ?? []) {
        subjectIds.add(userRole.roleId);
      }
    }
    const policies = await this.policies?.list((item) => subjectIds.has(item.subjectId) && item.effect === 'allow') ?? [];
    return policies.some((item) => item.actions.includes('*') && item.resourceTypes.includes('*'));
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
    ['certificate', '证书', 'certificate_assets'],
    ['certificate_asset', '证书资产', 'certificate_assets'],
    ['certificate_version', '证书版本', 'certificate_versions'],
    ['certificate_version_format', '证书版本格式', 'certificate_version_formats'],
    ['gateway', '网关', 'gateways'],
    ['agent', 'Agent', 'agents'],
    ['application_asset', '应用资产', 'service_assets'],
    ['device_asset', '设备资产', 'device_assets'],
    ['host', '主机资产', 'hosts'],
    ['service_instance', '服务实例', 'service_instances'],
    ['service_asset', '应用资产', 'service_assets'],
    ['site_asset', '站点资产', 'site_assets'],
    ['service_endpoint', '服务端点', 'service_endpoints'],
    ['managed_target', '托管目标', 'managed_targets'],
    ['managed_target_snapshot', '托管目标快照', 'managed_target_snapshots'],
    ['discovery_snapshot', '发现快照', 'discovery_snapshots'],
    ['asset_conflict', '资产冲突', 'asset_conflicts'],
    ['certificate_binding', '证书绑定', 'certificate_bindings'],
    ['deployment_plan', '更新计划', 'deployment_plans'],
    ['workflow', '工作流', 'workflow_templates'],
    ['execution_run', '执行记录', 'execution_runs'],
    ['audit_log', '审计日志', 'audit_logs'],
    ['system_setting', '系统设置', 'settings'],
    ['identity_source', '身份源', 'identity_sources'],
  ].map(([code, name, tableName]) => ({
    id: code,
    code,
    name,
    tableName,
    tenantField: 'tenant_id',
    supportedActions: [`${code}.read`, `${code}.update`, `${code}.create`, `${code}.delete`],
    createdAt: now,
    updatedAt: now,
  }));
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
  return bindingTenantId === '*' || bindingTenantId === (tenantId ?? 'default');
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
    return members.some((item) => item.objectSetId === objectSet.id && item.objectType === object.objectType && item.objectId === object.objectId);
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

function actionFor(objectType: string, level: AccessLevel): string {
  if (level === 'read') return `${objectType}.read`;
  if (level === 'edit') return `${objectType}.update`;
  return `${objectType}.control`;
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
