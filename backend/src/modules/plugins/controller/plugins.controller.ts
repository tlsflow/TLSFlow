import type { Router } from '../../../common/http/router.js';
import type { HttpRequest } from '../../../common/http/http-types.js';
import type { RouteContract } from '../../../common/openapi/route-contract.js';
import type { OpenApiSchema } from '../../../common/openapi/route-contract.js';
import { AppError } from '../../../common/errors/app-error.js';
import type { ObjectValidationSchema } from '../../../common/validation/schema-validation.js';
import { validateObject as validateBaseObject } from '../../../common/validation/schema-validation.js';
import { UnifiedPluginsApplicationService } from '../application/unified-plugins.application-service.js';
import { isCloudAccountIdentificationCapability, PluginBindingsApplicationService } from '../application/plugin-bindings.application-service.js';
import { ManagedTargetPluginQueryService, type SaveManagedTargetPluginOverrideInput } from '../application/managed-target-plugin-query.service.js';
import type { ImportUnifiedPluginVersionInput, UnifiedPluginManifestV1 } from '../dto/unified-plugins.dto.js';
import { semanticVersionPattern } from '../schema/unified-plugins.schema.js';
import { StandardPluginFieldRegistry } from '../forms/standard-plugin-field.registry.js';
import { PluginCapabilityRegistry } from '../capabilities/plugin-capability.registry.js';
import { PluginPromotionService } from '../promotion/plugin-promotion.service.js';
import { pluginRuntimeGuard } from '../runtime/plugin-runtime-guard.service.js';
import { enqueueTaskBestEffort, isUnifiedTaskWorkerEnabled, type TaskEnqueuer } from '../../tasks/task-enqueue.js';
import type { SecurityServices } from '../../security/security.controller.js';
import {
  assertRouteAction,
  assertRouteObjectAccess,
  decorateAuthorizedItem,
  filterAuthorizedItems,
  requireRouteSecurity,
  type RouteSecurityContext,
} from '../../security/security-route-helpers.js';
import { unifiedPluginVersionOwnerType } from '../application/unified-plugins.application-service.js';
import type { CloudAccountAssetsApplicationService } from '../../providers/application/cloud-account-assets.application-service.js';
import type { PluginRefreshResult } from '../dto/plugin-refresh-result.dto.js';
import type { ApplicationOnboardingDeploymentDefaultsV1 } from '../onboarding/application-onboarding-recipe.dto.js';
import type { PluginWorkflowPublisherService } from '../application/plugin-workflow-publisher.service.js';
import type { ApplicationExecutionCompatibilityService } from '../../assets/application/application-execution-compatibility.service.js';

export interface BuiltinPluginCatalogRefresher {
  refresh(tenantId?: string): Promise<PluginRefreshResult>;
}

const tags = ['Plugins'];

export class PluginsController {
  private readonly standardFields = new StandardPluginFieldRegistry();
  private readonly capabilityRegistry = new PluginCapabilityRegistry();
  constructor(
    private readonly unifiedPlugins = new UnifiedPluginsApplicationService(),
    private readonly pluginBindings = new PluginBindingsApplicationService(),
    private readonly promotions?: PluginPromotionService,
    private readonly managedTargetPlugins?: ManagedTargetPluginQueryService,
    private readonly builtinCatalogRefresher?: BuiltinPluginCatalogRefresher,
    private readonly tasks?: TaskEnqueuer,
    private readonly security?: SecurityServices,
    private readonly cloudAccounts?: CloudAccountAssetsApplicationService,
    private readonly pluginWorkflowPublisher?: Pick<PluginWorkflowPublisherService, 'publishPlugin'>,
    private readonly executionCompatibility?: ApplicationExecutionCompatibilityService,
  ) {}

  register(router: Router): void {
    router.get('/api/v1/plugin-catalog', '查询统一插件目录', tags, (request) => this.listCatalog(request));
    router.post('/api/v1/plugin-catalog/refresh-builtins', '刷新插件目录', tags, (request) => this.refreshBuiltinCatalog(request));
    router.get('/api/v1/plugin-versions', '查询统一插件版本', tags, (request) => this.listUnifiedPluginVersions(request));
    router.get('/api/v1/plugin-version-groups', '查询插件版本分组', tags, (request) => this.listPluginVersionGroups(request));
    router.get('/api/v1/plugin-version-management/:pluginVersionId', '查询插件版本管理详情', tags, (request) => this.getPluginVersionManagementDetail(request));
    router.post('/api/v1/plugin-packages/import', '导入统一插件版本', tags, (request) => this.importUnifiedPluginVersion(request));
    router.post('/api/v1/plugin-versions/approve-permissions', '审批统一插件权限', tags, (request) => this.approveUnifiedPluginPermissions(request));
    router.post('/api/v1/plugin-versions/enable', '启用统一插件版本', tags, (request) => this.enableUnifiedPluginVersion(request));
    router.post('/api/v1/plugin-versions/disable', '禁用统一插件版本', tags, (request) => this.disableUnifiedPluginVersion(request));
    router.post('/api/v1/plugin-versions/retire', '退休统一插件版本', tags, (request) => this.retireUnifiedPluginVersion(request));
    router.get('/api/v1/plugin-versions/upgrade-diff', '查询统一插件升级差异', tags, (request) => this.getUnifiedPluginUpgradeDiff(request));
    router.get('/api/v1/plugin-form/standard-fields', '查询插件标准字段', tags, (request) => this.listStandardFields(request));
    router.get('/api/v1/plugin-capabilities', '查询宿主支持的插件能力 Contract', tags, (request) => this.listPluginCapabilities(request));
    router.get('/api/v1/plugin-versions/ui-resources', '查询插件表单、展示和语言资源', tags, (request) => this.getUnifiedPluginUiResources(request));
    router.get('/api/v1/plugin-versions/:pluginVersionId/resources/logos/:variant', '读取插件包 Logo 资源', tags, (request) => this.getUnifiedPluginLogo(request));
    router.post('/api/v1/plugin-bindings', '创建统一插件绑定', tags, (request) => this.createPluginBinding(request));
    router.get('/api/v1/plugin-bindings', '查询统一插件绑定', tags, (request) => this.getPluginBinding(request));
    router.patch('/api/v1/plugin-bindings', '更新统一插件绑定', tags, (request) => this.updatePluginBinding(request));
    router.post('/api/v1/cloud-account-assets/:id/capability-binding', '固定云账号插件能力绑定', tags, (request) => this.createCloudAccountCapabilityBinding(request));
    router.post('/api/v1/capability-assignments', '设置插件能力指派', tags, (request) => this.assignPluginCapability(request));
    router.post('/api/v1/capability-assignments/resolve', '解析插件能力来源', tags, (request) => this.resolvePluginCapability(request));
    router.post('/api/v1/plugin-promotions/preview', '预览 Standalone 目标归集', tags, (request) => this.previewPromotion(request));
    router.post('/api/v1/plugin-promotions/confirm', '确认 Standalone 目标归集', tags, (request) => this.confirmPromotion(request));
    router.post('/api/v1/plugin-promotions/revoke', '撤销 Standalone 目标归集', tags, (request) => this.revokePromotion(request));
    router.get('/api/v1/plugin-promotions', '查询 Standalone 目标归集记录', tags, (request) => this.getPromotion(request));
    router.get('/api/v1/plugin-runtime/metrics', '查询插件运行指标', tags, (request) => this.listRuntimeMetrics(request));
    router.get('/api/v1/managed-targets/:managedTargetId/deployment-capabilities/:capabilityKey', '查询受管目标生效部署能力', tags, (request) => this.getManagedTargetEffectiveCapability(request));
    router.get('/api/v1/managed-targets/:managedTargetId/compatible-plugins', '查询受管目标兼容插件', tags, (request) => this.listManagedTargetCompatiblePlugins(request));
    router.post('/api/v1/managed-targets/:managedTargetId/deployment-input-projection', '生成应用资产插件部署输入投影', tags, (request) => this.projectApplicationAssetPluginInputs(request));
    router.put('/api/v1/application-assets/:applicationAssetId/managed-target', '保存应用资产受管目标和插件覆盖', tags, (request) => this.saveApplicationAssetManagedTarget(request));
  }

  private async listCatalog(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.read', 'plugin');
    const locale = typeof request.query['filter[locale]'] === 'string' ? request.query['filter[locale]'] : 'zh-CN';
    const runtime = queryFilterString(request, 'runtime');
    const items = await this.unifiedPlugins.listCatalog(security.tenantId, locale, {
      ...(runtime ? { runtime: runtime as UnifiedPluginManifestV1['runtime'] } : {}),
    });
    const authorizedItems = await this.filterVersionItems(security, items, 'pluginVersionId');
    return { items: authorizedItems, page: 1, pageSize: authorizedItems.length, total: authorizedItems.length };
  }

