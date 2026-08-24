import { apiClient } from '@/api/client'
import { toClientPath } from './common'
import type { DeploymentInputProjectionV1 } from '@/design-system/components/DeploymentInputForm.types'

const DEPLOYMENT_INPUT_PROJECTION_PATH = '/api/v1/deployment-inputs/projection'
const MANAGED_TARGET_PLUGIN_INPUT_PROJECTION_PATH = '/api/v1/managed-targets'

export function projectDeploymentInputs(applicationAssetId: string) {
  return apiClient.post<DeploymentInputProjectionV1>(toClientPath(DEPLOYMENT_INPUT_PROJECTION_PATH), {
    applicationAssetId,
  })
}

export function projectApplicationAssetPluginInputs(managedTargetId: string, payload: {
  capabilityKey?: string
  pluginVersionId?: string
  certificateFormatId?: string
  applicationAsset: {
    id: string
    address: string
    sniName?: string
    port: number
    protocol: string
    displayName?: string
  }
  inputBindings?: unknown
}) {
  return apiClient.post<DeploymentInputProjectionV1>(
    toClientPath(`${MANAGED_TARGET_PLUGIN_INPUT_PROJECTION_PATH}/${encodeURIComponent(managedTargetId)}/deployment-input-projection`),
    payload,
  )
}
