import { apiClient } from '@/api/client'
import type { ApiResult } from '@/api/generated/client-types'
import type { AppPreferences, ThemeMode } from '@/preferences/app-preferences'
import type { SupportedLocale } from '@/i18n'
import { buildListPath, listRecords, toClientPath, type ApiPageResult, type ApiRecord, type BusinessListQuery } from './common'

export interface LoginRequest {
  readonly username: string
  readonly password: string
  readonly sourceId?: string
}

export interface AuthRole {
  readonly id: string
  readonly code: string
  readonly name: string
}

export interface AuthUser {
  readonly id: string
  readonly username: string
  readonly displayName: string
  readonly tenantId: string
  readonly tenantName: string
  readonly status: string
  readonly roles: readonly AuthRole[]
}

export interface AuthSessionResponse {
  readonly token: string
  readonly user: AuthUser
  readonly permissions: readonly string[]
}

export interface CurrentUserResponse {
  readonly user: AuthUser
  readonly roles: readonly AuthRole[]
  readonly permissions: readonly string[]
}

export interface ObjectPermissionContextResponse extends CurrentUserResponse {
  readonly objectSets: readonly ApiRecord[]
  readonly roleBindings: readonly ApiRecord[]
  readonly objectPermissionVersion: string
  readonly expiresAt: string
}

export function login(body: LoginRequest): Promise<ApiResult<AuthSessionResponse>> {
  return apiClient.post<AuthSessionResponse>('/v1/auth/login', body)
}

export function externalLogin(body: Required<Pick<LoginRequest, 'sourceId' | 'username' | 'password'>>): Promise<ApiResult<AuthSessionResponse>> {
  return apiClient.post<AuthSessionResponse>('/v1/auth/external-login', body)
}

export function listPublicIdentitySources(): Promise<ApiResult<{ items: readonly ApiRecord[] }>> {
  return apiClient.get<{ items: readonly ApiRecord[] }>('/v1/auth/identity-sources/public')
}

export function logout(): Promise<ApiResult<{ success: true }>> {
  return apiClient.post<{ success: true }>('/v1/auth/logout')
}

export function changeCurrentUserPassword(body: {
  currentPassword: string
  newPassword: string
}): Promise<ApiResult<{ success: true }>> {
  return apiClient.request<{ success: true }>('/v1/auth/password', { method: 'PUT', body })
}

export function getCurrentUser(): Promise<ApiResult<CurrentUserResponse>> {
  return apiClient.get<CurrentUserResponse>('/v1/auth/me')
}

export function getCurrentPermissions(): Promise<ApiResult<{ permissions: readonly string[] }>> {
  return apiClient.get<{ permissions: readonly string[] }>('/v1/auth/permissions')
}

export function getPermissionContext(): Promise<ApiResult<ObjectPermissionContextResponse>> {
  return apiClient.get<ObjectPermissionContextResponse>('/v1/auth/permission-context')
}

export function getCurrentUserPreferences(): Promise<ApiResult<AppPreferences>> {
  return apiClient.get<AppPreferences>('/v1/auth/preferences')
}

export function updateCurrentUserPreferences(body: {
  theme: ThemeMode
  locale: SupportedLocale
}): Promise<ApiResult<AppPreferences>> {
  return apiClient.request<AppPreferences>('/v1/auth/preferences', { method: 'PUT', body })
}

export function listUsers(query?: BusinessListQuery): Promise<ApiPageResult> {
  return listRecords('/api/v1/security/users', query)
}

export function listGroups(query?: BusinessListQuery): Promise<ApiPageResult> {
  return listRecords('/api/v1/security/groups', query)
}

export function createGroup(body: { name: string; code?: string; enabled?: boolean }): Promise<ApiResult<ApiRecord>> {
  return apiClient.post<ApiRecord>('/v1/security/groups', body)
}

export function createUser(body: Record<string, unknown>): Promise<ApiResult<ApiRecord>> {
  return apiClient.post<ApiRecord>('/v1/security/users', body)
}

