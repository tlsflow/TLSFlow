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

const SESSION_TOKEN_KEY = 'gcac.auth.session-token'

function readSessionToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage.getItem(SESSION_TOKEN_KEY)
  } catch {
    return null
  }
}

function writeSessionToken(token: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (token) window.sessionStorage.setItem(SESSION_TOKEN_KEY, token)
    else window.sessionStorage.removeItem(SESSION_TOKEN_KEY)
  } catch {
    // 中文说明：存储不可用时仍依赖 HttpOnly Cookie 恢复登录态。
  }
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({ token: readSessionToken(), user: null }),
  getters: {
    isAuthenticated: (state) => Boolean(state.user)
  },
  actions: {
    setSession(session: AuthSession): void {
      // 中文说明：Cookie 恢复的会话不返回 Bearer token，不能覆盖已有的会话级 token。
      this.token = session.token !== undefined ? (session.token ?? null) : this.token
      this.user = session.user
      writeSessionToken(this.token)
    },
    setToken(token: string | null): void {
      this.token = token
      writeSessionToken(token)
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
      writeSessionToken(null)
    }
  }
})
