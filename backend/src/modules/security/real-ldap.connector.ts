import { lookup as dnsLookup } from 'node:dns/promises';
import { createConnection, isIP } from 'node:net';
import { Client, type SearchOptions } from 'ldapts';
import { AppError } from '../../common/errors/app-error.js';
import { securityErrors } from '../../shared/security-error.js';
import { escapeLdapDnValue, escapeLdapFilterValue, renderLdapTemplate } from './ldap-filter-escape.js';
import type {
  ExternalGroupProfile,
  ExternalIdentityProfile,
  IdentitySource,
  LdapConnectionCheck,
  LdapConnectionTestResult,
  LdapConnector,
  LdapServiceCredentials,
} from './external-identity.service.js';

type LdapSearchEntry = Record<string, unknown> & { dn?: string };
type LdapEndpoint = {
  protocol: 'ldap' | 'ldaps';
  hostname: string;
  port: number;
};

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

  async lookupGroup(source: IdentitySource, groupName: string, credentials?: LdapServiceCredentials): Promise<ExternalGroupProfile> {
    const client = this.createClient(source);
    try {
      await this.bindAsServiceIfNeeded(client, source, credentials);
      const filterValue = escapeLdapFilterValue(groupName.trim());
      const { searchEntries } = await client.search(source.baseDn, {
        scope: 'sub',
        filter: buildGroupLookupFilter(source, filterValue),
        attributes: ['dn', 'cn', 'name', 'sAMAccountName', 'uid', 'objectGUID', 'entryUUID'],
        sizeLimit: 2,
      });
      const entries = searchEntries as LdapSearchEntry[];
      if (entries.length === 0) throw new AppError('RESOURCE_NOT_FOUND', '身份源组不存在');
      if (entries.length > 1) throw securityErrors.ldapSearchFailed({ sourceId: source.id, reason: 'multiple groups matched' });
      return normalizeGroupProfile(entries[0]);
    } catch (error) {
      if (error instanceof AppError || 'errorCode' in Object(error ?? {})) {
        throw error;
      }
      throw this.mapLdapError(error, { sourceId: source.id, phase: 'lookupGroup' });
    } finally {
      await safeUnbind(client);
    }
  }

  async testConnection(source: IdentitySource, credentials?: LdapServiceCredentials): Promise<LdapConnectionTestResult> {
    const checks: LdapConnectionCheck[] = [];
    let endpoint: LdapEndpoint;
    try {
      endpoint = parseLdapEndpoint(source.url);
    } catch (error) {
      const failure = connectionFailure('LDAP_URL_INVALID', toErrorMessage(error));
      checks.push({
        key: 'dns',
        status: 'failed',
        code: failure.code,
        message: failure.message,
        details: { url: source.url },
      });
      checks.push(skippedConnectionCheck('port', 'SKIPPED_INVALID_URL'));
      checks.push(skippedConnectionCheck('bind', 'SKIPPED_INVALID_URL'));
      return buildConnectionTestResult(checks);
    }

    let addresses: string[];
    try {
      addresses = await resolveLdapHost(endpoint.hostname);
      checks.push({
        key: 'dns',
        status: 'passed',
        code: 'DNS_RESOLVED',
        message: isIP(endpoint.hostname)
          ? 'Host is an IP address; DNS lookup was not required'
          : `DNS resolved successfully: ${addresses.join(', ')}`,
        details: { host: endpoint.hostname, addresses, lookupRequired: !isIP(endpoint.hostname) },
      });
    } catch (error) {
      const failure = connectionFailure('LDAP_DNS_FAILED', toErrorMessage(error));
      checks.push({
        key: 'dns',
        status: 'failed',
        code: failure.code,
        message: failure.message,
        details: { host: endpoint.hostname },
      });
      checks.push(skippedConnectionCheck('port', 'SKIPPED_DNS_FAILED'));
      checks.push(skippedConnectionCheck('bind', 'SKIPPED_DNS_FAILED'));
      return buildConnectionTestResult(checks);
    }

    const portProbe = await probeLdapPort(endpoint.hostname, endpoint.port, 10000);
    if (!portProbe.success) {
      checks.push({
        key: 'port',
        status: 'failed',
        code: portProbe.reasonCode ?? 'LDAP_PORT_UNREACHABLE',
        message: portProbe.reasonDetail ?? 'LDAP authentication port is unreachable',
        details: { host: endpoint.hostname, port: endpoint.port, protocol: endpoint.protocol },
      });
      checks.push(skippedConnectionCheck('bind', 'SKIPPED_PORT_UNREACHABLE'));
      return buildConnectionTestResult(checks);
    }
    checks.push({
      key: 'port',
      status: 'passed',
      code: 'LDAP_PORT_REACHABLE',
      message: `${endpoint.protocol.toUpperCase()} authentication port ${endpoint.port} is reachable`,
      details: { host: endpoint.hostname, port: endpoint.port, protocol: endpoint.protocol },
    });

    let client: Client | undefined;
    try {
      client = this.createClient(source);
      await this.bindAsServiceIfNeeded(client, source, credentials);
      if (!source.bindDn) {
        await client.bind('', '');
      }
      if (source.baseDn) {
        await client.search(source.baseDn, { scope: 'base', filter: '(objectClass=*)', attributes: ['dn'] });
      }
      checks.push({
        key: 'bind',
        status: 'passed',
        code: 'LDAP_BIND_OK',
        message: source.bindDn
          ? 'LDAP service account BIND and Base DN query succeeded'
          : 'Anonymous LDAP BIND and Base DN query succeeded',
        details: { bindDnConfigured: Boolean(source.bindDn), baseDn: source.baseDn },
      });
    } catch (error) {
      const mapped = this.mapLdapError(error, { sourceId: source.id, phase: 'testConnection' });
      checks.push({
        key: 'bind',
        status: 'failed',
        code: errorCodeOf(mapped, 'LDAP_BIND_FAILED'),
        message: mapped.message,
        details: { bindDnConfigured: Boolean(source.bindDn) },
      });
    } finally {
      if (client) await safeUnbind(client);
    }
    return buildConnectionTestResult(checks);
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

export function parseLdapEndpoint(value: string): LdapEndpoint {
  const url = new URL(value);
  if (url.protocol !== 'ldap:' && url.protocol !== 'ldaps:') {
    throw new Error(`unsupported LDAP protocol: ${url.protocol || 'missing'}`);
  }
  if (!url.hostname) throw new Error('LDAP hostname is missing');
  return {
    protocol: url.protocol === 'ldaps:' ? 'ldaps' : 'ldap',
    hostname: url.hostname,
    port: Number(url.port) || (url.protocol === 'ldaps:' ? 636 : 389),
  };
}

export async function resolveLdapHost(hostname: string): Promise<string[]> {
  if (isIP(hostname)) return [hostname];
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  return addresses.map((entry) => entry.address);
}

export function probeLdapPort(host: string, port: number, timeoutMs: number): Promise<{ success: boolean; reasonCode?: string; reasonDetail?: string }> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (result: { success: boolean; reasonCode?: string; reasonDetail?: string }) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () => finish({
      success: false,
      reasonCode: 'LDAP_PORT_CONNECT_TIMEOUT',
      reasonDetail: `LDAP port connection timed out after ${timeoutMs}ms`,
    }));
    socket.once('connect', () => finish({ success: true }));
    socket.once('error', (error: NodeJS.ErrnoException) => finish({
      success: false,
      reasonCode: ldapPortReasonCode(error.code),
      reasonDetail: error.message,
    }));
  });
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

