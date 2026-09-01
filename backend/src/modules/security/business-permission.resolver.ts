import { createHash } from 'node:crypto';
import type { AsyncRepositoryPort } from '../../persistence/repositories/async-repository-port.js';
import type {
  BusinessPermissionDomain,
  BusinessPermissionEffect,
  BusinessPermissionGrantEntity,
  BusinessPermissionLevel,
  BusinessPermissionRelationEntity,
} from '../../persistence/entities/business-permission.entity.js';
import {
  canonicalBusinessPermissionAction,
  getBusinessPermissionDefinition,
  type BusinessPermissionResourceRule,
} from './business-permission.registry.js';
import {
  BUSINESS_PERMISSION_DOMAINS,
  BUSINESS_PERMISSION_LEVELS,
} from '../../persistence/entities/business-permission.entity.js';
import type { ObjectPermissionService, ObjectRef } from './object-permission.service.js';
import type { RequestContext, SecuritySubject } from '../../shared/security-types.js';
import type { PrincipalType } from '../../persistence/entities/object-permission.entity.js';
import { securityErrors } from '../../shared/security-error.js';
import { newId } from '../../shared/id.js';

function accessRank(value: 'read' | 'edit' | 'control'): number {
  return value === 'control' ? 3 : value === 'edit' ? 2 : 1;
}

function mergeResource(resources: Map<string, BusinessPermissionResource>, key: string, next: BusinessPermissionResource): void {
  const current = resources.get(key);
  if (!current) {
    resources.set(key, next);
    return;
  }
  resources.set(key, {
    ...current,
    accessLevel: accessRank(next.accessLevel) > accessRank(current.accessLevel) ? next.accessLevel : current.accessLevel,
    actions: [...new Set([...current.actions, ...next.actions])],
    highRisk: current.highRisk || next.highRisk,
  });
}

export interface BusinessPermissionResource {
  objectType: string;
  objectId?: string;
  accessLevel: BusinessPermissionResourceRule['accessLevel'];
  actions: string[];
  highRisk: boolean;
}

export interface BusinessPermissionResolution {
  allowed: boolean;
  domain: BusinessPermissionDomain;
  level: BusinessPermissionLevel;
  rootObject: { objectType: string; objectId?: string; tenantId: string };
  relatedResources: BusinessPermissionResource[];
  resolverVersion: string;
  relatedResourceVersion: string;
  forbiddenCapabilities: string[];
  reason: string;
}

export interface BusinessPermissionInput {
  tenantId: string;
  principalType: Extract<PrincipalType, 'user' | 'group' | 'external_group'>;
  principalId: string;
  roleId: string;
  domain: BusinessPermissionDomain;
  level: BusinessPermissionLevel;
  rootObjectType: string;
  rootObjectId?: string;
  rootScope?: Record<string, unknown>;
  effect?: BusinessPermissionEffect;
  createdBy: string;
}

export interface BusinessPermissionResolverOptions {
  /** 由业务模块提供真实根对象存在性检查；未装配时仍只允许已知业务根类型。 */
  rootExists?: (input: { tenantId: string; objectType: string; objectId: string }) => Promise<boolean>;
  /**
   * 从业务事实源重建根对象关系。调用方只提交业务根对象，不能提交技术对象列表。
   * 返回 undefined 表示当前运行时没有可用事实源；空数组则代表已确认没有关联资源。
   */
  projectRelations?: (input: {
    tenantId: string;
    domain: BusinessPermissionDomain;
    rootObjectType: string;
    rootObjectId: string;
  }) => Promise<Array<Pick<BusinessPermissionRelationEntity, 'relatedObjectType' | 'relatedObjectId' | 'relation'>> | undefined>;
  /** 只认当前租户内仍有效的 owner/admin 成员关系。 */
  isTenantAdministrator?: (input: { subject: SecuritySubject; tenantId: string }) => Promise<boolean>;
}

