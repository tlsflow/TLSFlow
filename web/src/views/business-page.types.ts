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
  readonly hidden?: (row: import('@/composables/useBusinessPage').ViewRow | null) => boolean
  readonly disabledReason?: (row: import('@/composables/useBusinessPage').ViewRow | null) => string
  readonly run?: (row?: import('@/composables/useBusinessPage').ViewRow) => Promise<unknown>
}

export interface BusinessRowAction {
  readonly label: string
  readonly permission: string
  readonly danger?: boolean
  readonly confirmText?: string
  readonly riskText?: string
  readonly reloadAfterRun?: boolean
  readonly hidden?: (row: import('@/composables/useBusinessPage').ViewRow) => boolean
  readonly disabledReason?: (row: import('@/composables/useBusinessPage').ViewRow) => string
  readonly run?: (row: import('@/composables/useBusinessPage').ViewRow) => Promise<unknown>
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

export interface BusinessFilterField {
  readonly key: string
  readonly label: string
  readonly placeholder?: string
  readonly type?: 'text' | 'select'
  readonly options?: readonly { readonly label: string; readonly value: string }[]
}

export interface BusinessPageConfig {
  readonly title: string
  readonly description: string
  readonly showHeader?: boolean
  readonly showMetrics?: boolean
  readonly showEmptyState?: boolean
  readonly readPermission: string
  readonly primaryPermission: string
  readonly primaryActionLabel: string
  readonly primaryAction?: () => Promise<unknown> | unknown
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
  readonly rowActions?: readonly BusinessRowAction[]
  readonly detailFields?: readonly BusinessDetailField[]
  readonly contextLinks?: readonly BusinessContextLink[]
  readonly filters?: readonly BusinessFilterField[]
  readonly filterValues?: Record<string, string>
  readonly onFiltersChange?: (filters: Record<string, string>) => void
  readonly mockRows?: readonly ApiRecord[]
  readonly onSelectionChange?: (row: import('@/composables/useBusinessPage').ViewRow | null) => void
  readonly showDetailPanel?: boolean
  readonly showActionPanel?: boolean
}