  private async refreshBuiltinCatalog(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.manage', 'plugin');
    if (!this.builtinCatalogRefresher) throw new Error('内置插件热刷新服务未接入');
    if (this.tasks && isUnifiedTaskWorkerEnabled()) {
      const task = await this.tasks.enqueue({
        tenantId: security.tenantId,
        taskType: 'PLUGIN_REFERENCE_REFRESH',
        requestedBy: request.context.actorId ?? 'system',
        triggerSource: 'plugin.catalog.refresh',
        idempotencyKey: `plugin-reference-refresh:${security.tenantId}:${new Date().toISOString().slice(0, 16)}`,
        payload: { scope: 'builtin-catalog' },
        resourceRefs: [{ resourceType: 'pluginCatalog', resourceId: 'builtin' }],
      });
      return { statusCode: 202, body: { taskId: task.id, status: task.status } };
    }
    return this.builtinCatalogRefresher.refresh(security.tenantId);
  }

  private async listUnifiedPluginVersions(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.read', 'plugin');
    const items = (await this.unifiedPlugins.listVersions(security.tenantId)).map(withPluginVersionIdentity);
    const authorizedItems = await filterAuthorizedItems(security, items, 'plugin_version', 'read');
    return { items: authorizedItems, page: 1, pageSize: authorizedItems.length, total: authorizedItems.length };
  }

  private async listPluginVersionGroups(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.read', 'plugin');
    const groups = await this.unifiedPlugins.listVersionGroups(security.tenantId);
    const result = [];
    for (const group of groups) {
      const versions = (await this.filterVersionItems(security, group.versions, 'id')).map(withPluginVersionIdentity);
      if (versions.length === 0) continue;
      result.push({
        ...group,
        versions,
        ...(group.activeVersionId && versions.some((item) => item.id === group.activeVersionId)
          ? { activeVersionId: group.activeVersionId }
          : {}),
      });
    }
    return result;
  }

  private async getPluginVersionManagementDetail(request: HttpRequest) {
    const security = this.securityContext(request);
    const pluginVersionId = request.path.match(/^\/api\/v1\/plugin-version-management\/([^/]+)$/)?.[1];
    if (!pluginVersionId) throw new Error('插件版本管理详情路径无效');
    const version = await this.requirePluginVersion(security, decodeURIComponent(pluginVersionId), 'read');
    return this.unifiedPlugins.getVersionManagementDetail(security.tenantId, version.id).then(withPluginVersionIdentity);
  }

  private async importUnifiedPluginVersion(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.manage', 'plugin');
    const body = validateObject(request.body, {
      manifest: { type: 'object', required: true },
      resources: { type: 'object' },
      packageContent: { type: 'string' },
    });
    const imported = await this.unifiedPlugins.importVersion(security.tenantId, body as unknown as ImportUnifiedPluginVersionInput);
    if (imported.runtime === 'WORKFLOW_DSL') await this.pluginWorkflowPublisher?.publishPlugin(imported);
    await this.recheckPluginCompatibility(security.tenantId, imported.pluginId);
    return {
      statusCode: 201,
      body: withPluginVersionIdentity(imported),
    };
  }

  private async approveUnifiedPluginPermissions(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.manage', 'plugin');
    const body = validateObject(request.body, {
      pluginVersionId: { type: 'string', required: true },
      approvedPermissions: { type: 'array', required: true },
    });
    const version = await this.requirePluginVersion(security, String(body.pluginVersionId), 'control');
    return this.unifiedPlugins.approvePermissions(
      version.id,
      (body.approvedPermissions as unknown[]).map(String),
    ).then(withPluginVersionIdentity);
  }

  private async enableUnifiedPluginVersion(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.manage', 'plugin');
    const body = validateObject(request.body, { pluginVersionId: { type: 'string', required: true } });
    const version = await this.requirePluginVersion(security, String(body.pluginVersionId), 'control');
    const enabled = await this.unifiedPlugins.enableVersion(version.id);
    await this.recheckPluginCompatibility(security.tenantId, enabled.pluginId);
    return withPluginVersionIdentity(enabled);
  }

  private async disableUnifiedPluginVersion(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.manage', 'plugin');
    const body = validateObject(request.body, { pluginVersionId: { type: 'string', required: true } });
    const version = await this.requirePluginVersion(security, String(body.pluginVersionId), 'control');
    const disabled = await this.unifiedPlugins.disableVersion(version.id);
    await this.recheckPluginCompatibility(security.tenantId, disabled.pluginId);
    return withPluginVersionIdentity(disabled);
  }

  private async retireUnifiedPluginVersion(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.manage', 'plugin');
    const body = validateObject(request.body, { pluginVersionId: { type: 'string', required: true } });
    const version = await this.requirePluginVersion(security, String(body.pluginVersionId), 'control');
    const retired = await this.unifiedPlugins.retireVersion(version.id);
    await this.recheckPluginCompatibility(security.tenantId, retired.pluginId);
    return withPluginVersionIdentity(retired);
  }

  private async getUnifiedPluginUpgradeDiff(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.read', 'plugin');
    const fromVersionId = typeof request.query.fromVersionId === 'string' ? request.query.fromVersionId : '';
    const toVersionId = typeof request.query.toVersionId === 'string' ? request.query.toVersionId : '';
    const [from, to] = await Promise.all([
      this.requirePluginVersion(security, fromVersionId, 'read'),
      this.requirePluginVersion(security, toVersionId, 'read'),
    ]);
    return this.unifiedPlugins.getUpgradeDiff(from.id, to.id);
  }

  private async getUnifiedPluginUiResources(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.read', 'plugin');
    const pluginVersionId = typeof request.query.pluginVersionId === 'string' ? request.query.pluginVersionId : '';
    const locale = typeof request.query.locale === 'string' ? request.query.locale : 'zh-CN';
    const version = await this.requirePluginVersion(security, pluginVersionId, 'read');
    return this.unifiedPlugins.getUiResources(version.id, locale);
  }

  private async getUnifiedPluginLogo(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.read', 'plugin');
    const match = request.path.match(/^\/api\/v1\/plugin-versions\/([^/]+)\/resources\/logos\/(horizontal|square)$/);
    if (!match) throw new AppError('RESOURCE_NOT_FOUND', '插件 Logo 资源不存在');
    const version = await this.requirePluginVersion(security, decodeURIComponent(match[1] ?? ''), 'read');
    const variant = match[2] as 'horizontal' | 'square';
    const resource = this.unifiedPlugins.getLogoResource(version, variant);
    return {
      statusCode: 200,
      headers: {
        'content-type': 'image/svg+xml; charset=utf-8',
        'cache-control': 'public, max-age=31536000, immutable',
        etag: resource.etag,
      },
      body: resource.content,
    };
  }

  private async createPluginBinding(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.manage', 'plugin');
    const body = validateObject(request.body, {
      pluginVersionId: { type: 'string', required: true }, mode: { type: 'string', required: true },
      inputBindings: { type: 'object', required: true }, managedContext: { type: 'object' },
    });
    const version = await this.requirePluginVersion(security, String(body.pluginVersionId), 'read');
    const binding = await this.pluginBindings.createBinding(security.tenantId, {
      pluginVersionId: String(body.pluginVersionId), mode: body.mode as 'MANAGED' | 'STANDALONE',
      inputBindings: body.inputBindings as never,
      managedContext: body.managedContext as never,
    });
    await this.recheckPluginCompatibility(security.tenantId, version.pluginId);
    return binding;
  }

  private async createCloudAccountCapabilityBinding(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.manage', 'plugin');
    if (!this.cloudAccounts) throw new Error('云账号资产服务未接入插件绑定控制面');
    const assetId = request.path.match(/^\/api\/v1\/cloud-account-assets\/([^/]+)\/capability-binding$/)?.[1];
    if (!assetId) throw new Error('云账号能力绑定路径无效');
    const resolvedAssetId = decodeURIComponent(assetId);
    const asset = await this.cloudAccounts.get(security.tenantId, resolvedAssetId);
    await assertRouteObjectAccess(security, 'edit', {
      objectType: 'cloud_account_asset',
      objectId: asset.id,
      tenantId: asset.tenantId,
    });
    const body = validateObject(request.body, {
      pluginVersionId: { type: 'string', required: true },
      capabilityKey: { type: 'string', required: true },
      inputBindings: { type: 'object', required: true },
    });
    const version = await this.requirePluginVersion(security, String(body.pluginVersionId), 'control');
    const capabilityKey = String(body.capabilityKey);
    if (!isCloudAccountIdentificationCapability(capabilityKey)) {
      throw new AppError('VALIDATION_FAILED', '云账号只允许绑定连接测试和资源发现能力，证书生命周期必须使用 V1 DSL Workflow', {
        capabilityKey,
      });
    }
    if (version.pluginId !== asset.providerKey) {
      throw new AppError('VALIDATION_FAILED', '云账号能力绑定的插件必须与资产 providerKey 一致', {
        providerKey: asset.providerKey,
        pluginId: version.pluginId,
      });
    }
    if (!version.manifest.capabilities.some((item) => item.key === capabilityKey)) {
      throw new AppError('VALIDATION_FAILED', '插件版本未声明该 Capability', { pluginVersionId: version.id, capabilityKey });
    }
    const binding = await this.pluginBindings.createBinding(security.tenantId, {
      pluginVersionId: version.id,
      mode: 'MANAGED',
      inputBindings: body.inputBindings as never,
      managedContext: { cloudAccountAssetId: asset.id },
    });
    const assignment = await this.pluginBindings.assignCapability(security.tenantId, {
      ownerType: 'CLOUD_ACCOUNT_ASSET',
      ownerId: asset.id,
      capabilityKey,
      pluginVersionId: version.id,
      pluginBindingId: binding.id,
      precedence: 'ASSET_OVERRIDE',
    });
    await this.recheckPluginCompatibility(security.tenantId, version.pluginId);
    return { binding, assignment };
  }

