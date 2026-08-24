import { parsePageQuery } from '../../../common/pagination/pagination.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import { AppError } from '../../../common/errors/app-error.js';
import { assetsEnumValues } from '../../assets/domain/assets.domain-service.js';
import { ProvidersApplicationService } from '../application/providers.application-service.js';
import type { RunDiscoveryInput } from '../dto/providers.dto.js';

const tags = ['Providers'];
const tenantFallback = '00000000-0000-0000-0000-000000000000';

export class ProvidersController {
  constructor(private readonly service = new ProvidersApplicationService()) {}

  register(router: Router): void {
    router.get('/api/v1/providers', '查询 Provider 列表', tags, () => this.service.listProviders());
    router.post('/api/v1/providers/discovery-runs', '执行 Provider Discovery', tags, (request) => this.runDiscovery(request));
    router.get('/api/v1/provider-discovery-results', '查询 Provider Discovery 结果', tags, (request) => this.listDiscoveryResults(request));
    router.get('/api/v1/provider-discovery-result', '查询单个 Provider Discovery 结果', tags, (request) => this.getDiscoveryResult(request));
  }

  getApplicationService(): ProvidersApplicationService {
    return this.service;
  }

  private async runDiscovery(request: HttpRequest) {
    const body = validateObject(request.body, {
      providerId: { type: 'string', required: true },
      source: { type: 'string', enum: assetsEnumValues.discoverySources },
      scope: { type: 'object' },
      payload: { type: 'object' },
    });
    const result = await this.service.runDiscovery({ tenantId: tenantId(request), actorId: request.context.actorId, requestId: request.context.requestId }, body as unknown as RunDiscoveryInput);
    return { statusCode: 201, body: result };
  }

  private listDiscoveryResults(request: HttpRequest) {
    const query = parsePageQuery(request.query, {
      allowedSortFields: ['createdAt', 'updatedAt', 'providerId', 'providerType', 'status', 'normalizedHash'],
      allowedFilterFields: ['providerId', 'providerType', 'status', 'normalizedHash', 'snapshotId'],
    });
    return this.service.listDiscoveryResults(tenantId(request), query);
  }

  private getDiscoveryResult(request: HttpRequest) {
    const resultId = readQueryString(request, 'id');
    const item = this.service.getDiscoveryResult(tenantId(request), resultId);
    if (!item) {
      throw new AppError('RESOURCE_NOT_FOUND', 'discovery result 不存在', { resultId });
    }
    return item;
  }
}

export function getProvidersRouteContracts(): RouteContract[] {
  const schema = { type: 'object', additionalProperties: true };
  return [
    { method: 'GET', path: '/api/v1/providers', operationId: 'listProviders', summary: '查询 Provider 列表', tags, responseSchema: { type: 'array', items: schema } },
    { method: 'POST', path: '/api/v1/providers/discovery-runs', operationId: 'runProviderDiscovery', summary: '执行 Provider Discovery', tags, responseSchema: schema },
    { method: 'GET', path: '/api/v1/provider-discovery-results', operationId: 'listProviderDiscoveryResults', summary: '查询 Provider Discovery 结果', tags, responseSchema: pageSchema() },
    { method: 'GET', path: '/api/v1/provider-discovery-result', operationId: 'getProviderDiscoveryResult', summary: '查询单个 Provider Discovery 结果', tags, responseSchema: schema },
  ];
}

function pageSchema() {
  return {
    type: 'object',
    required: ['items', 'page', 'pageSize', 'total'],
    properties: {
      items: { type: 'array', items: { type: 'object', additionalProperties: true } },
      page: { type: 'number' },
      pageSize: { type: 'number' },
      total: { type: 'number' },
    },
  };
}

function readQueryString(request: HttpRequest, field: string): string {
  const value = request.query[field];
  const normalized = Array.isArray(value) ? value[0] : value;
  if (!normalized) {
    throw new AppError('VALIDATION_FAILED', `${field} 不能为空`, { field });
  }
  return normalized;
}

function tenantId(request: HttpRequest): string {
  return request.context.tenantId ?? tenantFallback;
}
