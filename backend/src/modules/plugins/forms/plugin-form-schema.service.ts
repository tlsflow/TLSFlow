import { AppError } from '../../../common/errors/app-error.js';
import type { UnifiedPluginCapabilityDescriptor } from '../dto/unified-plugins.dto.js';
import {
  pluginFieldTypes,
  type PluginFormConditionV1,
  type PluginFormFieldV1,
  type PluginFormSchemaV1,
} from './plugin-form.dto.js';
import { StandardPluginFieldRegistry } from './standard-plugin-field.registry.js';

export class PluginFormSchemaService {
  constructor(private readonly standardFields = new StandardPluginFieldRegistry()) {}

  validate(input: unknown, capabilities: UnifiedPluginCapabilityDescriptor[]): PluginFormSchemaV1 {
    const schema = record(input, 'form');
    if (schema.schemaVersion !== 'gcac.plugin-form/v1') fail('form.schemaVersion', '仅支持 gcac.plugin-form/v1');
    const mode = enumValue(schema.mode, ['MANAGED', 'STANDALONE', 'BOTH'] as const, 'form.mode');
    const sections = array(schema.sections, 'form.sections').map((item, sectionIndex) => {
      const section = record(item, `form.sections.${sectionIndex}`);
      return {
        id: text(section.id, `form.sections.${sectionIndex}.id`),
        titleKey: localeKey(section.titleKey, `form.sections.${sectionIndex}.titleKey`),
        descriptionKey: optionalLocaleKey(section.descriptionKey, `form.sections.${sectionIndex}.descriptionKey`),
        fields: array(section.fields, `form.sections.${sectionIndex}.fields`).map((field, fieldIndex) =>
          this.validateField(field, `form.sections.${sectionIndex}.fields.${fieldIndex}`, capabilities)),
      };
    });
    const allFields = sections.flatMap((section) => section.fields);
    const keys = allFields.map((field) => field.key);
    const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
    if (duplicates.length > 0) fail('form.sections', '字段 key 重复', { duplicates: [...new Set(duplicates)] });
    this.assertDependencyGraph(allFields);
    return { schemaVersion: 'gcac.plugin-form/v1', mode, sections };
  }

  private validateField(input: unknown, path: string, capabilities: UnifiedPluginCapabilityDescriptor[]): PluginFormFieldV1 {
    const item = record(input, path);
    const type = enumValue(item.type, pluginFieldTypes, `${path}.type`);
    const standardField = optionalText(item.standardField, `${path}.standardField`);
    const standard = standardField ? this.standardFields.require(standardField) : undefined;
    if (standard && standard.type !== type) fail(`${path}.type`, '标准字段类型不能被插件覆盖', { standardField, expectedType: standard.type });
    const sensitive = item.sensitive === undefined ? standard?.sensitive ?? false : booleanValue(item.sensitive, `${path}.sensitive`);
    if (standard?.sensitive && sensitive !== true) fail(`${path}.sensitive`, '标准 Secret 字段不能取消敏感标记', { standardField });
    if (type === 'password') fail(`${path}.type`, '插件不能直接接收明文密码，请使用 secret_ref');
    const acceptedCredentialKinds = optionalEnumArray(item.acceptedCredentialKinds, ['PASSWORD', 'USERNAME_PASSWORD', 'SSH_KEY', 'BEARER_TOKEN', 'API_KEY', 'CLIENT_CERTIFICATE', 'CLOUD_PROVIDER'] as const, `${path}.acceptedCredentialKinds`);
    const acceptedSecretTypes = optionalEnumArray(item.acceptedSecretTypes, ['password', 'api_token', 'ssh_key', 'private_key', 'certificate_private_key', 'ca_certificate'] as const, `${path}.acceptedSecretTypes`);
    const acceptedScopes = optionalEnumArray(item.acceptedScopes, ['global', 'team', 'zone', 'host', 'plugin'] as const, `${path}.acceptedScopes`);
    const purpose = optionalText(item.purpose, `${path}.purpose`);
    if (type === 'credential_ref' && (!acceptedCredentialKinds || acceptedCredentialKinds.length === 0)) fail(`${path}.acceptedCredentialKinds`, 'credential_ref 必须声明可接受的凭据类型');
    if (type === 'credential_ref' && !purpose) fail(`${path}.purpose`, 'credential_ref 必须声明用途');
    if (type !== 'credential_ref' && acceptedCredentialKinds) fail(`${path}.acceptedCredentialKinds`, '只有 credential_ref 可以声明凭据类型');
    if (type !== 'secret_ref' && acceptedSecretTypes) fail(`${path}.acceptedSecretTypes`, '只有 secret_ref 可以声明 Secret 类型');
    const optionProviderAction = optionalText(item.optionProviderAction, `${path}.optionProviderAction`);
    if (optionProviderAction) {
      const capability = capabilities.find((candidate) => candidate.actionContractId === optionProviderAction);
      if (!capability || capability.riskLevel !== 'LOW') {
        fail(`${path}.optionProviderAction`, '动态选项只能调用已声明的低风险只读 Action', { optionProviderAction });
      }
    }
    return {
      key: text(item.key, `${path}.key`),
      type,
      labelKey: standard?.labelKey ?? localeKey(item.labelKey, `${path}.labelKey`),
      descriptionKey: standard?.descriptionKey ?? optionalLocaleKey(item.descriptionKey, `${path}.descriptionKey`),
      placeholderKey: standard?.placeholderKey ?? optionalLocaleKey(item.placeholderKey, `${path}.placeholderKey`),
      required: item.required === undefined ? standard?.required : booleanValue(item.required, `${path}.required`),
      standardField,
      validation: standard?.validation ?? optionalRecord(item.validation, `${path}.validation`),
      visibleWhen: optionalCondition(item.visibleWhen, `${path}.visibleWhen`),
      enabledWhen: optionalCondition(item.enabledWhen, `${path}.enabledWhen`),
      options: item.options === undefined ? undefined : array(item.options, `${path}.options`).map((option, index) => {
        const value = record(option, `${path}.options.${index}`);
        return {
          value: text(value.value, `${path}.options.${index}.value`),
          labelKey: localeKey(value.labelKey, `${path}.options.${index}.labelKey`),
          disabled: value.disabled === undefined ? undefined : booleanValue(value.disabled, `${path}.options.${index}.disabled`),
        };
      }),
      optionProviderAction,
      acceptedCredentialKinds,
      acceptedSecretTypes,
      acceptedScopes,
      purpose,
      sensitive,
      defaultValue: standard?.defaultValue ?? item.defaultValue,
    };
  }

