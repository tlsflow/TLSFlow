import type { CurrentUser } from '@/stores/auth.store'
import { ApiClientError } from '@/api/client'
import { getCurrentUser, login as loginApi, logout as logoutApi, type AuthUser } from '@/api/modules/security.api'

export interface AuthSession {
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
    if (!result.data) throw new Error('登录接口没有返回会话')
    return {
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
      user: {
        id: 'mock-user',
        username: 'mock',
        displayName: '前端骨架用户',
        tenantId: 'default',
        tenantName: '默认租户',
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
