import type { OpenApiSchema } from '../../../common/openapi/route-contract.js';

export const deviceAssetSchema: OpenApiSchema = {
  type: 'object',
  required: ['id', 'tenantId', 'displayName', 'managementAddress', 'managementPort', 'deviceFamily', 'credentialId', 'authMode', 'tlsVerify', 'supportTier'],
  properties: {
    id: { type: 'string' },
    tenantId: { type: 'string' },
    displayName: { type: 'string' },
    managementAddress: { type: 'string' },
    managementPort: { type: 'number' },
    deviceFamily: { type: 'string', enum: ['NETSCALER_ADC'] },
    credentialId: { type: 'string' },
    authMode: { type: 'string', enum: ['AUTO', 'SESSION', 'PER_REQUEST'] },
    tlsVerify: { type: 'boolean' },
    supportTier: { type: 'string', enum: ['SUPPORTED', 'COMPATIBLE', 'READ_ONLY', 'UNSUPPORTED'] },
    capabilityProfile: { type: 'object' },
  },
};

export const deviceVirtualServerSchema: OpenApiSchema = {
  type: 'object',
  required: ['id', 'tenantId', 'deviceAssetId', 'type', 'name', 'targetKey', 'sniNames', 'status'],
  properties: {
    id: { type: 'string' },
    tenantId: { type: 'string' },
    deviceAssetId: { type: 'string' },
    type: { type: 'string', enum: ['LB', 'CS', 'VPN', 'GSLB'] },
    name: { type: 'string' },
    targetKey: { type: 'string' },
    sniNames: { type: 'array', items: { type: 'string' } },
    status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'UNKNOWN', 'STALE', 'DELETED'] },
  },
};