  private async getPluginBinding(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.read', 'plugin');
    const bindingId = typeof request.query.bindingId === 'string' ? request.query.bindingId : '';
    const binding = await this.pluginBindings.getTenantBinding(security.tenantId, bindingId);
    await assertRouteObjectAccess(security, 'read', {
      objectType: 'plugin_binding',
      objectId: binding.id,
      tenantId: binding.tenantId,
    });
    await this.requirePluginVersion(security, binding.pluginVersionId, 'read');
    return binding;
  }

  private async updatePluginBinding(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.manage', 'plugin');
    const body = validateObject(request.body, {
      bindingId: { type: 'string', required: true }, expectedVersion: { type: 'number', required: true },
      inputBindings: { type: 'object' }, managedContext: { type: 'object' }, status: { type: 'string' },
    });
    const binding = await this.pluginBindings.getTenantBinding(security.tenantId, String(body.bindingId));
    await assertRouteObjectAccess(security, 'edit', {
      objectType: 'plugin_binding',
      objectId: binding.id,
      tenantId: binding.tenantId,
    });
    const version = await this.requirePluginVersion(security, binding.pluginVersionId, 'read');
    const updated = await this.pluginBindings.updateBinding(security.tenantId, String(body.bindingId), body as never);
    await this.recheckPluginCompatibility(security.tenantId, version.pluginId);
    return updated;
  }

  private async assignPluginCapability(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.manage', 'plugin');
    const body = validateObject(request.body, {
      ownerType: { type: 'string', required: true }, ownerId: { type: 'string', required: true }, capabilityKey: { type: 'string', required: true },
      pluginVersionId: { type: 'string', required: true }, pluginBindingId: { type: 'string', required: true }, precedence: { type: 'string', required: true },
    });
    const binding = await this.pluginBindings.getTenantBinding(security.tenantId, String(body.pluginBindingId));
    await assertRouteObjectAccess(security, 'edit', {
      objectType: 'plugin_binding',
      objectId: binding.id,
      tenantId: binding.tenantId,
    });
    const version = await this.requirePluginVersion(security, String(body.pluginVersionId), 'read');
    await this.assertObjectReadForOwner(security, String(body.ownerType), String(body.ownerId));
    const assignment = await this.pluginBindings.assignCapability(security.tenantId, body as never);
    await this.recheckPluginCompatibility(security.tenantId, version.pluginId);
    return assignment;
  }

  private async resolvePluginCapability(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.read', 'plugin');
    const body = validateObject(request.body, {
      capabilityKey: { type: 'string', required: true }, deviceId: { type: 'string' }, managedTargetId: { type: 'string' }, applicationAssetId: { type: 'string' }, serviceAssetId: { type: 'string' }, cloudAccountAssetId: { type: 'string' },
    });
    const owners = {
      deviceId: typeof body.deviceId === 'string' ? body.deviceId : undefined,
      managedTargetId: typeof body.managedTargetId === 'string' ? body.managedTargetId : undefined,
      applicationAssetId: typeof body.applicationAssetId === 'string' ? body.applicationAssetId : undefined,
      serviceAssetId: typeof body.serviceAssetId === 'string' ? body.serviceAssetId : undefined,
      cloudAccountAssetId: typeof body.cloudAccountAssetId === 'string' ? body.cloudAccountAssetId : undefined,
    };
    for (const [ownerType, ownerId] of [
      ['DEVICE', owners.deviceId],
      ['MANAGED_TARGET', owners.managedTargetId],
      ['APPLICATION_ASSET', owners.applicationAssetId],
      ['SERVICE_ASSET', owners.serviceAssetId],
      ['CLOUD_ACCOUNT_ASSET', owners.cloudAccountAssetId],
    ] as const) {
      if (ownerId) await this.assertObjectReadForOwner(security, ownerType, ownerId);
    }
    const assignment = await this.pluginBindings.resolveAssignment(security.tenantId, String(body.capabilityKey), owners);
    if (assignment) {
      await assertRouteObjectAccess(security, 'read', {
        objectType: 'plugin_capability_assignment',
        objectId: assignment.id,
        tenantId: assignment.tenantId,
      });
      await assertRouteObjectAccess(security, 'read', {
        objectType: 'plugin_binding',
        objectId: assignment.pluginBindingId,
        tenantId: assignment.tenantId,
      });
      await this.requirePluginVersion(security, assignment.pluginVersionId, 'read');
    }
    return assignment;
  }

  private async previewPromotion(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.manage', 'plugin');
    const body = validateObject(request.body, {
      sourcePluginBindingId: { type: 'string', required: true }, displayName: { type: 'string', required: true },
      deviceFamily: { type: 'string', required: true }, managementAddress: { type: 'string', required: true },
      managementPort: { type: 'number', required: true }, authMode: { type: 'string', required: true },
      tlsVerify: { type: 'boolean', required: true }, gatewayId: { type: 'string' }, applicationAssetId: { type: 'string' },
      discovery: { type: 'object', required: true },
    });
    const source = await this.pluginBindings.getTenantBinding(security.tenantId, String(body.sourcePluginBindingId));
    await assertRouteObjectAccess(security, 'control', {
      objectType: 'plugin_binding',
      objectId: source.id,
      tenantId: source.tenantId,
    });
    await this.requirePluginVersion(security, source.pluginVersionId, 'read');
    if (typeof body.gatewayId === 'string') await this.assertObjectRead(security, 'gateway', body.gatewayId);
    if (typeof body.applicationAssetId === 'string') await this.assertObjectRead(security, 'application_asset', body.applicationAssetId);
    return this.requirePromotions().preview(security.tenantId, body as never);
  }

  private async confirmPromotion(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.manage', 'plugin');
    const body = validateObject(request.body, { promotionId: { type: 'string', required: true } });
    const record = await this.requirePromotions().get(security.tenantId, String(body.promotionId));
    await this.assertPromotionObjects(security, record);
    const source = await this.pluginBindings.getTenantBinding(security.tenantId, record.sourcePluginBindingId);
    const confirmed = await this.requirePromotions().confirm(security.tenantId, record.id);
    if (source.pluginId) await this.recheckPluginCompatibility(security.tenantId, source.pluginId);
    return confirmed;
  }

  private async revokePromotion(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.manage', 'plugin');
    const body = validateObject(request.body, { promotionId: { type: 'string', required: true } });
    const record = await this.requirePromotions().get(security.tenantId, String(body.promotionId));
    await this.assertPromotionObjects(security, record);
    const source = await this.pluginBindings.getTenantBinding(security.tenantId, record.sourcePluginBindingId);
    const revoked = await this.requirePromotions().revoke(security.tenantId, record.id);
    if (source.pluginId) await this.recheckPluginCompatibility(security.tenantId, source.pluginId);
    return revoked;
  }

  private async getPromotion(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.read', 'plugin');
    const promotionId = typeof request.query.promotionId === 'string' ? request.query.promotionId : '';
    const record = await this.requirePromotions().get(security.tenantId, promotionId);
    await this.assertPromotionObjects(security, record, 'read');
    return record;
  }

  private async getManagedTargetEffectiveCapability(request: HttpRequest) {
    const security = this.securityContext(request);
    const service = this.requireManagedTargetPlugins();
    await assertRouteAction(security, 'plugin.read', 'plugin');
    const match = request.path.match(/^\/api\/v1\/managed-targets\/([^/]+)\/deployment-capabilities\/([^/]+)$/);
    if (!match) throw new Error('受管目标能力路径无效');
    const managedTargetId = decodeURIComponent(match[1]!);
    await this.assertObjectRead(security, 'managed_target', managedTargetId);
    const applicationAssetId = queryString(request, 'applicationAssetId');
    if (applicationAssetId) await this.assertObjectRead(security, 'application_asset', applicationAssetId);
    return service.getEffectiveCapability({
      tenantId: security.tenantId,
      managedTargetId,
      capabilityKey: decodeURIComponent(match[2]!),
      applicationAssetId,
    });
  }

