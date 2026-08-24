import type { RouteDefinition } from '../http/http-types.js';

export interface OpenApiSchema {
  type?: string;
  properties?: Record<string, OpenApiSchema>;
  items?: OpenApiSchema;
  required?: string[];
  enum?: readonly string[];
  pattern?: string;
  additionalProperties?: boolean | OpenApiSchema;
  format?: string;
  description?: string;
  writeOnly?: boolean;
  'x-sensitive'?: boolean;
}

export interface RouteContract extends Omit<RouteDefinition, 'handler'> {
  operationId: string;
  responseSchema?: OpenApiSchema;
  responseContentType?: string;
  requestSchema?: OpenApiSchema;
}
