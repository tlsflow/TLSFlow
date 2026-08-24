import { apiClient } from '@/api/client'
import { toClientPath } from './common'

export type DeploymentArchitecture = 'small' | 'standard'

export interface SystemHealth {
  readonly status: 'OK' | 'DEGRADED'
  readonly service: string
  readonly version: string
  readonly timestamp: string
  readonly deploymentArchitecture: DeploymentArchitecture
  readonly features: {
    readonly browserRuntime: boolean
  }
}

export function getSystemHealth() {
  return apiClient.get<SystemHealth>(toClientPath('/api/v1/health'))
}