  private async listManagedTargetCompatiblePlugins(request: HttpRequest) {
    const security = this.securityContext(request);
    const service = this.requireManagedTargetPlugins();
    await assertRouteAction(security, 'plugin.read', 'plugin');
    const managedTargetId = request.path.match(/^\/api\/v1\/managed-targets\/([^/]+)\/compatible-plugins$/)?.[1];
    if (!managedTargetId) throw new Error('受管目标兼容插件路径无效');
    const resolvedManagedTargetId = decodeURIComponent(managedTargetId);
    await this.assertObjectRead(security, 'managed_target', resolvedManagedTargetId);
    const applicationAssetId = queryString(request, 'applicationAssetId');
    if (applicationAssetId) await this.assertObjectRead(security, 'application_asset', applicationAssetId);
    const result = await service.listCompatiblePlugins({
      tenantId: security.tenantId,
      managedTargetId: resolvedManagedTargetId,
      capabilityKey: queryString(request, 'capabilityKey') ?? 'certificate.deploy',
      applicationAssetId,
      locale: queryString(request, 'locale') ?? 'zh-CN',
    });
    return { ...result, items: await this.filterVersionItems(security, result.items, 'pluginVersionId') };
  }

  private async saveApplicationAssetManagedTarget(request: HttpRequest) {
    const security = this.securityContext(request);
    const service = this.requireManagedTargetPlugins();
    await assertRouteAction(security, 'plugin.manage', 'plugin');
    const applicationAssetId = request.path.match(/^\/api\/v1\/application-assets\/([^/]+)\/managed-target$/)?.[1];
    if (!applicationAssetId) throw new Error('应用资产受管目标路径无效');
    const body = validateObject(request.body, {
      managedTargetId: { type: 'string', required: true },
      certificateFormatId: { type: 'string' },
      executionMode: { type: 'string' },
      expectedTargetVersion: { type: 'number' },
      capabilityKey: { type: 'string' },
      pluginOverride: { type: 'object' },
      workflowExecution: { type: 'object' },
    }) as unknown as SaveManagedTargetPluginOverrideInput;
    const resolvedApplicationAssetId = decodeURIComponent(applicationAssetId);
    await this.assertObjectAccess(security, 'application_asset', resolvedApplicationAssetId, 'edit');
    await this.assertObjectAccess(security, 'managed_target', String(body.managedTargetId), 'edit');
    if (body.pluginOverride) {
      if (body.pluginOverride.pluginVersionId) await this.requirePluginVersion(security, body.pluginOverride.pluginVersionId, 'read');
      if (body.pluginOverride.pluginBindingId) {
        const binding = await this.pluginBindings.getTenantBinding(security.tenantId, body.pluginOverride.pluginBindingId);
        await assertRouteObjectAccess(security, 'edit', {
          objectType: 'plugin_binding',
          objectId: binding.id,
          tenantId: binding.tenantId,
        });
      }
    }
    return service.saveApplicationAssetTarget({
      tenantId: security.tenantId,
      applicationAssetId: resolvedApplicationAssetId,
      value: body,
    });
  }

  private async projectApplicationAssetPluginInputs(request: HttpRequest) {
    const security = this.securityContext(request);
    const service = this.requireManagedTargetPlugins();
    await assertRouteAction(security, 'plugin.read', 'plugin');
    const managedTargetId = request.path.match(/^\/api\/v1\/managed-targets\/([^/]+)\/deployment-input-projection$/)?.[1];
    if (!managedTargetId) throw new Error('受管目标部署输入投影路径无效');
    const body = validateObject(request.body, {
      capabilityKey: { type: 'string' },
      pluginVersionId: { type: 'string' },
      certificateFormatId: { type: 'string' },
      deploymentDefaults: { type: 'object' },
      applicationAsset: { type: 'object', required: true },
      inputBindings: { type: 'object' },
    });
    const applicationAsset = body.applicationAsset as Record<string, unknown>;
    const resolvedManagedTargetId = decodeURIComponent(managedTargetId);
    await this.assertObjectRead(security, 'managed_target', resolvedManagedTargetId);
    if (typeof applicationAsset.id === 'string' && applicationAsset.id !== 'draft') {
      await this.assertObjectRead(security, 'application_asset', applicationAsset.id);
    }
    if (typeof body.pluginVersionId === 'string') await this.requirePluginVersion(security, body.pluginVersionId, 'read');
    const commonInput = {
      tenantId: security.tenantId,
      managedTargetId: resolvedManagedTargetId,
      pluginVersionId: typeof body.pluginVersionId === 'string' ? body.pluginVersionId : undefined,
      applicationAsset: {
        id: String(applicationAsset.id ?? 'draft'),
        address: String(applicationAsset.address ?? ''),
        sniName: typeof applicationAsset.sniName === 'string' ? applicationAsset.sniName : undefined,
        verifyUrl: typeof applicationAsset.verifyUrl === 'string' ? applicationAsset.verifyUrl : undefined,
        port: Number(applicationAsset.port),
        protocol: String(applicationAsset.protocol ?? 'HTTPS'),
        displayName: typeof applicationAsset.displayName === 'string' ? applicationAsset.displayName : undefined,
      },
      inputBindings: body.inputBindings as never,
    };
    if (body.deploymentDefaults !== undefined) {
      if (typeof commonInput.pluginVersionId !== 'string') {
        throw new AppError('VALIDATION_FAILED', '使用应用接入默认值投影时必须提供插件版本');
      }
      return service.projectApplicationOnboardingDefaults({
        ...commonInput,
        pluginVersionId: commonInput.pluginVersionId,
        defaults: body.deploymentDefaults as ApplicationOnboardingDeploymentDefaultsV1,
      });
    }
    return service.projectApplicationAssetPluginInputs({
      ...commonInput,
      capabilityKey: typeof body.capabilityKey === 'string' ? body.capabilityKey : undefined,
      certificateFormatId: typeof body.certificateFormatId === 'string' ? body.certificateFormatId : undefined,
    });
  }

  private listStandardFields(request: HttpRequest) {
    const security = this.securityContext(request);
    return assertRouteAction(security, 'plugin.read', 'plugin').then(() => ({ items: this.standardFields.list() }));
  }

  private listPluginCapabilities(request: HttpRequest) {
    const security = this.securityContext(request);
    return assertRouteAction(security, 'plugin.read', 'plugin').then(() => ({ items: this.capabilityRegistry.list() }));
  }

  private async listRuntimeMetrics(request: HttpRequest) {
    const security = this.securityContext(request);
    await assertRouteAction(security, 'plugin.read', 'plugin');
    const items = await this.filterVersionItems(
      security,
      pluginRuntimeGuard.listMetrics(security.tenantId),
      'pluginVersionId',
    );
    return { items, page: 1, pageSize: items.length, total: items.length };
  }

  private securityContext(request: HttpRequest): RouteSecurityContext {
    return requireRouteSecurity(request, this.security);
  }

  private async requirePluginVersion(
    security: RouteSecurityContext,
    pluginVersionId: string,
    accessLevel: 'read' | 'control',
  ) {
    if (!pluginVersionId.trim()) throw new Error('pluginVersionId 不能为空');
    const version = await this.unifiedPlugins.getVersionForTenant(security.tenantId, pluginVersionId);
    const ownerType = unifiedPluginVersionOwnerType(version);
    await assertRouteObjectAccess(security, accessLevel, {
      objectType: 'plugin_version',
      objectId: version.id,
      ownerType,
      tenantId: ownerType === 'SYSTEM' ? undefined : version.tenantId,
    });
    return version;
  }

  private async filterVersionItems<T extends object>(
    security: RouteSecurityContext,
    items: T[],
    objectIdField: string,
  ): Promise<T[]> {
    const decorated = items.map((item) => decorateAuthorizedItem(
      item,
      security.tenantId,
      {
        tenantId: readOptionalString(item, 'tenantId'),
        ownerType: readOwnerType(item),
      },
    ));
    const authorized = await filterAuthorizedItems(security, decorated, 'plugin_version', 'read', objectIdField);
    const allowed = new Set(authorized.map((item) => String((item as Record<string, unknown>)[objectIdField])));
    return items.filter((item) => allowed.has(String((item as Record<string, unknown>)[objectIdField])));
  }

  private async assertObjectRead(security: RouteSecurityContext, objectType: string, objectId: string): Promise<void> {
    await assertRouteObjectAccess(security, 'read', {
      objectType,
      objectId,
      tenantId: security.tenantId,
    });
  }

