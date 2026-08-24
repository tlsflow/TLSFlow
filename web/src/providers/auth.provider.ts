import type { CurrentUser } from '@/stores/auth.store'

export interface AuthSession {
  readonly token: string
  readonly user: CurrentUser
}

export interface AuthProvider {
  bootstrapSession(): Promise<AuthSession | null>
}

export class MockAuthProvider implements AuthProvider {
  async bootstrapSession(): Promise<AuthSession> {
    // 中文说明：mock 只留在 Provider 适配层，路由守卫和 Store 不直接知道 mock 细节。
    return {
      token: 'mock-token-for-frontend-skeleton',
      user: {
        id: 'mock-user',
        displayName: '前端骨架用户',
        tenantId: 'default',
        tenantName: '默认租户',
        roles: ['admin']
      }
    }
  }
}

let authProvider: AuthProvider = new MockAuthProvider()

export function getAuthProvider(): AuthProvider {
  return authProvider
}

export function setAuthProvider(provider: AuthProvider): void {
  authProvider = provider
}

export function resetAuthProvider(): void {
  authProvider = new MockAuthProvider()
}
