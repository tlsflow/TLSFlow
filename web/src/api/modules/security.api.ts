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
  readonly businessPermissions?: readonly ApiRecord[]
  readonly businessPermissionVersion?: string
  readonly expiresAt: string
}

export type TenantMode = 'single' | 'hierarchical'
export type TenantScopeType = 'SELF' | 'SUBTREE' | 'EXPLICIT' | 'SYSTEM'

export interface AccessibleTenantResponse {
  readonly tenantId: string
  readonly name: string
  readonly code: string
  readonly type: 'GROUP' | 'COMPANY'
  readonly parentTenantId?: string
  readonly membershipType: 'owner' | 'admin' | 'operator' | 'auditor' | 'member'
  readonly membershipStatus: 'ACTIVE' | 'REVOKED' | 'EXPIRED'
  readonly current: boolean
  readonly canSwitch: boolean
  readonly mode: TenantMode
  readonly scopeType?: TenantScopeType
}

export interface TenantContextResponse {
  readonly mode: TenantMode
  readonly currentTenantId: string
  readonly homeTenantId: string
  readonly accessibleTenantIds: readonly string[]
  readonly managementScope?: { readonly type: TenantScopeType; readonly rootTenantId?: string; readonly tenantIds?: readonly string[] }
  readonly version: string
}

export interface TenantAdministratorSummary {
  readonly membershipId: string
  readonly subjectType: 'user' | 'group' | 'external_group'
  readonly subjectId: string
  readonly displayName: string
  readonly username?: string
  readonly membershipType: 'owner' | 'admin'
  readonly status: 'ACTIVE'
  readonly effectiveFrom: string
  readonly effectiveUntil?: string
}

export interface TenantArchitectureNode {
  readonly id: string
  readonly name: string
  readonly code: string
  readonly type: 'GROUP' | 'COMPANY'
  readonly parentId?: string
  readonly status: 'ACTIVE' | 'SUSPENDED'
  readonly current: boolean
  readonly administrators: readonly TenantAdministratorSummary[]
  readonly administratorsTruncated?: boolean
  readonly children: readonly TenantArchitectureNode[]
}

export interface TenantArchitectureResponse {
  readonly mode: TenantMode
  readonly currentTenantId: string
  readonly contextVersion: string
  readonly managementScope?: { readonly type: TenantScopeType; readonly rootTenantId?: string; readonly tenantIds?: readonly string[] }
  readonly roots: readonly TenantArchitectureNode[]
}

export interface TenantModeSummaryResponse {
  readonly state: { readonly mode: TenantMode; readonly lifecycleState: string; readonly updatedAt?: string; readonly lastPreflightBatchId?: string; readonly lastEnableBatchId?: string; readonly lastRollbackBatchId?: string }
  readonly lastPreflightBatch?: ApiRecord
  readonly lastEnableBatch?: ApiRecord
  readonly lastRollbackBatch?: ApiRecord
}

export function listAccessibleTenants(): Promise<ApiResult<{ currentTenantId: string; version: string; mode: TenantMode; items: readonly AccessibleTenantResponse[] }>> {
  return apiClient.get('/v1/tenants/accessible')
}

export function getTenantContext(): Promise<ApiResult<TenantContextResponse & { readonly currentTenant?: ApiRecord }>> {
  return apiClient.get('/v1/tenant-context/current')
}

export function switchTenant(body: { readonly tenantId: string; readonly contextVersion: string }): Promise<ApiResult<TenantContextResponse & { readonly token: string }>> {
  return apiClient.post('/v1/tenant-context/switch', body)
}

export function getTenantArchitecture(): Promise<ApiResult<TenantArchitectureResponse>> {
  return apiClient.get('/v1/tenants/architecture')
}

export function getTenantModeSummary(): Promise<ApiResult<TenantModeSummaryResponse>> {
  return apiClient.get('/v1/system/tenant-mode')
}

export function runTenantModePreflight(body: { readonly confirmation?: string } = {}): Promise<ApiResult<ApiRecord>> {
  return apiClient.post('/v1/system/tenant-mode/preflight', body)
}

export function enableTenantMode(body: { readonly preflightBatchId: string; readonly confirmation: string }): Promise<ApiResult<ApiRecord>> {
  return apiClient.post('/v1/system/tenant-mode/enable', body)
}

export function rollbackTenantMode(body: { readonly confirmation: string }): Promise<ApiResult<ApiRecord>> {
  return apiClient.post('/v1/system/tenant-mode/rollback', body)
}

export function createTenant(body: { readonly name: string; readonly code: string; readonly type: 'COMPANY'; readonly parentId: string }): Promise<ApiResult<{ readonly tenant: ApiRecord }>> {
  return apiClient.post('/v1/tenants', body)
}

export function createTenantMembership(body: { readonly tenantId: string; readonly subjectType: 'user' | 'group' | 'external_group'; readonly subjectId: string; readonly membershipType: 'owner' | 'admin' }): Promise<ApiResult<{ readonly membership: ApiRecord }>> {
  return apiClient.post('/v1/tenant-memberships', body)
}

export function revokeTenantMembership(membershipId: string): Promise<ApiResult<{ readonly membership: ApiRecord }>> {
  return apiClient.request('/v1/tenant-memberships', { method: 'DELETE', body: { membershipId } })
}

export function updateTenantStatus(body: { readonly tenantId: string; readonly status: 'ACTIVE' | 'SUSPENDED' }): Promise<ApiResult<{ readonly tenant: ApiRecord }>> {
  return apiClient.request('/v1/tenants/status', { method: 'PATCH', body })
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

export function listBusinessPermissionDefinitions(): Promise<ApiResult<{ items: readonly ApiRecord[] }>> {
  return apiClient.get<{ items: readonly ApiRecord[] }>('/v1/security/business-permission-domains')
}

export function listBusinessPermissionGrants(query?: BusinessListQuery): Promise<ApiPageResult> {
  return listRecords('/api/v1/security/business-permission-grants', query)
}

export function createBusinessPermissionGrant(body: Record<string, unknown>): Promise<ApiResult<ApiRecord>> {
  return apiClient.post<ApiRecord>('/v1/security/business-permission-grants', body)
}

export function revokeBusinessPermissionGrant(id: string, version?: number): Promise<ApiResult<{ id: string; revoked: true; version: number }>> {
  return apiClient.request<{ id: string; revoked: true; version: number }>('/v1/security/business-permission-grants', {
    method: 'DELETE',
    body: { id, version }
  })
}

export function resolveBusinessPermissionCapabilities(body: Record<string, unknown>): Promise<ApiResult<ApiRecord>> {
  return apiClient.post<ApiRecord>('/v1/security/business-permission-capabilities', body)
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