  private async assertObjectAccess(
    security: RouteSecurityContext,
    objectType: string,
    objectId: string,
    accessLevel: 'read' | 'edit' | 'control',
  ): Promise<void> {
    await assertRouteObjectAccess(security, accessLevel, {
      objectType,
      objectId,
      tenantId: security.tenantId,
    });
  }

  private async assertObjectReadForOwner(
    security: RouteSecurityContext,
    ownerType: string,
    ownerId: string,
  ): Promise<void> {
    const objectType = ownerType === 'DEVICE'
      ? 'device_asset'
      : ownerType === 'MANAGED_TARGET'
        ? 'managed_target'
      : ownerType === 'APPLICATION_ASSET'
          ? 'application_asset'
          : ownerType === 'SERVICE_ASSET'
            ? 'service_asset'
          : ownerType === 'CLOUD_ACCOUNT_ASSET'
            ? 'cloud_account_asset'
          : undefined;
    if (!objectType) throw new Error(`不支持的插件能力所有者类型: ${ownerType}`);
    await this.assertObjectRead(security, objectType, ownerId);
  }

  private async assertPromotionObjects(
    security: RouteSecurityContext,
    record: {
      sourcePluginBindingId: string;
      targetPluginBindingId?: string;
      deviceAssetId?: string;
      applicationAssetId?: string;
    },
    accessLevel: 'read' | 'control' = 'control',
  ): Promise<void> {
    await this.assertObjectAccess(security, 'plugin_binding', record.sourcePluginBindingId, accessLevel);
    if (record.targetPluginBindingId) await this.assertObjectAccess(security, 'plugin_binding', record.targetPluginBindingId, accessLevel);
    if (record.deviceAssetId) await this.assertObjectAccess(security, 'device_asset', record.deviceAssetId, accessLevel);
    if (record.applicationAssetId) await this.assertObjectAccess(security, 'application_asset', record.applicationAssetId, accessLevel);
  }

  private requireManagedTargetPlugins(): ManagedTargetPluginQueryService {
    if (!this.managedTargetPlugins) throw new Error('受管目标插件查询服务未接入');
    return this.managedTargetPlugins;
  }

  private requirePromotions(): PluginPromotionService {
    if (!this.promotions) throw new Error('PluginPromotionService 未配置');
    return this.promotions;
  }

  private async recheckPluginCompatibility(tenantId: string, pluginId: string | undefined): Promise<void> {
    if (!this.executionCompatibility || !pluginId?.trim()) return;
    await this.executionCompatibility.recheckPluginForAssociatedTenants(tenantId, pluginId.trim());
  }

}

function readOptionalString(value: object, key: string): string | undefined {
  const current = (value as Record<string, unknown>)[key];
  return typeof current === 'string' && current.trim() ? current : undefined;
}

function readOwnerType(value: object): 'SYSTEM' | 'TENANT' | undefined {
  const current = (value as Record<string, unknown>).ownerType;
  return current === 'SYSTEM' || current === 'TENANT' ? current : undefined;
}

export function getPluginsRouteContracts(): RouteContract[] {
  return [
    { method: 'GET', path: '/api/v1/plugin-catalog', operationId: 'listPluginCatalog', summary: '查询统一插件目录', tags, responseSchema: pageSchema(pluginCatalogItemSchema()) },
    { method: 'POST', path: '/api/v1/plugin-catalog/refresh-builtins', operationId: 'refreshBuiltinPluginCatalog', summary: '刷新插件目录', tags, responseSchema: refreshCatalogSchema() },
    { method: 'GET', path: '/api/v1/plugin-versions', operationId: 'listUnifiedPluginVersions', summary: '查询统一插件版本', tags, responseSchema: pageSchema(pluginVersionRecordSchema()) },
    { method: 'GET', path: '/api/v1/plugin-version-groups', operationId: 'listPluginVersionGroups', summary: '查询插件版本分组', tags, responseSchema: { type: 'array', items: pluginVersionGroupSchema() } },
    { method: 'GET', path: '/api/v1/plugin-version-management/:pluginVersionId', operationId: 'getPluginVersionManagementDetail', summary: '查询插件版本管理详情', tags, responseSchema: pluginVersionManagementDetailSchema() },
    { method: 'POST', path: '/api/v1/plugin-packages/import', operationId: 'importUnifiedPluginVersion', summary: '导入统一插件版本', tags, requestSchema: importPluginSchema(), responseSchema: pluginVersionRecordSchema() },
    { method: 'POST', path: '/api/v1/plugin-versions/approve-permissions', operationId: 'approveUnifiedPluginPermissions', summary: '审批统一插件权限', tags, requestSchema: pluginVersionActionSchema(['pluginVersionId', 'approvedPermissions']), responseSchema: pluginVersionRecordSchema() },
    { method: 'POST', path: '/api/v1/plugin-versions/enable', operationId: 'enableUnifiedPluginVersion', summary: '启用统一插件版本', tags, requestSchema: pluginVersionActionSchema(['pluginVersionId']), responseSchema: pluginVersionRecordSchema() },
    { method: 'POST', path: '/api/v1/plugin-versions/disable', operationId: 'disableUnifiedPluginVersion', summary: '禁用统一插件版本', tags, requestSchema: pluginVersionActionSchema(['pluginVersionId']), responseSchema: pluginVersionRecordSchema() },
    { method: 'POST', path: '/api/v1/plugin-versions/retire', operationId: 'retireUnifiedPluginVersion', summary: '退休统一插件版本', tags, requestSchema: pluginVersionActionSchema(['pluginVersionId']), responseSchema: pluginVersionRecordSchema() },
    { method: 'GET', path: '/api/v1/plugin-versions/upgrade-diff', operationId: 'getUnifiedPluginUpgradeDiff', summary: '查询统一插件升级差异', tags, responseSchema: upgradeDiffSchema() },
    { method: 'GET', path: '/api/v1/plugin-versions/ui-resources', operationId: 'getUnifiedPluginUiResources', summary: '查询插件表单、展示和语言资源', tags, responseSchema: uiResourcesSchema() },
    { method: 'GET', path: '/api/v1/plugin-versions/:pluginVersionId/resources/logos/:variant', operationId: 'getUnifiedPluginLogo', summary: '读取插件包 Logo 资源', tags, responseSchema: logoResourceSchema(), responseContentType: 'image/svg+xml' },
    { method: 'GET', path: '/api/v1/plugin-form/standard-fields', operationId: 'listPluginStandardFields', summary: '查询插件标准字段', tags, responseSchema: objectPageSchema(standardFieldSchema()) },
    { method: 'GET', path: '/api/v1/plugin-capabilities', operationId: 'listPluginCapabilities', summary: '查询宿主支持的插件能力 Contract', tags, responseSchema: objectPageSchema(capabilityContractSchema()) },
    { method: 'POST', path: '/api/v1/plugin-bindings', operationId: 'createPluginBinding', summary: '创建统一插件绑定', tags, requestSchema: createBindingSchema(), responseSchema: pluginBindingSchema() },
    { method: 'GET', path: '/api/v1/plugin-bindings', operationId: 'getPluginBinding', summary: '查询统一插件绑定', tags, responseSchema: pluginBindingSchema() },
    { method: 'PATCH', path: '/api/v1/plugin-bindings', operationId: 'updatePluginBinding', summary: '更新统一插件绑定', tags, requestSchema: updateBindingSchema(), responseSchema: pluginBindingSchema() },
    { method: 'POST', path: '/api/v1/cloud-account-assets/:id/capability-binding', operationId: 'createCloudAccountCapabilityBinding', summary: '固定云账号插件能力绑定', tags, requestSchema: cloudAccountCapabilityBindingSchema(), responseSchema: jsonObjectSchema() },
    { method: 'POST', path: '/api/v1/capability-assignments', operationId: 'assignPluginCapability', summary: '设置插件能力指派', tags, requestSchema: capabilityAssignmentInputSchema(), responseSchema: capabilityAssignmentSchema() },
    { method: 'POST', path: '/api/v1/capability-assignments/resolve', operationId: 'resolvePluginCapability', summary: '解析插件能力来源', tags, requestSchema: resolveCapabilitySchema(), responseSchema: capabilityAssignmentSchema() },
    { method: 'POST', path: '/api/v1/plugin-promotions/preview', operationId: 'previewPluginPromotion', summary: '预览 Standalone 目标归集', tags, requestSchema: promotionPreviewInputSchema(), responseSchema: promotionPreviewSchema() },
    { method: 'POST', path: '/api/v1/plugin-promotions/confirm', operationId: 'confirmPluginPromotion', summary: '确认 Standalone 目标归集', tags, requestSchema: promotionActionSchema(), responseSchema: promotionRecordSchema() },
    { method: 'POST', path: '/api/v1/plugin-promotions/revoke', operationId: 'revokePluginPromotion', summary: '撤销 Standalone 目标归集', tags, requestSchema: promotionActionSchema(), responseSchema: promotionRecordSchema() },
    { method: 'GET', path: '/api/v1/plugin-promotions', operationId: 'getPluginPromotion', summary: '查询 Standalone 目标归集记录', tags, responseSchema: promotionRecordSchema() },
    { method: 'GET', path: '/api/v1/plugin-runtime/metrics', operationId: 'listPluginRuntimeMetrics', summary: '查询插件运行指标', tags, responseSchema: pageSchema(runtimeMetricSchema()) },
    { method: 'GET', path: '/api/v1/managed-targets/:managedTargetId/deployment-capabilities/:capabilityKey', operationId: 'getManagedTargetEffectiveCapability', summary: '查询受管目标生效部署能力', tags, responseSchema: effectiveCapabilitySchema() },
    { method: 'GET', path: '/api/v1/managed-targets/:managedTargetId/compatible-plugins', operationId: 'listManagedTargetCompatiblePlugins', summary: '查询受管目标兼容插件', tags, responseSchema: objectPageSchema(compatiblePluginSchema()) },
    { method: 'POST', path: '/api/v1/managed-targets/:managedTargetId/deployment-input-projection', operationId: 'projectApplicationAssetPluginInputs', summary: '生成应用资产插件部署输入投影', tags, requestSchema: projectionRequestSchema(), responseSchema: projectionSchema() },
    { method: 'PUT', path: '/api/v1/application-assets/:applicationAssetId/managed-target', operationId: 'saveApplicationAssetManagedTarget', summary: '保存应用资产受管目标和插件覆盖', tags, requestSchema: managedTargetSaveSchema(), responseSchema: managedTargetSaveResultSchema() },
  ];
}

