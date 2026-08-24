import { defineStore } from 'pinia'
import { getSystemInitializationStatus, type SystemInitializationStatus } from '@/api/modules/system-initialization.api'

interface SystemInitializationState {
  loaded: boolean
  status: SystemInitializationStatus | 'unknown'
  initialized: boolean
}

export const useSystemInitializationStore = defineStore('system-initialization', {
  state: (): SystemInitializationState => ({ loaded: false, status: 'unknown', initialized: false }),
  getters: {
    isPending: (state) => state.status === 'pending' || state.status === 'initializing'
  },
  actions: {
    async loadStatus(force = false): Promise<void> {
      if (this.loaded && !force) return
      try {
        const result = await getSystemInitializationStatus()
        if (!result.data) throw new Error('SYSTEM_INITIALIZATION_STATUS_EMPTY')
        this.status = result.data.status
        this.initialized = result.data.initialized
        this.loaded = true
      } catch {
        // 状态接口不可用时不阻断登录页；向导页面会显示可重试错误。
        this.status = 'unknown'
        this.initialized = false
        this.loaded = true
      }
    },
    markInitialized(): void {
      this.loaded = true
      this.status = 'initialized'
      this.initialized = true
    }
  }
})
