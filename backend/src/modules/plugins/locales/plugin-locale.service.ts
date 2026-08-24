import { AppError } from '../../../common/errors/app-error.js';
import type { UnifiedPluginManifestV1 } from '../dto/unified-plugins.dto.js';

export const hostLocales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'ru-RU', 'pt-BR'] as const;

export interface PluginLocaleBundle {
  defaultLocale: string;
  supportedLocales: string[];
  messages: Record<string, Record<string, string>>;
  coverage: Record<string, number>;
}

export class PluginLocaleService {
  validate(manifest: UnifiedPluginManifestV1, resources: Record<string, string>, referencedKeys: string[]): PluginLocaleBundle | undefined {
    const localeResources = manifest.resources.locales ?? {};
    if (Object.keys(localeResources).length === 0) return undefined;
    const defaultLocale = manifest.defaultLocale ?? 'zh-CN';
    const messages: Record<string, Record<string, string>> = {};
    for (const [locale, path] of Object.entries(localeResources)) {
      const content = resources[path];
      if (content === undefined) fail('PLUGIN_LOCALE_RESOURCE_MISSING', '插件 Locale 资源不存在', { locale, path });
      let parsed: unknown;
      try { parsed = JSON.parse(content); } catch { fail('PLUGIN_LOCALE_JSON_INVALID', '插件 Locale 不是合法 JSON', { locale, path }); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('PLUGIN_LOCALE_JSON_INVALID', '插件 Locale 必须是键值对象', { locale, path });
      messages[locale] = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value !== 'string') fail('PLUGIN_LOCALE_VALUE_INVALID', '插件 Locale 文案必须是字符串', { locale, key });
        if (/<\/?[a-z][^>]*>/i.test(value)) fail('PLUGIN_LOCALE_HTML_FORBIDDEN', '插件 Locale 不允许包含 HTML', { locale, key });
        messages[locale][key] = value;
      }
    }
    if (!messages[defaultLocale]) fail('PLUGIN_LOCALE_DEFAULT_MISSING', '插件缺少默认语言资源', { defaultLocale });
    // 插件只对 Manifest 声明的语言负责；未声明语言由宿主按 defaultLocale 展示，不能伪造翻译资源。
    const required = [...new Set(referencedKeys)];
    const missingDefaultKeys = required.filter((key) => !(key in messages[defaultLocale]!));
    if (missingDefaultKeys.length > 0) fail('PLUGIN_LOCALE_KEY_MISSING', '默认语言缺少插件引用的 key', { defaultLocale, missingDefaultKeys });
    const coverage = Object.fromEntries(Object.entries(messages).map(([locale, values]) => [
      locale,
      required.length === 0 ? 100 : Math.round(required.filter((key) => key in values).length * 10000 / required.length) / 100,
    ]));
    return { defaultLocale, supportedLocales: Object.keys(messages), messages, coverage };
  }

  resolve(bundle: PluginLocaleBundle, locale: string, key: string): string | undefined {
    return bundle.messages[locale]?.[key] ?? bundle.messages[bundle.defaultLocale]?.[key];
  }
}

function fail(code: string, message: string, details: Record<string, unknown>): never {
  throw new AppError('VALIDATION_FAILED', message, { code, ...details });
}
