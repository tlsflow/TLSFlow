import { apiClient } from '@/api/client'
import type { ApiResult } from '@/api/generated/client-types'
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

export function getCurrentUser(): Promise<ApiResult<CurrentUserResponse>> {
  return apiClient.get<CurrentUserResponse>('/v1/auth/me')
}

export function getCurrentPermissions(): Promise<ApiResult<{ permissions: readonly string[] }>> {
  return apiClient.get<{ permissions: readonly string[] }>('/v1/auth/permissions')
}

export function listUsers(query?: BusinessListQuery): Promise<ApiPageResult> {
  return listRecords('/api/v1/security/users', query)
}

export function createUser(body: Record<string, unknown>): Promise<ApiResult<ApiRecord>> {
  return apiClient.post<ApiRecord>('/v1/security/users', body)
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

export function listPermissionPolicies(query?: BusinessListQuery): Promise<ApiPageResult> {
  return apiClient.get(buildListPath('/api/v1/security/permission-policies', query))
}

export function createPermissionPolicy(body: Record<string, unknown>): Promise<ApiResult<ApiRecord>> {
  return apiClient.post<ApiRecord>(toClientPath('/api/v1/security/permission-policies'), body)
}

export function listIdentitySources(query?: BusinessListQuery): Promise<ApiPageResult> {
  return listRecords('/api/v1/security/identity-sources', query)
}

export function createIdentitySource(body: Record<string, unknown>): Promise<ApiResult<ApiRecord>> {
  return apiClient.post<ApiRecord>('/v1/security/identity-sources', body)
}

export function testIdentitySource(sourceId: string): Promise<ApiResult<{ ok: boolean; message: string }>> {
  return apiClient.post<{ ok: boolean; message: string }>('/v1/security/identity-sources/test', { sourceId })
}

export function listGroupRoleMappings(query?: BusinessListQuery): Promise<ApiPageResult> {
  return listRecords('/api/v1/security/group-role-mappings', query)
}

export function createGroupRoleMapping(body: Record<string, unknown>): Promise<ApiResult<ApiRecord>> {
  return apiClient.post<ApiRecord>('/v1/security/group-role-mappings', body)
}