export interface BusinessPermissionContextItem extends Pick<BusinessPermissionGrantEntity,
  'id' | 'tenantId' | 'principalType' | 'principalId' | 'roleId' | 'domain' | 'level' | 'rootObjectType' | 'rootObjectId' | 'effect' | 'status' | 'resolverVersion' | 'relatedResourceVersion' | 'expandedResourceTypes' | 'expandedActions' | 'version'
> {}

/** 业务授权的集中解析入口。关系不完整、租户不一致和未知对象均拒绝。 */
export class BusinessPermissionResolver {
  static readonly resolverVersion = 'bpmap_v1';

  constructor(
    private readonly grants: AsyncRepositoryPort<BusinessPermissionGrantEntity>,
    private readonly relations: AsyncRepositoryPort<BusinessPermissionRelationEntity>,
    private readonly objectPermissions?: Pick<ObjectPermissionService, 'resolvePrincipals' | 'can'>,
    private readonly options: BusinessPermissionResolverOptions = {},
  ) {}

  listDefinitions() {
    return BUSINESS_PERMISSION_DOMAINS.map((domain) => {
      const definition = getBusinessPermissionDefinition(domain)!;
      return {
        domain,
        label: definition.label,
        rootObjectTypes: [...definition.rootObjectTypes],
        levels: BUSINESS_PERMISSION_LEVELS.map((level) => ({
          level,
          resources: definition.levels[level].resources.map((item) => ({ ...item, actions: [...item.actions] })),
          forbiddenCapabilities: [...definition.levels[level].forbiddenCapabilities],
        })),
      };
    });
  }

