import { App } from './common/http/app.js';
import type { RouteContract } from './common/openapi/route-contract.js';
import { generateOpenApiDocument } from './common/openapi/openapi-generator.js';
import { getHealthRouteContracts, HealthController } from './modules/health/controller/health.controller.js';
import { getSecurityRouteContracts, SecurityController, type SecurityServices } from './modules/security/security.controller.js';

export interface AppDependencies {
  security?: SecurityServices;
}

export function createApp(dependencies: AppDependencies = {}): App {
  const app = new App();
  new HealthController().register(app.router);
  new SecurityController(dependencies.security).register(app.router);

  app.router.get('/api/v1/openapi.json', '获取 OpenAPI 契约', ['System'], async () => ({
    statusCode: 200,
    body: generateOpenApiDocument(getRouteContracts()),
  }));

  return app;
}

export function getRouteContracts(): RouteContract[] {
  return [
    ...getHealthRouteContracts(),
    ...getSecurityRouteContracts(),
    {
      method: 'GET',
      path: '/api/v1/openapi.json',
      operationId: 'getOpenApiDocument',
      summary: '获取 OpenAPI 契约',
      tags: ['System'],
      responseSchema: { type: 'object', additionalProperties: true },
    },
  ];
}
