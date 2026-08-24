import type { ApiPageResult, ApiRecord } from '@/api/modules/common'
import type { RiskCode } from '@/design-system/status/risk-map'

export interface BusinessPageColumn {
  readonly key: string
  readonly title: string
  readonly candidates: readonly string[]
  readonly kind?: 'text' | 'status' | 'risk' | 'date' | 'count'
}

export interface BusinessMetricCard {
  readonly title: string
  readonly description: string
  readonly status: string
  readonly risk: RiskCode
}

export interface BusinessAction {
  readonly label: string
  readonly permission: string
  readonly danger?: boolean
  readonly confirmText?: string
  readonly riskText?: string
  readonly requiresSelection?: boolean
  readonly run?: (row?: import('@/composables/useBusinessPage').ViewRow) => Promise<unknown>
}

export interface BusinessDetailField {
  readonly label: string
  readonly candidates: readonly string[]
}

export interface BusinessContextLink {
  readonly label: string
  readonly to: string
  readonly queryKey: string
  readonly candidates: readonly string[]
}

export interface BusinessPageConfig {
  readonly title: string
  readonly description: string
  readonly readPermission: string
  readonly primaryPermission: string
  readonly primaryActionLabel: string
  readonly moduleName: string
  readonly resourceName: string
  readonly defaultStatus: string
  readonly defaultRisk: RiskCode
  readonly columns: readonly BusinessPageColumn[]
  readonly metrics: readonly BusinessMetricCard[]
  readonly emptyTitle: string
  readonly emptyDescription: string
  readonly load: () => Promise<ApiPageResult>
  readonly actions: readonly BusinessAction[]
  readonly detailFields?: readonly BusinessDetailField[]
  readonly contextLinks?: readonly BusinessContextLink[]
  readonly mockRows?: readonly ApiRecord[]
  readonly onSelectionChange?: (row: import('@/composables/useBusinessPage').ViewRow | null) => void
}
