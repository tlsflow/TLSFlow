import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { authorizePageQuery, requireRouteSecurity, assertRouteAction } from '../../security/security-route-helpers.js';
import { withAuthorization, type PageQuery } from '../../../common/pagination/pagination.js';
import type { GlobalSearchApplicationService } from '../application/global-search.application-service.js';

const tags = ['Global Search'];

export class GlobalSearchController {
  constructor(
    private readonly service: GlobalSearchApplicationService,
    private readonly security: import('../../security/security.controller.js').SecurityServices,
  ) {}

  register(router: Router): void {
    router.get('/api/v1/global-search', '全局搜索', tags, (request) => this.search(request));
  }

  private async search(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const query = readQuery(request, 'query');
    const locale = readQuery(request, 'locale') || 'zh-CN';
    const permissions = {
      certificates: await certificatePermissions(security),
      assets: await authorizedQueryIfAllowed(security, ['service_asset.read'], 'service_asset', { page: 1, pageSize: 1000, filter: {} }),
      devices: await authorizedIdsIfAllowed(security, ['host.read'], 'host'),
      cloudServices: await authorizedIdsIfAllowed(security, ['cloud_account_asset.read'], 'cloud_account_asset'),
      plugins: await authorizedIdsIfAllowed(security, ['plugin.read'], 'plugin_version'),
    };
    return this.service.search(security.tenantId, locale, query, permissions);
  }
}

export function getGlobalSearchRouteContracts(): RouteContract[] {
  return [{
    method: 'GET',
    path: '/api/v1/global-search',
    operationId: 'searchGlobal',
    summary: '全局搜索证书、资产、设置和插件',
    tags,
    responseSchema: { type: 'object', additionalProperties: true },
  }];
}

function readQuery(request: HttpRequest, key: string): string {
  const value = request.query[key];
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
}

async function canReadAny(
  context: ReturnType<typeof requireRouteSecurity>,
  actions: string[],
  resourceType: string,
): Promise<boolean> {
  for (const action of actions) {
    try {
      await assertRouteAction(context, action, resourceType);
      return true;
    } catch {
      // 搜索需要按权限降级，不应因单个资源类别无权限而使整体失败。
    }
  }
  return false;
}

async function certificatePermissions(
  context: ReturnType<typeof requireRouteSecurity>,
): Promise<{ assets: PageQuery; versions: PageQuery } | undefined> {
  if (!await canReadAny(context, ['certificate.asset.read', 'certificate.read'], 'certificate_asset')) return undefined;
  return {
    assets: await authorizePageQuery(context, 'certificate_asset', 'read', { page: 1, pageSize: 1000, filter: {} }),
    versions: await authorizePageQuery(context, 'certificate_version', 'read', { page: 1, pageSize: 1000, filter: {} }),
  };
}

async function authorizedQueryIfAllowed(
  context: ReturnType<typeof requireRouteSecurity>,
  actions: string[],
  objectType: string,
  query: PageQuery,
): Promise<PageQuery | undefined> {
  if (!await canReadAny(context, actions, objectType)) return undefined;
  return authorizePageQuery(context, objectType, 'read', query);
}

async function authorizedIdsIfAllowed(
  context: ReturnType<typeof requireRouteSecurity>,
  actions: string[],
  objectType: string,
): Promise<string[] | undefined> {
  if (!await canReadAny(context, actions, objectType)) return undefined;
  const authorization = await context.services.objectPermissions.buildAuthorizedQuery(context.subject, objectType, 'read');
  if (authorization.unrestricted) return undefined;
  if (authorization.empty) return [];
  return authorization.objectIds ?? [];
}
