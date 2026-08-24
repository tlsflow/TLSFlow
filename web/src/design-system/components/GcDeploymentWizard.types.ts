import type { ApiRecord } from '@/api/modules/common'
import type { CapabilityMatrixItem } from './GcCapabilityMatrix.vue'

export interface DeploymentWizardPlan {
  readonly certificateId: string
  readonly certificateVersionId: string
  readonly certificateFormatId: string
  readonly targetIds: readonly string[]
  readonly applicationAssetId?: string
  readonly selectionMode: 'EXPLICIT' | 'LATEST_AUTO'
  readonly capabilityItems: readonly CapabilityMatrixItem[]
  readonly dryRunChecks: readonly ApiRecord[]
  readonly previewSummary?: string
  readonly dryRunSummary?: string
  readonly submitSummary?: string
}
