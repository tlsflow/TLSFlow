import { defineStore } from 'pinia'

interface AppState {
  theme: 'light' | 'dark'
  globalLoading: boolean
}

export const useAppStore = defineStore('app', {
  state: (): AppState => ({
    theme: 'light',
    globalLoading: false
  }),
  actions: {
    setGlobalLoading(loading: boolean): void {
      this.globalLoading = loading
    }
  }
})
