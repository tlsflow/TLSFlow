import type { HttpRequest } from '../../../common/http/http-types.js';
import type { Router } from '../../../common/http/router.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import { requireTenantId } from '../../../common/http/tenant-context.js';
import { validateObject } from '../../../common/validation/schema-validation.js';
import type { CloudAccountAsset } from '../dto/providers.dto.js';
import { ProviderCatalogApplicationService } from '../application/provider-catalog.application-service.js';
import { CloudAccountAssetsApplicationService } from '../application/cloud-account-assets.application-service.js';
import { CloudProviderDiscoveryApplicationService } from '../application/cloud-provider-discovery.application-service.js';
import { ProviderOperationLedgerService } from '../application/provider-operation-ledger.service.js';
import type { TasksApplicationService } from '../../tasks/task.application-service.js';

const tags = ['Providers'];

export class ProvidersController {
  constructor(
    private readonly catalog: ProviderCatalogApplicationService,
    private readonly cloudAccounts: CloudAccountAssetsApplicationService,
    private readonly discovery?: CloudProviderDiscoveryApplicationService,
    private readonly ledger?: ProviderOperationLedgerService,
    private readonly tasks?: TasksApplicationService,
  ) {}

  register(router: Router): void {
    router.get('/api/v1/providers', '查询云服务 Provider', tags, () => ({ items: this.catalog.listProviders() }));
    router.get('/api/v1/providers/:providerKey/capabilities', '查询 Provider 产品能力', tags, (request) => this.listCapabilities(request));
    router.get('/api/v1/provider-capability-plugins', '查询 Provider 能力插件', tags, (request) => this.listCapabilities(request));
    router.get('/api/v1/cloud-account-assets', '查询云账号资产', tags, (request) => this.cloudAccounts.list(requireTenantId(request)));
    router.post('/api/v1/cloud-account-assets', '创建云账号资产', tags, (request) => this.createCloudAccount(request));
    router.patch('/api/v1/cloud-account-assets', '更新云账号资产', tags, (request) => this.updateCloudAccount(request));
    router.post('/api/v1/cloud-account-assets/delete', '删除云账号资产', tags, (request) => this.deleteCloudAccount(request));
    router.post('/api/v1/cloud-account-assets/:id/connection-test', '测试云账号连接', tags, (request) => this.testConnection(request));
    router.post('/api/v1/cloud-account-assets/:id/discover', '发现云资源', tags, (request) => this.discover(request));
    router.post('/api/v1/cloud-account-assets/:id/execute', '执行 Provider 能力', tags, (request) => this.execute(request));
    router.post('/api/v1/cloud-account-assets/:id/execute-task', '提交 Provider 能力任务', tags, (request) => this.enqueueExecute(request));
  }

  private listCapabilities(request: HttpRequest) {
    const providerKey = providerKeyFromPath(request) ?? optionalString(request.query.providerKey);
    return {
      items: this.catalog.listCapabilities({
        providerKey,
        frameworkType: optionalString(request.query.frameworkType),
        operationKey: optionalString(request.query.operationKey),
      }),
    };
  }

  private async createCloudAccount(request: HttpRequest) {
    const body = validateObject(request.body, {
      displayName: { type: 'string', required: true },
      providerKey: { type: 'string', required: true },
      accountId: { type: 'string' },
      credentialRef: { type: 'string', required: true },
      scope: { type: 'object' },
      metadata: { type: 'object' },
    });
    return {
      statusCode: 201,
      body: await this.cloudAccounts.create(requireTenantId(request), body as never),
    };
  }

  private async updateCloudAccount(request: HttpRequest) {
    const body = validateObject(request.body, {
      id: { type: 'string', required: true },
      displayName: { type: 'string' },
      accountId: { type: 'string' },
      credentialRef: { type: 'string' },
      scope: { type: 'object' },
      status: { type: 'string' },
      metadata: { type: 'object' },
    });
    const { id, ...input } = body;
    return this.cloudAccounts.update(requireTenantId(request), String(id), input as never);
  }

  private async deleteCloudAccount(request: HttpRequest) {
    const body = validateObject(request.body, { id: { type: 'string', required: true } });
    return this.cloudAccounts.delete(requireTenantId(request), String(body.id));
  }

  private async testConnection(request: HttpRequest) {
    const id = request.path.match(/^\/api\/v1\/cloud-account-assets\/([^/]+)\/connection-test$/)?.[1];
    if (!id) throw new Error('云账号资产路径无效');
    const asset = await this.cloudAccounts.get(requireTenantId(request), decodeURIComponent(id));
    return this.catalog.testConnection(asset, request.context.requestId);
  }

