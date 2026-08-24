import type { CurrentUser } from '@/stores/auth.store'
import { ApiClientError } from '@/api/client'
import { getCurrentUser, login as loginApi, logout as logoutApi, type AuthUser } from '@/api/modules/security.api'
import { i18n } from '@/i18n'

export interface AuthSession {
  /** 中文说明：Bearer token 仅用于当前页面会话；刷新页面优先由 HttpOnly Cookie 恢复。 */
  readonly token?: string | null
  readonly user: CurrentUser
  readonly permissions?: readonly string[]
}

export interface LoginCredentials {
  readonly username: string
  readonly password: string
}

export interface AuthProvider {
  bootstrapSession(): Promise<AuthSession | null>
  login(credentials: LoginCredentials): Promise<AuthSession>
  logout(): Promise<void>
}

function toCurrentUser(user: AuthUser): CurrentUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    tenantId: user.tenantId,
    tenantName: user.tenantName,
    roles: user.roles.map((role) => role.code)
  }
}

export class ApiAuthProvider implements AuthProvider {
  async bootstrapSession(): Promise<AuthSession | null> {
    let result: Awaited<ReturnType<typeof getCurrentUser>>
    try {
      result = await getCurrentUser()
    } catch (cause) {
      // 中文说明：启动时探测当前登录态，未认证是正常的空会话，不应打断路由启动。
      if (cause instanceof ApiClientError && (cause.status === 401 || cause.errorCode === 'AUTH_UNAUTHENTICATED')) {
        return null
      }
      throw cause
    }
    if (!result.data) return null
    return {
      user: toCurrentUser(result.data.user),
      permissions: result.data.permissions
    }
  }

  async login(credentials: LoginCredentials): Promise<AuthSession> {
    const result = await loginApi(credentials)
    if (!result.data) throw new Error(i18n.global.t('auth.errors.missingSession'))
    return {
      token: result.data.token,
      user: toCurrentUser(result.data.user),
      permissions: result.data.permissions
    }
  }

  async logout(): Promise<void> {
    await logoutApi()
  }
}

export class MockAuthProvider implements AuthProvider {
  async bootstrapSession(): Promise<AuthSession> {
    // 中文说明：mock 只留给测试；真实运行默认使用 ApiAuthProvider。
    return {
      token: 'mock-token-for-frontend-skeleton',
      user: {
        id: 'mock-user',
        username: 'mock',
        displayName: i18n.global.t('auth.mock.displayName'),
        tenantId: 'default',
        tenantName: i18n.global.t('common.tenantFallback'),
        roles: ['admin']
      }
    }
  }

  async login(): Promise<AuthSession> {
    return this.bootstrapSession()
  }

  async logout(): Promise<void> {}
}

let authProvider: AuthProvider = new ApiAuthProvider()

export function getAuthProvider(): AuthProvider {
  return authProvider
}

export function setAuthProvider(provider: AuthProvider): void {
  authProvider = provider
}

export function resetAuthProvider(): void {
  authProvider = new ApiAuthProvider()
}

export function resetAuthProviderToMock(): void {
  authProvider = new MockAuthProvider()
}