export interface ExternalUserLookupResponse extends ApiRecord {
  readonly sourceId: string
  readonly sourceName: string
  readonly identityProvider: string
  readonly externalId: string
  readonly username: string
  readonly displayName: string
  readonly email?: string
  readonly userDn: string
  readonly disabled?: boolean
}

export function lookupExternalUser(body: { sourceId: string; username: string }): Promise<ApiResult<ExternalUserLookupResponse>> {
  return apiClient.post<ExternalUserLookupResponse>('/v1/security/users/lookup-external', body)
}

export interface ExternalGroupLookupResponse extends ApiRecord {
  readonly sourceId: string
  readonly sourceName: string
  readonly identityProvider: string
  readonly externalId: string
  readonly name: string
  readonly code: string
  readonly groupDn: string
}

export function lookupExternalGroup(body: { sourceId: string; groupName: string }): Promise<ApiResult<ExternalGroupLookupResponse>> {
  return apiClient.post<ExternalGroupLookupResponse>('/v1/security/groups/lookup-external', body)
}

export function createExternalUser(body: { sourceId: string; username: string; roleId?: string }): Promise<ApiResult<ApiRecord>> {
  return apiClient.post<ApiRecord>('/v1/security/users/external', body)
}

export function createExternalGroup(body: { sourceId: string; groupName: string }): Promise<ApiResult<ApiRecord>> {
  return apiClient.post<ApiRecord>('/v1/security/groups/external', body)
}

export function updateUser(body: {
  userId: string
  displayName?: string
  email?: string
  status?: 'active' | 'disabled'
  roleId?: string
}): Promise<ApiResult<ApiRecord>> {
  return apiClient.request<ApiRecord>('/v1/security/users', { method: 'PATCH', body })
}

export function deleteUser(userId: string): Promise<ApiResult<{ userId: string; deleted: true }>> {
  return apiClient.request<{ userId: string; deleted: true }>('/v1/security/users/delete', {
    method: 'DELETE',
    body: { userId }
  })
}

export function updateUserStatus(body: { userId: string; status: 'active' | 'disabled' }): Promise<ApiResult<ApiRecord>> {
  return apiClient.request<ApiRecord>('/v1/security/users/status', { method: 'PATCH', body })
}

export function assignUserRole(body: { userId: string; roleId: string }): Promise<ApiResult<ApiRecord>> {
  return apiClient.post<ApiRecord>('/v1/security/users/roles', body)
}

export function listRoles(query?: BusinessListQuery): Promise<ApiPageResult> {
  return listRecords('/api/v1/security/roles', query)
}

export function createRole(body: Record<string, unknown>): Promise<ApiResult<ApiRecord>> {
  return apiClient.post<ApiRecord>('/v1/security/roles', body)
}

export function deleteRole(roleId: string): Promise<ApiResult<{ roleId: string; deleted: true }>> {
  return apiClient.request<{ roleId: string; deleted: true }>('/v1/security/roles/delete', {
    method: 'DELETE',
    body: { roleId }
  })
}

export function listObjectTypes(query?: BusinessListQuery): Promise<ApiPageResult> {
  return listRecords('/api/v1/security/object-types', query)
}

export function listObjectSets(query?: BusinessListQuery): Promise<ApiPageResult> {
  return listRecords('/api/v1/security/object-sets', query)
}

export function createObjectSet(body: Record<string, unknown>): Promise<ApiResult<ApiRecord>> {
  return apiClient.post<ApiRecord>('/v1/security/object-sets', body)
}

export function listObjectSetMembers(query?: BusinessListQuery): Promise<ApiPageResult> {
  return listRecords('/api/v1/security/object-set-members', query)
}

export function addObjectSetMember(body: Record<string, unknown>): Promise<ApiResult<ApiRecord>> {
  return apiClient.post<ApiRecord>('/v1/security/object-set-members', body)
}

export function listRoleBindings(query?: BusinessListQuery): Promise<ApiPageResult> {
  return listRecords('/api/v1/security/role-bindings', query)
}

