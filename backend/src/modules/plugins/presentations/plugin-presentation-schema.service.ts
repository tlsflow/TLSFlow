import { AppError } from '../../../common/errors/app-error.js';
import type { DevicePresentationSchemaV1, PresentationColumnV1, PresentationFieldV1 } from './plugin-presentation.dto.js';

export class PluginPresentationSchemaService {
  validate(input: unknown, capabilityKeys: string[]): DevicePresentationSchemaV1 {
    const schema = record(input, 'presentation');
    if (schema.schemaVersion !== 'gcac.device-presentation/v1') fail('presentation.schemaVersion', '仅支持 gcac.device-presentation/v1');
    const resourceLabels = schema.resourceLabels === undefined ? undefined : resourceLabelSchema(schema.resourceLabels);
    const overview = array(schema.overview, 'presentation.overview').map((item, index) => {
      const group = record(item, `presentation.overview.${index}`);
      return {
        id: text(group.id, `presentation.overview.${index}.id`),
        titleKey: localeKey(group.titleKey, `presentation.overview.${index}.titleKey`),
        fields: array(group.fields, `presentation.overview.${index}.fields`).map((field, fieldIndex) =>
          presentationField(field, `presentation.overview.${index}.fields.${fieldIndex}`)),
      };
    });
    const tabs = array(schema.tabs, 'presentation.tabs').map((item, index) => {
      const tab = record(item, `presentation.tabs.${index}`);
      const type = enumValue(tab.type, ['frameworks', 'sites', 'certificate_bindings', 'device_logs', 'records'] as const, `presentation.tabs.${index}.type`);
      const queryCapabilities = tab.queryCapabilities === undefined ? undefined : stringArray(tab.queryCapabilities, `presentation.tabs.${index}.queryCapabilities`);
      const unknownCapabilities = (queryCapabilities ?? []).filter((key) => !capabilityKeys.includes(key));
      if (unknownCapabilities.length > 0) fail(`presentation.tabs.${index}.queryCapabilities`, '日志查询引用未知能力', { unknownCapabilities });
      return {
        type,
        id: text(tab.id, `presentation.tabs.${index}.id`),
        titleKey: localeKey(tab.titleKey, `presentation.tabs.${index}.titleKey`),
        recordType: optionalText(tab.recordType, `presentation.tabs.${index}.recordType`),
        queryCapabilities,
        columns: array(tab.columns, `presentation.tabs.${index}.columns`).map((column, columnIndex) =>
          presentationColumn(column, `presentation.tabs.${index}.columns.${columnIndex}`)),
      };
    });
    const actions = array(schema.actions, 'presentation.actions').map((item, index) => {
      const action = record(item, `presentation.actions.${index}`);
      const capabilityKey = text(action.capabilityKey, `presentation.actions.${index}.capabilityKey`);
      if (!capabilityKeys.includes(capabilityKey)) fail(`presentation.actions.${index}.capabilityKey`, '动作引用未知能力', { capabilityKey });
      return {
        capabilityKey,
        labelKey: localeKey(action.labelKey, `presentation.actions.${index}.labelKey`),
        tone: action.tone === undefined ? undefined : enumValue(action.tone, ['success', 'warning', 'danger', 'info', 'muted'] as const, `presentation.actions.${index}.tone`),
      };
    });
    return { schemaVersion: 'gcac.device-presentation/v1', resourceLabels, overview, tabs, actions };
  }
}