  private async discover(request: HttpRequest) {
    const id = request.path.match(/^\/api\/v1\/cloud-account-assets\/([^/]+)\/discover$/)?.[1];
    if (!id) throw new Error('云账号资产路径无效');
    const asset = await this.cloudAccounts.get(requireTenantId(request), decodeURIComponent(id));
    const frameworkTypes = request.body && typeof request.body === 'object'
      ? (request.body as Record<string, unknown>).frameworkTypes
      : undefined;
    return this.discovery
      ? this.discovery.discoverAndProject(asset.tenantId, asset, Array.isArray(frameworkTypes) ? frameworkTypes.filter((item): item is string => typeof item === 'string') : undefined, request.context.requestId)
      : this.catalog.execute({
          tenantId: asset.tenantId,
          asset,
          frameworkType: `${asset.providerKey}.cdn`,
          operationKey: 'certificate.discover',
          target: { frameworkType: `${asset.providerKey}.cdn`, resourceId: asset.id },
          requestId: request.context.requestId,
        });
  }

  private async execute(request: HttpRequest) {
    const id = request.path.match(/^\/api\/v1\/cloud-account-assets\/([^/]+)\/execute$/)?.[1];
    if (!id) throw new Error('云账号资产路径无效');
    const body = validateObject(request.body, {
      frameworkType: { type: 'string', required: true },
      operationKey: { type: 'string', required: true },
      target: { type: 'object', required: true },
      input: { type: 'object' },
    });
    const asset = await this.cloudAccounts.get(requireTenantId(request), decodeURIComponent(id));
    const execute = {
      tenantId: asset.tenantId,
      asset,
      frameworkType: String(body.frameworkType),
      operationKey: String(body.operationKey),
      target: body.target as never,
      requestId: request.context.requestId,
      input: (body.input as Record<string, unknown> | undefined) ?? {},
    };
    return this.ledger ? this.ledger.execute(execute) : this.catalog.execute(execute);
  }

  private async enqueueExecute(request: HttpRequest) {
    if (!this.tasks) throw new Error('Provider 任务控制面未配置');
    const id = request.path.match(/^\/api\/v1\/cloud-account-assets\/([^/]+)\/execute-task$/)?.[1];
    if (!id) throw new Error('云账号资产路径无效');
    const body = validateObject(request.body, {
      frameworkType: { type: 'string', required: true },
      operationKey: { type: 'string', required: true },
      target: { type: 'object', required: true },
      input: { type: 'object' },
      idempotencyKey: { type: 'string' },
    });
    const asset = await this.cloudAccounts.get(requireTenantId(request), decodeURIComponent(id));
    const task = await this.tasks.enqueue({
      tenantId: asset.tenantId,
      taskType: 'PROVIDER_OPERATION',
      requestedBy: request.context.actorId,
      triggerSource: 'api',
      idempotencyKey: optionalString(body.idempotencyKey),
      resourceSummary: { assetId: asset.id, providerKey: asset.providerKey, operationKey: body.operationKey },
      resourceRefs: [{ resourceType: 'cloud_account_asset', resourceId: asset.id, displayKey: asset.displayName }],
      payload: {
        cloudAccountAssetId: asset.id,
        frameworkType: String(body.frameworkType),
        operationKey: String(body.operationKey),
        target: body.target,
        input: body.input && typeof body.input === 'object' ? body.input : {},
      },
    }, request.context.actorId ? { id: request.context.actorId, type: 'user', scope: { tenantId: asset.tenantId } } : undefined);
    return { statusCode: 202, body: { taskId: task.id, status: task.status } };
  }
}

export function getProvidersRouteContracts(): RouteContract[] {
  return [
    { method: 'GET', path: '/api/v1/providers', operationId: 'listProviders', summary: '查询云服务 Provider', tags, responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/providers/:providerKey/capabilities', operationId: 'listProviderCapabilities', summary: '查询 Provider 产品能力', tags, responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/provider-capability-plugins', operationId: 'listProviderCapabilityPlugins', summary: '查询 Provider 能力插件', tags, responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/cloud-account-assets', operationId: 'listCloudAccountAssets', summary: '查询云账号资产', tags, responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/cloud-account-assets', operationId: 'createCloudAccountAsset', summary: '创建云账号资产', tags, responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'PATCH', path: '/api/v1/cloud-account-assets', operationId: 'updateCloudAccountAsset', summary: '更新云账号资产', tags, responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/cloud-account-assets/delete', operationId: 'deleteCloudAccountAsset', summary: '删除云账号资产', tags, responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/cloud-account-assets/:id/connection-test', operationId: 'testCloudAccountAssetConnection', summary: '测试云账号连接', tags, responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/cloud-account-assets/:id/discover', operationId: 'discoverCloudAccountResources', summary: '发现云资源', tags, responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/cloud-account-assets/:id/execute', operationId: 'executeProviderCapability', summary: '执行 Provider 能力', tags, responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/cloud-account-assets/:id/execute-task', operationId: 'enqueueProviderCapability', summary: '提交 Provider 能力任务', tags, responseSchema: { type: 'object', additionalProperties: true } },
  ];
}

function providerKeyFromPath(request: HttpRequest): string | undefined {
  const match = request.path.match(/^\/api\/v1\/providers\/([^/]+)\/capabilities$/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
