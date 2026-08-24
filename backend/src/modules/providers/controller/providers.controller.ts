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

const tags = ['Cloud Service'];

export class ProvidersController {
  constructor(
    private readonly cloudAccounts: CloudAccountAssetsApplicationService,
    private readonly security?: SecurityServices,
  ) {}

  register(router: Router): void {
    router.get('/api/v1/cloud-account-assets', '查询云账号资产', tags, (request) => this.listCloudAccounts(request));
    router.get('/api/v1/cloud-account-assets/:id', '查询云账号资产详情', tags, (request) => this.getCloudAccount(request));
    router.post('/api/v1/cloud-account-assets', '创建云账号资产', tags, (request) => this.createCloudAccount(request));
    router.patch('/api/v1/cloud-account-assets', '更新云账号资产', tags, (request) => this.updateCloudAccount(request));
    router.post('/api/v1/cloud-account-assets/delete', '删除云账号资产', tags, (request) => this.deleteCloudAccount(request));
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

}

export function getCloudAccountRouteContracts(): RouteContract[] {
  return [
    { method: 'GET', path: '/api/v1/cloud-account-assets', operationId: 'listCloudAccountAssets', summary: '查询云账号资产', tags, responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/cloud-account-assets/:id', operationId: 'getCloudAccountAsset', summary: '查询云账号资产详情', tags, responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/cloud-account-assets', operationId: 'createCloudAccountAsset', summary: '创建云账号资产', tags, requestSchema: { type: 'object', required: ['displayName', 'providerKey', 'credentialRef'], additionalProperties: true }, responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'PATCH', path: '/api/v1/cloud-account-assets', operationId: 'updateCloudAccountAsset', summary: '更新云账号资产', tags, requestSchema: { type: 'object', required: ['id', 'expectedVersion'], additionalProperties: false }, responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/cloud-account-assets/delete', operationId: 'deleteCloudAccountAsset', summary: '删除云账号资产', tags, responseSchema: { type: 'object', additionalProperties: true } },
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
