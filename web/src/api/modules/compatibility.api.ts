import { apiClient } from '@/api/client'

export interface CompatibilityCatalogItem {
  profileId: string
  version: string
  declaredStatus: string
  effectiveStatus: string
  evidenceStatus: 'current' | 'expired' | 'failed'
  automation: string
  limitations: string[]
  lastVerifiedAt?: string
  reasonCodes: string[]
  baselineRef?: string
  recipeRefs?: string[]
  certificationRefs?: string[]
}

export interface CompatibilityCatalogResponse {
  schemaVersion: string
  generatedAt: string
  items: CompatibilityCatalogItem[]
}

export function listCompatibilityCatalog() {
  return apiClient.get<CompatibilityCatalogResponse>('/v1/compatibility/catalog')
}
