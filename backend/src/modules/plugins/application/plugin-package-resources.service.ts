import { AppError } from '../../../common/errors/app-error.js';
import type { UnifiedPluginManifestV1 } from '../dto/unified-plugins.dto.js';
import type { PluginFormSchemaV1 } from '../forms/plugin-form.dto.js';
import { PluginFormSchemaService } from '../forms/plugin-form-schema.service.js';
import { PluginLocaleService, type PluginLocaleBundle } from '../locales/plugin-locale.service.js';
import type { DevicePresentationSchemaV1 } from '../presentations/plugin-presentation.dto.js';
import { PluginPresentationSchemaService } from '../presentations/plugin-presentation-schema.service.js';

export interface ValidatedPluginPackageResources {
  forms: Record<string, PluginFormSchemaV1>;
  presentations: Record<string, DevicePresentationSchemaV1>;
  locales?: PluginLocaleBundle;
}

export class PluginPackageResourcesService {
  constructor(
    private readonly forms = new PluginFormSchemaService(),
    private readonly locales = new PluginLocaleService(),
    private readonly presentations = new PluginPresentationSchemaService(),
  ) {}

  validate(manifest: UnifiedPluginManifestV1, resources: Record<string, string>): ValidatedPluginPackageResources {
    const capabilities = manifest.capabilities;
    const forms = Object.fromEntries(Object.entries(manifest.resources.forms ?? {}).map(([key, path]) => [
      key,
      this.forms.validate(parseJsonResource(resources, path), capabilities),
    ]));
    const capabilityKeys = capabilities.map((item) => item.key);
    const presentations = Object.fromEntries(Object.entries(manifest.resources.presentations ?? {}).map(([key, path]) => [
      key,
      this.presentations.validate(parseJsonResource(resources, path), capabilityKeys),
    ]));
    const referencedKeys = collectLocaleKeys(manifest, forms, presentations);
    const locales = this.locales.validate(manifest, resources, referencedKeys);
    if ((Object.keys(forms).length > 0 || Object.keys(presentations).length > 0) && !locales) {
      throw new AppError('VALIDATION_FAILED', '带表单或展示资源的插件必须提供 Locale', { code: 'PLUGIN_LOCALE_REQUIRED' });
    }
    return { forms, presentations, locales };
  }
}

function parseJsonResource(resources: Record<string, string>, path: string): unknown {
  const content = resources[path];
  if (content === undefined) throw new AppError('VALIDATION_FAILED', '插件资源不存在', { code: 'PLUGIN_RESOURCE_MISSING', path });
  try { return JSON.parse(content); } catch { throw new AppError('VALIDATION_FAILED', '插件资源不是合法 JSON', { code: 'PLUGIN_RESOURCE_JSON_INVALID', path }); }
}

function collectLocaleKeys(
  manifest: UnifiedPluginManifestV1,
  forms: Record<string, PluginFormSchemaV1>,
  presentations: Record<string, DevicePresentationSchemaV1>,
): string[] {
  const keys = [manifest.displayNameKey, manifest.descriptionKey].filter(Boolean) as string[];
  for (const form of Object.values(forms)) for (const section of form.sections) {
    keys.push(section.titleKey);
    if (section.descriptionKey) keys.push(section.descriptionKey);
    for (const field of section.fields) {
      keys.push(field.labelKey);
      if (field.descriptionKey) keys.push(field.descriptionKey);
      if (field.placeholderKey) keys.push(field.placeholderKey);
      for (const option of field.options ?? []) keys.push(option.labelKey);
    }
  }
  for (const presentation of Object.values(presentations)) {
    for (const group of presentation.overview) {
      keys.push(group.titleKey, ...group.fields.map((field) => field.labelKey));
    }
    for (const tab of presentation.tabs) keys.push(tab.titleKey, ...tab.columns.map((column) => column.labelKey));
    keys.push(...presentation.actions.map((action) => action.labelKey));
  }
  return [...new Set(keys)];
}
