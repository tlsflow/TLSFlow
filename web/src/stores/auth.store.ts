import { defineStore } from 'pinia'
import { getAuthProvider, type AuthSession, type LoginCredentials } from '@/providers/auth.provider'

const STORAGE_KEY = 'gcac.auth.session'

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

function loadStoredSession(): AuthState {
  if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') return { token: null, user: null }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { token: null, user: null }
    const parsed = JSON.parse(raw) as AuthState
    return { token: parsed.token ?? null, user: parsed.user ?? null }
  } catch {
    return { token: null, user: null }
  }
}

function persistSession(state: AuthState): void {
  if (typeof localStorage === 'undefined' || typeof localStorage.setItem !== 'function' || typeof localStorage.removeItem !== 'function') return
  if (!state.token || !state.user) {
    localStorage.removeItem(STORAGE_KEY)
    return
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: state.token, user: state.user }))
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => loadStoredSession(),
  getters: {
    isAuthenticated: (state) => Boolean(state.token && state.user)
  },
  actions: {
    setSession(session: AuthSession): void {
      this.token = session.token
      this.user = session.user
      persistSession({ token: this.token, user: this.user })
    },
    async login(credentials: LoginCredentials): Promise<AuthSession> {
      const session = await getAuthProvider().login(credentials)
      this.setSession(session)
      return session
    },
    async bootstrapSession(): Promise<void> {
      const session = await getAuthProvider().bootstrapSession(this.token)
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
      this.token = null
      this.user = null
      persistSession({ token: null, user: null })
    }
  }
})
