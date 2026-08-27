import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { AppError } from '../../../common/errors/app-error.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import type { SecurityServices } from '../../security/security.controller.js';
import {
  assertRouteAction,
  assertRouteObjectAccess,
  filterAuthorizedItems,
  requireRouteSecurity,
} from '../../security/security-route-helpers.js';
import { CloudAccountAssetsApplicationService } from '../application/cloud-account-assets.application-service.js';
import { CloudAccountDiscoveryApplicationService, type CloudAccountDiscoveryOperation } from '../application/cloud-account-discovery.application-service.js';
import type { UnifiedPluginsApplicationService } from '../../plugins/application/unified-plugins.application-service.js';
import { CloudAccountOnboardingRecipeLoader } from '../../plugins/onboarding/cloud-account-onboarding-recipe.loader.js';
import { PluginLocaleService } from '../../plugins/locales/plugin-locale.service.js';

const tags = ['Cloud Service'];

function parseResource(content: string | undefined): Record<string, unknown> {
  if (!content) throw new AppError('VALIDATION_FAILED', '云账号接入资源不存在');
  try {
    const value = JSON.parse(content);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
    return value as Record<string, unknown>;
  } catch {
    throw new AppError('VALIDATION_FAILED', '云账号接入资源不是合法 JSON');
  }
}

export class ProvidersController {
  constructor(
    private readonly cloudAccounts: CloudAccountAssetsApplicationService,
    private readonly discovery?: CloudAccountDiscoveryApplicationService,
    private readonly security?: SecurityServices,
    private readonly plugins?: Pick<UnifiedPluginsApplicationService, 'listCatalog' | 'getVersionForTenant'>,
  ) {}

  register(router: Router): void {
    router.get('/api/v1/cloud-account-assets', '查询云账号资产', tags, (request) => this.listCloudAccounts(request));
    router.get('/api/v1/cloud-account-assets/:id', '查询云账号资产详情', tags, (request) => this.getCloudAccount(request));
    router.get('/api/v1/cloud-account-assets/:id/resources', '查询云账号发现资源', tags, (request) => this.listCloudAccountResources(request));
    router.post('/api/v1/cloud-account-assets', '创建云账号资产', tags, (request) => this.createCloudAccount(request));
    router.patch('/api/v1/cloud-account-assets', '更新云账号资产', tags, (request) => this.updateCloudAccount(request));
    router.post('/api/v1/cloud-account-assets/delete', '删除云账号资产', tags, (request) => this.deleteCloudAccount(request));
    router.post('/api/v1/cloud-account-assets/:id/connection-test', '测试云账号连接', tags, (request) => this.runCloudAccountAction(request, 'connection-test'));
    router.post('/api/v1/cloud-account-assets/:id/discover', '发现云账号资源', tags, (request) => this.runCloudAccountAction(request, 'discover'));
    router.get('/api/v1/cloud-account-onboarding/recipes', '查询云账号接入配方', tags, (request) => this.listCloudAccountOnboardingRecipes(request));
  }