function queryString(request: HttpRequest, key: string): string | undefined {
  return typeof request.query[key] === 'string' ? request.query[key] : undefined;
}

function queryFilterString(request: HttpRequest, key: string): string | undefined {
  return queryString(request, `filter[${key}]`);
}

export function validatePluginRequestObject(input: unknown, schema: ObjectValidationSchema): Record<string, unknown> {
  const value = validateBaseObject(input, schema);
  const allowedFields = new Set(Object.keys(schema));
  const unknownFields = Object.keys(value).filter((field) => !allowedFields.has(field));
  if (unknownFields.length > 0) {
    throw new AppError('VALIDATION_FAILED', '插件请求包含未声明字段', { unknownFields });
  }
  return value;
}

function validateObject(input: unknown, schema: ObjectValidationSchema): Record<string, unknown> {
  return validatePluginRequestObject(input, schema);
}

const idSchema = (): OpenApiSchema => ({ type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$' });
const hashSchema = (): OpenApiSchema => ({ type: 'string', pattern: '^sha256:[0-9a-f]{64}$' });
const stringArraySchema = (): OpenApiSchema => ({ type: 'array', items: { type: 'string' } });
const stringMapSchema = (): OpenApiSchema => ({ type: 'object', additionalProperties: { type: 'string' } });
// 这些字段是资源内容、输入值或审计快照的键值命名空间；开放的是命名空间内的业务键，不是请求包络字段。
const jsonObjectSchema = (): OpenApiSchema => ({ type: 'object', additionalProperties: {} });

function strictSchema(properties: Record<string, OpenApiSchema>, required: string[] = []): OpenApiSchema {
  return { type: 'object', properties, ...(required.length > 0 ? { required } : {}), additionalProperties: false };
}

function pageSchema(item: OpenApiSchema): OpenApiSchema {
  return strictSchema({
    items: { type: 'array', items: item },
    page: { type: 'number' },
    pageSize: { type: 'number' },
    total: { type: 'number' },
  }, ['items', 'page', 'pageSize', 'total']);
}

function objectPageSchema(item: OpenApiSchema): OpenApiSchema {
  return strictSchema({ items: { type: 'array', items: item } }, ['items']);
}

function identityProperties(): Record<string, OpenApiSchema> {
  return {
    pluginId: idSchema(),
    pluginVersionId: idSchema(),
    version: { type: 'string' },
    manifestSha256: hashSchema(),
    packageSha256: hashSchema(),
    resourceSha256: stringMapSchema(),
  };
}

function pluginCapabilitySchema(): OpenApiSchema {
  return strictSchema({
    key: { type: 'string' }, contractVersion: { type: 'string' }, actionContractId: { type: 'string' },
    riskLevel: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
    executionLocations: { type: 'array', items: { type: 'string', enum: ['AGENT', 'CONTROL_PLANE', 'GATEWAY'] } },
    compatibility: jsonObjectSchema(),
  }, ['key', 'contractVersion', 'actionContractId', 'riskLevel', 'executionLocations']);
}

function pluginManifestSchema(): OpenApiSchema {
  return strictSchema({
    apiVersion: { type: 'string' }, kind: { type: 'string' }, pluginId: idSchema(), version: { type: 'string' },
    displayNameKey: { type: 'string' }, descriptionKey: { type: 'string' }, logoUrl: { type: 'string' }, logoSquareUrl: { type: 'string' }, defaultLocale: { type: 'string' },
    publisher: { type: 'string' }, runtime: { type: 'string', enum: ['AGENT_PLAN', 'WORKFLOW_DSL'] },
    source: { type: 'string', enum: ['BUILTIN', 'USER'] }, scope: { type: 'string', enum: ['MANAGED', 'STANDALONE', 'BOTH'] },
    trust: { type: 'string', enum: ['OFFICIAL_SIGNED', 'USER_SIGNED', 'UNSIGNED'] },
    support: { type: 'string', enum: ['OFFICIAL', 'COMMUNITY', 'SELF_MANAGED'] }, minGcacVersion: { type: 'string', pattern: semanticVersionPattern.source },
    capabilities: { type: 'array', items: pluginCapabilitySchema() }, permissions: stringArraySchema(),
    compatibility: strictSchema({ productFamilies: stringArraySchema(), frameworkTypes: stringArraySchema(), targetTypes: stringArraySchema(), managementMethods: stringArraySchema(), executionLocations: stringArraySchema(), artifactContracts: stringArraySchema() }),
    resources: strictSchema({ logos: strictSchema({ horizontal: { type: 'string' }, square: { type: 'string' } }, ['horizontal', 'square']), runtimeEntrypoint: { type: 'string' }, agentPlans: stringMapSchema(), workflows: stringMapSchema(), inputContracts: stringMapSchema(), actionContracts: stringMapSchema(), credentialContracts: stringMapSchema(), forms: stringMapSchema(), presentations: stringMapSchema(), locales: stringMapSchema(), discoveryMappings: stringMapSchema(), agentDiscoveryMappings: stringMapSchema(), onboarding: jsonObjectSchema() }),
  }, ['apiVersion', 'kind', 'pluginId', 'version', 'displayNameKey', 'publisher', 'runtime', 'source', 'scope', 'trust', 'support', 'capabilities', 'permissions', 'resources']);
}

function pluginVersionRecordSchema(): OpenApiSchema {
  return strictSchema({
    id: idSchema(), tenantId: idSchema(), ownerType: { type: 'string', enum: ['SYSTEM', 'TENANT'] }, ownerId: idSchema(),
    ...identityProperties(), source: { type: 'string', enum: ['BUILTIN', 'USER'] }, runtime: { type: 'string', enum: ['AGENT_PLAN', 'WORKFLOW_DSL'] },
    scope: { type: 'string', enum: ['MANAGED', 'STANDALONE', 'BOTH'] }, trust: { type: 'string' }, support: { type: 'string' },
    manifest: pluginManifestSchema(), resources: stringMapSchema(), status: { type: 'string' }, permissionApprovalStatus: { type: 'string' },
    approvedPermissions: stringArraySchema(), validationReport: strictSchema({ valid: { type: 'boolean' }, errors: { type: 'array', items: jsonObjectSchema() }, warnings: { type: 'array', items: jsonObjectSchema() }, manifestSha256: hashSchema(), resourceSha256: stringMapSchema() }, ['valid', 'errors', 'warnings', 'manifestSha256', 'resourceSha256']),
    createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
  }, ['id', 'tenantId', 'pluginId', 'pluginVersionId', 'version', 'source', 'runtime', 'scope', 'trust', 'support', 'packageSha256', 'manifestSha256', 'resourceSha256', 'manifest', 'resources', 'status', 'permissionApprovalStatus', 'approvedPermissions', 'validationReport', 'createdAt', 'updatedAt']);
}

function pluginCatalogItemSchema(): OpenApiSchema {
  return strictSchema({
    id: idSchema(), catalogType: { type: 'string' }, ...identityProperties(), name: { type: 'string' }, displayNameKey: { type: 'string' }, descriptionKey: { type: 'string' }, displayName: { type: 'string' }, description: { type: 'string' }, logoUrl: { type: 'string' }, logoSquareUrl: { type: 'string' }, tags: stringArraySchema(), platforms: stringArraySchema(), stepCount: { type: 'number' }, rollbackCount: { type: 'number' }, configuration: jsonObjectSchema(), source: { type: 'string' }, runtime: { type: 'string' }, scope: { type: 'string' }, trust: { type: 'string' }, support: { type: 'string' }, status: { type: 'string' }, capabilities: { type: 'array', items: pluginCapabilitySchema() }, compatibility: jsonObjectSchema(), detailRef: strictSchema({ pluginVersionId: idSchema() }, ['pluginVersionId']),
  }, ['id', 'catalogType', 'pluginId', 'pluginVersionId', 'version', 'name', 'displayNameKey', 'tags', 'platforms', 'stepCount', 'rollbackCount', 'source', 'runtime', 'scope', 'trust', 'support', 'packageSha256', 'manifestSha256', 'resourceSha256', 'status', 'capabilities', 'detailRef']);
}

function pluginVersionSummarySchema(): OpenApiSchema {
  return strictSchema({ id: idSchema(), ...identityProperties(), source: { type: 'string' }, runtime: { type: 'string' }, scope: { type: 'string' }, status: { type: 'string' }, workflowVersions: { type: 'array', items: jsonObjectSchema() }, references: jsonObjectSchema(), switchable: { type: 'boolean' } }, ['id', 'pluginId', 'version', 'source', 'runtime', 'scope', 'status', 'packageSha256', 'manifestSha256', 'resourceSha256', 'workflowVersions', 'references', 'switchable']);
}

function pluginVersionGroupSchema(): OpenApiSchema {
  return strictSchema({ pluginId: idSchema(), source: { type: 'string', enum: ['BUILTIN', 'USER', 'MIXED'] }, activeVersionId: idSchema(), versions: { type: 'array', items: pluginVersionSummarySchema() } }, ['pluginId', 'source', 'versions']);
}

function pluginVersionManagementDetailSchema(): OpenApiSchema {
  return strictSchema({ ...(pluginVersionSummarySchema().properties ?? {}), tenantId: idSchema(), ownerType: { type: 'string' }, ownerId: idSchema(), trust: { type: 'string' }, support: { type: 'string' }, manifest: pluginManifestSchema(), validationReport: jsonObjectSchema(), visibleToTenant: { type: 'boolean' } }, ['id', 'pluginId', 'version', 'packageSha256', 'manifestSha256', 'resourceSha256', 'tenantId', 'trust', 'support', 'manifest', 'validationReport', 'visibleToTenant']);
}

function importPluginSchema(): OpenApiSchema {
  return strictSchema({ manifest: pluginManifestSchema(), resources: stringMapSchema(), packageContent: { type: 'string', writeOnly: true, 'x-sensitive': true } }, ['manifest']);
}

function pluginVersionActionSchema(required: string[]): OpenApiSchema {
  return strictSchema({ pluginVersionId: idSchema(), approvedPermissions: stringArraySchema() }, required);
}

function inputBindingsSchema(): OpenApiSchema {
  return strictSchema({ apiVersion: { type: 'string' }, variables: jsonObjectSchema(), connections: jsonObjectSchema(), credentials: jsonObjectSchema(), artifacts: jsonObjectSchema() }, ['apiVersion', 'variables', 'connections', 'credentials', 'artifacts']);
}

function pluginBindingSchema(): OpenApiSchema {
  return strictSchema({ id: idSchema(), tenantId: idSchema(), pluginVersionId: idSchema(), mode: { type: 'string', enum: ['MANAGED', 'STANDALONE'] }, inputBindings: inputBindingsSchema(), managedContext: strictSchema({ hostId: idSchema(), managedTargetId: idSchema(), serviceAssetId: idSchema(), assetId: idSchema(), cloudAccountAssetId: idSchema() }), status: { type: 'string' }, version: { type: 'number' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' } }, ['id', 'tenantId', 'pluginVersionId', 'mode', 'inputBindings', 'status', 'version', 'createdAt', 'updatedAt']);
}

function createBindingSchema(): OpenApiSchema { return strictSchema({ pluginVersionId: idSchema(), mode: { type: 'string', enum: ['MANAGED', 'STANDALONE'] }, inputBindings: inputBindingsSchema(), managedContext: strictSchema({ hostId: idSchema(), managedTargetId: idSchema(), serviceAssetId: idSchema(), assetId: idSchema(), cloudAccountAssetId: idSchema() }) }, ['pluginVersionId', 'mode', 'inputBindings']); }
function updateBindingSchema(): OpenApiSchema { return strictSchema({ bindingId: idSchema(), expectedVersion: { type: 'number' }, inputBindings: inputBindingsSchema(), managedContext: strictSchema({ hostId: idSchema(), managedTargetId: idSchema(), serviceAssetId: idSchema(), assetId: idSchema(), cloudAccountAssetId: idSchema() }), status: { type: 'string', enum: ['ACTIVE', 'DISABLED', 'MIGRATING', 'ERROR'] } }, ['bindingId', 'expectedVersion']); }
function capabilityAssignmentInputSchema(): OpenApiSchema { return strictSchema({ ownerType: { type: 'string', enum: ['DEVICE', 'MANAGED_TARGET', 'APPLICATION_ASSET', 'SERVICE_ASSET', 'CLOUD_ACCOUNT_ASSET'] }, ownerId: idSchema(), capabilityKey: { type: 'string' }, pluginVersionId: idSchema(), pluginBindingId: idSchema(), precedence: { type: 'string', enum: ['DEVICE_DEFAULT', 'TARGET_OVERRIDE', 'ASSET_OVERRIDE'] } }, ['ownerType', 'ownerId', 'capabilityKey', 'pluginVersionId', 'pluginBindingId', 'precedence']); }
function capabilityAssignmentSchema(): OpenApiSchema { return strictSchema({ id: idSchema(), tenantId: idSchema(), ...capabilityAssignmentInputSchema().properties, status: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' } }, ['id', 'tenantId', 'ownerType', 'ownerId', 'capabilityKey', 'pluginVersionId', 'pluginBindingId', 'precedence', 'status', 'createdAt', 'updatedAt']); }
function resolveCapabilitySchema(): OpenApiSchema { return strictSchema({ capabilityKey: { type: 'string' }, deviceId: idSchema(), managedTargetId: idSchema(), applicationAssetId: idSchema(), serviceAssetId: idSchema(), cloudAccountAssetId: idSchema() }, ['capabilityKey']); }
function cloudAccountCapabilityBindingSchema(): OpenApiSchema { return strictSchema({ pluginVersionId: idSchema(), capabilityKey: { type: 'string' }, inputBindings: inputBindingsSchema() }, ['pluginVersionId', 'capabilityKey', 'inputBindings']); }
function promotionActionSchema(): OpenApiSchema { return strictSchema({ promotionId: idSchema() }, ['promotionId']); }
function promotionPreviewInputSchema(): OpenApiSchema { return strictSchema({ sourcePluginBindingId: idSchema(), displayName: { type: 'string' }, deviceFamily: { type: 'string' }, managementAddress: { type: 'string' }, managementPort: { type: 'number' }, authMode: { type: 'string' }, tlsVerify: { type: 'boolean' }, gatewayId: idSchema(), applicationAssetId: idSchema(), discovery: jsonObjectSchema() }, ['sourcePluginBindingId', 'displayName', 'deviceFamily', 'managementAddress', 'managementPort', 'authMode', 'tlsVerify', 'discovery']); }
function promotionPreviewSchema(): OpenApiSchema { return strictSchema({ promotionId: idSchema(), status: { type: 'string', enum: ['PREVIEWED', 'CONFLICT'] }, sourcePluginBindingId: idSchema(), pluginVersionId: idSchema(), mappings: jsonObjectSchema(), conflicts: { type: 'array', items: jsonObjectSchema() } }, ['promotionId', 'status', 'sourcePluginBindingId', 'pluginVersionId', 'mappings', 'conflicts']); }
function promotionRecordSchema(): OpenApiSchema { return strictSchema({ id: idSchema(), tenantId: idSchema(), sourcePluginBindingId: idSchema(), targetPluginBindingId: idSchema(), deviceAssetId: idSchema(), applicationAssetId: idSchema(), status: { type: 'string' }, previewSnapshot: jsonObjectSchema(), createdResources: jsonObjectSchema(), errorCode: { type: 'string' }, errorMessage: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' }, completedAt: { type: 'string', format: 'date-time' }, revokedAt: { type: 'string', format: 'date-time' }, version: { type: 'number' } }, ['id', 'tenantId', 'sourcePluginBindingId', 'status', 'previewSnapshot', 'createdResources', 'createdAt', 'updatedAt', 'version']); }
function upgradeDiffSchema(): OpenApiSchema { return strictSchema({ pluginId: idSchema(), fromVersionId: idSchema(), toVersionId: idSchema(), addedCapabilities: stringArraySchema(), removedCapabilities: stringArraySchema(), addedPermissions: stringArraySchema(), removedPermissions: stringArraySchema(), runtimeChanged: { type: 'boolean' }, scopeChanged: { type: 'boolean' }, compatibilityChanged: { type: 'boolean' }, capabilityCompatibilityChanges: { type: 'array', items: jsonObjectSchema() }, bindingRecheckRequired: { type: 'boolean' }, requiresApproval: { type: 'boolean' } }, ['pluginId', 'fromVersionId', 'toVersionId', 'addedCapabilities', 'removedCapabilities', 'addedPermissions', 'removedPermissions', 'runtimeChanged', 'scopeChanged', 'compatibilityChanged', 'capabilityCompatibilityChanges', 'bindingRecheckRequired', 'requiresApproval']); }
function uiResourcesSchema(): OpenApiSchema { return strictSchema({ pluginVersionId: idSchema(), forms: jsonObjectSchema(), presentations: jsonObjectSchema(), locale: jsonObjectSchema() }, ['pluginVersionId', 'forms', 'presentations']); }
function logoResourceSchema(): OpenApiSchema { return { type: 'string', format: 'binary', description: '插件包内固定尺寸 SVG Logo' }; }
function standardFieldSchema(): OpenApiSchema { return strictSchema({ key: { type: 'string' }, type: { type: 'string' }, labelKey: { type: 'string' }, sensitive: { type: 'boolean' }, valueKind: { type: 'string' }, supportedModes: stringArraySchema(), required: { type: 'boolean' }, defaultValue: jsonObjectSchema(), validation: jsonObjectSchema() }, ['key', 'type', 'labelKey', 'sensitive', 'valueKind', 'supportedModes']); }
function capabilityContractSchema(): OpenApiSchema { return strictSchema({ key: { type: 'string' }, contractVersion: { type: 'string' }, actionContractId: { type: 'string' }, riskLevel: { type: 'string' }, idempotency: { type: 'string' }, permission: { type: 'string' }, inputSchemaId: { type: 'string' }, outputSchemaId: { type: 'string' }, resourceLock: { type: 'string' }, executionLocations: stringArraySchema() }, ['key', 'contractVersion', 'actionContractId', 'riskLevel', 'idempotency', 'permission', 'inputSchemaId', 'outputSchemaId', 'resourceLock', 'executionLocations']); }
function runtimeMetricSchema(): OpenApiSchema { return strictSchema({ tenantId: idSchema(), pluginVersionId: idSchema(), capabilityKey: { type: 'string' }, started: { type: 'number' }, succeeded: { type: 'number' }, failed: { type: 'number' }, rejected: { type: 'number' }, inFlight: { type: 'number' }, circuitState: { type: 'string', enum: ['CLOSED', 'OPEN'] }, lastDurationMilliseconds: { type: 'number' }, lastError: { type: 'string' } }, ['tenantId', 'pluginVersionId', 'capabilityKey', 'started', 'succeeded', 'failed', 'rejected', 'inFlight', 'circuitState']); }
function compatiblePluginSchema(): OpenApiSchema { return strictSchema({ ...identityProperties(), runtime: { type: 'string' }, displayNameKey: { type: 'string' }, displayName: { type: 'string' }, compatible: { type: 'boolean' }, compatibilityStatus: { type: 'string', enum: ['COMPATIBLE', 'INCOMPATIBLE', 'UNKNOWN'] }, compatibility: jsonObjectSchema(), executionLocations: stringArraySchema(), reasons: { type: 'array', items: jsonObjectSchema() } }, ['pluginId', 'pluginVersionId', 'version', 'runtime', 'packageSha256', 'manifestSha256', 'resourceSha256', 'displayNameKey', 'compatible', 'executionLocations', 'reasons']); }
function effectiveCapabilitySchema(): OpenApiSchema {
  return strictSchema({
    capabilityKey: { type: 'string' },
    source: strictSchema({ ownerType: { type: 'string' }, ownerId: idSchema(), precedence: { type: 'string' }, assignmentId: idSchema() }, ['ownerType', 'ownerId', 'precedence', 'assignmentId']),
    plugin: strictSchema({ pluginVersionId: idSchema(), pluginId: idSchema(), version: { type: 'string' }, runtime: { type: 'string' }, packageSha256: hashSchema(), manifestSha256: hashSchema(), resourceSha256: stringMapSchema() }, ['pluginVersionId', 'pluginId', 'version', 'runtime', 'packageSha256', 'manifestSha256', 'resourceSha256']),
    binding: strictSchema({ pluginBindingId: idSchema(), hostId: idSchema(), managedTargetId: idSchema(), status: { type: 'string' }, version: { type: 'number' } }, ['pluginBindingId', 'status', 'version']),
    executionLocation: { type: 'string' }, compatible: { type: 'boolean' }, compatibilityStatus: { type: 'string' }, compatibilityInputs: jsonObjectSchema(), reasons: { type: 'array', items: jsonObjectSchema() },
  }, ['capabilityKey', 'source', 'plugin', 'binding', 'executionLocation', 'compatible', 'reasons']);
}
function projectionRequestSchema(): OpenApiSchema { return strictSchema({ capabilityKey: { type: 'string' }, pluginVersionId: idSchema(), certificateFormatId: idSchema(), deploymentDefaults: jsonObjectSchema(), applicationAsset: strictSchema({ id: idSchema(), address: { type: 'string' }, sniName: { type: 'string' }, verifyUrl: { type: 'string' }, port: { type: 'number' }, protocol: { type: 'string' }, displayName: { type: 'string' } }, ['id', 'address', 'port', 'protocol']), inputBindings: inputBindingsSchema() }, ['applicationAsset']); }
function projectionSchema(): OpenApiSchema { return strictSchema({ contractVersion: { type: 'string' }, requiredVariables: { type: 'array', items: jsonObjectSchema() }, advancedVariables: { type: 'array', items: jsonObjectSchema() }, connections: { type: 'array', items: jsonObjectSchema() }, credentials: { type: 'array', items: jsonObjectSchema() }, artifacts: { type: 'array', items: jsonObjectSchema() }, fixedValues: { type: 'array', items: jsonObjectSchema() }, runtimeValues: { type: 'array', items: jsonObjectSchema() }, issues: { type: 'array', items: jsonObjectSchema() }, saveable: { type: 'boolean' } }, ['contractVersion', 'requiredVariables', 'advancedVariables', 'connections', 'credentials', 'artifacts', 'fixedValues', 'runtimeValues', 'issues', 'saveable']); }
function managedTargetSaveSchema(): OpenApiSchema { return strictSchema({ managedTargetId: idSchema(), certificateFormatId: idSchema(), executionMode: { type: 'string', enum: ['PLUGIN', 'WORKFLOW_OVERRIDE'] }, expectedTargetVersion: { type: 'number' }, capabilityKey: { type: 'string' }, pluginOverride: strictSchema({ pluginId: idSchema(), pluginVersionId: idSchema(), pluginBindingId: idSchema(), expectedBindingVersion: { type: 'number' }, inputBindings: inputBindingsSchema() }), workflowExecution: jsonObjectSchema() }, ['managedTargetId']); }
function managedTargetSaveResultSchema(): OpenApiSchema { return strictSchema({ target: jsonObjectSchema(), executionMode: { type: 'string' }, workflowExecutionBinding: jsonObjectSchema(), effectiveCapability: effectiveCapabilitySchema() }, ['target', 'executionMode']); }
function refreshCatalogSchema(): OpenApiSchema {
  const version = strictSchema({ id: idSchema(), pluginId: idSchema(), version: { type: 'string' }, status: { type: 'string' } }, ['id', 'pluginId', 'version', 'status']);
  const change = strictSchema({ pluginId: idSchema(), before: version, after: version, changeType: { type: 'string', enum: ['ADDED', 'UPDATED', 'REMOVED', 'UNCHANGED'] } }, ['pluginId', 'changeType']);
  return strictSchema({
    refreshedAt: { type: 'string', format: 'date-time' },
    versions: { type: 'array', items: version },
    beforeVersions: { type: 'array', items: version },
    changes: { type: 'array', items: change },
    projection: jsonObjectSchema(),
  }, ['refreshedAt', 'versions']);
}

function withPluginVersionIdentity<T extends { id: string }>(version: T): T & { pluginVersionId: string } {
  return { ...version, pluginVersionId: version.id };
}
