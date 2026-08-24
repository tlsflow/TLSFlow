import type { OpenApiSchema } from './route-contract.js';

export const errorResponseSchema: OpenApiSchema = {
  type: 'object',
  required: ['errorCode', 'message', 'requestId', 'timestamp'],
  properties: {
    errorCode: { type: 'string' },
    message: { type: 'string' },
    details: { type: 'object', additionalProperties: true },
    requestId: { type: 'string' },
    traceId: { type: 'string' },
    timestamp: { type: 'string', format: 'date-time' },
  },
};

export const healthResponseSchema: OpenApiSchema = {
  type: 'object',
  required: ['status', 'service', 'version', 'timestamp', 'deploymentArchitecture', 'features'],
  properties: {
    status: { type: 'string', enum: ['OK', 'DEGRADED'] },
    service: { type: 'string' },
    version: { type: 'string' },
    timestamp: { type: 'string', format: 'date-time' },
    dependencies: { type: 'object', additionalProperties: { type: 'string' } },
    deploymentArchitecture: { type: 'string', enum: ['small', 'standard'] },
    features: {
      type: 'object',
      required: ['browserRuntime'],
      properties: {
        browserRuntime: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
};

export const pageResponseSchema: OpenApiSchema = {
  type: 'object',
  required: ['items', 'page', 'pageSize', 'total'],
  properties: {
    items: { type: 'array', items: { type: 'object', additionalProperties: true } },
    page: { type: 'number' },
    pageSize: { type: 'number' },
    total: { type: 'number' },
  },
};
