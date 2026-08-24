import { Client, type SearchOptions } from 'ldapts';
import { AppError } from '../../common/errors/app-error.js';
import { securityErrors } from '../../shared/security-error.js';
import { escapeLdapDnValue, escapeLdapFilterValue, renderLdapTemplate } from './ldap-filter-escape.js';
import type { ExternalIdentityProfile, IdentitySource, LdapConnector, LdapConnectionTestResult, LdapServiceCredentials } from './external-identity.service.js';

type LdapSearchEntry = Record<string, unknown> & { dn?: string };

export class RealLdapConnector implements LdapConnector {
  async authenticate(source: IdentitySource, username: string, password: string, credentials?: LdapServiceCredentials): Promise<ExternalIdentityProfile> {
    if (!password.trim()) {
      throw new AppError('AUTH_UNAUTHENTICATED', '用户名或密码错误');
    }
    const client = this.createClient(source);
    try {
      const userRecord = await this.resolveUserRecord(client, source, username, credentials);
      await this.userBind(source, userRecord.userDn, password);
      const groups = await this.searchUserGroups(client, source, userRecord, username);
      return {
        externalId: userRecord.externalId,
        username: userRecord.username,
        displayName: userRecord.displayName,
        email: userRecord.email,
        userDn: userRecord.userDn,
        groups,
        disabled: userRecord.disabled,
      };
    } finally {
      await safeUnbind(client);
    }
  }

  async lookupUser(source: IdentitySource, username: string, credentials?: LdapServiceCredentials): Promise<ExternalIdentityProfile> {
    const client = this.createClient(source);
    try {
      const userRecord = await this.resolveUserRecord(client, source, username, credentials, 'lookup');
      const groups = await this.searchUserGroups(client, source, userRecord, username);
      return {
        externalId: userRecord.externalId,
        username: userRecord.username,
        displayName: userRecord.displayName,
        email: userRecord.email,
        userDn: userRecord.userDn,
        groups,
        disabled: userRecord.disabled,
      };
    } catch (error) {
      if (error instanceof AppError || 'errorCode' in Object(error ?? {})) {
        throw error;
      }
      throw this.mapLdapError(error, { sourceId: source.id, phase: 'lookupUser' });
    } finally {
      await safeUnbind(client);
    }
  }

  async testConnection(source: IdentitySource, credentials?: LdapServiceCredentials): Promise<LdapConnectionTestResult> {
    const client = this.createClient(source);
    try {
      await this.bindAsServiceIfNeeded(client, source, credentials);
      if (source.baseDn) {
        await client.search(source.baseDn, { scope: 'base', filter: '(objectClass=*)', attributes: ['dn'] });
      }
      return { ok: true, code: 'OK', message: 'ldap connection ok' };
    } catch (error) {
      throw this.mapLdapError(error, { sourceId: source.id, phase: 'testConnection' });
    } finally {
      await safeUnbind(client);
    }
  }

  async syncUsers(source: IdentitySource, credentials?: LdapServiceCredentials, options: { pageSize?: number; usernamePrefix?: string } = {}): Promise<ExternalIdentityProfile[]> {
    const client = this.createClient(source);
    try {
      await this.bindAsServiceIfNeeded(client, source, credentials);
      const entries = await this.searchUsers(client, source, options.usernamePrefix, options.pageSize);
      return entries.map((entry) => this.normalizeProfile(entry, source));
    } catch (error) {
      throw this.mapLdapError(error, { sourceId: source.id, phase: 'syncUsers' });
    } finally {
      await safeUnbind(client);
    }
  }

  private createClient(source: IdentitySource): Client {
    return new Client({
      url: source.url,
      timeout: 10000,
      connectTimeout: 10000,
      tlsOptions: source.tlsMode === 'none' ? undefined : {},
    });
  }

  private async resolveUserRecord(client: Client, source: IdentitySource, username: string, credentials?: LdapServiceCredentials, purpose: 'auth' | 'lookup' = 'auth') {
    if (source.userDnTemplate) {
      const userDn = renderLdapTemplate(source.userDnTemplate, {
        username: escapeLdapDnValue(username),
      });
      await this.bindAsServiceIfNeeded(client, source, credentials);
      if (looksLikeLdapDn(userDn)) {
        const entry = await this.lookupUserByDn(client, source, userDn, purpose);
        return this.normalizeProfile(entry, source);
      }
      if (source.type === 'active_directory') {
        return this.searchSingleUser(client, source, buildAdLookupFilter(username, userDn), purpose);
      }
    }

    if (!source.userFilter) {
      throw securityErrors.ldapConfigInvalid({ sourceId: source.id, reason: 'missing userFilter and userDnTemplate' });
    }
    await this.bindAsServiceIfNeeded(client, source, credentials);
    const renderedFilter = renderLdapTemplate(source.userFilter, {
      username: escapeLdapFilterValue(username),
    });
    return this.searchSingleUser(client, source, renderedFilter, purpose);
  }

