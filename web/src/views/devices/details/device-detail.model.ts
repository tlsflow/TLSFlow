import type { Component } from 'vue'

export type DeviceSiteKind = `${string}${'.' | '-'}${string}`
export const DEVICE_SITE_KIND_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/
export type DeviceDetailFieldValueType = 'TEXT' | 'STATUS' | 'DATETIME' | 'BOOLEAN' | 'NUMBER'

export interface DeviceDetailField {
  key: string
  value: string | number | boolean | null
  valueType: DeviceDetailFieldValueType
  copyable?: boolean
}

export interface DeviceDetailSection {
  key: string
  fields: readonly DeviceDetailField[]
}

export interface DeviceFrameworkView {
  id: string
  name: string
  type?: string
  version?: string
  status?: string
  metadata: Readonly<Record<string, unknown>>
}

export interface DeviceBoundCertificateView {
  certificateAssetId?: string
  certificateVersionId?: string
  name?: string
  subject?: string
  issuer?: string
  notBefore?: string
  notAfter?: string
  fingerprintSha256?: string
  status?: string
}

export interface DeviceSiteBindingView {
  id: string
  bindingKey: string
  bindingType: string
  hostName?: string
  status: string
  certificate?: DeviceBoundCertificateView
  replacement: {
    allowed: boolean
    managedTargetId?: string
    reasonCode?: string
  }
}

export interface DeviceSiteView {
  id: string
  siteAssetId: string
  frameworkInstanceId?: string
  managedTargetId?: string
  kind: DeviceSiteKind
  frameworkType: string
  name: string
  status?: string
  endpoint?: {
    address?: string
    hostName?: string
    port?: number
    protocol?: string
  }
  configPath?: string
  presentation?: {
    groupKey: string
    groupLabelKey: string
    typeLabelKey: string
    groupLabel?: string
    typeLabel?: string
  }
  bindings: readonly DeviceSiteBindingView[]
  metadata: Readonly<Record<string, unknown>>
}

export interface DeviceCertificateView extends DeviceBoundCertificateView {
  id: string
}

export interface DeviceCertificateSelection {
  certificate: DeviceBoundCertificateView
  site?: DeviceSiteView
  binding?: DeviceSiteBindingView
}

export interface DeviceLogView {
  id: string
  eventType: string
  result?: string
  summary?: string
  occurredAt: string
  actorId?: string
  metadata: Readonly<Record<string, unknown>>
}

export interface DeviceDetailContext {
  detail: Readonly<Record<string, unknown>>
  overviewSections: readonly DeviceDetailSection[]
  frameworks: readonly DeviceFrameworkView[]
  sites: readonly DeviceSiteView[]
  certificates: readonly DeviceCertificateView[]
  logs: readonly DeviceLogView[]
  resourceCounts: Readonly<Record<'frameworks' | 'sites' | 'certificates' | 'logs', number>>
  permissions: ReadonlySet<string>
}

export interface DeviceDetailAdapter {
  key: string
  priority?: number
  supports(detail: Readonly<Record<string, unknown>>): boolean
  buildContext(detail: Readonly<Record<string, unknown>>): DeviceDetailContext
}

export interface DeviceDetailTabDescriptor {
  key: string
  labelKey: string
  label?: string
  order: number
  component: Component
  isVisible(context: DeviceDetailContext): boolean
  buildProps?(context: DeviceDetailContext): Record<string, unknown>
}

export interface DeviceDetailTabProvider {
  key: string
  supports(context: DeviceDetailContext): boolean
  getTabs(context: DeviceDetailContext): readonly DeviceDetailTabDescriptor[]
}