function normalizeGroupProfile(entry: LdapSearchEntry): ExternalGroupProfile {
  const groupDn = firstString(entry.dn) ?? '';
  const code = firstString(entry.sAMAccountName) ?? firstString(entry.uid) ?? firstString(entry.cn) ?? firstString(entry.name) ?? groupDn;
  return {
    externalId: normalizeObjectGuid(entry.objectGUID) ?? firstString(entry.entryUUID) ?? groupDn,
    name: firstString(entry.name) ?? firstString(entry.cn) ?? code,
    code,
    groupDn,
  };
}

function buildGroupLookupFilter(source: IdentitySource, escapedGroupName: string): string {
  const objectClass = source.type === 'active_directory'
    ? '(objectClass=group)'
    : '(|(objectClass=groupOfNames)(objectClass=groupOfUniqueNames)(objectClass=posixGroup))';
  return `(&${objectClass}(|(cn=${escapedGroupName})(name=${escapedGroupName})(sAMAccountName=${escapedGroupName})(uid=${escapedGroupName})))`;
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

function skippedConnectionCheck(key: 'port' | 'bind', code: string): LdapConnectionCheck {
  return { key, status: 'skipped', code, message: code };
}

function connectionFailure(code: string, reason: string): { code: string; message: string } {
  return { code, message: reason };
}

function buildConnectionTestResult(checks: LdapConnectionCheck[]): LdapConnectionTestResult {
  const failed = checks.find((check) => check.status === 'failed');
  return {
    ok: !failed,
    code: failed?.code ?? 'OK',
    message: failed?.message ?? 'LDAP connection checks passed',
    checks,
  };
}

function errorCodeOf(error: Error, fallback: string): string {
  if (error instanceof AppError) return error.errorCode;
  return fallback;
}

function ldapPortReasonCode(code?: string): string {
  if (code === 'ECONNREFUSED') return 'LDAP_PORT_CONNECTION_REFUSED';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'LDAP_PORT_DNS_FAILED';
  if (code === 'ENETUNREACH' || code === 'EHOSTUNREACH') return 'LDAP_PORT_NO_ROUTE';
  return 'LDAP_PORT_CONNECT_FAILED';
}
