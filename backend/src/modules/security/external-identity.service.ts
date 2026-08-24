import { AppError } from '../../common/errors/app-error.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import type { AsyncRepositoryPort } from '../../persistence/repositories/async-repository-port.js';
import { PgDocumentRepository } from '../../persistence/repositories/pg-document-repository.js';
import { newId } from '../../shared/id.js';
import type { RequestContext, SecuritySubject } from '../../shared/security-types.js';
import { AUDIT_EVENT_TYPES } from '../audits/audit-event-types.js';
import type { AuditService } from '../audits/audit.service.js';
import type { RBACService } from '../rbac/rbac.service.js';
import type { SecretService } from '../secrets/secret.service.js';
import type { AuthService, AuthSessionResponse } from './auth.service.js';
import { RealLdapConnector } from './real-ldap.connector.js';

export type IdentitySourceType = 'active_directory' | 'ldap';
export type IdentitySourceTlsMode = 'none' | 'starttls' | 'ldaps';
export type IdentitySourceSyncStatus = 'idle' | 'success' | 'partial_failure' | 'failure';

export interface IdentitySource {
  id: string;
  name: string;
  type: IdentitySourceType;
  enabled: boolean;
  url: string;
  baseDn: string;
  userFilter?: string;
  groupFilter?: string;
  syncUserFilter?: string;
  userDnTemplate?: string;
  bindDn?: string;
  bindPasswordSecretRef?: string;
  defaultRoleId?: string;
  requireGroupMapping: boolean;
  tlsMode: IdentitySourceTlsMode;
  userAttributes?: string[];
  groupAttributes?: string[];
  lastSyncAt?: string;
  lastSyncStatus?: IdentitySourceSyncStatus;
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

export interface ExternalGroupProfile {
  externalId: string;
  name: string;
  code: string;
  groupDn: string;
}

export interface LdapServiceCredentials {
  bindPassword?: string;
}

export interface LdapConnectionTestResult {
  ok: boolean;
  code: string;
  message: string;
}

export interface ExternalIdentitySyncResult {
  sourceId: string;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{ code: string; message: string; externalId?: string }>;
}

export interface LdapConnector {
  authenticate(source: IdentitySource, username: string, password: string, credentials?: LdapServiceCredentials): Promise<ExternalIdentityProfile>;
  lookupUser(source: IdentitySource, username: string, credentials?: LdapServiceCredentials): Promise<ExternalIdentityProfile>;
  lookupGroup(source: IdentitySource, groupName: string, credentials?: LdapServiceCredentials): Promise<ExternalGroupProfile>;
  testConnection(source: IdentitySource, credentials?: LdapServiceCredentials): Promise<LdapConnectionTestResult>;
  syncUsers(source: IdentitySource, credentials?: LdapServiceCredentials, options?: { pageSize?: number; usernamePrefix?: string }): Promise<ExternalIdentityProfile[]>;
}

export class MockDirectoryConnector implements LdapConnector {
  private readonly profiles = new Map<string, ExternalIdentityProfile & { password: string }>();

  addProfile(sourceId: string, profile: ExternalIdentityProfile & { password: string }): void {
    this.profiles.set(`${sourceId}:${profile.username.toLowerCase()}`, profile);
  }

  async authenticate(source: IdentitySource, username: string, password: string): Promise<ExternalIdentityProfile> {
    const profile = this.profiles.get(`${source.id}:${username.toLowerCase()}`);
    if (!profile || profile.password !== password) {
      throw new AppError('AUTH_UNAUTHENTICATED', '用户名或密码错误');
    }
    const { password: _password, ...safeProfile } = profile;
    return safeProfile;
  }

  async lookupUser(source: IdentitySource, username: string): Promise<ExternalIdentityProfile> {
    const profile = this.profiles.get(`${source.id}:${username.toLowerCase()}`);
    if (!profile) {
      throw new AppError('RESOURCE_NOT_FOUND', '身份源用户不存在');
    }
    const { password: _password, ...safeProfile } = profile;
    return safeProfile;
  }

