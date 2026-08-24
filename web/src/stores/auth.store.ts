import { defineStore } from 'pinia'
import { getAuthProvider, type AuthSession, type LoginCredentials } from '@/providers/auth.provider'
import { getCurrentUser } from '@/api/modules/security.api'
import { useAppStore } from './app.store'

export interface CurrentUser {
  readonly id: string
  readonly username?: string
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
  state: (): AuthState => ({ token: null, user: null }),
  getters: {
    isAuthenticated: (state) => Boolean(state.user)
  },
  actions: {
    setSession(session: AuthSession): void {
      this.token = session.token ?? null
      this.user = session.user
    },
    setToken(token: string | null): void {
      this.token = token
    },
    async refreshCurrentUser(): Promise<void> {
      const result = await getCurrentUser()
      if (!result.data) throw new Error('AUTH_CONTEXT_EMPTY')
      this.user = {
        id: result.data.user.id,
        username: result.data.user.username,
        displayName: result.data.user.displayName,
        tenantId: result.data.user.tenantId,
        tenantName: result.data.user.tenantName,
        roles: result.data.user.roles.map((role) => role.code),
      }
    },
    async login(credentials: LoginCredentials): Promise<AuthSession> {
      const session = await getAuthProvider().login(credentials)
      this.setSession(session)
      await useAppStore().loadPreferencesFromBackend()
      return session
    },
    async bootstrapSession(): Promise<void> {
      const session = await getAuthProvider().bootstrapSession()
      if (session) {
        this.setSession(session)
        await useAppStore().loadPreferencesFromBackend()
      } else {
        this.clearSession()
      }
    },
    async logout(): Promise<void> {
      try {
        await getAuthProvider().logout()
      } finally {
        this.clearSession()
      }
    },
    clearSession(): void {
      this.token = null
      this.user = null
    }
  }
})
