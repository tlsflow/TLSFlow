import type { RouteContract } from './route-contract.js';
import { errorResponseSchema, healthResponseSchema, pageResponseSchema } from './schemas.js';

export interface OpenApiDocument {
  openapi: string;
  info: Record<string, unknown>;
  servers: Array<Record<string, unknown>>;
  paths: Record<string, unknown>;
  components: Record<string, unknown>;
  tags: Array<{ name: string; description?: string }>;
  'x-generatedAt': string;
}

export function generateOpenApiDocument(routes: RouteContract[], generatedAt = new Date()): OpenApiDocument {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of routes) {
    paths[route.path] ??= {};
    paths[route.path][route.method.toLowerCase()] = {
      operationId: route.operationId,
      summary: route.summary,
      tags: route.tags,
      responses: {
        '200': route.responseSchema
          ? { description: '成功', content: { 'application/json': { schema: route.responseSchema } } }
          : { description: '成功' },
        '400': { $ref: '#/components/responses/ErrorResponse' },
        '404': { $ref: '#/components/responses/ErrorResponse' },
        '500': { $ref: '#/components/responses/ErrorResponse' },
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'GCAC 后端 API',
      version: 'v1',
      description: '企业 SSL 证书生命周期管理平台后端 API 契约。',
    },
    servers: [{ url: '/api/v1' }],
    paths,
    components: {
      schemas: {
        ErrorResponse: errorResponseSchema,
        HealthResponse: healthResponseSchema,
        PageResponse: pageResponseSchema,
      },
      responses: {
        ErrorResponse: {
          description: '统一错误响应',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
        },
      },
    },
    tags: [
      { name: 'System', description: '系统基础能力' },
      { name: 'Health', description: '健康检查' },
    ],
    'x-generatedAt': generatedAt.toISOString(),
  };
}
