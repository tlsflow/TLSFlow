import type { HttpRequest } from '../../../common/http/http-types.js';
import { AppError } from '../../../common/errors/app-error.js';
import type { Router } from '../../../common/http/router.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import type { SecurityServices } from '../../security/security.controller.js';
import {
  assertRouteAction,
  assertRouteObjectAccess,
  filterAuthorizedItems,
  requireRouteSecurity,
} from '../../security/security-route-helpers.js';
import { CloudAccountAssetsApplicationService } from '../application/cloud-account-assets.application-service.js';
import { cloudCapabilityActionTypes, type CloudCapabilityAction } from '../application/cloud-capability-task.service.js';
import type { TaskEnqueuer } from '../../tasks/task-enqueue.js';
import { createHash } from 'node:crypto';

const tags = ['Cloud Service'];

export class ProvidersController {
  constructor(
    private readonly cloudAccounts: CloudAccountAssetsApplicationService,
    private readonly security?: SecurityServices,
    private readonly tasks?: TaskEnqueuer,
  ) {}

  register(router: Router): void {
    router.get('/api/v1/cloud-account-assets', '查询云账号资产', tags, (request) => this.listCloudAccounts(request));
    router.get('/api/v1/cloud-account-assets/:id', '查询云账号资产详情', tags, (request) => this.getCloudAccount(request));
    router.post('/api/v1/cloud-account-assets', '创建云账号资产', tags, (request) => this.createCloudAccount(request));
    router.patch('/api/v1/cloud-account-assets', '更新云账号资产', tags, (request) => this.updateCloudAccount(request));
    router.post('/api/v1/cloud-account-assets/delete', '删除云账号资产', tags, (request) => this.deleteCloudAccount(request));
    router.post('/api/v1/cloud-account-assets/:id/actions/:action', '执行云账号 Capability 任务', tags, (request) => this.enqueueCapabilityAction(request));
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

  private async enqueueCapabilityAction(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    await assertRouteAction(security, 'cloud_account_asset.update', 'cloud_account_asset');
    if (!this.tasks) throw new Error('统一任务控制面未接入云 Capability');
    const match = request.path.match(/^\/api\/v1\/cloud-account-assets\/([^/]+)\/actions\/([^/]+)$/);
    if (!match) throw new Error('云账号 Capability 路径无效');
    const assetId = decodeURIComponent(match[1]!);
    const action = decodeURIComponent(match[2]!) as CloudCapabilityAction;
    const taskType = cloudCapabilityTaskType(action);
    const asset = await this.cloudAccounts.get(security.tenantId, assetId);
    await assertRouteObjectAccess(security, 'control', {
      objectType: 'cloud_account_asset',
      objectId: asset.id,
      tenantId: asset.tenantId,
    });
    const body = validateObject(request.body, {
      input: { type: 'object' },
      certificateArtifactRef: { type: 'string' },
      idempotencyKey: { type: 'string' },
    });
    const input = body.input as Record<string, unknown> | undefined;
    const idempotencyKey = readIdempotencyKey(request, body.idempotencyKey)
      ?? `cloud:${asset.id}:${action}:${asset.version}:${createHash('sha256').update(JSON.stringify(input ?? {}), 'utf8').digest('hex')}`;
    const task = await this.tasks.enqueue({
      tenantId: security.tenantId,
      taskType,
      requestedBy: request.context.actorId ?? 'system',
      triggerSource: `cloud-account-asset.${action}`,
      idempotencyKey,
      idempotencyScope: {
        actionType: `cloud-account-asset.${action}`,
        resourceType: 'cloudAccountAsset',
        resourceId: asset.id,
      },
      payload: {
        action,
        cloudAccountAssetId: asset.id,
        ...(input ? { input } : {}),
        ...(typeof body.certificateArtifactRef === 'string' ? { certificateArtifactRef: body.certificateArtifactRef } : {}),
      },
      resourceSummary: { displayName: asset.displayName, providerKey: asset.providerKey, action },
      resourceRefs: [{ resourceType: 'cloudAccountAsset', resourceId: asset.id }],
    });
    return { statusCode: 202, body: { taskId: task.id, taskType: task.taskType, status: task.status } };
  }

}

export function getCloudAccountRouteContracts(): RouteContract[] {
  return [
    { method: 'GET', path: '/api/v1/cloud-account-assets', operationId: 'listCloudAccountAssets', summary: '查询云账号资产', tags, responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/cloud-account-assets/:id', operationId: 'getCloudAccountAsset', summary: '查询云账号资产详情', tags, responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/cloud-account-assets', operationId: 'createCloudAccountAsset', summary: '创建云账号资产', tags, requestSchema: { type: 'object', required: ['displayName', 'providerKey', 'credentialRef'], additionalProperties: true }, responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'PATCH', path: '/api/v1/cloud-account-assets', operationId: 'updateCloudAccountAsset', summary: '更新云账号资产', tags, requestSchema: { type: 'object', required: ['id', 'expectedVersion'], additionalProperties: false }, responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/cloud-account-assets/delete', operationId: 'deleteCloudAccountAsset', summary: '删除云账号资产', tags, responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/cloud-account-assets/:id/actions/:action', operationId: 'enqueueCloudCapabilityAction', summary: '执行云账号 Capability 任务', tags, requestSchema: { type: 'object', additionalProperties: true }, responseSchema: { type: 'object', additionalProperties: true } },
  ];
}

function cloudCapabilityTaskType(action: CloudCapabilityAction): string {
  const map: Record<CloudCapabilityAction, string> = {
    'connection-test': cloudCapabilityActionTypes.CONNECTION_TEST,
    discover: cloudCapabilityActionTypes.DISCOVER,
    deploy: cloudCapabilityActionTypes.DEPLOY,
    verify: cloudCapabilityActionTypes.VERIFY,
    rollback: cloudCapabilityActionTypes.ROLLBACK,
  };
  const taskType = map[action];
  if (!Object.hasOwn(map, action) || !taskType) throw new AppError('VALIDATION_FAILED', `不支持的 Cloud Capability action: ${action}`);
  return taskType;
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
