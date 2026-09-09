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

export type UpdateChannel = 'stable' | 'dev'
export type ReleaseRelation = 'current' | 'upgrade' | 'downgrade' | 'channel_switch'

export interface SystemUpdateSettings {
  readonly id: 'singleton'
  readonly channel: UpdateChannel
  readonly version: number
  readonly updatedBy?: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface SystemUpdateCheck {
  readonly channel: UpdateChannel
  readonly currentVersion: string
  readonly targetVersion: string
  readonly updateAvailable: boolean
  readonly relation: ReleaseRelation
  readonly publishedAt: string
  readonly releaseNotes: string
  readonly commands: {
    readonly installScript: string
    readonly compose: string
  }
  readonly checkedAt: string
}

export function getSystemUpdateSettings() {
  return apiClient.get<SystemUpdateSettings>(toClientPath('/api/v1/system/update-channel'))
}

export function updateSystemUpdateChannel(channel: UpdateChannel, version: number) {
  return apiClient.request<SystemUpdateSettings>(toClientPath('/api/v1/system/update-channel'), {
    method: 'PUT',
    body: { channel, version },
  })
}

export function checkSystemUpdate(channel?: UpdateChannel) {
  const query = channel ? `?channel=${encodeURIComponent(channel)}` : ''
  return apiClient.get<SystemUpdateCheck>(`${toClientPath('/api/v1/system/update-check')}${query}`)
}
