import type { OpenApiSchema } from '../../../common/openapi/route-contract.js';

export const gatewaySchema: OpenApiSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    id: { type: 'string' },
    tenantId: { type: 'string' },
    agentId: { type: 'string' },
    zoneIds: { type: 'array', items: { type: 'string' } },
    status: { type: 'string', enum: ['online', 'offline', 'disabled', 'revoked', 'upgrading'] },
    adapters: { type: 'array', items: { type: 'string' } },
    capabilities: { type: 'array', items: { type: 'string' } },
  },
};

export const gatewayPageSchema: OpenApiSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    items: { type: 'array', items: gatewaySchema },
    page: { type: 'number' },
    pageSize: { type: 'number' },
    total: { type: 'number' },
  },
};

export const gatewayDetailSchema: OpenApiSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    gateway: gatewaySchema,
    reachability: { type: 'array', items: { type: 'object', additionalProperties: true } },
  },
};

export const gatewayRouteResultSchema: OpenApiSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    status: { type: 'string', enum: ['selected', 'blocked', 'approvalRequired'] },
    selectedGateway: gatewaySchema,
    candidateGateways: { type: 'array', items: { type: 'object', additionalProperties: true } },
    missingCapabilities: { type: 'array', items: { type: 'string' } },
    fallbackSuggestions: { type: 'array', items: { type: 'string' } },
    blockedReason: { type: 'string' },
    relayAuthorization: {
      type: 'object',
      additionalProperties: false,
      properties: {
        routeRef: { type: 'string' },
        tenantId: { type: 'string' },
        callerId: { type: 'string' },
        zoneId: { type: 'string' },
        gatewayId: { type: 'string' },
        targetId: { type: 'string' },
        host: { type: 'string' },
        port: { type: 'number' },
        issuedAt: { type: 'string' },
        expiresAt: { type: 'string' },
      },
    },
  },
};
export const gatewayReachabilitySchema: OpenApiSchema = { type: 'object', additionalProperties: true };
export const gatewayTargetHistorySchema: OpenApiSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    delegatedTargetId: { type: 'string' },
    items: { type: 'array', items: { type: 'object', additionalProperties: true } },
  },
};