  private assertDependencyGraph(fields: PluginFormFieldV1[]): void {
    const known = new Set(fields.map((field) => field.key));
    const graph = new Map(fields.map((field) => [field.key, [field.visibleWhen?.field, field.enabledWhen?.field].filter(Boolean) as string[]]));
    for (const [field, dependencies] of graph) {
      const unknown = dependencies.filter((dependency) => !known.has(dependency));
      if (unknown.length > 0) fail(`form.fields.${field}`, '表单条件引用未知字段', { unknown });
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (key: string): void => {
      if (visiting.has(key)) fail('form.sections', '表单字段依赖存在循环', { key });
      if (visited.has(key)) return;
      visiting.add(key);
      for (const dependency of graph.get(key) ?? []) visit(dependency);
      visiting.delete(key);
      visited.add(key);
    };
    for (const key of graph.keys()) visit(key);
  }
}

function optionalCondition(input: unknown, path: string): PluginFormConditionV1 | undefined {
  if (input === undefined) return undefined;
  const item = record(input, path);
  return {
    field: text(item.field, `${path}.field`),
    operator: enumValue(item.operator, ['equals', 'not_equals', 'in', 'not_in', 'truthy', 'falsy'] as const, `${path}.operator`),
    value: item.value,
  };
}

function record(input: unknown, path: string): Record<string, unknown> { if (!input || typeof input !== 'object' || Array.isArray(input)) fail(path, '必须是对象'); return input as Record<string, unknown>; }
function optionalRecord(input: unknown, path: string): Record<string, unknown> | undefined { return input === undefined ? undefined : record(input, path); }
function array(input: unknown, path: string): unknown[] { if (!Array.isArray(input)) fail(path, '必须是数组'); return input; }
function text(input: unknown, path: string): string { if (typeof input !== 'string' || !input.trim()) fail(path, '必须是非空字符串'); return input.trim(); }
function optionalText(input: unknown, path: string): string | undefined { return input === undefined ? undefined : text(input, path); }
function localeKey(input: unknown, path: string): string { const value = text(input, path); if (!/^[a-zA-Z0-9_.-]+$/.test(value)) fail(path, '必须是合法 i18n key'); return value; }
function optionalLocaleKey(input: unknown, path: string): string | undefined { return input === undefined ? undefined : localeKey(input, path); }
function booleanValue(input: unknown, path: string): boolean { if (typeof input !== 'boolean') fail(path, '必须是布尔值'); return input; }
function enumValue<T extends string>(input: unknown, values: readonly T[], path: string): T { if (typeof input !== 'string' || !values.includes(input as T)) fail(path, `必须是 ${values.join('、')} 之一`); return input as T; }
function optionalEnumArray<T extends string>(input: unknown, values: readonly T[], path: string): T[] | undefined { return input === undefined ? undefined : array(input, path).map((value, index) => enumValue(value, values, `${path}.${index}`)); }
function fail(path: string, message: string, details: Record<string, unknown> = {}): never { throw new AppError('VALIDATION_FAILED', `插件表单 Schema 无效：${message}`, { code: 'PLUGIN_FORM_SCHEMA_INVALID', path, ...details }); }