export function createRoleBinding(body: Record<string, unknown>): Promise<ApiResult<ApiRecord>> {
  return apiClient.post<ApiRecord>('/v1/security/role-bindings', body)
}

export function listAccessGrants(query?: BusinessListQuery): Promise<ApiPageResult> {
  return listRecords('/api/v1/security/access-grants', query)
}

export function createAccessGrant(body: Record<string, unknown>): Promise<ApiResult<ApiRecord>> {
  return apiClient.post<ApiRecord>('/v1/security/access-grants', body)
}

export function getObjectCapabilities(body: {
  objects: readonly Record<string, unknown>[]
  accessLevels?: readonly ('read' | 'edit' | 'control')[]
}): Promise<ApiResult<{ items: readonly ApiRecord[] }>> {
  return apiClient.post<{ items: readonly ApiRecord[] }>('/v1/security/object-capabilities', body)
}

export function listIdentitySources(query?: BusinessListQuery): Promise<ApiPageResult> {
  return listRecords('/api/v1/security/identity-sources', query)
}

export function createIdentitySource(body: Record<string, unknown>): Promise<ApiResult<ApiRecord>> {
  return apiClient.post<ApiRecord>('/v1/security/identity-sources', body)
}

export function updateIdentitySource(body: Record<string, unknown>): Promise<ApiResult<ApiRecord>> {
  return apiClient.request<ApiRecord>('/v1/security/identity-sources', { method: 'PATCH', body })
}

export function deleteIdentitySource(id: string): Promise<ApiResult<{ id: string; deleted: true }>> {
  return apiClient.request<{ id: string; deleted: true }>('/v1/security/identity-sources/delete', {
    method: 'DELETE',
    body: { id }
  })
}

export type IdentitySourceConnectionCheckKey = 'dns' | 'port' | 'bind'
export type IdentitySourceConnectionCheckStatus = 'passed' | 'failed' | 'skipped'

export interface IdentitySourceConnectionCheck {
  readonly key: IdentitySourceConnectionCheckKey
  readonly status: IdentitySourceConnectionCheckStatus
  readonly code: string
  readonly message: string
  readonly details?: Record<string, unknown>
}

export interface IdentitySourceConnectionTestResult {
  readonly ok: boolean
  readonly code: string
  readonly message: string
  readonly checks: readonly IdentitySourceConnectionCheck[]
  readonly requestId?: string
}

export function listSecrets(query?: BusinessListQuery): Promise<ApiPageResult> {
  return listRecords('/api/v1/secrets', query)
}

export function createSecret(body: {
  name: string
  type: 'ssh_key' | 'password' | 'api_token' | 'pfx_password' | 'private_key' | 'certificate_private_key' | 'certificate_trust_bundle' | 'acme_eab'
  scopeType: 'global' | 'team' | 'zone' | 'host' | 'plugin'
  plainText: string
  scopeId?: string
  metadata?: Record<string, unknown>
}): Promise<ApiResult<{ id: string; secretRef: string }>> {
  return apiClient.post<{ id: string; secretRef: string }>('/v1/secrets', body)
}

export function testIdentitySource(sourceId: string): Promise<ApiResult<IdentitySourceConnectionTestResult>> {
  return apiClient.post<IdentitySourceConnectionTestResult>('/v1/security/identity-sources/test', { sourceId })
}

export function syncIdentitySourceUsers(body: { sourceId: string; usernamePrefix?: string; pageSize?: number }): Promise<ApiResult<ApiRecord>> {
  return apiClient.post<ApiRecord>('/v1/security/identity-sources/sync-users', body)
}

export function listGroupRoleMappings(query?: BusinessListQuery): Promise<ApiPageResult> {
  return listRecords('/api/v1/security/group-role-mappings', query)
}

export function createGroupRoleMapping(body: Record<string, unknown>): Promise<ApiResult<ApiRecord>> {
  return apiClient.post<ApiRecord>('/v1/security/group-role-mappings', body)
}
