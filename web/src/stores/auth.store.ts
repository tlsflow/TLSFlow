import { defineStore } from 'pinia'
import { getAuthProvider, type AuthSession } from '@/providers/auth.provider'

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
    setSession(session: AuthSession): void {
      this.token = session.token
      this.user = session.user
    },
    async bootstrapSession(): Promise<void> {
      const session = await getAuthProvider().bootstrapSession()
      if (session) {
        this.setSession(session)
      }
    },
    clearSession(): void {
      this.token = null
      this.user = null
    }
  }
})
