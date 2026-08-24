export type PluginFieldType =
  | 'text' | 'textarea' | 'integer' | 'decimal' | 'password' | 'secret_ref' | 'radio' | 'checkbox'
  | 'checkbox_group' | 'select' | 'multi_select' | 'switch' | 'date' | 'time' | 'datetime'
  | 'key_value' | 'object_list' | 'file_ref' | 'certificate_ref' | 'readonly_text' | 'notice' | 'divider'

export interface PluginFormCondition {
  field: string
  operator: 'equals' | 'not_equals' | 'in' | 'not_in' | 'truthy' | 'falsy'
  value?: unknown
}

export interface PluginFormField {
  key: string
  type: PluginFieldType
  labelKey: string
  descriptionKey?: string
  placeholderKey?: string
  required?: boolean
  standardField?: string
  validation?: Record<string, unknown>
  visibleWhen?: PluginFormCondition
  enabledWhen?: PluginFormCondition
  options?: Array<{ value: string; labelKey: string; disabled?: boolean }>
  optionProviderAction?: string
  sensitive?: boolean
  defaultValue?: unknown
}

export interface PluginFormSchema {
  schemaVersion: 'gcac.plugin-form/v1'
  mode: 'MANAGED' | 'STANDALONE' | 'BOTH'
  sections: Array<{ id: string; titleKey: string; descriptionKey?: string; fields: PluginFormField[] }>
}

export interface DevicePresentationSchema {
  schemaVersion: 'gcac.device-presentation/v1'
  overview: Array<{
    id: string
    titleKey: string
    fields: Array<{ key: string; labelKey: string; valuePath: string; type: string; sensitive?: boolean }>
  }>
  tabs: Array<{
    type: 'frameworks' | 'sites' | 'certificate_bindings' | 'device_logs' | 'records'
    id: string
    titleKey: string
    recordType?: string
    queryCapabilities?: string[]
    columns: Array<{ key: string; labelKey: string; valuePath: string; type: string }>
  }>
  actions: Array<{ capabilityKey: string; labelKey: string; tone?: 'success' | 'warning' | 'danger' | 'info' | 'muted' }>
}
