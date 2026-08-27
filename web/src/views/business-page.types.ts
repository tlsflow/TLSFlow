import type { ApiPageResult, ApiRecord } from '@/api/modules/common'
import type { RiskCode } from '@/design-system/status/risk-map'

export interface BusinessPageColumn {
  readonly key: string
  readonly title: string
  readonly candidates: readonly string[]
  readonly kind?: 'text' | 'status' | 'risk' | 'date' | 'count'
  readonly width?: string
  readonly truncate?: boolean
  readonly format?: (record: ApiRecord) => string
}

export interface BusinessMetricCard {
  readonly title: string
  readonly description: string
  readonly status: string
  readonly risk: RiskCode
  readonly kind?: 'total' | 'filtered'
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

export interface BusinessPageQuery {
  readonly page: number
  readonly pageSize: number
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
  /** 可选的列表标题；未提供时沿用“{resource} list”。 */
  readonly resourceListLabel?: string
  readonly defaultStatus: string
  readonly defaultRisk: RiskCode
  readonly columns: readonly BusinessPageColumn[]
  readonly metrics: readonly BusinessMetricCard[]
  readonly emptyTitle: string
  readonly emptyDescription: string
  readonly load: (query: BusinessPageQuery) => Promise<ApiPageResult>
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
  readonly tableFixed?: boolean
  /** 将列表总数从工具栏移至表格页脚。 */
  readonly showTotalInPagination?: boolean
  /** 数据源不支持服务端分页时，在客户端对整页数据进行切片分页。 */
  readonly clientSidePagination?: boolean
}
