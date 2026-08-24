import { AppError } from '../../../common/errors/app-error.js';
import type { UnifiedPluginCapabilityDescriptor } from '../dto/unified-plugins.dto.js';
import type { PluginFormSchemaV1 } from '../forms/plugin-form.dto.js';
import { PluginFormSchemaService } from '../forms/plugin-form-schema.service.js';
import type { DevicePresentationSchemaV1, PresentationColumnV1, PresentationFieldV1 } from '../presentations/plugin-presentation.dto.js';
import { PluginPresentationSchemaService } from '../presentations/plugin-presentation-schema.service.js';

export interface CloudPluginFormResourceV1 {
  apiVersion: 'gcac.plugin-form/v1';
  pluginId: string;
  fields: Array<{ key: string; type: 'objectRef' | 'secretRef' | 'string' | 'artifactRef'; required: boolean }>;
}

export interface ApplicationPresentationResourceV1 {
  schemaVersion: 'gcac.application-presentation/v1';
  resourceLabels: { applicationType: string; profile: string };
  overview: Array<{ id: string; titleKey: string; fields: PresentationFieldV1[] }>;
  actions: PresentationActionV1[];
}

export interface CertificateBindingPresentationResourceV1 {
  schemaVersion: 'gcac.certificate-binding-presentation/v1';
  fields: PresentationFieldV1[];
  actions: PresentationActionV1[];
}

export interface CloudPresentationResourceV1 {
  apiVersion: 'gcac.plugin-presentation/v1';
  pluginId: string;
  standardObject: 'CloudResource';
  columns: string[];
  secretFields: string[];
}

export interface PresentationActionV1 {
  capabilityKey: string;
  labelKey: string;
  tone?: 'success' | 'warning' | 'danger' | 'info' | 'muted';
}

export type PluginPackageFormResource = PluginFormSchemaV1 | CloudPluginFormResourceV1;
export type PluginPackagePresentationResource = DevicePresentationSchemaV1
  | ApplicationPresentationResourceV1
  | CertificateBindingPresentationResourceV1
  | CloudPresentationResourceV1;

/**
 * P2 包允许的表单和展示资源必须按自己的版本合同验证。
 * 版本分派是显式的，未知版本直接拒绝，避免把不同资源误当成兼容格式。
 */
export class PluginPackageResourceSchemaService {
  constructor(
    private readonly forms = new PluginFormSchemaService(),
    private readonly presentations = new PluginPresentationSchemaService(),
  ) {}

  validateForm(
    input: unknown,
    pluginId: string,
    capabilities: UnifiedPluginCapabilityDescriptor[],
  ): PluginPackageFormResource {
    if (isRecord(input) && input.schemaVersion === 'gcac.plugin-form/v1') {
      return this.forms.validate(input, capabilities);
    }
    return validateCloudForm(input, pluginId);
  }

  validatePresentation(
    input: unknown,
    pluginId: string,
    capabilityKeys: string[],
  ): PluginPackagePresentationResource {
    if (isRecord(input) && input.schemaVersion === 'gcac.device-presentation/v1') {
      return this.presentations.validate(input, capabilityKeys);
    }
    if (isRecord(input) && input.schemaVersion === 'gcac.application-presentation/v1') {
      return validateApplicationPresentation(input, capabilityKeys);
    }
    if (isRecord(input) && input.schemaVersion === 'gcac.certificate-binding-presentation/v1') {
      return validateCertificateBindingPresentation(input, capabilityKeys);
    }
    return validateCloudPresentation(input, pluginId);
  }
}

function validateCloudForm(input: unknown, pluginId: string): CloudPluginFormResourceV1 {
  const value = record(input, 'form');
  if (value.apiVersion !== 'gcac.plugin-form/v1') fail('form.apiVersion', '不支持的 P2 表单资源版本');
  assertPluginId(value.pluginId, pluginId, 'form.pluginId');
  const fields = array(value.fields, 'form.fields').map((item, index) => {
    const field = record(item, `form.fields.${index}`);
    const type = enumValue(field.type, ['objectRef', 'secretRef', 'string', 'artifactRef'] as const, `form.fields.${index}.type`);
    return {
      key: identifier(field.key, `form.fields.${index}.key`),
      type,
      required: booleanValue(field.required, `form.fields.${index}.required`),
    };
  });
  if (fields.length === 0) fail('form.fields', 'P2 表单至少声明一个字段');
  assertUnique(fields.map((field) => field.key), 'form.fields');
  return { apiVersion: 'gcac.plugin-form/v1', pluginId, fields };
}

function validateApplicationPresentation(input: Record<string, unknown>, capabilityKeys: string[]): ApplicationPresentationResourceV1 {
  const labels = record(input.resourceLabels, 'presentation.resourceLabels');
  const resourceLabels = {
    applicationType: localeKey(labels.applicationType, 'presentation.resourceLabels.applicationType'),
    profile: localeKey(labels.profile, 'presentation.resourceLabels.profile'),
  };
  const overview = array(input.overview, 'presentation.overview').map((item, index) => {
    const group = record(item, `presentation.overview.${index}`);
    return {
      id: identifier(group.id, `presentation.overview.${index}.id`),
      titleKey: localeKey(group.titleKey, `presentation.overview.${index}.titleKey`),
      fields: array(group.fields, `presentation.overview.${index}.fields`).map((field, fieldIndex) =>
        presentationField(field, `presentation.overview.${index}.fields.${fieldIndex}`)),
    };
  });
  return {
    schemaVersion: 'gcac.application-presentation/v1',
    resourceLabels,
    overview,
    actions: validateActions(input.actions, capabilityKeys, 'presentation.actions'),
  };
}

