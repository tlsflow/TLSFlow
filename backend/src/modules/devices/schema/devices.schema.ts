import type { OpenApiSchema } from '../../../common/openapi/route-contract.js';
import { MANAGED_DEVICE_SITE_KIND_PATTERN } from '../dto/devices.dto.js';

const informationFieldSchema: OpenApiSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'value', 'valueType'],
  properties: {
    key: { type: 'string' },
    value: {},
    valueType: { type: 'string', enum: ['TEXT', 'STATUS', 'DATETIME', 'BOOLEAN', 'NUMBER'] },
    copyable: { type: 'boolean' },
  },
};

const boundCertificateSchema: OpenApiSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    certificateAssetId: { type: 'string' },
    certificateVersionId: { type: 'string' },
    name: { type: 'string' },
    subject: { type: 'string' },
    issuer: { type: 'string' },
    notBefore: { type: 'string', format: 'date-time' },
    notAfter: { type: 'string', format: 'date-time' },
    fingerprintSha256: { type: 'string' },
    status: { type: 'string' },
  },
};

const siteBindingSchema: OpenApiSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'bindingKey', 'bindingType', 'status', 'replacement'],
  properties: {
    id: { type: 'string' },
    bindingKey: { type: 'string' },
    bindingType: { type: 'string' },
    hostName: { type: 'string' },
    status: { type: 'string' },
    certificate: boundCertificateSchema,
    replacement: {
      type: 'object',
      additionalProperties: false,
      required: ['allowed'],
      properties: {
        allowed: { type: 'boolean' },
        managedTargetId: { type: 'string' },
        reasonCode: { type: 'string' },
      },
    },
  },
};

const siteSchema: OpenApiSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'siteAssetId', 'kind', 'frameworkType', 'name', 'bindings', 'metadata'],
  properties: {
    id: { type: 'string' },
    siteAssetId: { type: 'string' },
    managedTargetId: { type: 'string' },
    kind: { type: 'string', pattern: MANAGED_DEVICE_SITE_KIND_PATTERN },
    frameworkType: { type: 'string', pattern: MANAGED_DEVICE_SITE_KIND_PATTERN },
    name: { type: 'string' },
    status: { type: 'string' },
    endpoint: {
      type: 'object',
      additionalProperties: false,
      properties: {
        address: { type: 'string' },
        hostName: { type: 'string' },
        port: { type: 'number' },
        protocol: { type: 'string' },
      },
    },
    configPath: { type: 'string' },
    presentation: {
      type: 'object',
      additionalProperties: false,
      required: ['groupKey', 'groupLabelKey', 'typeLabelKey'],
      properties: {
        groupKey: { type: 'string' },
        groupLabelKey: { type: 'string' },
        typeLabelKey: { type: 'string' },
        groupLabel: { type: 'string' },
        typeLabel: { type: 'string' },
      },
    },
    bindings: { type: 'array', items: siteBindingSchema },
    metadata: { type: 'object', additionalProperties: true },
  },
};

export const managedDeviceDetailSchema: OpenApiSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['id', 'displayName', 'overview', 'informationSections', 'frameworks', 'sites', 'certificates', 'logs', 'extension', 'extensionSummary'],
  properties: {
    id: { type: 'string' },
    displayName: { type: 'string' },
    overview: {
      type: 'object',
      additionalProperties: false,
      required: ['deviceId', 'displayName', 'deviceType', 'managementMode', 'status', 'updatedAt'],
      properties: {
        deviceId: { type: 'string' },
        displayName: { type: 'string' },
        deviceType: { type: 'string' },
        productFamily: { type: 'string' },
        managementMode: { type: 'string' },
        status: { type: 'string' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
    informationSections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'fields'],
        properties: {
          key: { type: 'string' },
          fields: { type: 'array', items: informationFieldSchema },
        },
      },
    },
    frameworks: { type: 'array', items: { type: 'object', additionalProperties: true } },
    sites: { type: 'array', items: siteSchema },
    certificates: {
      type: 'array',
      items: {
        ...boundCertificateSchema,
        required: ['id'],
        properties: { id: { type: 'string' }, ...boundCertificateSchema.properties },
      },
    },
    logs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'eventType', 'occurredAt', 'metadata'],
        properties: {
          id: { type: 'string' },
          eventType: { type: 'string' },
          result: { type: 'string' },
          summary: { type: 'string' },
          occurredAt: { type: 'string', format: 'date-time' },
          actorId: { type: 'string' },
          metadata: { type: 'object', additionalProperties: true },
        },
      },
    },
    extension: { type: 'object', additionalProperties: true, required: ['type'], properties: { type: { type: 'string' } } },
    extensionSummary: { type: 'object', additionalProperties: true },
  },
};
