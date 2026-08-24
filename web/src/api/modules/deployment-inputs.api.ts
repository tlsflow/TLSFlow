import { apiClient } from '@/api/client'
import { toClientPath } from './common'
import type { DeploymentInputProjectionV1 } from '@/design-system/components/DeploymentInputForm.types'

const DEPLOYMENT_INPUT_PROJECTION_PATH = '/api/v1/deployment-inputs/projection'

export function projectDeploymentInputs(applicationAssetId: string) {
  return apiClient.post<DeploymentInputProjectionV1>(toClientPath(DEPLOYMENT_INPUT_PROJECTION_PATH), {
    applicationAssetId,
  })
}
