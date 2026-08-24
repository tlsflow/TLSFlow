import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import type { SecurityServices } from '../../security/security.controller.js';
import { requireRouteSecurity } from '../../security/security-route-helpers.js';
import { DashboardApplicationService } from '../application/dashboard.application-service.js';

const tags = ['Dashboard'];

export class DashboardController {
  constructor(private readonly service: DashboardApplicationService, private readonly security?: SecurityServices) {}

  register(router: Router): void {
    router.get('/api/v1/dashboard/overview', '查询总览聚合', tags, (request) => this.getOverview(request));
  }

  private async getOverview(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    // 仪表盘是认证后的统一入口，具体数据由应用服务按对象级读取权限裁剪。
    return this.service.getOverview({
      tenantId: security.tenantId,
      subject: security.subject,
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
