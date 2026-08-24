import { defineStore } from 'pinia'
import { getAuthProvider, type AuthSession, type LoginCredentials } from '@/providers/auth.provider'

export interface CurrentUser {
  readonly id: string
  readonly username?: string
  readonly displayName: string
  readonly tenantId: string
  readonly tenantName: string
  readonly roles: readonly string[]
}

interface AuthState {
  user: CurrentUser | null
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({ user: null }),
  getters: {
    isAuthenticated: (state) => Boolean(state.user)
  },
  actions: {
    setSession(session: AuthSession): void {
      this.user = session.user
    },
    async login(credentials: LoginCredentials): Promise<AuthSession> {
      const session = await getAuthProvider().login(credentials)
      this.setSession(session)
      return session
    },
    async bootstrapSession(): Promise<void> {
      const session = await getAuthProvider().bootstrapSession()
      if (session) this.setSession(session)
      else this.clearSession()
    },
    async logout(): Promise<void> {
      try {
        await getAuthProvider().logout()
      } finally {
        this.clearSession()
      }
    },
    clearSession(): void {
      this.user = null
    }
  }
})
