import type { RouteRecordRaw } from 'vue-router'

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface GcRouteMeta {
  readonly title: string
  readonly titleKey?: string
  readonly module: string
  readonly requiresAuth?: boolean
  readonly permission?: string
  readonly resourceType?: string
  readonly riskLevel?: RiskLevel
  readonly breadcrumb?: readonly string[]
  readonly breadcrumbKeys?: readonly string[]
  readonly keepAlive?: boolean
  readonly featureFlag?: string
  readonly hiddenInMenu?: boolean
}

export type GcRouteRecord = RouteRecordRaw & {
  readonly meta: GcRouteMeta
  readonly children?: readonly GcRouteRecord[]
}

export interface MenuItem {
  readonly title?: string
  readonly titleKey?: string
  readonly path: string
  readonly module: string
  readonly permission?: string
  readonly permissions?: readonly string[]
  readonly activePaths?: readonly string[]
  readonly icon?: string
  readonly description?: string
  readonly descriptionKey?: string
  readonly children?: readonly MenuItem[]
}
