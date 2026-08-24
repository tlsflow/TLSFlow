import assert from 'node:assert/strict';
import test from 'node:test';

import { pluginFieldTypes } from './forms/plugin-form.dto.js';
import { PluginFormSchemaService } from './forms/plugin-form-schema.service.js';
import { StandardPluginFieldRegistry } from './forms/standard-plugin-field.registry.js';
import { PluginLocaleService, hostLocales } from './locales/plugin-locale.service.js';
import { PluginPresentationSchemaService } from './presentations/plugin-presentation-schema.service.js';
import type { UnifiedPluginManifestV1 } from './dto/unified-plugins.dto.js';
import { PluginPackageResourcesService } from './application/plugin-package-resources.service.js';

test('标准字段 Registry 覆盖连接、认证、TLS、Gateway 和 SecretRef', () => {
  const registry = new StandardPluginFieldRegistry();
  assert.equal(registry.require('connection.address').type, 'text');
  assert.equal(registry.require('connection.gatewayId').valueKind, 'RESOURCE_REF');
  assert.equal(registry.require('authentication.passwordSecretRef').valueKind, 'SECRET_REF');
  assert.equal(registry.require('authentication.passwordSecretRef').sensitive, true);
  assert.equal(registry.require('tls.verifyPeer').defaultValue, true);
});

test('插件表单支持完整字段类型并拒绝覆盖 Secret 安全属性', () => {
  const service = new PluginFormSchemaService();
  const schema = service.validate({
    schemaVersion: 'gcac.plugin-form/v1',
    mode: 'BOTH',
    sections: [{
      id: 'all',
      titleKey: 'plugin.test.forms.all.title',
      fields: pluginFieldTypes.filter((type) => type !== 'password').map((type, index) => ({
        key: `field_${index}`,
        type,
        labelKey: `plugin.test.forms.all.field_${index}.label`,
      })),
    }],
  }, []);
  assert.equal(schema.sections[0]?.fields.length, pluginFieldTypes.length - 1);
  assert.throws(() => service.validate({
    schemaVersion: 'gcac.plugin-form/v1', mode: 'BOTH', sections: [{ id: 'secret', titleKey: 'plugin.test.secret', fields: [{
      key: 'password', type: 'secret_ref', labelKey: 'plugin.test.password', standardField: 'authentication.passwordSecretRef', sensitive: false,
    }] }],
  }, []), /不能取消敏感标记/);
});

test('插件表单拒绝循环依赖和未批准动态选项 Action', () => {
  const service = new PluginFormSchemaService();
  assert.throws(() => service.validate({
    schemaVersion: 'gcac.plugin-form/v1', mode: 'BOTH', sections: [{ id: 'cycle', titleKey: 'plugin.test.cycle', fields: [
      { key: 'left', type: 'text', labelKey: 'plugin.test.left', visibleWhen: { field: 'right', operator: 'truthy' } },
      { key: 'right', type: 'text', labelKey: 'plugin.test.right', visibleWhen: { field: 'left', operator: 'truthy' } },
    ] }],
  }, []), /依赖存在循环/);
  assert.throws(() => service.validate({
    schemaVersion: 'gcac.plugin-form/v1', mode: 'BOTH', sections: [{ id: 'options', titleKey: 'plugin.test.options', fields: [
      { key: 'partition', type: 'select', labelKey: 'plugin.test.partition', optionProviderAction: 'device.partition.list/v1' },
    ] }],
  }, []), /低风险只读 Action/);
});

test('Locale 服务校验内置八语言、用户默认语言、回退和恶意 HTML', () => {
  const service = new PluginLocaleService();
  const builtin = manifest('BUILTIN', Object.fromEntries(hostLocales.map((locale) => [locale, `locales/${locale}.json`])));
  const resources = Object.fromEntries(hostLocales.map((locale) => [`locales/${locale}.json`, JSON.stringify({ 'plugin.test.name': `${locale} name` })]));
  const bundle = service.validate(builtin, resources, ['plugin.test.name'])!;
  assert.equal(service.resolve(bundle, 'de-DE', 'plugin.test.name'), 'zh-CN name');

  assert.throws(() => service.validate(manifest('USER', { 'en-US': 'locales/en-US.json' }), {
    'locales/en-US.json': JSON.stringify({ 'plugin.test.name': '<b>unsafe</b>' }),
  }, ['plugin.test.name']), /HTML/);
});

test('插件 Locale 不重复承担宿主标准字段翻译', () => {
  const packageService = new PluginPackageResourcesService();
  const builtin = manifest('BUILTIN', Object.fromEntries(hostLocales.map((locale) => [locale, `locales/${locale}.json`])));
  builtin.resources.forms = { device: 'forms/device.json' };
  const messages = { 'plugin.test.name': 'Test' };
  const resources = {
    'forms/device.json': JSON.stringify({
      schemaVersion: 'gcac.plugin-form/v1',
      mode: 'BOTH',
      sections: [{ id: 'device', titleKey: 'plugin.test.name', fields: [{ key: 'address', type: 'text', labelKey: 'plugin.test.name', standardField: 'connection.address' }] }],
    }),
    ...Object.fromEntries(hostLocales.map((locale) => [`locales/${locale}.json`, JSON.stringify(messages)])),
  };
  assert.ok(packageService.validate(builtin, resources).locales);
});

test('Presentation Schema 统一支持设备详情、框架、站点、证书和日志', () => {
  const schema = new PluginPresentationSchemaService().validate({
    schemaVersion: 'gcac.device-presentation/v1',
    overview: [{ id: 'base', titleKey: 'plugin.test.overview', fields: [{ key: 'version', labelKey: 'plugin.test.version', valuePath: 'device.version', type: 'text' }] }],
    tabs: [
      { type: 'frameworks', id: 'frameworks', titleKey: 'plugin.test.frameworks', columns: [] },
      { type: 'sites', id: 'sites', titleKey: 'plugin.test.sites', columns: [] },
      { type: 'certificate_bindings', id: 'bindings', titleKey: 'plugin.test.bindings', columns: [] },
      { type: 'device_logs', id: 'logs', titleKey: 'plugin.test.logs', queryCapabilities: ['device.logs.read'], columns: [] },
    ],
    actions: [{ capabilityKey: 'device.refresh', labelKey: 'plugin.test.refresh', tone: 'info' }],
  }, ['device.logs.read', 'device.refresh']);
  assert.deepEqual(schema.tabs.map((tab) => tab.type), ['frameworks', 'sites', 'certificate_bindings', 'device_logs']);
});

function manifest(source: 'BUILTIN' | 'USER', locales: Record<string, string>): UnifiedPluginManifestV1 {
  return {
    apiVersion: 'gcac.plugin-manifest/v1', kind: 'GcacPlugin', pluginId: 'test.plugin', version: '1.0.0',
    displayNameKey: 'plugin.test.name', defaultLocale: 'zh-CN', publisher: 'GCAC', runtime: 'WORKFLOW_DSL', source,
    scope: 'BOTH', trust: source === 'BUILTIN' ? 'OFFICIAL_SIGNED' : 'UNSIGNED', support: source === 'BUILTIN' ? 'OFFICIAL' : 'SELF_MANAGED',
    capabilities: [], permissions: [], resources: { locales },
  };
}