  async lookupGroup(source: IdentitySource, groupName: string): Promise<ExternalGroupProfile> {
    const normalizedName = groupName.trim().toLowerCase();
    const group = [...this.profiles.values()]
      .flatMap((profile) => profile.groups)
      .find((item) => item.trim().toLowerCase() === normalizedName || item.trim().toLowerCase().includes(normalizedName));
    if (!group) {
      throw new AppError('RESOURCE_NOT_FOUND', '身份源组不存在');
    }
    return {
      externalId: group,
      name: group,
      code: group,
      groupDn: group,
    };
  }

  async testConnection(source: IdentitySource): Promise<LdapConnectionTestResult> {
    return source.enabled
      ? { ok: true, code: 'OK', message: 'mock directory reachable' }
      : { ok: false, code: 'DISABLED', message: 'identity source disabled' };
  }

  async syncUsers(source: IdentitySource): Promise<ExternalIdentityProfile[]> {
    return [...this.profiles.entries()]
      .filter(([key]) => key.startsWith(`${source.id}:`))
      .map(([, profile]) => {
        const { password: _password, ...safeProfile } = profile;
        return safeProfile;
      });
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
    private readonly secrets?: SecretService,
    private readonly connector: LdapConnector = new RealLdapConnector(),
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
      syncUserFilter: input.syncUserFilter,
      userDnTemplate: input.userDnTemplate,
      bindDn: input.bindDn,
      bindPasswordSecretRef: input.bindPasswordSecretRef,
      defaultRoleId: input.defaultRoleId,
      requireGroupMapping: input.requireGroupMapping,
      tlsMode: input.tlsMode,
      userAttributes: input.userAttributes,
      groupAttributes: input.groupAttributes,
      lastSyncAt: input.lastSyncAt,
      lastSyncStatus: input.lastSyncStatus ?? 'idle',
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
      context: { requestId: context.requestId, sourceIp: context.sourceIp, actor },
      detail: { type: source.type, url: source.url, bindPasswordSecretRef: source.bindPasswordSecretRef },
    });
    return source;
  }

  async updateSource(
    sourceId: string,
    patch: Partial<Omit<IdentitySource, 'id' | 'createdAt' | 'updatedAt' | 'lastSyncAt' | 'lastSyncStatus'>>,
    actor: SecuritySubject,
    context: RequestContext,
  ): Promise<IdentitySource> {
    const current = await this.sources.get(sourceId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', '身份源不存在');
    const next = await this.sources.update(sourceId, {
      ...patch,
      updatedAt: new Date().toISOString(),
    });
    await this.audit.write({
      eventType: AUDIT_EVENT_TYPES.IDENTITY_SOURCE_UPDATED,
      actorType: 'user',
      actorId: actor.id,
      action: 'security.identity_source.update',
      resourceType: 'identitySource',
      resourceId: sourceId,
      result: 'success',
      riskLevel: 'medium',
      context: { requestId: context.requestId, sourceIp: context.sourceIp, actor },
      detail: {
        before: {
          name: current.name,
          type: current.type,
          url: current.url,
          baseDn: current.baseDn,
          bindDn: current.bindDn,
          defaultRoleId: current.defaultRoleId,
          enabled: current.enabled,
          tlsMode: current.tlsMode,
        },
        after: {
          name: next.name,
          type: next.type,
          url: next.url,
          baseDn: next.baseDn,
          bindDn: next.bindDn,
          defaultRoleId: next.defaultRoleId,
          enabled: next.enabled,
          tlsMode: next.tlsMode,
        },
      },
    });
    return next;
  }

  async deleteSource(sourceId: string, actor: SecuritySubject, context: RequestContext): Promise<{ id: string; deleted: true }> {
    const source = await this.sources.get(sourceId);
    if (!source) throw new AppError('RESOURCE_NOT_FOUND', '身份源不存在');
    const relatedMappings = await this.mappings.list((mapping) => mapping.sourceId === sourceId);
    for (const mapping of relatedMappings) {
      await this.mappings.delete(mapping.id);
    }
    await this.sources.delete(sourceId);
    await this.audit.write({
      eventType: AUDIT_EVENT_TYPES.IDENTITY_SOURCE_DELETED,
      actorType: 'user',
      actorId: actor.id,
      action: 'security.identity_source.delete',
      resourceType: 'identitySource',
      resourceId: sourceId,
      result: 'success',
      riskLevel: 'high',
      context: { requestId: context.requestId, sourceIp: context.sourceIp, actor },
      detail: { name: source.name, mappingCount: relatedMappings.length },
    });
    return { id: sourceId, deleted: true };
  }

  async testSource(sourceId: string, actorId = 'system', context: RequestContext = {}): Promise<LdapConnectionTestResult & { requestId?: string }> {
    const source = await this.sources.get(sourceId);
    if (!source) throw new AppError('RESOURCE_NOT_FOUND', '身份源不存在');
    const credentials = await this.resolveServiceCredentials(source, actorId, context);
    const result = await this.connector.testConnection(source, credentials);
    await this.audit.write({
      eventType: AUDIT_EVENT_TYPES.IDENTITY_SOURCE_TESTED,
      actorType: actorId === 'system' ? 'system' : 'user',
      actorId,
      action: 'security.identity_source.test',
      resourceType: 'identitySource',
      resourceId: source.id,
      result: result.ok ? 'success' : 'failure',
      riskLevel: result.ok ? 'low' : 'medium',
      context,
      detail: { sourceType: source.type, code: result.code, message: result.message },
    });
    return { ...result, requestId: context.requestId };
  }

  async listMappings(): Promise<ExternalGroupRoleMapping[]> {
    return this.mappings.list();
  }

  async createMapping(
    input: Omit<ExternalGroupRoleMapping, 'id' | 'enabled' | 'createdAt' | 'updatedAt'> & { id?: string; enabled?: boolean },
    actor: SecuritySubject,
    context: RequestContext,
  ): Promise<ExternalGroupRoleMapping> {
    if (!await this.sources.get(input.sourceId)) throw new AppError('RESOURCE_NOT_FOUND', '身份源不存在');
    if (!await this.rbac.getRole(input.roleId)) throw new AppError('RESOURCE_NOT_FOUND', '角色不存在');
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
      context: { requestId: context.requestId, sourceIp: context.sourceIp, actor },
      detail: { sourceId: mapping.sourceId, externalGroup: mapping.externalGroup, roleId: mapping.roleId },
    });
    return mapping;
  }

  async login(input: { sourceId: string; username: string; password: string }, context: RequestContext): Promise<AuthSessionResponse> {
    const source = await this.sources.get(input.sourceId);
    if (!source || !source.enabled) throw new AppError('AUTH_UNAUTHENTICATED', '身份源不可用');
    const credentials = await this.resolveServiceCredentials(source, source.id, context);
    let profile: ExternalIdentityProfile;
    try {
      profile = await this.connector.authenticate(source, input.username, input.password, credentials);
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
        context: { requestId: context.requestId, sourceIp: context.sourceIp },
        detail: { sourceType: source.type, error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
    if (profile.disabled) throw new AppError('AUTH_FORBIDDEN', '外部目录用户已禁用');

    const user = await this.rbac.findUserByExternalIdentity(source.id, profile.externalId);
    if (!user) {
      throw new AppError('AUTH_FORBIDDEN', '该外部目录用户尚未在控制台中创建');
    }
    if (user.status !== 'active') throw new AppError('AUTH_FORBIDDEN', '本地影子用户已禁用');
    const refreshedUser = await this.updateLinkedUserFromProfile(user.id, source, profile, 'login');
    const matchedRoles = await this.matchRoleIds(source.id, profile.groups);
    for (const roleId of matchedRoles) {
      await this.rbac.assignRole(refreshedUser.id, roleId);
    }

    await this.audit.write({
      eventType: AUDIT_EVENT_TYPES.EXTERNAL_LOGIN_SUCCESS,
      actorType: 'user',
      actorId: refreshedUser.id,
      action: 'auth.external_login',
      resourceType: 'identitySource',
      resourceId: source.id,
      result: 'success',
      riskLevel: 'low',
      context: { requestId: context.requestId, sourceIp: context.sourceIp, actor: { id: refreshedUser.id, type: 'user' } },
      detail: { sourceType: source.type, groups: profile.groups, roleIds: matchedRoles },
    });
    return this.auth.currentSession(refreshedUser.id);
  }

  async lookupUser(input: { sourceId: string; username: string }, actor: SecuritySubject, context: RequestContext): Promise<ExternalIdentityProfile & { sourceId: string; sourceName: string; identityProvider: IdentitySourceType }> {
    const source = await this.sources.get(input.sourceId);
    if (!source || !source.enabled) throw new AppError('RESOURCE_NOT_FOUND', '身份源不存在或未启用');
    const credentials = await this.resolveServiceCredentials(source, actor.id, context);
    const profile = await this.connector.lookupUser(source, input.username, credentials);
    return {
      ...profile,
      sourceId: source.id,
      sourceName: source.name,
      identityProvider: source.type,
    };
  }

  async lookupGroup(input: { sourceId: string; groupName: string }, actor: SecuritySubject, context: RequestContext): Promise<ExternalGroupProfile & { sourceId: string; sourceName: string; identityProvider: IdentitySourceType }> {
    const source = await this.sources.get(input.sourceId);
    if (!source || !source.enabled) throw new AppError('RESOURCE_NOT_FOUND', '身份源不存在或未启用');
    const credentials = await this.resolveServiceCredentials(source, actor.id, context);
    const profile = await this.connector.lookupGroup(source, input.groupName, credentials);
    return {
      ...profile,
      sourceId: source.id,
      sourceName: source.name,
      identityProvider: source.type,
    };
  }

  async createLinkedUser(
    input: { sourceId: string; username: string; roleId?: string; tenantId?: string; tenantName?: string },
    actor: SecuritySubject,
    context: RequestContext,
  ) {
    const source = await this.sources.get(input.sourceId);
    if (!source || !source.enabled) throw new AppError('RESOURCE_NOT_FOUND', '身份源不存在或未启用');
    const credentials = await this.resolveServiceCredentials(source, actor.id, context);
    const profile = await this.connector.lookupUser(source, input.username, credentials);
    if (profile.disabled) throw new AppError('VALIDATION_FAILED', '外部目录用户已禁用');
    const existingExternalUser = await this.rbac.findUserByExternalIdentity(source.id, profile.externalId);
    if (existingExternalUser) throw new AppError('VALIDATION_FAILED', '该身份源用户已存在');
    const existingUsername = await this.rbac.findUserByUsername(profile.username);
    if (existingUsername) throw new AppError('VALIDATION_FAILED', '用户名已存在');
    const user = await this.createLinkedUserFromProfile(source, profile, input.tenantId ?? 'default', input.tenantName ?? '默认租户');
    if (input.roleId) {
      await this.rbac.assignRole(user.id, input.roleId);
    }
    await this.audit.write({
      eventType: AUDIT_EVENT_TYPES.SECURITY_USER_CREATED,
      actorType: 'user',
      actorId: actor.id,
      action: 'security.user.create_external',
      resourceType: 'user',
      resourceId: user.id,
      result: 'success',
      riskLevel: 'medium',
      context: { requestId: context.requestId, sourceIp: context.sourceIp, actor },
      detail: { sourceId: source.id, username: profile.username, externalId: profile.externalId, roleId: input.roleId },
    });
    return user;
  }

  async syncUsers(input: { sourceId: string; usernamePrefix?: string; pageSize?: number }, actor: SecuritySubject, context: RequestContext): Promise<ExternalIdentitySyncResult> {
    const source = await this.sources.get(input.sourceId);
    if (!source || !source.enabled) throw new AppError('RESOURCE_NOT_FOUND', '身份源不存在或未启用');
    const credentials = await this.resolveServiceCredentials(source, actor.id, context);
    const profiles = await this.connector.syncUsers(source, credentials, { pageSize: input.pageSize, usernamePrefix: input.usernamePrefix });
    const result: ExternalIdentitySyncResult = {
      sourceId: source.id,
      total: profiles.length,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };
    for (const profile of profiles) {
      try {
        const existing = await this.rbac.findUserByExternalIdentity(source.id, profile.externalId);
        await this.upsertShadowUser(source, profile, 'manual_sync');
        if (existing) result.updated += 1;
        else result.created += 1;
      } catch (error) {
        result.failed += 1;
        result.errors.push({
          code: extractErrorCode(error),
          message: error instanceof Error ? error.message : String(error),
          externalId: profile.externalId,
        });
      }
    }
    const syncStatus: IdentitySourceSyncStatus = result.failed === 0
      ? 'success'
      : (result.created + result.updated) > 0 ? 'partial_failure' : 'failure';
    await this.sources.update(source.id, {
      lastSyncAt: new Date().toISOString(),
      lastSyncStatus: syncStatus,
      updatedAt: new Date().toISOString(),
    });
    await this.audit.write({
      eventType: AUDIT_EVENT_TYPES.IDENTITY_SOURCE_SYNCED,
      actorType: 'user',
      actorId: actor.id,
      action: 'security.identity_source.sync_users',
      resourceType: 'identitySource',
      resourceId: source.id,
      result: result.failed === 0 ? 'success' : 'failure',
      riskLevel: 'medium',
      context: { requestId: context.requestId, sourceIp: context.sourceIp, actor },
      detail: result,
    });
    return result;
  }

  private async resolveServiceCredentials(source: IdentitySource, actorId: string, context: RequestContext): Promise<LdapServiceCredentials | undefined> {
    if (!source.bindDn) {
      return undefined;
    }
    if (!source.bindPasswordSecretRef) {
      throw new AppError('LDAP_CONFIG_INVALID', '服务账号缺少 bindPasswordSecretRef');
    }
    if (!this.secrets) {
      throw new AppError('SYSTEM_INTERNAL_ERROR', 'SecretService 未注入');
    }
    const resolved = await this.secrets.resolveForService({
      secretRef: source.bindPasswordSecretRef,
      expectedType: 'password',
      purpose: 'ldap.bind',
      actorId,
      context,
    });
    return { bindPassword: resolved.plainText };
  }

  private async upsertShadowUser(source: IdentitySource, profile: ExternalIdentityProfile, syncSource: 'login' | 'manual_sync') {
    const shadowUsername = this.buildShadowUsername(profile);
    const existing = await this.rbac.findUserByExternalIdentity(source.id, profile.externalId);
    if (existing) {
      return this.rbac.updateUser(existing.id, {
        username: shadowUsername,
        displayName: profile.displayName || profile.username,
        email: profile.email,
        identityProvider: source.type,
        externalId: profile.externalId,
        externalSourceId: source.id,
        status: profile.disabled ? 'disabled' : existing.status,
        lastSyncedAt: new Date().toISOString(),
        syncSource,
      });
    }
    return this.rbac.createUser({
      id: `external_${source.id}_${profile.externalId}`.replace(/[^a-zA-Z0-9_]/g, '_'),
      username: shadowUsername,
      displayName: profile.displayName || profile.username,
      email: profile.email,
      status: profile.disabled ? 'disabled' : 'active',
      tenantId: 'default',
      tenantName: '默认租户',
      identityProvider: source.type,
      externalId: profile.externalId,
      externalSourceId: source.id,
      lastSyncedAt: new Date().toISOString(),
      syncSource,
    });
  }

  private async updateLinkedUserFromProfile(userId: string, source: IdentitySource, profile: ExternalIdentityProfile, syncSource: 'login' | 'manual_sync') {
    const patch = {
      username: this.buildShadowUsername(profile),
      displayName: profile.displayName || profile.username,
      email: profile.email,
      identityProvider: source.type,
      externalId: profile.externalId,
      externalSourceId: source.id,
      lastSyncedAt: new Date().toISOString(),
      syncSource,
    } satisfies Parameters<RBACService['updateUser']>[1];
    return this.rbac.updateUser(userId, profile.disabled ? { ...patch, status: 'disabled' } : patch);
  }

  private async createLinkedUserFromProfile(source: IdentitySource, profile: ExternalIdentityProfile, tenantId: string, tenantName: string) {
    return this.rbac.createUser({
      id: `external_${source.id}_${profile.externalId}`.replace(/[^a-zA-Z0-9_]/g, '_'),
      username: this.buildShadowUsername(profile),
      displayName: profile.displayName || profile.username,
      email: profile.email,
      status: 'active',
      tenantId,
      tenantName,
      identityProvider: source.type,
      externalId: profile.externalId,
      externalSourceId: source.id,
      lastSyncedAt: new Date().toISOString(),
      syncSource: 'manual_sync',
    });
  }

  private buildShadowUsername(profile: ExternalIdentityProfile): string {
    return profile.username.trim();
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

function extractErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'errorCode' in error && typeof (error as { errorCode?: unknown }).errorCode === 'string') {
    return (error as { errorCode: string }).errorCode;
  }
  return 'SYSTEM_INTERNAL_ERROR';
}
