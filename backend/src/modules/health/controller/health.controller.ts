import type { Router } from '../../../common/http/router.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { healthResponseSchema } from '../../../common/openapi/schemas.js';
import { HealthApplicationService } from '../application/health.application-service.js';

export class HealthController {
  constructor(private readonly service: HealthApplicationService = new HealthApplicationService()) {}

  register(router: Router): void {
    router.get('/api/v1/health', '健康检查', ['Health'], async () => this.service.getHealth());
  }
}

export function getHealthRouteContracts(): RouteContract[] {
  return [
    {
      method: 'GET',
      path: '/api/v1/health',
      operationId: 'getHealth',
      summary: '健康检查',
      tags: ['Health'],
      responseSchema: healthResponseSchema,
    },
  ];
}