  private async searchSingleUser(client: Client, source: IdentitySource, filter: string, purpose: 'auth' | 'lookup') {
    const { searchEntries } = await client.search(source.baseDn, {
      scope: 'sub',
      filter,
      attributes: requestedUserAttributes(source),
      sizeLimit: 2,
    });
    const entries = searchEntries as LdapSearchEntry[];
    if (entries.length === 0) {
      throw purpose === 'lookup'
        ? new AppError('RESOURCE_NOT_FOUND', '身份源用户不存在')
        : new AppError('AUTH_UNAUTHENTICATED', '用户名或密码错误');
    }
    if (entries.length > 1) throw securityErrors.ldapSearchFailed({ sourceId: source.id, reason: 'multiple users matched' });
    return this.normalizeProfile(entries[0], source);
  }

  private async searchUserGroups(client: Client, source: IdentitySource, profile: ExternalIdentityProfile, username: string): Promise<string[]> {
    if (!source.groupFilter) {
      return [];
    }
    const renderedFilter = renderLdapTemplate(source.groupFilter, {
      userDn: escapeLdapFilterValue(profile.userDn),
      username: escapeLdapFilterValue(username),
    });
    const { searchEntries } = await client.search(source.baseDn, {
      scope: 'sub',
      filter: renderedFilter,
      attributes: ['dn', 'cn', 'sAMAccountName', 'uid'],
    });
    return (searchEntries as LdapSearchEntry[]).flatMap((entry) => normalizeGroupCandidates(entry));
  }

  private async searchUsers(client: Client, source: IdentitySource, usernamePrefix?: string, pageSize = 100): Promise<LdapSearchEntry[]> {
    const filter = source.syncUserFilter
      ? renderLdapTemplate(source.syncUserFilter, { username: escapeLdapFilterValue(usernamePrefix ?? '') })
      : buildDefaultSyncFilter(source, usernamePrefix);
    const options: SearchOptions = {
      scope: 'sub',
      filter,
      attributes: requestedUserAttributes(source),
      paged: { pageSize: Math.min(Math.max(pageSize, 1), 200) },
    };
    const { searchEntries } = await client.search(source.baseDn, options);
    return searchEntries as LdapSearchEntry[];
  }

  private async bindAsServiceIfNeeded(client: Client, source: IdentitySource, credentials?: LdapServiceCredentials): Promise<void> {
    if (source.tlsMode === 'starttls') {
      try {
        await client.startTLS({});
      } catch (error) {
        throw securityErrors.ldapTlsFailed({ sourceId: source.id, reason: toErrorMessage(error) });
      }
    }
    if (!source.bindDn) {
      return;
    }
    if (!credentials?.bindPassword) {
      throw securityErrors.ldapConfigInvalid({ sourceId: source.id, reason: 'bind password missing' });
    }
    try {
      await client.bind(source.bindDn, credentials.bindPassword);
    } catch (error) {
      throw securityErrors.ldapBindFailed({ sourceId: source.id, phase: 'service_bind', reason: toErrorMessage(error) });
    }
  }

  private async lookupUserByDn(client: Client, source: IdentitySource, userDn: string, purpose: 'auth' | 'lookup'): Promise<LdapSearchEntry> {
    try {
      const { searchEntries } = await client.search(userDn, {
        scope: 'base',
        filter: '(objectClass=*)',
        attributes: requestedUserAttributes(source),
      });
      const entry = (searchEntries as LdapSearchEntry[])[0];
      if (!entry) {
        throw purpose === 'lookup'
          ? new AppError('RESOURCE_NOT_FOUND', '身份源用户不存在')
          : new AppError('AUTH_UNAUTHENTICATED', '用户名或密码错误');
      }
      return entry;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw this.mapLdapError(error, { sourceId: source.id, phase: 'lookupUserByDn' });
    }
  }

  private async userBind(source: IdentitySource, userDn: string, password: string): Promise<void> {
    const client = this.createClient(source);
    try {
      if (source.tlsMode === 'starttls') {
        await client.startTLS({});
      }
      await client.bind(userDn, password);
    } catch {
      throw new AppError('AUTH_UNAUTHENTICATED', '用户名或密码错误');
    } finally {
      await safeUnbind(client);
    }
  }

