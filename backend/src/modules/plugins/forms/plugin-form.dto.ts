export const pluginFieldTypes = [
  'text', 'textarea', 'integer', 'decimal', 'password', 'secret_ref', 'credential_ref', 'radio', 'checkbox',
  'checkbox_group', 'select', 'multi_select', 'switch', 'date', 'time', 'datetime', 'key_value',
  'object_list', 'file_ref', 'certificate_ref', 'readonly_text', 'notice', 'divider',
] as const;

export type PluginFieldType = typeof pluginFieldTypes[number];

export interface PluginFormConditionV1 {
  field: string;
  operator: 'equals' | 'not_equals' | 'in' | 'not_in' | 'truthy' | 'falsy';
  value?: unknown;
}

export interface PluginFormOptionV1 {
  value: string;
  labelKey: string;
  disabled?: boolean;
}

export interface PluginFormFieldV1 {
  key: string;
  type: PluginFieldType;
  labelKey: string;
  descriptionKey?: string;
  placeholderKey?: string;
  required?: boolean;
  standardField?: string;
  validation?: Record<string, unknown>;
  visibleWhen?: PluginFormConditionV1;
  enabledWhen?: PluginFormConditionV1;
  options?: PluginFormOptionV1[];
  optionProviderAction?: string;
  acceptedCredentialKinds?: Array<'PASSWORD' | 'USERNAME_PASSWORD' | 'SSH_KEY' | 'BEARER_TOKEN' | 'API_KEY' | 'CLIENT_CERTIFICATE'>;
  acceptedSecretTypes?: Array<'password' | 'api_token' | 'ssh_key' | 'private_key' | 'certificate_private_key' | 'ca_certificate'>;
  acceptedScopes?: Array<'global' | 'team' | 'zone' | 'host' | 'plugin'>;
  purpose?: string;
  sensitive?: boolean;
  defaultValue?: unknown;
}

export interface PluginFormSectionV1 {
  id: string;
  titleKey: string;
  descriptionKey?: string;
  fields: PluginFormFieldV1[];
}

export interface PluginFormSchemaV1 {
  schemaVersion: 'gcac.plugin-form/v1';
  mode: 'MANAGED' | 'STANDALONE' | 'BOTH';
  sections: PluginFormSectionV1[];
}

export interface StandardPluginFieldDefinition {
  key: string;
  type: PluginFieldType;
  labelKey: string;
  descriptionKey?: string;
  placeholderKey?: string;
  required?: boolean;
  defaultValue?: unknown;
  validation?: Record<string, unknown>;
  sensitive: boolean;
  valueKind: 'PLAIN' | 'SECRET_REF' | 'CREDENTIAL_REF' | 'RESOURCE_REF';
  supportedModes: Array<'MANAGED' | 'STANDALONE'>;
}
