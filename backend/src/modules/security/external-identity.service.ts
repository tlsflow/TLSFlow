import { AppError } from '../../common/errors/app-error.js';
import type { RequestContext } from '../../common/tracing/request-context.js';
import { newId } from '../../shared/id.js';
import type { SecuritySubject } from '../../shared/security-types.js';
import { AUDIT_EVENT_TYPES } from '../audits/audit-event-types.js';
import type { AuditService } from '../audits/audit.service.js';
import type { RBACService } from '../rbac/rbac.service.js';
import type { AuthService, AuthSessionResponse } from './auth.service.js';

export type IdentitySourceType = 'active_directory' | 'ldap';
export type IdentitySourceTlsMode = 'none' | 'starttls' | 'ldaps';

export interface IdentitySource {
  id: string;
  name: string;
  type: IdentitySourceType;
  enabled: boolean;
  url: string;
  baseDn: string;
  userFilter?: string;
  groupFilter?: string;
  userDnTemplate?: string;
  bindDn?: string;
  bindPasswordSecretRef?: string;
  defaultRoleId?: string;
  requireGroupMapping: boolean;
  tlsMode: IdentitySourceTlsMode;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalGroupRoleMapping {
  id: string;
  sourceId: string;
  externalGroup: string;
  roleId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalIdentityProfile {
  externalId: string;
  username: string;
  displayName: string;
  email?: string;
  userDn: string;
  groups: string[];
  disabled?: boolean;
}

export interface LdapConnector {
  authenticate(source: IdentitySource, username: string, password: string): Promise<ExternalIdentityProfile>;
  testConnection(source: IdentitySource): Promise<{ ok: boolean; message: string }>;
}

export class MockDirectoryConnector implements LdapConnector {
  private readonly profiles = new Map<string, ExternalIdentityProfile & { password: string }>();

  addProfile(sourceId: string, profile: ExternalIdentityProfile & { password: string }): void {
    this.profiles.set(`${sourceId}:${profile.username.toLowerCase()}`, profile);
  }

  async authenticate(source: IdentitySource, username: string, password: string): Promise<ExternalIdentityProfile> {
    const profile = this.profiles.get(`${source.id}:${username.toLowerCase()}`);
    if (!profile || profile.password !== password) {
      throw new AppError('AUTH_UNAUTHENTICATED', '外部目录用户名或密码错误');
    }
    const { password: _password, ...safeProfile } = profile;
    return safeProfile;
  }

  async testConnection(source: IdentitySource): Promise<{ ok: boolean; message: string }> {
    return source.enabled ? { ok: true, message: 'mock directory reachable' } : { ok: false, message: 'identity source disabled' };
  }
}

export class ExternalIdentityService {
  private readonly sources = new Map<string, IdentitySource>();
  private readonly mappings = new Map<string, ExternalGroupRoleMapping>();

  constructor(
    private readonly rbac: RBACService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly connector: LdapConnector = new MockDirectoryConnector(),
  ) {}

  getConnector(): LdapConnector {
    return this.connector;
  }

  listPublicSources(): Array<Pick<IdentitySource, 'id' | 'name' | 'type'>> {
    return [...this.sources.values()].filter((source) => source.enabled).map((source) => ({ id: source.id, name: source.name, type: source.type }));
  }

  listSources(): IdentitySource[] {
    return [...this.sources.values()].map((source) => structuredClone(source));
  }

  createSource(input: Omit<IdentitySource, 'id' | 'enabled' | 'createdAt' | 'updatedAt'> & { id?: string; enabled?: boolean }, actor: SecuritySubject, context: RequestContext): IdentitySource {
    const now = new Date().toISOString();
    const source: IdentitySource = {
      id: input.id ?? newId('ids'),
      name: input.name,
      type: input.type,
      enabled: input.enabled ?? true,
      url: input.url,
      baseDn: input.baseDn,
      userFilter: input.userFilter,
      groupFilter: input.groupFilter,
      userDnTemplate: input.userDnTemplate,
      bindDn: input.bindDn,
      bindPasswordSecretRef: input.bindPasswordSecretRef,
      defaultRoleId: input.defaultRoleId,
      requireGroupMapping: input.requireGroupMapping,
      tlsMode: input.tlsMode,
      createdAt: now,
      updatedAt: now,
    };
    this.sources.set(source.id, structuredClone(source));
    this.audit.write({
      eventType: AUDIT_EVENT_TYPES.IDENTITY_SOURCE_CREATED,
      actorType: 'user',
      actorId: actor.id,
      action: 'security.identity_source.create',
      resourceType: 'identitySource',
      resourceId: source.id,
      result: 'success',
      riskLevel: 'medium',
      context: { requestId: context.requestId, sourceIp: context.ip, actor },
      detail: { type: source.type, url: source.url, bindPasswordSecretRef: source.bindPasswordSecretRef },
    });
    return source;
  }

  async testSource(sourceId: string): Promise<{ ok: boolean; message: string }> {
    const source = this.sources.get(sourceId);
    if (!source) throw new AppError('RESOURCE_NOT_FOUND', '身份源不存在');
    return this.connector.testConnection(source);
  }

  listMappings(): ExternalGroupRoleMapping[] {
    return [...this.mappings.values()].map((mapping) => structuredClone(mapping));
  }

  createMapping(input: Omit<ExternalGroupRoleMapping, 'id' | 'enabled' | 'createdAt' | 'updatedAt'> & { id?: string; enabled?: boolean }, actor: SecuritySubject, context: RequestContext): ExternalGroupRoleMapping {
    if (!this.sources.has(input.sourceId)) throw new AppError('RESOURCE_NOT_FOUND', '身份源不存在');
    if (!this.rbac.getRole(input.roleId)) throw new AppError('RESOURCE_NOT_FOUND', '角色不存在');
    const now = new Date().toISOString();
    const mapping: ExternalGroupRoleMapping = {
      id: input.id ?? newId('grpmap'),
      sourceId: input.sourceId,
      externalGroup: input.externalGroup,
      roleId: input.roleId,
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.mappings.set(mapping.id, structuredClone(mapping));
    this.audit.write({
      eventType: AUDIT_EVENT_TYPES.IDENTITY_GROUP_MAPPING_CREATED,
      actorType: 'user',
      actorId: actor.id,
      action: 'security.identity_source.mapping.create',
      resourceType: 'externalGroupRoleMapping',
      resourceId: mapping.id,
      result: 'success',
      riskLevel: 'medium',
      context: { requestId: context.requestId, sourceIp: context.ip, actor },
      detail: { sourceId: mapping.sourceId, externalGroup: mapping.externalGroup, roleId: mapping.roleId },
    });
    return mapping;
  }

  async login(input: { sourceId: string; username: string; password: string }, context: RequestContext): Promise<AuthSessionResponse> {
    const source = this.sources.get(input.sourceId);
    if (!source || !source.enabled) throw new AppError('AUTH_UNAUTHENTICATED', '身份源不可用');
    let profile: ExternalIdentityProfile;
    try {
      profile = await this.connector.authenticate(source, input.username, input.password);
    } catch (error) {
      this.audit.write({
        eventType: AUDIT_EVENT_TYPES.EXTERNAL_LOGIN_FAILED,
        actorType: 'user',
        actorId: input.username,
        action: 'auth.external_login',
        resourceType: 'identitySource',
        resourceId: source.id,
        result: 'failure',
        riskLevel: 'medium',
        context: { requestId: context.requestId, sourceIp: context.ip },
        detail: { sourceType: source.type },
      });
      throw error;
    }
    if (profile.disabled) throw new AppError('AUTH_FORBIDDEN', '外部目录用户已禁用');

    const matchedRoles = this.matchRoleIds(source.id, profile.groups);
    if (matchedRoles.length === 0 && source.defaultRoleId) matchedRoles.push(source.defaultRoleId);
    if (matchedRoles.length === 0 && source.requireGroupMapping) {
      throw new AppError('AUTH_FORBIDDEN', '未命中任何外部组角色映射');
    }

    const user = this.rbac.createUserIfAbsent({
      id: `external_${source.id}_${profile.externalId}`.replace(/[^a-zA-Z0-9_]/g, '_'),
      username: `${source.id}:${profile.username}`,
      displayName: profile.displayName || profile.username,
      status: 'active',
      tenantId: 'default',
      tenantName: '默认租户',
      identityProvider: source.type,
      externalId: profile.externalId,
      externalSourceId: source.id,
    });
    if (user.status !== 'active') throw new AppError('AUTH_FORBIDDEN', '本地影子用户已禁用');
    for (const roleId of matchedRoles) this.rbac.assignRole(user.id, roleId);

    this.audit.write({
      eventType: AUDIT_EVENT_TYPES.EXTERNAL_LOGIN_SUCCESS,
      actorType: 'user',
      actorId: user.id,
      action: 'auth.external_login',
      resourceType: 'identitySource',
      resourceId: source.id,
      result: 'success',
      riskLevel: 'low',
      context: { requestId: context.requestId, sourceIp: context.ip, actor: { id: user.id, type: 'user' } },
      detail: { sourceType: source.type, groups: profile.groups, roleIds: matchedRoles },
    });
    return this.auth.currentSession(user.id);
  }

  private matchRoleIds(sourceId: string, groups: string[]): string[] {
    const normalizedGroups = new Set(groups.map((group) => normalizeGroup(group)));
    const roleIds = [...this.mappings.values()]
      .filter((mapping) => mapping.enabled && mapping.sourceId === sourceId && normalizedGroups.has(normalizeGroup(mapping.externalGroup)))
      .map((mapping) => mapping.roleId);
    return [...new Set(roleIds)];
  }
}

function normalizeGroup(value: string): string {
  return value.trim().toLowerCase();
}