function presentationField(input: unknown, path: string): PresentationFieldV1 { const item = record(input, path); return { key: text(item.key, `${path}.key`), labelKey: localeKey(item.labelKey, `${path}.labelKey`), valuePath: valuePath(item.valuePath, `${path}.valuePath`), type: enumValue(item.type, ['text', 'number', 'status', 'timestamp', 'link', 'badge', 'readonly_text'] as const, `${path}.type`), sensitive: item.sensitive === undefined ? undefined : booleanValue(item.sensitive, `${path}.sensitive`) }; }
function presentationColumn(input: unknown, path: string): PresentationColumnV1 { const item = record(input, path); return { key: text(item.key, `${path}.key`), labelKey: localeKey(item.labelKey, `${path}.labelKey`), valuePath: valuePath(item.valuePath, `${path}.valuePath`), type: enumValue(item.type, ['text', 'number', 'status', 'timestamp', 'link', 'badge'] as const, `${path}.type`) }; }
function resourceLabelSchema(input: unknown): NonNullable<DevicePresentationSchemaV1['resourceLabels']> {
  const value = record(input, 'presentation.resourceLabels');
  const frameworks = array(value.frameworks, 'presentation.resourceLabels.frameworks').map((item, index) => {
    const path = `presentation.resourceLabels.frameworks.${index}`;
    const framework = record(item, path);
    return { frameworkType: namespace(framework.frameworkType, `${path}.frameworkType`), labelKey: localeKey(framework.labelKey, `${path}.labelKey`) };
  });
  const sites = array(value.sites, 'presentation.resourceLabels.sites').map((item, index) => {
    const path = `presentation.resourceLabels.sites.${index}`;
    const site = record(item, path);
    return {
      frameworkType: namespace(site.frameworkType, `${path}.frameworkType`),
      siteType: namespace(site.siteType, `${path}.siteType`),
      groupKey: stableKey(site.groupKey, `${path}.groupKey`),
      groupLabelKey: localeKey(site.groupLabelKey, `${path}.groupLabelKey`),
      typeLabelKey: localeKey(site.typeLabelKey, `${path}.typeLabelKey`),
    };
  });
  assertUnique(frameworks.map((item) => item.frameworkType), 'presentation.resourceLabels.frameworks');
  assertUnique(sites.map((item) => `${item.frameworkType}:${item.siteType}`), 'presentation.resourceLabels.sites');
  return { frameworks, sites };
}
function valuePath(input: unknown, path: string): string { const value = text(input, path); if (!/^[a-zA-Z][a-zA-Z0-9_.\[\]-]*$/.test(value)) fail(path, 'valuePath 不合法'); return value; }
function record(input: unknown, path: string): Record<string, unknown> { if (!input || typeof input !== 'object' || Array.isArray(input)) fail(path, '必须是对象'); return input as Record<string, unknown>; }
function array(input: unknown, path: string): unknown[] { if (!Array.isArray(input)) fail(path, '必须是数组'); return input; }
function text(input: unknown, path: string): string { if (typeof input !== 'string' || !input.trim()) fail(path, '必须是非空字符串'); return input.trim(); }
function optionalText(input: unknown, path: string): string | undefined { return input === undefined ? undefined : text(input, path); }
function localeKey(input: unknown, path: string): string { const value = text(input, path); if (!/^[a-zA-Z0-9_.-]+$/.test(value)) fail(path, '必须是合法 i18n key'); return value; }
function namespace(input: unknown, path: string): string { const value = text(input, path); if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(value)) fail(path, '必须是带命名空间的标准类型'); return value; }
function stableKey(input: unknown, path: string): string { const value = text(input, path); if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(value)) fail(path, '必须是合法稳定键'); return value; }
function assertUnique(values: string[], path: string): void { if (new Set(values).size !== values.length) fail(path, '不能包含重复映射'); }
function stringArray(input: unknown, path: string): string[] { return array(input, path).map((item, index) => text(item, `${path}.${index}`)); }
function booleanValue(input: unknown, path: string): boolean { if (typeof input !== 'boolean') fail(path, '必须是布尔值'); return input; }
function enumValue<T extends string>(input: unknown, values: readonly T[], path: string): T { if (typeof input !== 'string' || !values.includes(input as T)) fail(path, `必须是 ${values.join('、')} 之一`); return input as T; }
function fail(path: string, message: string, details: Record<string, unknown> = {}): never { throw new AppError('VALIDATION_FAILED', `设备 Presentation Schema 无效：${message}`, { code: 'PLUGIN_PRESENTATION_SCHEMA_INVALID', path, ...details }); }
