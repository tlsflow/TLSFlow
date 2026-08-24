import { AppError } from '../../../common/errors/app-error.js';
import type { StandardPluginFieldDefinition } from './plugin-form.dto.js';

const fields: StandardPluginFieldDefinition[] = [
  field('connection.address', 'text', 'plugins.standardFields.connectionAddress', { required: true, validation: { minLength: 1, maxLength: 255 } }),
  field('connection.port', 'integer', 'plugins.standardFields.connectionPort', { required: true, defaultValue: 443, validation: { minimum: 1, maximum: 65535 } }),
  field('connection.basePath', 'text', 'plugins.standardFields.basePath', { defaultValue: '/' }),
  field('connection.timeoutSeconds', 'integer', 'plugins.standardFields.timeoutSeconds', { defaultValue: 30, validation: { minimum: 1, maximum: 600 } }),
  field('connection.gatewayId', 'select', 'plugins.standardFields.gateway', { valueKind: 'RESOURCE_REF' }),
  field('authentication.mode', 'radio', 'plugins.standardFields.authenticationMode', { required: true }),
  field('authentication.credentialId', 'credential_ref', 'plugins.standardFields.credential', { required: true, sensitive: true, valueKind: 'CREDENTIAL_REF' }),
  field('authentication.clientCertificateRef', 'certificate_ref', 'plugins.standardFields.clientCertificate', { valueKind: 'RESOURCE_REF' }),
  field('tls.enabled', 'switch', 'plugins.standardFields.tlsEnabled', { defaultValue: true }),
  field('tls.verifyPeer', 'switch', 'plugins.standardFields.tlsVerifyPeer', { defaultValue: true }),
  field('tls.ignoreCertificateErrors', 'switch', 'plugins.standardFields.tlsIgnoreCertificateErrors', { defaultValue: false }),
  field('tls.serverName', 'text', 'plugins.standardFields.tlsServerName'),
  field('tls.caSecretRef', 'secret_ref', 'plugins.standardFields.caSecret', { sensitive: true, valueKind: 'SECRET_REF' }),
  field('tls.minimumVersion', 'select', 'plugins.standardFields.tlsMinimumVersion', { defaultValue: 'TLSv1.2' }),
  field('device.displayName', 'text', 'plugins.standardFields.deviceDisplayName', { required: true }),
  field('device.description', 'textarea', 'plugins.standardFields.deviceDescription'),
  field('device.tags', 'multi_select', 'plugins.standardFields.deviceTags'),
  field('target.name', 'text', 'plugins.standardFields.targetName'),
  field('target.labels', 'key_value', 'plugins.standardFields.targetLabels'),
];

const byKey = new Map(fields.map((item) => [item.key, Object.freeze(item)]));

export class StandardPluginFieldRegistry {
  list(): StandardPluginFieldDefinition[] {
    return fields.map((item) => ({ ...item, supportedModes: [...item.supportedModes] }));
  }

  get(key: string): StandardPluginFieldDefinition | undefined {
    const item = byKey.get(key);
    return item ? { ...item, supportedModes: [...item.supportedModes] } : undefined;
  }

  require(key: string): StandardPluginFieldDefinition {
    const item = this.get(key);
    if (!item) throw new AppError('VALIDATION_FAILED', '插件引用了未知标准字段', { code: 'PLUGIN_STANDARD_FIELD_UNKNOWN', key });
    return item;
  }
}

function field(
  key: string,
  type: StandardPluginFieldDefinition['type'],
  labelKey: string,
  patch: Partial<StandardPluginFieldDefinition> = {},
): StandardPluginFieldDefinition {
  return {
    key,
    type,
    labelKey,
    sensitive: false,
    valueKind: 'PLAIN',
    supportedModes: ['MANAGED', 'STANDALONE'],
    ...patch,
  };
}
