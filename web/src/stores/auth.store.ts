import { defineStore } from 'pinia'

export interface CurrentUser {
  readonly id: string
  readonly displayName: string
  readonly tenantId: string
  readonly tenantName: string
  readonly roles: readonly string[]
}

interface AuthState {
  token: string | null
  user: CurrentUser | null
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    token: null,
    user: null
  }),
  getters: {
    isAuthenticated: (state) => Boolean(state.token && state.user)
  },
  actions: {
    async bootstrapMockSession(): Promise<void> {
      // 中文说明：004 只搭工程骨架，真实登录和 Token 刷新由 005/后端认证 Spec 接入。
      this.token = 'mock-token-for-frontend-skeleton'
      this.user = {
        id: 'mock-user',
        displayName: '前端骨架用户',
        tenantId: 'default',
        tenantName: '默认租户',
        roles: ['admin']
      }
    },
    clearSession(): void {
      this.token = null
      this.user = null
    }
  }
})
