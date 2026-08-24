import { AppError } from '../../common/errors/app-error.js';
import type { RequestContext } from '../../common/tracing/request-context.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import type { AsyncRepositoryPort } from '../../persistence/repositories/async-repository-port.js';
import { PgDocumentRepository } from '../../persistence/repositories/pg-document-repository.js';
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
      throw new AppError('AUTH_UNAUTHENTICATED', '澶栭儴鐩綍鐢ㄦ埛鍚嶆垨瀵嗙爜閿欒');
    }
    const { password: _password, ...safeProfile } = profile;
    return safeProfile;
  }

  async testConnection(source: IdentitySource): Promise<{ ok: boolean; message: string }> {
    return source.enabled ? { ok: true, message: 'mock directory reachable' } : { ok: false, message: 'identity source disabled' };
  }
}

export class ExternalIdentityService {
  private static readonly defaultDb = new PgliteDatabase();

  private static createDefaultSourcesRepository(): AsyncRepositoryPort<IdentitySource> {
    return new PgDocumentRepository<IdentitySource>(ExternalIdentityService.defaultDb, 'security.identity_sources');
  }

  private static createDefaultMappingsRepository(): AsyncRepositoryPort<ExternalGroupRoleMapping> {
    return new PgDocumentRepository<ExternalGroupRoleMapping>(ExternalIdentityService.defaultDb, 'security.external_group_role_mappings');
  }

  constructor(
    private readonly rbac: RBACService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly connector: LdapConnector = new MockDirectoryConnector(),
    private readonly sources: AsyncRepositoryPort<IdentitySource> = ExternalIdentityService.createDefaultSourcesRepository(),
    private readonly mappings: AsyncRepositoryPort<ExternalGroupRoleMapping> = ExternalIdentityService.createDefaultMappingsRepository(),
  ) {}

  getConnector(): LdapConnector {
    return this.connector;
  }

  async listPublicSources(): Promise<Array<Pick<IdentitySource, 'id' | 'name' | 'type'>>> {
    return (await this.sources.list((source) => source.enabled)).map((source) => ({ id: source.id, name: source.name, type: source.type }));
  }

  async listSources(): Promise<IdentitySource[]> {
    return this.sources.list();
  }

  async createSource(input: Omit<IdentitySource, 'id' | 'enabled' | 'createdAt' | 'updatedAt'> & { id?: string; enabled?: boolean }, actor: SecuritySubject, context: RequestContext): Promise<IdentitySource> {
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
    await this.sources.upsert(source);
    await this.audit.write({
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
    const source = await this.sources.get(sourceId);
    if (!source) throw new AppError('RESOURCE_NOT_FOUND', '韬唤婧愪笉瀛樺湪');
    return this.connector.testConnection(source);
  }

  async listMappings(): Promise<ExternalGroupRoleMapping[]> {
    return this.mappings.list();
  }

  async createMapping(
    input: Omit<ExternalGroupRoleMapping, 'id' | 'enabled' | 'createdAt' | 'updatedAt'> & { id?: string; enabled?: boolean },
    actor: SecuritySubject,
    context: RequestContext,
  ): Promise<ExternalGroupRoleMapping> {
    if (!await this.sources.get(input.sourceId)) throw new AppError('RESOURCE_NOT_FOUND', '韬唤婧愪笉瀛樺湪');
    if (!await this.rbac.getRole(input.roleId)) throw new AppError('RESOURCE_NOT_FOUND', '瑙掕壊涓嶅瓨鍦?');
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
    await this.mappings.upsert(mapping);
    await this.audit.write({
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
    const source = await this.sources.get(input.sourceId);
    if (!source || !source.enabled) throw new AppError('AUTH_UNAUTHENTICATED', '韬唤婧愪笉鍙敤');
    let profile: ExternalIdentityProfile;
    try {
      profile = await this.connector.authenticate(source, input.username, input.password);
    } catch (error) {
      await this.audit.write({
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
    if (profile.disabled) throw new AppError('AUTH_FORBIDDEN', '澶栭儴鐩綍鐢ㄦ埛宸茬鐢?');

    const matchedRoles = await this.matchRoleIds(source.id, profile.groups);
    if (matchedRoles.length === 0 && source.defaultRoleId) matchedRoles.push(source.defaultRoleId);
    if (matchedRoles.length === 0 && source.requireGroupMapping) {
      throw new AppError('AUTH_FORBIDDEN', '鏈懡涓换浣曞閮ㄧ粍瑙掕壊鏄犲皠');
    }

    const user = await this.rbac.createUserIfAbsent({
      id: `external_${source.id}_${profile.externalId}`.replace(/[^a-zA-Z0-9_]/g, '_'),
      username: `${source.id}:${profile.username}`,
      displayName: profile.displayName || profile.username,
      status: 'active',
      tenantId: 'default',
      tenantName: '榛樿绉熸埛',
      identityProvider: source.type,
      externalId: profile.externalId,
      externalSourceId: source.id,
    });
    if (user.status !== 'active') throw new AppError('AUTH_FORBIDDEN', '鏈湴褰卞瓙鐢ㄦ埛宸茬鐢?');
    for (const roleId of matchedRoles) {
      await this.rbac.assignRole(user.id, roleId);
    }

    await this.audit.write({
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

  private async matchRoleIds(sourceId: string, groups: string[]): Promise<string[]> {
    const normalizedGroups = new Set(groups.map((group) => normalizeGroup(group)));
    const roleIds = (await this.mappings.list((mapping) => mapping.enabled && mapping.sourceId === sourceId))
      .filter((mapping) => normalizedGroups.has(normalizeGroup(mapping.externalGroup)))
      .map((mapping) => mapping.roleId);
    return [...new Set(roleIds)];
  }
}

function normalizeGroup(value: string): string {
  return value.trim().toLowerCase();
}