  private normalizeProfile(entry: LdapSearchEntry, source: IdentitySource): ExternalIdentityProfile {
    const userDn = String(entry.dn ?? '').trim();
    if (!userDn) {
      throw securityErrors.ldapProfileInvalid({ sourceId: source.id, reason: 'missing dn' });
    }
    const username = firstString(entry.uid)
      ?? firstString(entry.sAMAccountName)
      ?? firstString(entry.userPrincipalName)
      ?? firstString(entry.cn)
      ?? userDn;
    const externalId = firstString(entry.entryUUID)
      ?? normalizeObjectGuid(entry.objectGUID)
      ?? userDn;
    const displayName = firstString(entry.displayName)
      ?? firstString(entry.cn)
      ?? username;
    const email = firstString(entry.mail);
    const disabled = Boolean(entry.userAccountControl && (Number(entry.userAccountControl) & 2) === 2);
    const memberOf = stringArray(entry.memberOf);

    return {
      externalId,
      username,
      displayName,
      email,
      userDn,
      groups: [...new Set(memberOf.flatMap((group) => normalizeGroupCandidates({ dn: group })))],
      disabled,
    };
  }

  private mapLdapError(error: unknown, details: Record<string, unknown>): Error {
    if (error instanceof AppError || 'errorCode' in Object(error ?? {})) {
      return error as Error;
    }
    const message = toErrorMessage(error).toLowerCase();
    if (message.includes('certificate') || message.includes('tls') || message.includes('ssl')) {
      return securityErrors.ldapTlsFailed({ ...details, reason: toErrorMessage(error) });
    }
    if (message.includes('bind')) {
      return securityErrors.ldapBindFailed({ ...details, reason: toErrorMessage(error) });
    }
    if (message.includes('search')) {
      return securityErrors.ldapSearchFailed({ ...details, reason: toErrorMessage(error) });
    }
    return securityErrors.ldapSourceUnreachable({ ...details, reason: toErrorMessage(error) });
  }
}

function requestedUserAttributes(source: IdentitySource): string[] {
  return source.userAttributes?.length
    ? source.userAttributes
    : ['dn', 'cn', 'displayName', 'mail', 'uid', 'sAMAccountName', 'userPrincipalName', 'memberOf', 'entryUUID', 'objectGUID', 'userAccountControl'];
}

export function buildDefaultSyncFilter(source: IdentitySource, usernamePrefix?: string): string {
  if (source.type === 'active_directory') {
    const samAccountClause = usernamePrefix
      ? `(sAMAccountName=${escapeLdapFilterValue(`${usernamePrefix}*`)})`
      : '(sAMAccountName=*)';
    return `(&
(objectCategory=person)
(objectClass=user)
(!(objectClass=computer))
(!(userAccountControl:1.2.840.113556.1.4.803:=2))
(!(sAMAccountName=*$))
${samAccountClause}
)`.replace(/\s+/g, '');
  }
  if (source.userFilter) {
    return renderLdapTemplate(source.userFilter, {
      username: escapeLdapFilterValue(usernamePrefix ? `${usernamePrefix}*` : '*'),
    });
  }
  const uidClause = usernamePrefix
    ? `(uid=${escapeLdapFilterValue(`${usernamePrefix}*`)})`
    : '(uid=*)';
  return `(&(objectClass=person)${uidClause})`;
}

export function buildAdLookupFilter(username: string, renderedUserName: string): string {
  const candidates = [...new Set([username.trim(), renderedUserName.trim()].filter(Boolean))];
  const clauses = candidates.flatMap((candidate) => [
    `(sAMAccountName=${escapeLdapFilterValue(candidate)})`,
    `(userPrincipalName=${escapeLdapFilterValue(candidate)})`,
  ]);
  return `(&
(objectCategory=person)
(objectClass=user)
(!(objectClass=computer))
(!(userAccountControl:1.2.840.113556.1.4.803:=2))
(!(|(sAMAccountName=*$)(userPrincipalName=*$)))
(|${clauses.join('')})
)`.replace(/\s+/g, '');
}

function looksLikeLdapDn(value: string): boolean {
  return /(^|,)\s*(cn|uid|ou|dc|o|c|sn|givenName)=/i.test(value);
}

function firstString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const item = value.find((entry) => typeof entry === 'string' && entry.trim());
    return typeof item === 'string' ? item.trim() : undefined;
  }
  return undefined;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '').map((entry) => entry.trim());
  }
  return typeof value === 'string' && value.trim() !== '' ? [value.trim()] : [];
}

function normalizeObjectGuid(value: unknown): string | undefined {
  if (Buffer.isBuffer(value)) {
    return value.toString('hex');
  }
  return undefined;
}

function normalizeGroupCandidates(entry: LdapSearchEntry): string[] {
  const candidates = [firstString(entry.dn), firstString(entry.cn), firstString(entry.sAMAccountName), firstString(entry.uid)];
  return candidates.filter((value): value is string => typeof value === 'string' && value.trim() !== '').map((value) => value.trim());
}

async function safeUnbind(client: Client): Promise<void> {
  try {
    await client.unbind();
  } catch {
    // ignore cleanup failure
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
