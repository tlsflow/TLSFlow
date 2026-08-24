import { defineStore } from 'pinia'
import { statusDictionary } from '@/design-system/status/status-map'
import { riskDictionary } from '@/design-system/status/risk-map'

export const useDictionaryStore = defineStore('dictionary', {
  state: () => ({
    statusDictionary,
    riskDictionary,
    loadedAt: new Date().toISOString()
  })
})
