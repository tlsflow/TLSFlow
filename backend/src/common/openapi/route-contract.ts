import type { RouteDefinition } from '../http/http-types.js';

export interface OpenApiSchema {
  type?: string;
  properties?: Record<string, OpenApiSchema>;
  items?: OpenApiSchema;
  required?: string[];
  enum?: string[];
  additionalProperties?: boolean | OpenApiSchema;
  format?: string;
  description?: string;
}

export interface RouteContract extends Omit<RouteDefinition, 'handler'> {
  operationId: string;
  responseSchema?: OpenApiSchema;
}