function validateCertificateBindingPresentation(input: Record<string, unknown>, capabilityKeys: string[]): CertificateBindingPresentationResourceV1 {
  return {
    schemaVersion: 'gcac.certificate-binding-presentation/v1',
    fields: array(input.fields, 'presentation.fields').map((field, index) => presentationField(field, `presentation.fields.${index}`)),
    actions: validateActions(input.actions, capabilityKeys, 'presentation.actions'),
  };
}

function validateCloudPresentation(input: unknown, pluginId: string): CloudPresentationResourceV1 {
  const value = record(input, 'presentation');
  if (value.apiVersion !== 'gcac.plugin-presentation/v1') fail('presentation.apiVersion', '不支持的 P2 展示资源版本');
  assertPluginId(value.pluginId, pluginId, 'presentation.pluginId');
  if (value.standardObject !== 'CloudResource') fail('presentation.standardObject', 'Cloud 展示必须绑定 CloudResource 标准对象');
  const columns = stringArray(value.columns, 'presentation.columns');
  const secretFields = stringArray(value.secretFields, 'presentation.secretFields');
  if (columns.length === 0) fail('presentation.columns', 'Cloud 展示至少声明一个字段');
  assertUnique(columns, 'presentation.columns');
  assertUnique(secretFields, 'presentation.secretFields');
  return { apiVersion: 'gcac.plugin-presentation/v1', pluginId, standardObject: 'CloudResource', columns, secretFields };
}

function validateActions(input: unknown, capabilityKeys: string[], path: string): PresentationActionV1[] {
  return array(input, path).map((item, index) => {
    const action = record(item, `${path}.${index}`);
    const capabilityKey = identifier(action.capabilityKey, `${path}.${index}.capabilityKey`);
    if (!capabilityKeys.includes(capabilityKey)) fail(`${path}.${index}.capabilityKey`, '动作引用未知能力', { capabilityKey });
    return {
      capabilityKey,
      labelKey: localeKey(action.labelKey, `${path}.${index}.labelKey`),
      tone: action.tone === undefined ? undefined : enumValue(action.tone, ['success', 'warning', 'danger', 'info', 'muted'] as const, `${path}.${index}.tone`),
    };
  });
}

function presentationField(input: unknown, path: string): PresentationFieldV1 {
  const field = record(input, path);
  return {
    key: identifier(field.key, `${path}.key`),
    labelKey: localeKey(field.labelKey, `${path}.labelKey`),
    valuePath: valuePath(field.valuePath, `${path}.valuePath`),
    type: enumValue(field.type, ['text', 'number', 'status', 'timestamp', 'link', 'badge', 'readonly_text'] as const, `${path}.type`),
  };
}

function assertPluginId(input: unknown, expected: string, path: string): void {
  if (input !== expected) fail(path, '资源 Plugin ID 与 Manifest 不一致', { expected, actual: input });
}

function record(input: unknown, path: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(path, '必须是对象');
  return input as Record<string, unknown>;
}

function array(input: unknown, path: string): unknown[] {
  if (!Array.isArray(input)) fail(path, '必须是数组');
  return input;
}

function stringArray(input: unknown, path: string): string[] {
  return array(input, path).map((item, index) => text(item, `${path}.${index}`));
}

function identifier(input: unknown, path: string): string {
  const value = text(input, path);
  if (!/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(value)) fail(path, '标识符格式无效');
  return value;
}

function localeKey(input: unknown, path: string): string {
  const value = text(input, path);
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) fail(path, '必须是合法 i18n key');
  return value;
}

function valuePath(input: unknown, path: string): string {
  const value = text(input, path);
  if (!/^[A-Za-z][A-Za-z0-9_.[\]-]*$/.test(value)) fail(path, 'valuePath 不合法');
  return value;
}

function text(input: unknown, path: string): string {
  if (typeof input !== 'string' || !input.trim()) fail(path, '必须是非空字符串');
  return input.trim();
}

function booleanValue(input: unknown, path: string): boolean {
  if (typeof input !== 'boolean') fail(path, '必须是布尔值');
  return input;
}

function enumValue<T extends string>(input: unknown, values: readonly T[], path: string): T {
  if (typeof input !== 'string' || !values.includes(input as T)) fail(path, `必须是 ${values.join('、')} 之一`);
  return input as T;
}

function assertUnique(values: string[], path: string): void {
  if (new Set(values).size !== values.length) fail(path, '不能包含重复值');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function fail(path: string, message: string, details: Record<string, unknown> = {}): never {
  throw new AppError('VALIDATION_FAILED', `P2 插件资源 Schema 无效：${message}`, { code: 'P2_PLUGIN_RESOURCE_SCHEMA_INVALID', path, ...details });
}