  private async listCloudAccountOnboardingRecipes(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    await assertRouteAction(security, 'cloud_account_asset.create', 'cloud_account_asset');
    if (!this.plugins) return { items: [], page: 1, pageSize: 0, total: 0 };
    const locale = typeof request.query.locale === 'string' ? request.query.locale : 'zh-CN';
    const catalog = await this.plugins.listCatalog(security.tenantId, locale);
    const loader = new CloudAccountOnboardingRecipeLoader();
    const locales = new PluginLocaleService();
    const items = [];
    for (const item of catalog.filter((candidate) => candidate.status === 'ENABLED')) {
      try {
        const version = await this.plugins.getVersionForTenant(security.tenantId, item.pluginVersionId);
        const loaded = loader.load(version);
        const localeBundle = locales.validate(version.manifest, version.resources, [
          loaded.recipe.display.nameKey,
          ...(loaded.recipe.display.descriptionKey ? [loaded.recipe.display.descriptionKey] : []),
          ...loaded.recipe.platformMetadata.compatibilityKeys,
          ...loaded.recipe.platformMetadata.requiredInformationKeys,
        ]);
        const resolve = (key: string): string => locales.resolve(localeBundle!, locale, key) ?? key;
        items.push({
          pluginId: loaded.pluginId,
          pluginVersionId: loaded.pluginVersionId,
          version: loaded.pluginVersion,
          displayName: resolve(loaded.recipe.display.nameKey),
          ...(loaded.recipe.display.descriptionKey ? { description: resolve(loaded.recipe.display.descriptionKey) } : {}),
          businessMetadata: {
            // 与应用资产向导保持一致，展示实际绑定的不可变插件版本，而非配方合同版本。
            capabilityVersion: loaded.pluginVersion,
            compatibleVersions: loaded.recipe.platformMetadata.compatibilityKeys.map(resolve),
            requiredInformation: loaded.recipe.platformMetadata.requiredInformationKeys.map(resolve),
          },
          ...(item.logoUrl ? { logoUrl: item.logoUrl } : {}),
          ...(item.logoSquareUrl ? { logoSquareUrl: item.logoSquareUrl } : {}),
          recipe: loaded.recipe,
          form: parseResource(version.resources[loaded.recipe.formResource]),
          credentialContract: parseResource(version.resources[loaded.recipe.credentialContractResource]),
        });
      } catch {
        // 单个插件资源无效时返回结构化不可用列表，不阻断其他 Provider。
      }
    }
    return { items, page: 1, pageSize: items.length, total: items.length };
  }

  private async listCloudAccounts(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    await assertRouteAction(security, 'cloud_account_asset.read', 'cloud_account_asset');
    const page = await this.cloudAccounts.list(security.tenantId);
    return {
      ...page,
      items: await filterAuthorizedItems(security, page.items, 'cloud_account_asset', 'read'),
    };
  }

  private async getCloudAccount(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const id = request.path.match(/^\/api\/v1\/cloud-account-assets\/([^/]+)$/)?.[1];
    if (!id) throw new Error('云账号资产详情路径无效');
    const asset = await this.cloudAccounts.get(security.tenantId, decodeURIComponent(id));
    await assertRouteAction(security, 'cloud_account_asset.read', 'cloud_account_asset', { resourceId: asset.id });
    await assertRouteObjectAccess(security, 'read', {
      objectType: 'cloud_account_asset',
      objectId: asset.id,
      tenantId: asset.tenantId,
    });
    return asset;
  }

  private async createCloudAccount(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    await assertRouteAction(security, 'cloud_account_asset.create', 'cloud_account_asset');
    const body = validateObject(request.body, {
      displayName: { type: 'string', required: true },
      providerKey: { type: 'string', required: true },
      pluginVersionId: { type: 'string' },
      accountId: { type: 'string' },
      credentialRef: { type: 'string', required: true },
      scope: { type: 'object' },
      metadata: { type: 'object' },
      idempotencyKey: { type: 'string' },
    });
    const idempotencyKey = readIdempotencyKey(request, body.idempotencyKey);
    return {
      statusCode: 201,
      body: await this.cloudAccounts.create(security.tenantId, { ...body, ...(idempotencyKey ? { idempotencyKey } : {}) } as never),
    };
  }

  private async updateCloudAccount(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const body = validateObject(request.body, {
      id: { type: 'string', required: true },
      expectedVersion: { type: 'number', required: true },
      displayName: { type: 'string' },
      accountId: { type: 'string' },
      credentialRef: { type: 'string' },
      scope: { type: 'object' },
      status: { type: 'string' },
      metadata: { type: 'object' },
      idempotencyKey: { type: 'string' },
    });
    const { id, ...input } = body;
    const idempotencyKey = readIdempotencyKey(request, input.idempotencyKey);
    await assertRouteAction(security, 'cloud_account_asset.update', 'cloud_account_asset', { resourceId: String(id) });
    await assertRouteObjectAccess(security, 'edit', { objectType: 'cloud_account_asset', objectId: String(id), tenantId: security.tenantId });
    return this.cloudAccounts.update(security.tenantId, String(id), { ...input, ...(idempotencyKey ? { idempotencyKey } : {}) } as never);
  }