  async create(input: BusinessPermissionInput): Promise<BusinessPermissionGrantEntity> {
    const definition = this.requireDefinition(input.domain, input.level);
    this.validateRoot(definition, input.rootObjectType, input.rootObjectId, input.domain);
    await this.assertTenantRoot(input.tenantId, input.rootObjectType, input.rootObjectId);
    const existing = await this.grants.list((item) =>
      item.status === 'active'
      && item.tenantId === input.tenantId
      && item.principalType === input.principalType
      && item.principalId === input.principalId
      && item.roleId === input.roleId
      && item.domain === input.domain
      && item.level === input.level
      && item.rootObjectType === input.rootObjectType
      && item.rootObjectId === input.rootObjectId
      && item.effect === (input.effect ?? 'allow'),
    );
    // 同一角色、主体、范围和效果的重复提交直接返回现有记录，保证网络重试不会产生第二份授权。
    if (existing.length > 0) return existing[0];
    const resolution = await this.resolveGrant({
      tenantId: input.tenantId,
      domain: input.domain,
      level: input.level,
      rootObjectType: input.rootObjectType,
      rootObjectId: input.rootObjectId,
      rootScope: input.rootScope,
      effect: input.effect ?? 'allow',
    });
    if (!resolution.allowed) throw securityErrors.permissionDenied({ reason: resolution.reason, domain: input.domain });
    const now = new Date().toISOString();
    const entity: BusinessPermissionGrantEntity = {
      id: newId('bpgr'),
      tenantId: input.tenantId,
      principalType: input.principalType,
      principalId: input.principalId,
      roleId: input.roleId,
      domain: input.domain,
      level: input.level,
      rootObjectType: input.rootObjectType,
      rootObjectId: input.rootObjectId,
      rootScope: input.rootScope,
      effect: input.effect ?? 'allow',
      status: 'active',
      resolverVersion: resolution.resolverVersion,
      relatedResourceVersion: resolution.relatedResourceVersion,
      expandedResourceTypes: [...new Set(resolution.relatedResources.map((item) => item.objectType))],
      expandedActions: [...new Set(resolution.relatedResources.flatMap((item) => item.actions))],
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    return this.grants.create(entity);
  }

  async list(subject?: SecuritySubject, filters: Partial<Pick<BusinessPermissionGrantEntity, 'tenantId' | 'principalType' | 'principalId' | 'domain' | 'rootObjectId'>> = {}): Promise<BusinessPermissionContextItem[]> {
    const principalKeys = subject && this.objectPermissions
      ? new Set((await this.objectPermissions.resolvePrincipals(subject)).map((item) => `${item.type}:${item.id}`))
      : undefined;
    const rows = await this.grants.list((item) =>
      item.status === 'active'
      && (!filters.tenantId || item.tenantId === filters.tenantId)
      && (!filters.principalType || item.principalType === filters.principalType)
      && (!filters.principalId || item.principalId === filters.principalId)
      && (!filters.domain || item.domain === filters.domain)
      && (!filters.rootObjectId || item.rootObjectId === filters.rootObjectId)
      && (!principalKeys || principalKeys.has(`${item.principalType}:${item.principalId}`)),
    );
    return rows.map((item) => this.contextItem(item));
  }

  async get(id: string): Promise<BusinessPermissionGrantEntity | undefined> {
    return this.grants.get(id);
  }

  async revoke(id: string, expectedVersion?: number): Promise<BusinessPermissionGrantEntity | undefined> {
    const grant = await this.grants.get(id);
    if (!grant) return undefined;
    if (grant.status === 'revoked') return grant;
    if (expectedVersion !== undefined && grant.version !== expectedVersion) {
      throw securityErrors.permissionDenied({ reason: 'business permission version conflict', id, expectedVersion, version: grant.version });
    }
    return this.grants.update(id, {
      status: 'revoked',
      revokedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: grant.version + 1,
    });
  }

  async resolveForSubject(
    subject: SecuritySubject,
    domain: BusinessPermissionDomain,
    level: BusinessPermissionLevel,
    root: { tenantId: string; objectType: string; objectId?: string; rootScope?: Record<string, unknown> },
    context: RequestContext = {},
  ): Promise<BusinessPermissionResolution> {
    const principals = this.objectPermissions ? await this.objectPermissions.resolvePrincipals(subject) : [{ type: subject.type as PrincipalType, id: subject.id }];
    const principalKeys = new Set(principals.map((item) => `${item.type}:${item.id}`));
    const candidates = await this.grants.list((item) =>
      item.status === 'active'
      && item.tenantId === root.tenantId
      && item.domain === domain
      && item.level === level
      && principalKeys.has(`${item.principalType}:${item.principalId}`)
      && item.rootObjectType === root.objectType
      && item.rootObjectId === root.objectId,
    );
    if (candidates.length === 0 && !await this.isTenantAdministrator(subject, root.tenantId)) {
      return this.deniedResolution(domain, level, root, 'no business permission grant');
    }
    const denies = candidates.filter((item) => item.effect === 'deny');
    if (denies.length > 0) return this.deniedResolution(domain, level, root, 'explicit business deny');
    if (await this.isTenantAdministrator(subject, root.tenantId)) {
      return this.resolveGrant({
        tenantId: root.tenantId,
        domain,
        level,
        rootObjectType: root.objectType,
        rootObjectId: root.objectId,
        rootScope: root.rootScope,
        effect: 'allow',
      });
    }
    const resolution = await this.resolveGrant({ tenantId: root.tenantId, domain, level, rootObjectType: root.objectType, rootObjectId: root.objectId, rootScope: root.rootScope, effect: 'allow' });
    if (!resolution.allowed) return resolution;
    for (const resource of resolution.relatedResources) {
      if (!resource.objectId || !this.objectPermissions) continue;
      const decision = await this.objectPermissions.can(subject, resource.accessLevel, { objectType: resource.objectType, objectId: resource.objectId, tenantId: root.tenantId }, context);
      if (!decision.allowed && decision.reason === 'explicit deny') return this.deniedResolution(domain, level, root, 'legacy technical deny');
    }
    return resolution;
  }

  async resolveGrant(input: Pick<BusinessPermissionInput, 'tenantId' | 'domain' | 'level' | 'rootObjectType' | 'rootObjectId' | 'rootScope' | 'effect'>): Promise<BusinessPermissionResolution> {
    const definition = this.requireDefinition(input.domain, input.level);
    this.validateRoot(definition, input.rootObjectType, input.rootObjectId, input.domain);
    await this.assertTenantRoot(input.tenantId, input.rootObjectType, input.rootObjectId);
    await this.refreshProjectedRelations(input);
    const rules = definition.levels[input.level].resources;
    const relationRows = input.rootObjectId
      ? await this.relations.list((item) =>
        item.tenantId === input.tenantId
        && item.rootDomain === input.domain
        && item.rootObjectType === input.rootObjectType
        && item.rootObjectId === input.rootObjectId,
      )
      : [];
    if (input.domain === 'application' && input.rootObjectId && relationRows.length === 0) {
      return this.deniedResolution(input.domain, input.level, { tenantId: input.tenantId, objectType: input.rootObjectType, objectId: input.rootObjectId }, 'application relations missing');
    }
    const related = new Map<string, BusinessPermissionResource>();
    for (const rule of rules) {
      if (rule.objectType === input.rootObjectType) {
        mergeResource(related, `${rule.objectType}:${input.rootObjectId ?? '*'}`, { objectType: rule.objectType, objectId: input.rootObjectId, accessLevel: rule.accessLevel, actions: [...rule.actions], highRisk: rule.highRisk ?? false });
      }
      for (const relation of relationRows.filter((item) => item.relatedObjectType === rule.objectType)) {
        if (relation.tenantId !== input.tenantId) return this.deniedResolution(input.domain, input.level, { tenantId: input.tenantId, objectType: input.rootObjectType, objectId: input.rootObjectId }, 'related resource tenant mismatch');
        mergeResource(related, `${rule.objectType}:${relation.relatedObjectId}`, { objectType: rule.objectType, objectId: relation.relatedObjectId, accessLevel: rule.accessLevel, actions: [...rule.actions], highRisk: rule.highRisk ?? false });
      }
    }
    if (input.domain !== 'audit' && input.domain !== 'settings' && related.size === 0) {
      return this.deniedResolution(input.domain, input.level, { tenantId: input.tenantId, objectType: input.rootObjectType, objectId: input.rootObjectId }, 'root object relation missing');
    }
    const relatedResourceVersion = `bpr_${Buffer.from(JSON.stringify([...related.values()])).toString('base64url').slice(0, 24)}`;
    return {
      allowed: true,
      domain: input.domain,
      level: input.level,
      rootObject: { objectType: input.rootObjectType, objectId: input.rootObjectId, tenantId: input.tenantId },
      relatedResources: [...related.values()],
      resolverVersion: BusinessPermissionResolver.resolverVersion,
      relatedResourceVersion,
      forbiddenCapabilities: [...definition.levels[input.level].forbiddenCapabilities],
      reason: input.effect === 'deny' ? 'explicit business deny source' : 'allow',
    };
  }

  async upsertRelation(input: Omit<BusinessPermissionRelationEntity, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<BusinessPermissionRelationEntity> {
    if (!input.tenantId || !input.rootObjectId || !input.relatedObjectId) throw securityErrors.permissionDenied({ reason: 'relation scope incomplete' });
    if (input.tenantId === '*') throw securityErrors.permissionDenied({ reason: 'relation tenant wildcard forbidden' });
    const id = this.relationStorageId(input);
    const now = new Date().toISOString();
    return this.relations.upsert({ ...input, id, createdAt: now, updatedAt: now });
  }

  private async refreshProjectedRelations(input: Pick<BusinessPermissionInput, 'tenantId' | 'domain' | 'rootObjectType' | 'rootObjectId'>): Promise<void> {
    const rootObjectId = input.rootObjectId;
    if (!rootObjectId || !this.options.projectRelations) return;
    const projected = await this.options.projectRelations({
      tenantId: input.tenantId,
      domain: input.domain,
      rootObjectType: input.rootObjectType,
      rootObjectId,
    });
    if (projected === undefined) return;

    const desired = new Map(projected.map((item) => {
      const id = this.relationStorageId({
        tenantId: input.tenantId,
        rootDomain: input.domain,
        rootObjectType: input.rootObjectType,
        rootObjectId,
        ...item,
      });
      return [id, item] as const;
    }));
    const current = await this.relations.list((item) => item.tenantId === input.tenantId
      && item.rootDomain === input.domain
      && item.rootObjectType === input.rootObjectType
      && item.rootObjectId === rootObjectId);
    await Promise.all(current.filter((item) => !desired.has(item.id)).map((item) => this.relations.delete(item.id)));
    for (const [id, item] of desired) {
      await this.upsertRelation({
        id,
        tenantId: input.tenantId,
        rootDomain: input.domain,
        rootObjectType: input.rootObjectType,
        rootObjectId,
        ...item,
      });
    }
  }

  /**
   * pg_documents 的 document_id 上限是 128。业务对象 ID 可以由外部系统提供，
   * 因此不能把完整关系直接拼接为存储键；哈希保留完整身份，又保证重复投影可定位同一行。
   */
  private relationStorageId(input: Pick<BusinessPermissionRelationEntity,
    'tenantId' | 'rootDomain' | 'rootObjectType' | 'rootObjectId' | 'relatedObjectType' | 'relatedObjectId' | 'relation'
  >): string {
    const identity = JSON.stringify([
      input.tenantId,
      input.rootDomain,
      input.rootObjectType,
      input.rootObjectId,
      input.relatedObjectType,
      input.relatedObjectId,
      input.relation,
    ]);
    return `bprel_${createHash('sha256').update(identity).digest('base64url')}`;
  }

  async permissionContext(subject: SecuritySubject, tenantId?: string): Promise<BusinessPermissionContextItem[]> {
    return this.list(subject, tenantId ? { tenantId } : {});
  }

  /** RBAC action 的业务授权适配，供所有 Controller 共用。 */
  async isActionAllowed(subject: SecuritySubject, action: string, resource: { type: string; id?: string; tenantId?: string }): Promise<boolean> {
    action = canonicalBusinessPermissionAction(action);
    const tenantId = resource.tenantId ?? subject.scope?.tenantId;
    if (!tenantId) return false;
    const principals = this.objectPermissions ? await this.objectPermissions.resolvePrincipals(subject) : [{ type: subject.type as PrincipalType, id: subject.id }];
    const principalKeys = new Set(principals.map((item) => `${item.type}:${item.id}`));
    if (await this.isActionExplicitlyDenied(subject, action, resource)) return false;
    if (await this.isTenantAdministrator(subject, tenantId)) return true;
    const grants = await this.grants.list((item) => item.status === 'active' && item.tenantId === tenantId && principalKeys.has(`${item.principalType}:${item.principalId}`));
    let allowed = false;
    for (const grant of grants) {
      const resolution = await this.resolveGrant(grant);
      const matchesResource = resolution.relatedResources.some((item) => item.objectType === resource.type && (!resource.id || item.objectId === resource.id));
      if (!matchesResource) continue;
      const matchesAction = resolution.relatedResources.some((item) => item.objectType === resource.type && item.actions.some((candidate) => canonicalBusinessPermissionAction(candidate) === action));
      if (!matchesAction) continue;
      allowed = true;
    }
    return allowed;
  }

  /**
   * 显式 deny 需要能穿透到 RBAC 动作入口，不能被业务 allow 或历史 allow 覆盖。
   * 与 isActionAllowed 分开，避免把普通的“没有授权”误判为拒绝规则。
   */
  async isActionExplicitlyDenied(subject: SecuritySubject, action: string, resource: { type: string; id?: string; tenantId?: string }): Promise<boolean> {
    action = canonicalBusinessPermissionAction(action);
    const tenantId = resource.tenantId ?? subject.scope?.tenantId;
    if (!tenantId) return false;
    const principals = this.objectPermissions ? await this.objectPermissions.resolvePrincipals(subject) : [{ type: subject.type as PrincipalType, id: subject.id }];
    const principalKeys = new Set(principals.map((item) => `${item.type}:${item.id}`));
    const grants = await this.grants.list((item) => item.status === 'active'
      && item.effect === 'deny'
      && item.tenantId === tenantId
      && principalKeys.has(`${item.principalType}:${item.principalId}`));
    for (const grant of grants) {
      const resolution = await this.resolveGrant(grant);
      if (resolution.relatedResources.some((item) => item.objectType === resource.type
        && (!resource.id || item.objectId === resource.id)
        && item.actions.some((candidate) => canonicalBusinessPermissionAction(candidate) === action))) {
        return true;
      }
    }
    return false;
  }

  /** 对象查询适配，返回业务授权展开出的明确对象 ID，不返回租户全集。 */
  async authorizedObjectIds(subject: SecuritySubject, objectType: string, accessLevel: 'read' | 'edit' | 'control'): Promise<string[]> {
    const tenantId = subject.scope?.tenantId;
    if (!tenantId) return [];
    const principals = this.objectPermissions ? await this.objectPermissions.resolvePrincipals(subject) : [{ type: subject.type as PrincipalType, id: subject.id }];
    const principalKeys = new Set(principals.map((item) => `${item.type}:${item.id}`));
    const grants = await this.grants.list((item) => item.status === 'active' && item.tenantId === tenantId && principalKeys.has(`${item.principalType}:${item.principalId}`));
    const allowed = new Set<string>();
    const denied = new Set<string>();
    for (const grant of grants) {
      const resolution = await this.resolveGrant(grant);
      for (const resource of resolution.relatedResources) {
        if (resource.objectType !== objectType || !resource.objectId) continue;
        if (accessRank(resource.accessLevel) < accessRank(accessLevel)) continue;
        (grant.effect === 'deny' ? denied : allowed).add(resource.objectId);
      }
    }
    return [...allowed].filter((id) => !denied.has(id));
  }

  async isResourceAllowed(subject: SecuritySubject, object: ObjectRef, accessLevel: 'read' | 'edit' | 'control'): Promise<boolean> {
    if (!object.objectId || !object.tenantId) return false;
    const ids = await this.authorizedObjectIds(subject, object.objectType, accessLevel);
    return ids.includes(object.objectId);
  }

  /** 显式业务 deny 必须在租户管理员全量授权之前判定。 */
  async isResourceExplicitlyDenied(subject: SecuritySubject, object: ObjectRef, accessLevel: 'read' | 'edit' | 'control'): Promise<boolean> {
    if (!object.objectId || !object.tenantId) return false;
    const principals = this.objectPermissions ? await this.objectPermissions.resolvePrincipals(subject) : [{ type: subject.type as PrincipalType, id: subject.id }];
    const principalKeys = new Set(principals.map((item) => `${item.type}:${item.id}`));
    const grants = await this.grants.list((item) => item.status === 'active'
      && item.effect === 'deny'
      && item.tenantId === object.tenantId
      && principalKeys.has(`${item.principalType}:${item.principalId}`));
    for (const grant of grants) {
      const resolution = await this.resolveGrant(grant);
      if (resolution.relatedResources.some((resource) => resource.objectType === object.objectType
        && resource.objectId === object.objectId
        && accessRank(resource.accessLevel) >= accessRank(accessLevel))) return true;
    }
    return false;
  }

  async explicitlyDeniedObjectIds(subject: SecuritySubject, objectType: string, accessLevel: 'read' | 'edit' | 'control'): Promise<string[]> {
    const tenantId = subject.scope?.tenantId;
    if (!tenantId) return [];
    const principals = this.objectPermissions ? await this.objectPermissions.resolvePrincipals(subject) : [{ type: subject.type as PrincipalType, id: subject.id }];
    const principalKeys = new Set(principals.map((item) => `${item.type}:${item.id}`));
    const grants = await this.grants.list((item) => item.status === 'active'
      && item.effect === 'deny'
      && item.tenantId === tenantId
      && principalKeys.has(`${item.principalType}:${item.principalId}`));
    const denied = new Set<string>();
    for (const grant of grants) {
      const resolution = await this.resolveGrant(grant);
      for (const resource of resolution.relatedResources) {
        if (resource.objectType === objectType && resource.objectId && accessRank(resource.accessLevel) >= accessRank(accessLevel)) denied.add(resource.objectId);
      }
    }
    return [...denied];
  }

  async isTenantAdministrator(subject: SecuritySubject, tenantId = subject.scope?.tenantId): Promise<boolean> {
    if (!tenantId || tenantId === '*' || !this.options.isTenantAdministrator) return false;
    return this.options.isTenantAdministrator({ subject, tenantId });
  }

  private requireDefinition(domain: string, level: string) {
    if (!BUSINESS_PERMISSION_DOMAINS.includes(domain as BusinessPermissionDomain) || !BUSINESS_PERMISSION_LEVELS.includes(level as BusinessPermissionLevel)) {
      throw securityErrors.permissionDenied({ reason: 'unknown business domain or level', domain, level });
    }
    return getBusinessPermissionDefinition(domain)!;
  }

  private validateRoot(definition: ReturnType<typeof getBusinessPermissionDefinition> extends infer T ? T : never, rootObjectType: string, rootObjectId: string | undefined, domain: BusinessPermissionDomain): void {
    if (!definition || !definition.rootObjectTypes.includes(rootObjectType)) throw securityErrors.permissionDenied({ reason: 'unknown business root object', domain, rootObjectType });
    if ((domain === 'certificate' || domain === 'application') && !rootObjectId) throw securityErrors.permissionDenied({ reason: 'business root object id required', domain });
  }

  private async assertTenantRoot(tenantId: string, rootObjectType: string, rootObjectId?: string): Promise<void> {
    if (!tenantId || tenantId === '*' || !rootObjectType || (rootObjectType !== 'audit_log' && rootObjectType !== 'system_setting' && !rootObjectId)) {
      throw securityErrors.permissionDenied({ reason: 'business tenant or root scope invalid', tenantId, rootObjectType, rootObjectId });
    }
    if (rootObjectId && this.options.rootExists && !await this.options.rootExists({ tenantId, objectType: rootObjectType, objectId: rootObjectId })) {
      throw securityErrors.permissionDenied({ reason: 'business root object not found', tenantId, rootObjectType, rootObjectId });
    }
  }

  private deniedResolution(domain: BusinessPermissionDomain, level: BusinessPermissionLevel, root: { tenantId: string; objectType: string; objectId?: string }, reason: string): BusinessPermissionResolution {
    return {
      allowed: false,
      domain,
      level,
      rootObject: root,
      relatedResources: [],
      resolverVersion: BusinessPermissionResolver.resolverVersion,
      relatedResourceVersion: 'bpr_empty',
      forbiddenCapabilities: [],
      reason,
    };
  }

  private contextItem(item: BusinessPermissionGrantEntity): BusinessPermissionContextItem {
    return {
      id: item.id,
      tenantId: item.tenantId,
      principalType: item.principalType,
      principalId: item.principalId,
      roleId: item.roleId,
      domain: item.domain,
      level: item.level,
      rootObjectType: item.rootObjectType,
      rootObjectId: item.rootObjectId,
      effect: item.effect,
      status: item.status,
      resolverVersion: item.resolverVersion,
      relatedResourceVersion: item.relatedResourceVersion,
      expandedResourceTypes: [...item.expandedResourceTypes],
      expandedActions: [...item.expandedActions],
      version: item.version,
    };
  }
}
