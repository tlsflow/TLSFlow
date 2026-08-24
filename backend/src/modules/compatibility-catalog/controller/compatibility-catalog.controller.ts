import type { Router } from '../../../common/http/router.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { CompatibilityCatalogApplicationService } from '../application/compatibility-catalog.application-service.js';

const tags = ['Compatibility Catalog'];

export class CompatibilityCatalogController {
  constructor(private readonly service = new CompatibilityCatalogApplicationService()) {}

  register(router: Router): void {
    router.get('/api/v1/compatibility/catalog', '查询兼容性目录', tags, () => this.service.list());
  }
}

export function getCompatibilityCatalogRouteContracts(): RouteContract[] {
  return [{
    method: 'GET',
    path: '/api/v1/compatibility/catalog',
    operationId: 'listCompatibilityCatalog',
    summary: '查询兼容性目录',
    tags,
    responseSchema: { type: 'object', additionalProperties: true },
  }];
}