  private async deleteCloudAccount(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    const body = validateObject(request.body, { id: { type: 'string', required: true }, idempotencyKey: { type: 'string' } });
    const idempotencyKey = readIdempotencyKey(request, body.idempotencyKey);
    await assertRouteAction(security, 'cloud_account_asset.delete', 'cloud_account_asset', { resourceId: String(body.id) });
    await assertRouteObjectAccess(security, 'control', { objectType: 'cloud_account_asset', objectId: String(body.id), tenantId: security.tenantId });
    return this.cloudAccounts.delete(security.tenantId, String(body.id), idempotencyKey);
  }

  private async runCloudAccountAction(request: HttpRequest, operation: CloudAccountDiscoveryOperation) {
    if (!this.discovery) throw new AppError('CAPABILITY_MISSING', '云账号发现服务未完成装配');
    const security = requireRouteSecurity(request, this.security);
    const match = request.path.match(/^\/api\/v1\/cloud-account-assets\/([^/]+)\/(connection-test|discover)$/);
    const id = match?.[1];
    if (!id) throw new AppError('VALIDATION_FAILED', '云账号动作路径无效');
    const assetId = decodeURIComponent(id);
    await assertRouteAction(security, 'cloud_account_asset.control', 'cloud_account_asset', { resourceId: assetId });
    await assertRouteObjectAccess(security, 'control', { objectType: 'cloud_account_asset', objectId: assetId, tenantId: security.tenantId });
    return this.discovery.execute(security.tenantId, assetId, operation);
  }

  private async listCloudAccountResources(request: HttpRequest) {
    if (!this.discovery) throw new AppError('CAPABILITY_MISSING', '云账号发现服务未完成装配');
    const security = requireRouteSecurity(request, this.security);
    const id = request.path.match(/^\/api\/v1\/cloud-account-assets\/([^/]+)\/resources$/)?.[1];
    if (!id) throw new AppError('VALIDATION_FAILED', '云账号资源路径无效');
    const assetId = decodeURIComponent(id);
    await assertRouteAction(security, 'cloud_account_asset.read', 'cloud_account_asset', { resourceId: assetId });
    await assertRouteObjectAccess(security, 'read', { objectType: 'cloud_account_asset', objectId: assetId, tenantId: security.tenantId });
    return this.discovery.listResources(security.tenantId, assetId);
  }

}

export function getCloudAccountRouteContracts(): RouteContract[] {
  return [
    { method: 'GET', path: '/api/v1/cloud-account-assets', operationId: 'listCloudAccountAssets', summary: '查询云账号资产', tags, responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/cloud-account-assets/:id', operationId: 'getCloudAccountAsset', summary: '查询云账号资产详情', tags, responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/cloud-account-assets/:id/resources', operationId: 'listCloudAccountResources', summary: '查询云账号发现资源', tags, responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/cloud-account-assets', operationId: 'createCloudAccountAsset', summary: '创建云账号资产', tags, requestSchema: { type: 'object', required: ['displayName', 'providerKey', 'credentialRef'], additionalProperties: true }, responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'PATCH', path: '/api/v1/cloud-account-assets', operationId: 'updateCloudAccountAsset', summary: '更新云账号资产', tags, requestSchema: { type: 'object', required: ['id', 'expectedVersion'], additionalProperties: false }, responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/cloud-account-assets/delete', operationId: 'deleteCloudAccountAsset', summary: '删除云账号资产', tags, responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/cloud-account-assets/:id/connection-test', operationId: 'testCloudAccountConnection', summary: '测试云账号连接', tags, responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/cloud-account-assets/:id/discover', operationId: 'discoverCloudAccountResources', summary: '发现云账号资源', tags, responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/cloud-account-onboarding/recipes', operationId: 'listCloudAccountOnboardingRecipes', summary: '查询云账号接入配方', tags, responseSchema: { type: 'object', additionalProperties: true } },
  ];
}

function readIdempotencyKey(request: HttpRequest, bodyValue?: unknown): string | undefined {
  const header = request.headers['x-idempotency-key'] ?? request.headers['idempotency-key'];
  const value = Array.isArray(header) ? header[0] : header;
  const candidate = value ?? bodyValue;
  if (candidate === undefined) return undefined;
  const normalized = String(candidate).trim();
  if (!normalized) throw new AppError('VALIDATION_FAILED', 'idempotencyKey 不能为空', { field: 'idempotencyKey' });
  return normalized;
}
