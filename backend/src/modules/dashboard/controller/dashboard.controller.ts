import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { DashboardApplicationService } from '../application/dashboard.application-service.js';

const tags = ['Dashboard'];

export class DashboardController {
  constructor(private readonly service: DashboardApplicationService) {}

  register(router: Router): void {
    router.get('/api/v1/dashboard/overview', '查询总览聚合', tags, (request) => this.getOverview(request));
  }

  private getOverview(request: HttpRequest) {
    return this.service.getOverview({
      tenantId: request.context.tenantId ?? 'default',
    });
  }
}

export function getDashboardRouteContracts(): RouteContract[] {
  return [
    {
      method: 'GET',
      path: '/api/v1/dashboard/overview',
      operationId: 'getDashboardOverview',
      summary: '查询总览聚合',
      tags,
      responseSchema: { type: 'object', additionalProperties: true },
    },
  ];
}
