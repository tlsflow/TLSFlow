import { defineStore } from 'pinia'
import { getSystemHealth, type DeploymentArchitecture } from '@/api/modules/system.api'

export type SystemFeature = 'browser.runtime'

interface SystemCapabilitiesState {
  deploymentArchitecture: DeploymentArchitecture | null
  browserRuntime: boolean
  loadedAt: string | null
  loading: boolean
}

export const useSystemCapabilitiesStore = defineStore('system-capabilities', {
  state: (): SystemCapabilitiesState => ({
    deploymentArchitecture: null,
    browserRuntime: false,
    loadedAt: null,
    loading: false
  }),
  getters: {
    isLoaded: (state) => Boolean(state.loadedAt),
    hasFeature: (state) => (feature: SystemFeature): boolean => {
      if (feature === 'browser.runtime') return state.browserRuntime
      return false
    }
  },
  actions: {
    async load(force = false): Promise<void> {
      if (this.loading || (this.loadedAt && !force)) return
      this.loading = true
      try {
        const result = await getSystemHealth()
        const health = result.data
        this.deploymentArchitecture = health?.deploymentArchitecture ?? null
        this.browserRuntime = health?.features.browserRuntime === true
        this.loadedAt = new Date().toISOString()
      } catch (error) {
        // 功能发现失败时保持 fail closed，普通功能仍可继续使用。
        this.deploymentArchitecture = null
        this.browserRuntime = false
        this.loadedAt = new Date().toISOString()
        throw error
      } finally {
        this.loading = false
      }
    }
  }
})
